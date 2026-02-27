use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex, OnceLock};

use astroimage::{ImageConverter, ProcessedImage, ThreadPoolBuilder};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, Rgb};

use crate::fits_parser;
use crate::types::FitsPreviewResult;
use crate::xisf_parser;

const MAX_PREVIEW_WIDTH: u32 = 1920;
const MAX_PREVIEW_HEIGHT: u32 = 1080;
const JPEG_QUALITY: u8 = 90;

// ─── Shared rayon thread pool for concurrent image processing ───────────────

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

/// Max concurrent image processing operations (semaphore permits).
pub fn concurrent_limit() -> usize {
    cpu_count().min(8)
}

// ─── In-memory cache for preview results ─────────────────────────────────

static RESULT_CACHE: Mutex<Option<HashMap<String, FitsPreviewResult>>> = Mutex::new(None);

fn ensure_cache() {
    let mut cache = RESULT_CACHE.lock().unwrap();
    if cache.is_none() {
        *cache = Some(HashMap::new());
    }
}

// ─── Header reader ──────────────────────────────────────────────────────────

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

// ─── Public API ─────────────────────────────────────────────────────────────

/// Fast path: check RAM cache without any processing.
/// Returns instantly — no semaphore needed.
pub fn try_cache(file_path: &str) -> Option<FitsPreviewResult> {
    ensure_cache();
    let cache = RESULT_CACHE.lock().unwrap();
    cache.as_ref().unwrap().get(file_path).cloned()
}

/// Slow path: process FITS/XISF → JPEG base64, insert into cache.
/// Caller is responsible for concurrency control (semaphore).
pub fn generate_preview(file_path: &str) -> Result<FitsPreviewResult, String> {
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

    // Use preview mode (2x2 binning during read) when downscale is small —
    // processes 4x less data from the start, major speed win.
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

    // Insert into RAM cache
    ensure_cache();
    let mut cache = RESULT_CACHE.lock().unwrap();
    cache
        .as_mut()
        .unwrap()
        .insert(file_path.to_string(), result.clone());

    Ok(result)
}

/// Single-file preview: cache check → generate.
pub fn get_fits_preview(file_path: &str) -> Result<FitsPreviewResult, String> {
    if let Some(cached) = try_cache(file_path) {
        return Ok(cached);
    }
    generate_preview(file_path)
}

/// Clear all preview data from RAM.
pub fn clear_preview_cache() {
    let mut cache = RESULT_CACHE.lock().unwrap();
    if let Some(map) = cache.as_mut() {
        map.clear();
    }
}
