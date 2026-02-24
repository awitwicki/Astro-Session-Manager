use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use image::{ImageBuffer, Luma, Rgb, RgbImage};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::fits_parser;
use crate::types::{FitsHeader, FitsPreviewResult};

const MAX_PREVIEW_WIDTH: u32 = 1920;
const MAX_PREVIEW_HEIGHT: u32 = 1080;

// ─── In-memory cache for intermediate binned pixel data ─────────────────────

struct CachedPreviewData {
    file_path: String,
    header: FitsHeader,
    /// Normalized [0,1] f32 pixels — already binned and debayered.
    /// For mono: length = w*h. For color: length = w*h*3 (R,G,B planes concatenated).
    pixels: Vec<f32>,
    width: u32,
    height: u32,
    channels: u32, // 1 for mono, 3 for color
    original_width: u32,
    original_height: u32,
    /// Per-channel auto-stretch params (for green noise removal).
    /// For mono images, all three entries are identical.
    auto_shadows_rgb: [f32; 3],
    auto_highlights_rgb: [f32; 3],
    auto_midtones: f32,
    /// Averages sent to frontend for slider initial position.
    auto_shadows_avg: f32,
    auto_highlights_avg: f32,
}

static PREVIEW_CACHE: Mutex<Option<CachedPreviewData>> = Mutex::new(None);

// ─── STF helpers (same as thumbnail.rs) ─────────────────────────────────────

struct StretchParams {
    shadows: f32,
    midtones: f32,
    highlights: f32,
}

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

// ─── Debayer (same logic as thumbnail.rs) ───────────────────────────────────

fn debayer(
    mono: &[f32],
    width: usize,
    height: usize,
    pattern: &str,
) -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    let pixel_count = width * height;
    let mut r = vec![0.0f32; pixel_count];
    let mut g = vec![0.0f32; pixel_count];
    let mut b = vec![0.0f32; pixel_count];
    let pat_bytes = pattern.as_bytes();

    let px = |row: isize, col: isize| -> f32 {
        let cr = row.clamp(0, height as isize - 1) as usize;
        let cc = col.clamp(0, width as isize - 1) as usize;
        mono[cr * width + cc]
    };

    let color_at = |row: usize, col: usize| -> u8 { pat_bytes[(row % 2) * 2 + (col % 2)] };

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
                    g[i] = (px(ir - 1, ic) + px(ir + 1, ic) + px(ir, ic - 1) + px(ir, ic + 1))
                        / 4.0;
                    b[i] = (px(ir - 1, ic - 1)
                        + px(ir - 1, ic + 1)
                        + px(ir + 1, ic - 1)
                        + px(ir + 1, ic + 1))
                        / 4.0;
                }
                b'B' => {
                    b[i] = val;
                    g[i] = (px(ir - 1, ic) + px(ir + 1, ic) + px(ir, ic - 1) + px(ir, ic + 1))
                        / 4.0;
                    r[i] = (px(ir - 1, ic - 1)
                        + px(ir - 1, ic + 1)
                        + px(ir + 1, ic - 1)
                        + px(ir + 1, ic + 1))
                        / 4.0;
                }
                b'G' => {
                    g[i] = val;
                    let row_color0 = pat_bytes[(row % 2) * 2];
                    if row_color0 == b'R' {
                        r[i] = (px(ir, ic - 1) + px(ir, ic + 1)) / 2.0;
                        b[i] = (px(ir - 1, ic) + px(ir + 1, ic)) / 2.0;
                    } else {
                        b[i] = (px(ir, ic - 1) + px(ir, ic + 1)) / 2.0;
                        r[i] = (px(ir - 1, ic) + px(ir + 1, ic)) / 2.0;
                    }
                }
                _ => {
                    g[i] = val;
                }
            }
        }
    }

    (r, g, b)
}

// ─── Binning (area-average downscale) ───────────────────────────────────────

/// Compute the bin factor so the result fits within max_w x max_h.
fn compute_bin_factor(w: u32, h: u32, max_w: u32, max_h: u32) -> u32 {
    let bin_w = (w + max_w - 1) / max_w; // ceil division
    let bin_h = (h + max_h - 1) / max_h;
    bin_w.max(bin_h).max(1)
}

/// Bin (area-average downsample) a single f32 channel.
fn bin_channel(data: &[f32], width: usize, height: usize, bin: usize) -> (Vec<f32>, usize, usize) {
    let new_w = width / bin;
    let new_h = height / bin;
    let mut out = vec![0.0f32; new_w * new_h];
    let bin_area = (bin * bin) as f32;

    for ny in 0..new_h {
        for nx in 0..new_w {
            let mut sum = 0.0f32;
            let sy = ny * bin;
            let sx = nx * bin;
            for dy in 0..bin {
                for dx in 0..bin {
                    sum += data[(sy + dy) * width + (sx + dx)];
                }
            }
            out[ny * new_w + nx] = sum / bin_area;
        }
    }

    (out, new_w, new_h)
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

fn preview_cache_key(file_path: &str, shadows: f32, midtones: f32, highlights: f32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "preview|{}|{:.4}|{:.4}|{:.4}",
        file_path, shadows, midtones, highlights
    ));
    let result = hasher.finalize();
    hex::encode(&result[..12])
}

// ─── Load and cache intermediate data ───────────────────────────────────────

fn load_and_cache_preview(file_path: &str) -> Result<(), String> {
    // Read FITS pixel data (full resolution, normalized to [0,1])
    let pixel_data = fits_parser::read_fits_pixel_data(file_path)?;
    let header = pixel_data.header;
    let orig_w = header.naxis1 as u32;
    let orig_h = header.naxis2 as u32;
    let channels = header.naxis3.unwrap_or(1).max(1) as u32;
    let pixels = pixel_data.pixels;

    let valid_bayer = ["RGGB", "BGGR", "GRBG", "GBRG"];
    let bayerpat = header
        .bayerpat
        .as_ref()
        .map(|s| s.to_uppercase())
        .filter(|s| valid_bayer.contains(&s.as_str()));
    let has_bayer = channels == 1 && bayerpat.is_some();

    // Determine bin factor
    let bin = compute_bin_factor(orig_w, orig_h, MAX_PREVIEW_WIDTH, MAX_PREVIEW_HEIGHT) as usize;

    if has_bayer {
        // Debayer at full resolution first, then bin each channel
        let pattern = bayerpat.as_ref().unwrap();
        let (r_full, g_full, b_full) =
            debayer(&pixels, orig_w as usize, orig_h as usize, pattern);

        let (r_bin, bw, bh) = bin_channel(&r_full, orig_w as usize, orig_h as usize, bin);
        let (mut g_bin, _, _) = bin_channel(&g_full, orig_w as usize, orig_h as usize, bin);
        let (b_bin, _, _) = bin_channel(&b_full, orig_w as usize, orig_h as usize, bin);

        // Remove green excess from Bayer pattern (2x green pixels)
        apply_scnr(&r_bin, &mut g_bin, &b_bin);

        // Interleave into R,G,B planes concatenated
        let pixel_count = bw * bh;
        let mut combined = Vec::with_capacity(pixel_count * 3);
        combined.extend_from_slice(&r_bin);
        combined.extend_from_slice(&g_bin);
        combined.extend_from_slice(&b_bin);

        // Auto-stretch per channel (key for green noise removal)
        let str_r = auto_stretch(&r_bin);
        let str_g = auto_stretch(&g_bin);
        let str_b = auto_stretch(&b_bin);
        let shadows_rgb = [str_r.shadows, str_g.shadows, str_b.shadows];
        let highlights_rgb = [str_r.highlights, str_g.highlights, str_b.highlights];
        let avg_shadows = (shadows_rgb[0] + shadows_rgb[1] + shadows_rgb[2]) / 3.0;
        let avg_highlights = (highlights_rgb[0] + highlights_rgb[1] + highlights_rgb[2]) / 3.0;

        let mut cache = PREVIEW_CACHE.lock().unwrap();
        *cache = Some(CachedPreviewData {
            file_path: file_path.to_string(),
            header,
            pixels: combined,
            width: bw as u32,
            height: bh as u32,
            channels: 3,
            original_width: orig_w,
            original_height: orig_h,
            auto_shadows_rgb: shadows_rgb,
            auto_highlights_rgb: highlights_rgb,
            auto_midtones: 0.25,
            auto_shadows_avg: avg_shadows,
            auto_highlights_avg: avg_highlights,
        });
    } else if channels == 1 {
        // Mono — just bin
        let (binned, bw, bh) = bin_channel(&pixels, orig_w as usize, orig_h as usize, bin);
        let stretch = auto_stretch(&binned);

        let mut cache = PREVIEW_CACHE.lock().unwrap();
        *cache = Some(CachedPreviewData {
            file_path: file_path.to_string(),
            header,
            pixels: binned,
            width: bw as u32,
            height: bh as u32,
            channels: 1,
            original_width: orig_w,
            original_height: orig_h,
            auto_shadows_rgb: [stretch.shadows; 3],
            auto_highlights_rgb: [stretch.highlights; 3],
            auto_midtones: stretch.midtones,
            auto_shadows_avg: stretch.shadows,
            auto_highlights_avg: stretch.highlights,
        });
    } else {
        // Multi-channel color: bin each plane
        let pixel_count = orig_w as usize * orig_h as usize;
        let num_ch = (channels as usize).min(3);
        let mut combined = Vec::new();
        let mut bw = 0usize;
        let mut bh = 0usize;
        let mut shadows_rgb = [0.0f32; 3];
        let mut highlights_rgb = [0.0f32; 3];

        for c in 0..num_ch {
            let plane = &pixels[c * pixel_count..(c + 1) * pixel_count];
            let (binned, w, h) = bin_channel(plane, orig_w as usize, orig_h as usize, bin);
            let stretch = auto_stretch(&binned);
            shadows_rgb[c] = stretch.shadows;
            highlights_rgb[c] = stretch.highlights;
            bw = w;
            bh = h;
            combined.extend_from_slice(&binned);
        }

        // Pad to 3 channels if needed
        let binned_count = bw * bh;
        for c in num_ch..3 {
            combined.extend(std::iter::repeat(0.0f32).take(binned_count));
            shadows_rgb[c] = shadows_rgb[0];
            highlights_rgb[c] = highlights_rgb[0];
        }

        let avg_shadows = (shadows_rgb[0] + shadows_rgb[1] + shadows_rgb[2]) / 3.0;
        let avg_highlights = (highlights_rgb[0] + highlights_rgb[1] + highlights_rgb[2]) / 3.0;

        let mut cache = PREVIEW_CACHE.lock().unwrap();
        *cache = Some(CachedPreviewData {
            file_path: file_path.to_string(),
            header,
            pixels: combined,
            width: bw as u32,
            height: bh as u32,
            channels: 3,
            original_width: orig_w,
            original_height: orig_h,
            auto_shadows_rgb: shadows_rgb,
            auto_highlights_rgb: highlights_rgb,
            auto_midtones: 0.25,
            auto_shadows_avg: avg_shadows,
            auto_highlights_avg: avg_highlights,
        });
    }

    Ok(())
}

/// Render the cached preview data to a PNG with given stretch params.
/// For color images, per-channel stretch is applied: the user's slider values
/// are treated as deltas from the auto-stretch averages, preserving the
/// per-channel balance that eliminates green noise.
fn render_cached_to_png(
    shadows: f32,
    midtones: f32,
    highlights: f32,
    app_handle: &tauri::AppHandle,
) -> Result<FitsPreviewResult, String> {
    let cache = PREVIEW_CACHE.lock().unwrap();
    let data = cache.as_ref().ok_or("No preview data cached")?;

    let preview_dir = get_preview_dir(app_handle)?;
    let key = preview_cache_key(&data.file_path, shadows, midtones, highlights);
    let output_path = preview_dir.join(format!("{}.png", key));

    let w = data.width;
    let h = data.height;
    let pixel_count = (w * h) as usize;

    if !output_path.exists() {
        if data.channels == 1 {
            let params = StretchParams {
                shadows,
                midtones,
                highlights,
            };
            let img: ImageBuffer<Luma<u8>, Vec<u8>> =
                ImageBuffer::from_fn(w, h, |x, y| {
                    let i = y as usize * w as usize + x as usize;
                    Luma([apply_stretch(data.pixels[i], &params)])
                });
            img.save(&output_path)
                .map_err(|e| format!("Failed to save preview: {}", e))?;
        } else {
            // Per-channel stretch: apply user delta relative to auto-stretch averages
            let delta_s = shadows - data.auto_shadows_avg;
            let delta_h = highlights - data.auto_highlights_avg;

            let params_rgb: [StretchParams; 3] = [
                StretchParams {
                    shadows: (data.auto_shadows_rgb[0] + delta_s).clamp(0.0, 1.0),
                    midtones,
                    highlights: (data.auto_highlights_rgb[0] + delta_h).clamp(0.0, 1.0),
                },
                StretchParams {
                    shadows: (data.auto_shadows_rgb[1] + delta_s).clamp(0.0, 1.0),
                    midtones,
                    highlights: (data.auto_highlights_rgb[1] + delta_h).clamp(0.0, 1.0),
                },
                StretchParams {
                    shadows: (data.auto_shadows_rgb[2] + delta_s).clamp(0.0, 1.0),
                    midtones,
                    highlights: (data.auto_highlights_rgb[2] + delta_h).clamp(0.0, 1.0),
                },
            ];

            let r_plane = &data.pixels[..pixel_count];
            let g_plane = &data.pixels[pixel_count..pixel_count * 2];
            let b_plane = &data.pixels[pixel_count * 2..pixel_count * 3];

            let img: RgbImage = ImageBuffer::from_fn(w, h, |x, y| {
                let i = y as usize * w as usize + x as usize;
                Rgb([
                    apply_stretch(r_plane[i], &params_rgb[0]),
                    apply_stretch(g_plane[i], &params_rgb[1]),
                    apply_stretch(b_plane[i], &params_rgb[2]),
                ])
            });
            img.save(&output_path)
                .map_err(|e| format!("Failed to save preview: {}", e))?;
        }
    }

    Ok(FitsPreviewResult {
        image_path: output_path.to_string_lossy().to_string(),
        width: w,
        height: h,
        original_width: data.original_width,
        original_height: data.original_height,
        shadows: shadows as f64,
        midtones: midtones as f64,
        highlights: highlights as f64,
        header: data.header.clone(),
    })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Load a FITS file, bin it down, debayer if needed, auto-stretch, return PNG path.
pub fn get_fits_preview(
    file_path: &str,
    app_handle: &tauri::AppHandle,
) -> Result<FitsPreviewResult, String> {
    // Check if already cached for this file
    {
        let cache = PREVIEW_CACHE.lock().unwrap();
        if let Some(ref data) = *cache {
            if data.file_path == file_path {
                // Already loaded — render with auto-stretch params
                let s = data.auto_shadows_avg;
                let m = data.auto_midtones;
                let h = data.auto_highlights_avg;
                drop(cache);
                return render_cached_to_png(s, m, h, app_handle);
            }
        }
    }

    // Load fresh
    load_and_cache_preview(file_path)?;

    let (s, m, h) = {
        let cache = PREVIEW_CACHE.lock().unwrap();
        let data = cache.as_ref().unwrap();
        (data.auto_shadows_avg, data.auto_midtones, data.auto_highlights_avg)
    };

    render_cached_to_png(s, m, h, app_handle)
}

/// Re-render a previously loaded preview with new stretch parameters.
/// If the file isn't cached, it reloads it.
pub fn render_fits_preview(
    file_path: &str,
    shadows: f32,
    midtones: f32,
    highlights: f32,
    app_handle: &tauri::AppHandle,
) -> Result<FitsPreviewResult, String> {
    // Check if cached
    {
        let cache = PREVIEW_CACHE.lock().unwrap();
        if let Some(ref data) = *cache {
            if data.file_path == file_path {
                drop(cache);
                return render_cached_to_png(shadows, midtones, highlights, app_handle);
            }
        }
    }

    // Reload if not cached
    load_and_cache_preview(file_path)?;
    render_cached_to_png(shadows, midtones, highlights, app_handle)
}
