use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use image::{ImageBuffer, Rgb, RgbImage};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tauri::Manager;

use crate::types::{CacheSizeInfo, ThumbnailProgress, ThumbnailResult};

/// Get the thumbnail cache directory
fn get_cache_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?;

    let thumb_dir = cache_dir.join("thumbnails");
    fs::create_dir_all(&thumb_dir)
        .map_err(|e| format!("Failed to create thumbnail cache dir: {}", e))?;

    Ok(thumb_dir)
}

/// Compute a cache key from filepath + size + mtime using SHA256
fn compute_cache_key(file_path: &str, size_bytes: u64, mtime_ms: u128) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}|{}|{}", file_path, size_bytes, mtime_ms));
    let result = hasher.finalize();
    // Take first 16 hex characters (same as TypeScript version)
    hex::encode(&result[..8])
}

/// Generate a dummy chess/checkerboard pattern PNG image (400x400, 8x8 grid)
fn generate_chess_pattern(output_path: &Path) -> Result<(), String> {
    let width: u32 = 400;
    let height: u32 = 400;
    let grid_size: u32 = 8;
    let cell_width = width / grid_size;
    let cell_height = height / grid_size;

    let dark = Rgb([30u8, 30u8, 30u8]); // dark gray
    let light = Rgb([60u8, 60u8, 60u8]); // slightly lighter gray

    let img: RgbImage = ImageBuffer::from_fn(width, height, |x, y| {
        let col = x / cell_width;
        let row = y / cell_height;
        if (col + row) % 2 == 0 {
            dark
        } else {
            light
        }
    });

    img.save(output_path)
        .map_err(|e| format!("Failed to save thumbnail PNG: {}", e))?;

    Ok(())
}

/// Generate a thumbnail for a file (dummy chess pattern)
pub fn generate_thumbnail(
    file_path: &str,
    app_handle: &tauri::AppHandle,
) -> Result<ThumbnailResult, String> {
    let cache_dir = get_cache_dir(app_handle)?;

    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Failed to stat file: {}", e))?;

    let mtime_ms = metadata
        .modified()
        .map_err(|e| format!("Failed to get mtime: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to compute mtime duration: {}", e))?
        .as_millis();

    let cache_key = compute_cache_key(file_path, metadata.len(), mtime_ms);
    let output_path = cache_dir.join(format!("{}.png", cache_key));

    // Check if cached
    if output_path.exists() {
        return Ok(ThumbnailResult {
            thumbnail_path: output_path.to_string_lossy().to_string(),
            fwhm: None,
        });
    }

    // Generate dummy chess pattern
    generate_chess_pattern(&output_path)?;

    Ok(ThumbnailResult {
        thumbnail_path: output_path.to_string_lossy().to_string(),
        fwhm: None,
    })
}

/// Check if a cached thumbnail exists for a file
pub fn get_cached_thumbnail(
    file_path: &str,
    app_handle: &tauri::AppHandle,
) -> Result<Option<ThumbnailResult>, String> {
    let cache_dir = get_cache_dir(app_handle)?;

    let metadata = match fs::metadata(file_path) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };

    let mtime_ms = metadata
        .modified()
        .map_err(|e| format!("Failed to get mtime: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to compute mtime duration: {}", e))?
        .as_millis();

    let cache_key = compute_cache_key(file_path, metadata.len(), mtime_ms);
    let cached_path = cache_dir.join(format!("{}.png", cache_key));

    if cached_path.exists() {
        Ok(Some(ThumbnailResult {
            thumbnail_path: cached_path.to_string_lossy().to_string(),
            fwhm: None,
        }))
    } else {
        Ok(None)
    }
}

/// Batch generate thumbnails with progress events
pub fn batch_generate_thumbnails(
    window: &tauri::Window,
    file_paths: &[String],
    app_handle: &tauri::AppHandle,
) -> Result<HashMap<String, ThumbnailResult>, String> {
    let mut results: HashMap<String, ThumbnailResult> = HashMap::new();

    for (i, file_path) in file_paths.iter().enumerate() {
        match generate_thumbnail(file_path, app_handle) {
            Ok(result) => {
                results.insert(file_path.clone(), result);
            }
            Err(_) => {
                results.insert(
                    file_path.clone(),
                    ThumbnailResult {
                        thumbnail_path: String::new(),
                        fwhm: None,
                    },
                );
            }
        }

        // Emit progress event
        let progress = ThumbnailProgress {
            current: i + 1,
            total: file_paths.len(),
            file_path: file_path.clone(),
        };
        let _ = window.emit("thumbnail:progress", &progress);
    }

    Ok(results)
}

/// Get total cache size information
pub fn get_cache_size(app_handle: &tauri::AppHandle) -> Result<CacheSizeInfo, String> {
    let cache_dir = get_cache_dir(app_handle)?;
    let dir_path = cache_dir.to_string_lossy().to_string();

    let entries = match fs::read_dir(&cache_dir) {
        Ok(e) => e,
        Err(_) => {
            return Ok(CacheSizeInfo {
                total_size: 0,
                file_count: 0,
                path: dir_path,
            });
        }
    };

    let mut total_size: u64 = 0;
    let mut file_count: usize = 0;

    for entry in entries.filter_map(|e| e.ok()) {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() {
                total_size += metadata.len();
                file_count += 1;
            }
        }
    }

    Ok(CacheSizeInfo {
        total_size,
        file_count,
        path: dir_path,
    })
}

/// Clear all cached thumbnails
pub fn clear_thumbnail_cache(app_handle: &tauri::AppHandle) -> Result<bool, String> {
    let cache_dir = get_cache_dir(app_handle)?;

    let entries = match fs::read_dir(&cache_dir) {
        Ok(e) => e,
        Err(_) => return Ok(false),
    };

    for entry in entries.filter_map(|e| e.ok()) {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    Ok(true)
}
