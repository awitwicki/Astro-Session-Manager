use std::io::Cursor;
use std::num::NonZeroUsize;
use std::path::Path;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Instant;

use astroimage::{ImageConverter, ProcessedImage, ThreadPoolBuilder};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, Rgb};
use lru::LruCache;

use crate::fits_parser;
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
fn encode_jpeg_base64(processed: ProcessedImage) -> Result<(String, u32, u32), String> {
    let width = processed.width as u32;
    let height = processed.height as u32;

    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, processed.data)
            .ok_or("Failed to create image buffer from processed data")?;

    let mut buf = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
    img.write_with_encoder(encoder)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

    let base64_str = STANDARD.encode(buf.into_inner());
    Ok((base64_str, width, height))
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

/// Slow path: process FITS/XISF → JPEG base64, insert into cache.
/// Caller is responsible for concurrency control (semaphore).
pub fn generate_preview(file_path: &str) -> Result<Arc<FitsPreviewResult>, String> {
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
        .with_thread_pool(pool)
        .with_downscale(downscale);

    if downscale <= 2 {
        converter = converter.with_preview_mode();
    }

    let processed = converter
        .process(file_path)
        .map_err(|e| format!("Failed to process image: {}", e))?;

    let (image_data, width, height) = encode_jpeg_base64(processed)?;

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
