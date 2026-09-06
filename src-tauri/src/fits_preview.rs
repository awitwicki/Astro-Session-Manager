use std::num::NonZeroUsize;
use std::path::Path;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Instant;

use astroimage::{encode_jpeg, ImageConverter, ProcessedImage, ThreadPoolBuilder};
use base64::{engine::general_purpose::STANDARD, Engine};
use lru::LruCache;

use crate::fits_parser;
use crate::single_flight::SingleFlight;
use crate::types::FitsPreviewResult;
use crate::xisf_parser;

const MAX_PREVIEW_WIDTH: u32 = 1920;
const MAX_PREVIEW_HEIGHT: u32 = 1080;
const JPEG_QUALITY: u8 = 90;
const ENTRY_OVERHEAD_BYTES: usize = 4096;
const TTL_SECONDS: u64 = 30 * 60; // 30 minutes

// ─── Shared rayon thread pool ────────────────────────────────────────────────

static THREAD_POOL: OnceLock<Arc<astroimage::ThreadPool>> = OnceLock::new();

fn cpu_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

fn get_thread_pool() -> Arc<astroimage::ThreadPool> {
    Arc::clone(THREAD_POOL.get_or_init(|| {
        Arc::new(
            ThreadPoolBuilder::new()
                .num_threads(cpu_count())
                .build()
                .unwrap(),
        )
    }))
}

// ─── Runtime configuration ───────────────────────────────────────────────────

struct CacheConfig {
    max_bytes: usize,
    concurrency: usize,
}

static CACHE_CONFIG: OnceLock<RwLock<CacheConfig>> = OnceLock::new();

fn get_config() -> &'static RwLock<CacheConfig> {
    CACHE_CONFIG.get_or_init(|| {
        RwLock::new(CacheConfig {
            max_bytes: 500 * 1024 * 1024,
            concurrency: cpu_count().min(8),
        })
    })
}

/// Initialize config from saved AppSettings. Call once during app setup.
pub fn init_config(max_mb: u32, concurrency: u32) {
    let config = get_config();
    let mut c = config.write().unwrap();
    c.max_bytes = (max_mb as usize) * 1024 * 1024;
    c.concurrency = (concurrency as usize).max(1).min(16);
}

/// Update cache configuration at runtime (called from settings command).
pub fn update_config(max_mb: u32, concurrency: u32) {
    {
        let mut config = get_config().write().unwrap();
        config.max_bytes = (max_mb as usize) * 1024 * 1024;
        config.concurrency = (concurrency as usize).max(1).min(16);
    }
    // Enforce new size limit on existing cache
    enforce_size_limit();
}

/// Read current concurrency limit.
pub fn concurrent_limit() -> usize {
    get_config().read().unwrap().concurrency
}

// ─── LRU Cache ───────────────────────────────────────────────────────────────

struct CacheEntry {
    result: Arc<FitsPreviewResult>,
    inserted_at: Instant,
    byte_size: usize,
}

struct PreviewCache {
    lru: LruCache<String, CacheEntry>,
    total_bytes: usize,
}

static RESULT_CACHE: OnceLock<RwLock<PreviewCache>> = OnceLock::new();

fn get_cache() -> &'static RwLock<PreviewCache> {
    RESULT_CACHE.get_or_init(|| {
        RwLock::new(PreviewCache {
            lru: LruCache::new(NonZeroUsize::new(2000).unwrap()),
            total_bytes: 0,
        })
    })
}

fn entry_size(result: &FitsPreviewResult) -> usize {
    result.image_data.len() + ENTRY_OVERHEAD_BYTES
}

/// Evict LRU entries until total_bytes is within max_bytes.
fn enforce_size_limit() {
    let max_bytes = get_config().read().unwrap().max_bytes;
    let mut cache = get_cache().write().unwrap();
    while cache.total_bytes > max_bytes {
        if let Some((_key, entry)) = cache.lru.pop_lru() {
            cache.total_bytes = cache.total_bytes.saturating_sub(entry.byte_size);
        } else {
            break;
        }
    }
}

/// Remove entries older than TTL_SECONDS. Called by background sweeper.
pub fn evict_stale() {
    let now = Instant::now();
    let mut cache = get_cache().write().unwrap();
    let mut stale_keys = Vec::new();

    for (key, entry) in cache.lru.iter() {
        if now.duration_since(entry.inserted_at).as_secs() > TTL_SECONDS {
            stale_keys.push(key.clone());
        }
    }

    for key in stale_keys {
        if let Some(entry) = cache.lru.pop(&key) {
            cache.total_bytes = cache.total_bytes.saturating_sub(entry.byte_size);
        }
    }
}

/// Return current cache usage in bytes and the configured limit.
pub fn cache_stats() -> (usize, usize) {
    let used = get_cache().read().unwrap().total_bytes;
    let max = get_config().read().unwrap().max_bytes;
    (used, max)
}

// ─── Header reader ───────────────────────────────────────────────────────────

fn read_header(file_path: &str) -> Result<crate::types::FitsHeader, String> {
    if file_path.to_lowercase().ends_with(".xisf") {
        xisf_parser::read_xisf_header(file_path)
    } else {
        fits_parser::read_fits_header(file_path)
    }
}

/// Encode a ProcessedImage as JPEG in memory and return base64 string.
///
/// Uses rustafits' own encoder (pure-Rust libjpeg-turbo with SIMD paths)
/// straight from the processed RGB buffer — no intermediate image buffer.
fn encode_jpeg_base64(processed: &ProcessedImage) -> Result<(String, u32, u32), String> {
    let jpeg = encode_jpeg(
        &processed.data,
        processed.width,
        processed.height,
        processed.channels as usize,
        JPEG_QUALITY,
    )
    .map_err(|e| format!("Failed to encode JPEG: {:#}", e))?;

    Ok((
        STANDARD.encode(jpeg),
        processed.width as u32,
        processed.height as u32,
    ))
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Fast path: check RAM cache without any processing.
/// Uses `peek` (read-only, no LRU promotion) to avoid write-lock contention
/// in the batch path where many tasks check cache concurrently.
pub fn try_cache(file_path: &str) -> Option<Arc<FitsPreviewResult>> {
    let cache = get_cache().read().unwrap();
    cache.lru.peek(file_path).map(|entry| Arc::clone(&entry.result))
}

/// Cache check with LRU promotion (requires write lock).
/// Used by single-file `get_fits_preview` where promotion matters.
fn try_cache_promote(file_path: &str) -> Option<Arc<FitsPreviewResult>> {
    let mut cache = get_cache().write().unwrap();
    cache.lru.get(file_path).map(|entry| Arc::clone(&entry.result))
}

static GENERATION_FLIGHT: OnceLock<SingleFlight<Result<Arc<FitsPreviewResult>, String>>> =
    OnceLock::new();

fn generation_flight() -> &'static SingleFlight<Result<Arc<FitsPreviewResult>, String>> {
    GENERATION_FLIGHT.get_or_init(SingleFlight::new)
}

/// Slow path: process FITS/XISF → JPEG base64, insert into cache.
/// Caller is responsible for concurrency control (semaphore).
///
/// Single-flight per path: the queue worker and a direct `get_fits_preview`
/// command frequently request the same file at the same time (the detail view
/// enqueues the selected frame *and* fetches it directly) — the second caller
/// waits for the first generation instead of duplicating it.
pub fn generate_preview(file_path: &str) -> Result<Arc<FitsPreviewResult>, String> {
    generation_flight().run(file_path, || {
        // A follower that arrives just after the leader finished lands here
        // on a fresh flight — the cache check keeps that from regenerating.
        if let Some(cached) = try_cache(file_path) {
            return Ok(cached);
        }
        generate_preview_inner(file_path)
    })
}

fn generate_preview_inner(file_path: &str) -> Result<Arc<FitsPreviewResult>, String> {
    // Validate file exists before doing expensive work
    if !Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let pool = get_thread_pool();
    let header = read_header(file_path)?;
    let original_width = header.naxis1 as u32;
    let original_height = header.naxis2 as u32;

    // Compute downscale factor to fit within preview bounds
    let downscale_w = (original_width + MAX_PREVIEW_WIDTH - 1) / MAX_PREVIEW_WIDTH;
    let downscale_h = (original_height + MAX_PREVIEW_HEIGHT - 1) / MAX_PREVIEW_HEIGHT;
    let downscale = downscale_w.max(downscale_h).max(1) as usize;

    // Build converter with shared thread pool
    let mut converter = ImageConverter::new()
        .with_thread_pool(Arc::clone(&pool))
        .with_downscale(downscale);

    if downscale <= 2 {
        converter = converter.with_preview_mode();
    }

    // Read the raw samples on the shared pool too: the FITS/XISF readers
    // convert sample chunks with rayon, and running them outside `install`
    // would spill that work onto the global pool.
    let (mut meta, pixels) = pool
        .install(|| ImageConverter::read_raw(file_path))
        .map_err(|e| format!("{:#}", e))?;

    // rustafits 1.0 changed the default FITS row order: a file with no ROWORDER
    // keyword is treated as bottom-up and flipped vertically to match
    // PixInsight, whereas 0.9.x left it unflipped. Previews must stay in raw
    // orientation so they line up with the star-detection coordinates the
    // detail view overlays (the analyzer always works in raw, unflipped pixel
    // space). Clearing the flag before processing skips the flip inside the
    // pipeline instead of applying it and undoing it afterwards. XISF
    // orientation is unchanged across versions, so leave it as read.
    if !file_path.to_lowercase().ends_with(".xisf") {
        meta.flip_vertical = false;
    }

    let processed = converter
        .process_data(meta, pixels)
        .map_err(|e| format!("{:#}", e))?;

    let (image_data, width, height) = encode_jpeg_base64(&processed)?;

    let result = FitsPreviewResult {
        image_data,
        width,
        height,
        original_width,
        original_height,
        header,
    };

    let size = entry_size(&result);
    let arc_result = Arc::new(result);

    // Insert into LRU cache, evicting if needed
    {
        let max_bytes = get_config().read().unwrap().max_bytes;
        let mut cache = get_cache().write().unwrap();

        // Evict LRU entries until there's room
        while cache.total_bytes + size > max_bytes {
            if let Some((_key, evicted)) = cache.lru.pop_lru() {
                cache.total_bytes = cache.total_bytes.saturating_sub(evicted.byte_size);
            } else {
                break;
            }
        }

        // Handle possible overwrite of existing entry for same key
        let old = cache.lru.put(
            file_path.to_string(),
            CacheEntry {
                result: Arc::clone(&arc_result),
                inserted_at: Instant::now(),
                byte_size: size,
            },
        );
        if let Some(old_entry) = old {
            cache.total_bytes = cache.total_bytes.saturating_sub(old_entry.byte_size);
        }
        cache.total_bytes += size;
    }

    Ok(arc_result)
}

/// Single-file preview: cache check with LRU promotion → generate.
pub fn get_fits_preview(file_path: &str) -> Result<Arc<FitsPreviewResult>, String> {
    if let Some(cached) = try_cache_promote(file_path) {
        return Ok(cached);
    }
    generate_preview(file_path)
}

/// Clear all preview data from RAM.
pub fn clear_preview_cache() {
    let mut cache = get_cache().write().unwrap();
    cache.lru.clear();
    cache.total_bytes = 0;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fits_writer::{write_fits_u16, FitsMetadata};

    /// A 16-bit FITS with a bright band in its first rows (raw file order, no
    /// ROWORDER keyword). rustafits ≥ 1.0 treats such a file as bottom-up and
    /// would flip it for display; the preview must stay in raw orientation so
    /// it lines up with star-detection coordinates — the band has to come out
    /// at the top of the JPEG.
    #[test]
    fn fits_preview_keeps_raw_row_order() {
        let (width, height) = (64usize, 32usize);
        // Background with a little deterministic noise so the auto-stretch has
        // a non-zero MAD to work with; a saturated band in rows 0..8.
        let mut seed = 12345u32;
        let mut noise = || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            ((seed >> 16) % 200) as u16
        };
        let mut pixels = vec![0u16; width * height];
        for row in 0..height {
            for col in 0..width {
                let base = if row < 8 { 60_000 } else { 1_000 };
                pixels[row * width + col] = base + noise();
            }
        }

        let path = std::env::temp_dir().join(format!(
            "asm-preview-roworder-{}.fits",
            std::process::id()
        ));
        write_fits_u16(
            &path,
            &pixels,
            &FitsMetadata {
                width,
                height,
                exptime: None,
                gain: None,
                date_obs: None,
                instrume: None,
                bayerpat: None,
            },
        )
        .unwrap();

        let result = generate_preview(path.to_str().unwrap());
        let _ = std::fs::remove_file(&path);
        let result = result.unwrap();

        // downscale 1 → preview mode → 2×2 binning
        assert_eq!((result.original_width, result.original_height), (64, 32));
        assert_eq!((result.width, result.height), (32, 16));

        let jpeg = STANDARD.decode(&result.image_data).unwrap();
        let img = image::load_from_memory(&jpeg).unwrap().to_luma8();
        assert_eq!(img.dimensions(), (32, 16));

        let mean = |rows: std::ops::Range<u32>| -> f64 {
            let mut sum = 0u64;
            let mut n = 0u64;
            for y in rows {
                for x in 0..32 {
                    sum += img.get_pixel(x, y).0[0] as u64;
                    n += 1;
                }
            }
            sum as f64 / n as f64
        };
        let top = mean(0..4);
        let bottom = mean(12..16);
        assert!(
            top > bottom + 50.0,
            "bright band must stay at the top: top={top} bottom={bottom}"
        );
    }
}
