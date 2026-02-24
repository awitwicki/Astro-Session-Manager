use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

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

// ─── Fast Bayer super-pixel extraction ───────────────────────────────────────

/// Extract RGB from a 2x2 Bayer super-pixel at the given (even-aligned) position.
/// Much faster than full bilinear debayer — only 4 pixel lookups per output pixel.
#[inline]
fn bayer_super_pixel(
    pixels: &[f32],
    row: usize,
    col: usize,
    width: usize,
    pattern: &str,
) -> (f32, f32, f32) {
    let p00 = pixels[row * width + col];
    let p01 = pixels[row * width + col + 1];
    let p10 = pixels[(row + 1) * width + col];
    let p11 = pixels[(row + 1) * width + col + 1];

    match pattern {
        "RGGB" => (p00, (p01 + p10) * 0.5, p11),
        "BGGR" => (p11, (p01 + p10) * 0.5, p00),
        "GRBG" => (p01, (p00 + p11) * 0.5, p10),
        "GBRG" => (p10, (p00 + p11) * 0.5, p01),
        _ => (p00, p00, p00),
    }
}

/// Compute the subsample stride so the output fits within target×target.
fn compute_subsample_stride(width: usize, height: usize, target: usize) -> usize {
    let max_dim = width.max(height);
    (max_dim / target).max(1)
}

// ─── Thumbnail generation ───────────────────────────────────────────────────

/// Generate a thumbnail for a FITS file using fast stride-based subsampling.
/// Instead of full-resolution debayer + Lanczos3 resize, this directly subsamples
/// the pixel data to thumbnail size, making it ~100x faster for large images.
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
        // ── Bayer: fast super-pixel subsampling (no full debayer) ──
        let pattern = bayerpat.as_ref().unwrap();
        let stride = compute_subsample_stride(width, height, THUMBNAIL_SIZE as usize);
        // Must be even and at least 2 for Bayer pattern alignment
        let stride = if stride < 2 { 2 } else { stride + (stride % 2) };

        let out_w = (width / stride).max(1);
        let out_h = (height / stride).max(1);

        let mut r_sub = Vec::with_capacity(out_w * out_h);
        let mut g_sub = Vec::with_capacity(out_w * out_h);
        let mut b_sub = Vec::with_capacity(out_w * out_h);

        for oy in 0..out_h {
            for ox in 0..out_w {
                let sy = (oy * stride).min(height.saturating_sub(2));
                let sx = (ox * stride).min(width.saturating_sub(2));
                // Align to even for Bayer pattern
                let sy = sy - (sy % 2);
                let sx = sx - (sx % 2);

                let (r, g, b) = bayer_super_pixel(pixels, sy, sx, width, pattern);
                r_sub.push(r);
                g_sub.push(g);
                b_sub.push(b);
            }
        }

        apply_scnr(&r_sub, &mut g_sub, &b_sub);

        let stretch_r = auto_stretch(&r_sub);
        let stretch_g = auto_stretch(&g_sub);
        let stretch_b = auto_stretch(&b_sub);

        let img: RgbImage = ImageBuffer::from_fn(out_w as u32, out_h as u32, |x, y| {
            let i = y as usize * out_w + x as usize;
            Rgb([
                apply_stretch(r_sub[i], &stretch_r),
                apply_stretch(g_sub[i], &stretch_g),
                apply_stretch(b_sub[i], &stretch_b),
            ])
        });

        if out_w as u32 > THUMBNAIL_SIZE || out_h as u32 > THUMBNAIL_SIZE {
            save_resized_rgb(&img, &output_path)?;
        } else {
            img.save(&output_path)
                .map_err(|e| format!("Failed to save thumbnail PNG: {}", e))?;
        }
    } else if channels == 1 {
        // ── Mono: stride-based nearest-neighbor subsampling ──
        let stride = compute_subsample_stride(width, height, THUMBNAIL_SIZE as usize);
        let out_w = (width / stride).max(1);
        let out_h = (height / stride).max(1);

        let mut sub = Vec::with_capacity(out_w * out_h);
        for oy in 0..out_h {
            let sy = (oy * stride).min(height - 1);
            let row_off = sy * width;
            for ox in 0..out_w {
                let sx = (ox * stride).min(width - 1);
                sub.push(pixels[row_off + sx]);
            }
        }

        let stretch = auto_stretch(&sub);

        let img: ImageBuffer<Luma<u8>, Vec<u8>> =
            ImageBuffer::from_fn(out_w as u32, out_h as u32, |x, y| {
                let i = y as usize * out_w + x as usize;
                Luma([apply_stretch(sub[i], &stretch)])
            });

        if out_w as u32 > THUMBNAIL_SIZE || out_h as u32 > THUMBNAIL_SIZE {
            save_resized_gray(&img, &output_path)?;
        } else {
            img.save(&output_path)
                .map_err(|e| format!("Failed to save thumbnail PNG: {}", e))?;
        }
    } else {
        // ── Multi-channel: subsample each plane ──
        let stride = compute_subsample_stride(width, height, THUMBNAIL_SIZE as usize);
        let out_w = (width / stride).max(1);
        let out_h = (height / stride).max(1);

        let mut stretched_channels: Vec<Vec<u8>> = Vec::new();
        for c in 0..channels.min(3) {
            let plane = &pixels[c * pixel_count..(c + 1) * pixel_count];
            let mut sub = Vec::with_capacity(out_w * out_h);
            for oy in 0..out_h {
                let sy = (oy * stride).min(height - 1);
                let row_off = sy * width;
                for ox in 0..out_w {
                    let sx = (ox * stride).min(width - 1);
                    sub.push(plane[row_off + sx]);
                }
            }
            let stretch = auto_stretch(&sub);
            let stretched: Vec<u8> = sub.iter().map(|&v| apply_stretch(v, &stretch)).collect();
            stretched_channels.push(stretched);
        }

        while stretched_channels.len() < 3 {
            stretched_channels.push(vec![0u8; out_w * out_h]);
        }

        let img: RgbImage = ImageBuffer::from_fn(out_w as u32, out_h as u32, |x, y| {
            let i = y as usize * out_w + x as usize;
            Rgb([
                stretched_channels[0][i],
                stretched_channels[1][i],
                stretched_channels[2][i],
            ])
        });

        if out_w as u32 > THUMBNAIL_SIZE || out_h as u32 > THUMBNAIL_SIZE {
            save_resized_rgb(&img, &output_path)?;
        } else {
            img.save(&output_path)
                .map_err(|e| format!("Failed to save thumbnail PNG: {}", e))?;
        }
    }

    Ok(ThumbnailResult {
        thumbnail_path: output_path.to_string_lossy().to_string(),
        fwhm: None,
    })
}

/// Resize an RGB image to fit within THUMBNAIL_SIZE×THUMBNAIL_SIZE and save as PNG.
/// Uses Triangle (bilinear) filter for speed — image is already near target size.
fn save_resized_rgb(img: &RgbImage, output_path: &Path) -> Result<(), String> {
    let (w, h) = img.dimensions();
    let (new_w, new_h) = fit_inside(w, h, THUMBNAIL_SIZE);

    let resized = image::imageops::resize(img, new_w, new_h, image::imageops::FilterType::Triangle);
    resized
        .save(output_path)
        .map_err(|e| format!("Failed to save thumbnail PNG: {}", e))
}

/// Resize a grayscale image to fit within THUMBNAIL_SIZE×THUMBNAIL_SIZE and save as PNG.
/// Uses Triangle (bilinear) filter for speed — image is already near target size.
fn save_resized_gray(img: &ImageBuffer<Luma<u8>, Vec<u8>>, output_path: &Path) -> Result<(), String> {
    let (w, h) = img.dimensions();
    let (new_w, new_h) = fit_inside(w, h, THUMBNAIL_SIZE);

    let resized = image::imageops::resize(img, new_w, new_h, image::imageops::FilterType::Triangle);
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
        let thumb_path = match generate_thumbnail(file_path, app_handle) {
            Ok(result) => {
                let path = result.thumbnail_path.clone();
                results.insert(file_path.clone(), result);
                Some(path)
            }
            Err(_) => {
                results.insert(
                    file_path.clone(),
                    ThumbnailResult {
                        thumbnail_path: String::new(),
                        fwhm: None,
                    },
                );
                None
            }
        };

        let progress = ThumbnailProgress {
            current: i + 1,
            total: file_paths.len(),
            file_path: file_path.clone(),
            thumbnail_path: thumb_path,
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
