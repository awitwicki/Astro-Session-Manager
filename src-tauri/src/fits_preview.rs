use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use astroimage::ImageConverter;
use image::{ImageBuffer, Rgb, RgbImage};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::fits_parser;
use crate::types::{FitsHeader, FitsPreviewResult, PreviewProgress};
use crate::xisf_parser;

const MAX_PREVIEW_WIDTH: u32 = 1920;
const MAX_PREVIEW_HEIGHT: u32 = 1080;

// ─── In-memory cache for processed preview data ─────────────────────────────

struct CachedPreviewData {
    header: FitsHeader,
    /// Processed u8 pixels from rustafits — interleaved RGB.
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    original_width: u32,
    original_height: u32,
}

static PREVIEW_CACHE: Mutex<Option<HashMap<String, CachedPreviewData>>> = Mutex::new(None);

fn ensure_cache() {
    let mut cache = PREVIEW_CACHE.lock().unwrap();
    if cache.is_none() {
        *cache = Some(HashMap::new());
    }
}

// ─── Preview cache directory ────────────────────────────────────────────────

fn get_preview_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?;

    let preview_dir = cache_dir.join("previews");
    fs::create_dir_all(&preview_dir)
        .map_err(|e| format!("Failed to create preview cache dir: {}", e))?;

    Ok(preview_dir)
}

fn preview_cache_key(file_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("preview|{}", file_path));
    let result = hasher.finalize();
    hex::encode(&result[..12])
}

// ─── Load and cache intermediate data ───────────────────────────────────────

fn load_and_cache_preview(file_path: &str) -> Result<(), String> {
    // Read header for metadata (FITS or XISF)
    let header = if file_path.to_lowercase().ends_with(".xisf") {
        xisf_parser::read_xisf_header(file_path)?
    } else {
        fits_parser::read_fits_header(file_path)?
    };
    let orig_w = header.naxis1 as u32;
    let orig_h = header.naxis2 as u32;

    // Compute downscale factor to fit within preview bounds
    let downscale_w = (orig_w + MAX_PREVIEW_WIDTH - 1) / MAX_PREVIEW_WIDTH;
    let downscale_h = (orig_h + MAX_PREVIEW_HEIGHT - 1) / MAX_PREVIEW_HEIGHT;
    let downscale = downscale_w.max(downscale_h).max(1) as usize;

    // Process with rustafits
    let processed = ImageConverter::new()
        .with_downscale(downscale)
        .process(file_path)
        .map_err(|e| format!("Failed to process image: {}", e))?;

    let w = processed.width as u32;
    let h = processed.height as u32;

    ensure_cache();
    let mut cache = PREVIEW_CACHE.lock().unwrap();
    let map = cache.as_mut().unwrap();
    map.insert(
        file_path.to_string(),
        CachedPreviewData {
            header,
            pixels: processed.data,
            width: w,
            height: h,
            original_width: orig_w,
            original_height: orig_h,
        },
    );

    Ok(())
}

/// Render the cached preview data to a PNG.
fn render_cached_to_png(
    file_path: &str,
    app_handle: &tauri::AppHandle,
) -> Result<FitsPreviewResult, String> {
    let cache = PREVIEW_CACHE.lock().unwrap();
    let map = cache.as_ref().ok_or("Preview cache not initialized")?;
    let data = map
        .get(file_path)
        .ok_or("No preview data cached for this file")?;

    let preview_dir = get_preview_dir(app_handle)?;
    let key = preview_cache_key(file_path);
    let output_path = preview_dir.join(format!("{}.png", key));

    let w = data.width;
    let h = data.height;

    if !output_path.exists() {
        let img: RgbImage = ImageBuffer::from_fn(w, h, |x, y| {
            let i = (y as usize * data.width as usize + x as usize) * 3;
            Rgb([data.pixels[i], data.pixels[i + 1], data.pixels[i + 2]])
        });
        img.save(&output_path)
            .map_err(|e| format!("Failed to save preview: {}", e))?;
    }

    Ok(FitsPreviewResult {
        image_path: output_path.to_string_lossy().to_string(),
        width: w,
        height: h,
        original_width: data.original_width,
        original_height: data.original_height,
        header: data.header.clone(),
    })
}

/// Check if a preview PNG already exists on disk (without needing RAM cache).
/// Returns header + path if the PNG is present.
fn try_disk_cache(
    file_path: &str,
    app_handle: &tauri::AppHandle,
) -> Option<FitsPreviewResult> {
    let preview_dir = get_preview_dir(app_handle).ok()?;
    let key = preview_cache_key(file_path);
    let output_path = preview_dir.join(format!("{}.png", key));

    if !output_path.exists() {
        return None;
    }

    // Read PNG dimensions
    let img = image::open(&output_path).ok()?;
    let w = img.width();
    let h = img.height();

    // Read header for metadata
    let header = if file_path.to_lowercase().ends_with(".xisf") {
        xisf_parser::read_xisf_header(file_path).ok()?
    } else {
        fits_parser::read_fits_header(file_path).ok()?
    };
    let orig_w = header.naxis1 as u32;
    let orig_h = header.naxis2 as u32;

    Some(FitsPreviewResult {
        image_path: output_path.to_string_lossy().to_string(),
        width: w,
        height: h,
        original_width: orig_w,
        original_height: orig_h,
        header,
    })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Load a FITS/XISF file, process with rustafits, return PNG path.
pub fn get_fits_preview(
    file_path: &str,
    app_handle: &tauri::AppHandle,
) -> Result<FitsPreviewResult, String> {
    // Check if already cached in RAM
    {
        ensure_cache();
        let cache = PREVIEW_CACHE.lock().unwrap();
        let map = cache.as_ref().unwrap();
        if map.contains_key(file_path) {
            drop(cache);
            return render_cached_to_png(file_path, app_handle);
        }
    }

    // Check if PNG already exists on disk (survives RAM cache clears)
    if let Some(result) = try_disk_cache(file_path, app_handle) {
        return Ok(result);
    }

    // Load fresh
    load_and_cache_preview(file_path)?;
    render_cached_to_png(file_path, app_handle)
}

/// Batch generate previews for multiple files.
/// Emits `preview:progress` events for each file processed.
pub fn batch_generate_previews(
    window: &tauri::Window,
    file_paths: &[String],
    app_handle: &tauri::AppHandle,
) -> Result<HashMap<String, FitsPreviewResult>, String> {
    let total = file_paths.len();
    let mut results: HashMap<String, FitsPreviewResult> = HashMap::new();

    for (i, file_path) in file_paths.iter().enumerate() {
        // Check if already in RAM cache
        {
            ensure_cache();
            let cache = PREVIEW_CACHE.lock().unwrap();
            let map = cache.as_ref().unwrap();
            if map.contains_key(file_path.as_str()) {
                drop(cache);
                if let Ok(result) = render_cached_to_png(file_path, app_handle) {
                    results.insert(file_path.clone(), result);
                }
                let _ = window.emit(
                    "preview:progress",
                    PreviewProgress {
                        current: i + 1,
                        total,
                        file_path: file_path.clone(),
                    },
                );
                continue;
            }
        }

        // Check if PNG already exists on disk
        if let Some(result) = try_disk_cache(file_path, app_handle) {
            results.insert(file_path.clone(), result);
            let _ = window.emit(
                "preview:progress",
                PreviewProgress {
                    current: i + 1,
                    total,
                    file_path: file_path.clone(),
                },
            );
            continue;
        }

        // Generate fresh
        match load_and_cache_preview(file_path) {
            Ok(()) => {
                if let Ok(result) = render_cached_to_png(file_path, app_handle) {
                    results.insert(file_path.clone(), result);
                }
            }
            Err(e) => {
                eprintln!("Failed to generate preview for {}: {}", file_path, e);
            }
        }

        let _ = window.emit(
            "preview:progress",
            PreviewProgress {
                current: i + 1,
                total,
                file_path: file_path.clone(),
            },
        );
    }

    Ok(results)
}

/// Clear all preview data from RAM.
pub fn clear_preview_cache() {
    let mut cache = PREVIEW_CACHE.lock().unwrap();
    if let Some(map) = cache.as_mut() {
        map.clear();
    }
}
