use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{ImageBuffer, Luma, Rgb, RgbImage};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tauri::Manager;

use crate::fits_parser;
use crate::types::{CacheSizeInfo, ThumbnailProgress, ThumbnailResult};

const THUMBNAIL_SIZE: u32 = 400;

// ─── Cache helpers ──────────────────────────────────────────────────────────

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

fn compute_cache_key(file_path: &str, size_bytes: u64, mtime_ms: u128) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}|{}|{}", file_path, size_bytes, mtime_ms));
    let result = hasher.finalize();
    hex::encode(&result[..8])
}

// ─── Auto-stretch (STF) ────────────────────────────────────────────────────

struct StretchParams {
    shadows: f32,
    midtones: f32,
    highlights: f32,
}

/// Compute auto-stretch parameters using median + MAD (Median Absolute Deviation).
/// This is the standard astronomical Screen Transfer Function (STF).
fn auto_stretch(pixels: &[f32]) -> StretchParams {
    let sample_size = pixels.len().min(100_000);
    let step = (pixels.len() / sample_size).max(1);

    let mut samples: Vec<f32> = pixels.iter().step_by(step).copied().collect();
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    if samples.is_empty() {
        return StretchParams {
            shadows: 0.0,
            midtones: 0.25,
            highlights: 1.0,
        };
    }

    let median = samples[samples.len() / 2];

    let mut deviations: Vec<f32> = samples.iter().map(|&v| (v - median).abs()).collect();
    deviations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mad = deviations[deviations.len() / 2] * 1.4826;

    let shadows = (median - 2.8 * mad).max(0.0);
    let highlights = (median + 10.0 * mad).min(1.0);

    StretchParams {
        shadows,
        midtones: 0.25,
        highlights,
    }
}

/// Midtone Transfer Function — gamma-like nonlinear curve.
/// mtf(m, x) = ((m-1)*x) / ((2m-1)*x - m)
#[inline]
fn mtf(m: f32, x: f32) -> f32 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    ((m - 1.0) * x) / ((2.0 * m - 1.0) * x - m)
}

/// Apply stretch + MTF to a single pixel value.
#[inline]
fn apply_stretch(val: f32, params: &StretchParams) -> u8 {
    let range = params.highlights - params.shadows;
    let normalized = if range > 0.0 {
        ((val - params.shadows) / range).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let stretched = mtf(params.midtones, normalized);
    (stretched * 255.0).round() as u8
}

// ─── SCNR (green noise removal) ──────────────────────────────────────────────

/// Apply SCNR (Subtractive Chromatic Noise Reduction) to remove green cast
/// from Bayer-debayered images. Uses the "maximum neutral" method:
/// cap green at max(red, blue) for each pixel.
fn apply_scnr(r: &[f32], g: &mut [f32], b: &[f32]) {
    for i in 0..g.len() {
        let max_rb = r[i].max(b[i]);
        if g[i] > max_rb {
            g[i] = max_rb;
        }
    }
}

// ─── Debayer (Bayer CFA demosaicing) ────────────────────────────────────────

/// Debayer a single-channel Bayer-pattern image to RGB using bilinear interpolation.
/// Pattern must be one of: RGGB, BGGR, GRBG, GBRG
fn debayer(mono: &[f32], width: usize, height: usize, pattern: &str) -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    let pixel_count = width * height;
    let mut r = vec![0.0f32; pixel_count];
    let mut g = vec![0.0f32; pixel_count];
    let mut b = vec![0.0f32; pixel_count];

    let pat_bytes = pattern.as_bytes();

    // Get pixel with boundary clamping
    let px = |row: isize, col: isize| -> f32 {
        let cr = row.clamp(0, height as isize - 1) as usize;
        let cc = col.clamp(0, width as isize - 1) as usize;
        mono[cr * width + cc]
    };

    // Color at (row, col) in the Bayer pattern
    let color_at = |row: usize, col: usize| -> u8 {
        pat_bytes[(row % 2) * 2 + (col % 2)]
    };

    for row in 0..height {
        for col in 0..width {
            let i = row * width + col;
            let ir = row as isize;
            let ic = col as isize;
            let color = color_at(row, col);
            let val = mono[i];

            match color {
                b'R' => {
                    r[i] = val;
                    g[i] = (px(ir - 1, ic) + px(ir + 1, ic) + px(ir, ic - 1) + px(ir, ic + 1)) / 4.0;
                    b[i] = (px(ir - 1, ic - 1) + px(ir - 1, ic + 1) + px(ir + 1, ic - 1) + px(ir + 1, ic + 1)) / 4.0;
                }
                b'B' => {
                    b[i] = val;
                    g[i] = (px(ir - 1, ic) + px(ir + 1, ic) + px(ir, ic - 1) + px(ir, ic + 1)) / 4.0;
                    r[i] = (px(ir - 1, ic - 1) + px(ir - 1, ic + 1) + px(ir + 1, ic - 1) + px(ir + 1, ic + 1)) / 4.0;
                }
                b'G' => {
                    g[i] = val;
                    // Determine if R neighbors are horizontal or vertical
                    let row_color0 = pat_bytes[(row % 2) * 2]; // color at col=0 on this row
                    if row_color0 == b'R' {
                        // R on this row: horizontal neighbors are R, vertical are B
                        r[i] = (px(ir, ic - 1) + px(ir, ic + 1)) / 2.0;
                        b[i] = (px(ir - 1, ic) + px(ir + 1, ic)) / 2.0;
                    } else {
                        // B on this row: horizontal neighbors are B, vertical are R
                        b[i] = (px(ir, ic - 1) + px(ir, ic + 1)) / 2.0;
                        r[i] = (px(ir - 1, ic) + px(ir + 1, ic)) / 2.0;
                    }
                }
                _ => {
                    // Treat unknown as green
                    g[i] = val;
                }
            }
        }
    }

    (r, g, b)
}

// ─── Thumbnail generation ───────────────────────────────────────────────────

/// Generate a thumbnail for a FITS file with auto-stretch and optional debayering.
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

    // Read FITS pixel data
    let pixel_data = fits_parser::read_fits_pixel_data(file_path)?;
    let header = &pixel_data.header;
    let width = header.naxis1 as usize;
    let height = header.naxis2 as usize;
    let channels = header.naxis3.unwrap_or(1).max(1) as usize;
    let pixel_count = width * height;
    let pixels = &pixel_data.pixels;

    let valid_bayer = ["RGGB", "BGGR", "GRBG", "GBRG"];
    let bayerpat = header
        .bayerpat
        .as_ref()
        .map(|s| s.to_uppercase())
        .filter(|s| valid_bayer.contains(&s.as_str()));
    let has_bayer = channels == 1 && bayerpat.is_some();

    if has_bayer {
        // ── Bayer image: debayer → per-channel stretch → RGB ──
        let pattern = bayerpat.as_ref().unwrap();
        let (r_chan, mut g_chan, b_chan) = debayer(pixels, width, height, pattern);

        // Remove green excess from Bayer pattern (2x green pixels)
        apply_scnr(&r_chan, &mut g_chan, &b_chan);

        let stretch_r = auto_stretch(&r_chan);
        let stretch_g = auto_stretch(&g_chan);
        let stretch_b = auto_stretch(&b_chan);

        let img: RgbImage = ImageBuffer::from_fn(width as u32, height as u32, |x, y| {
            let i = y as usize * width + x as usize;
            Rgb([
                apply_stretch(r_chan[i], &stretch_r),
                apply_stretch(g_chan[i], &stretch_g),
                apply_stretch(b_chan[i], &stretch_b),
            ])
        });

        save_resized_rgb(&img, &output_path)?;
    } else if channels == 1 {
        // ── Mono image: single-channel stretch → grayscale ──
        let stretch = auto_stretch(pixels);

        let img: ImageBuffer<Luma<u8>, Vec<u8>> =
            ImageBuffer::from_fn(width as u32, height as u32, |x, y| {
                let i = y as usize * width + x as usize;
                Luma([apply_stretch(pixels[i], &stretch)])
            });

        save_resized_gray(&img, &output_path)?;
    } else {
        // ── Multi-channel color image (NAXIS3 planes) ──
        let mut stretched_channels: Vec<Vec<u8>> = Vec::new();
        for c in 0..channels.min(3) {
            let plane = &pixels[c * pixel_count..(c + 1) * pixel_count];
            let stretch = auto_stretch(plane);
            let stretched: Vec<u8> = plane.iter().map(|&v| apply_stretch(v, &stretch)).collect();
            stretched_channels.push(stretched);
        }

        // Pad to 3 channels if needed
        while stretched_channels.len() < 3 {
            stretched_channels.push(vec![0u8; pixel_count]);
        }

        let img: RgbImage = ImageBuffer::from_fn(width as u32, height as u32, |x, y| {
            let i = y as usize * width + x as usize;
            Rgb([
                stretched_channels[0][i],
                stretched_channels[1][i],
                stretched_channels[2][i],
            ])
        });

        save_resized_rgb(&img, &output_path)?;
    }

    Ok(ThumbnailResult {
        thumbnail_path: output_path.to_string_lossy().to_string(),
        fwhm: None,
    })
}

/// Resize an RGB image to fit within THUMBNAIL_SIZE×THUMBNAIL_SIZE and save as PNG.
fn save_resized_rgb(img: &RgbImage, output_path: &Path) -> Result<(), String> {
    let (w, h) = img.dimensions();
    let (new_w, new_h) = fit_inside(w, h, THUMBNAIL_SIZE);

    let resized = image::imageops::resize(img, new_w, new_h, FilterType::Lanczos3);
    resized
        .save(output_path)
        .map_err(|e| format!("Failed to save thumbnail PNG: {}", e))
}

/// Resize a grayscale image to fit within THUMBNAIL_SIZE×THUMBNAIL_SIZE and save as PNG.
fn save_resized_gray(img: &ImageBuffer<Luma<u8>, Vec<u8>>, output_path: &Path) -> Result<(), String> {
    let (w, h) = img.dimensions();
    let (new_w, new_h) = fit_inside(w, h, THUMBNAIL_SIZE);

    let resized = image::imageops::resize(img, new_w, new_h, FilterType::Lanczos3);
    resized
        .save(output_path)
        .map_err(|e| format!("Failed to save thumbnail PNG: {}", e))
}

/// Compute new dimensions to fit inside max_size×max_size without enlargement.
fn fit_inside(w: u32, h: u32, max_size: u32) -> (u32, u32) {
    if w <= max_size && h <= max_size {
        return (w, h);
    }
    let scale = (max_size as f64 / w as f64).min(max_size as f64 / h as f64);
    let new_w = (w as f64 * scale).round() as u32;
    let new_h = (h as f64 * scale).round() as u32;
    (new_w.max(1), new_h.max(1))
}

// ─── Cache operations (unchanged) ───────────────────────────────────────────

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

        let progress = ThumbnailProgress {
            current: i + 1,
            total: file_paths.len(),
            file_path: file_path.clone(),
        };
        let _ = window.emit("thumbnail:progress", &progress);
    }

    Ok(results)
}

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
