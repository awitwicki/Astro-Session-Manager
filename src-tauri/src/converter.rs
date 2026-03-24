use std::path::{Path, PathBuf};
use tauri::Emitter;
use walkdir::WalkDir;

use crate::cancellation;
use crate::dslr_parser;
use crate::fits_writer::{self, FitsMetadata};
use crate::types::{ConversionProgress, ConversionResult, RawFileInfo};

const RAW_EXTENSIONS: &[&str] = &["cr2", "cr3", "arw"];

fn is_raw_extension(ext: &str) -> bool {
    RAW_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

fn format_from_extension(ext: &str) -> String {
    ext.to_uppercase()
}

#[tauri::command]
pub async fn scan_raw_files(dir: String) -> Result<Vec<RawFileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files: Vec<RawFileInfo> = Vec::new();

        for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = match path.extension().and_then(|e| e.to_str()) {
                Some(e) => e,
                None => continue,
            };
            if !is_raw_extension(ext) {
                continue;
            }
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let format = format_from_extension(ext);

            files.push(RawFileInfo {
                path: path.to_string_lossy().to_string(),
                filename,
                size_bytes,
                format,
            });
        }

        files.sort_by(|a, b| a.filename.cmp(&b.filename));
        Ok(files)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn convert_dslr_to_fits(
    window: tauri::Window,
    files: Vec<String>,
    output_dir: String,
) -> Result<ConversionResult, String> {
    // Create output directory if it doesn't exist
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    cancellation::reset_cancel("convert");

    let total = files.len();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut succeeded = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;

        for (i, file_path) in files.iter().enumerate() {
            // Check cancellation
            if cancellation::is_cancelled("convert") {
                break;
            }

            let source = Path::new(file_path);
            let stem = source
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown");
            let filename = source
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let output = PathBuf::from(&output_dir).join(format!("{}.fits", stem));

            // Check if output already exists -> skip
            if output.exists() {
                skipped += 1;
                let _ = window.emit(
                    "converter-progress",
                    ConversionProgress {
                        current: i + 1,
                        total,
                        filename,
                        source_path: file_path.clone(),
                        success: false,
                        skipped: true,
                        error: None,
                    },
                );
                continue;
            }

            match convert_single_file(source, &output) {
                Ok(()) => {
                    succeeded += 1;
                    let _ = window.emit(
                        "converter-progress",
                        ConversionProgress {
                            current: i + 1,
                            total,
                            filename,
                            source_path: file_path.clone(),
                            success: true,
                            skipped: false,
                            error: None,
                        },
                    );
                }
                Err(err) => {
                    failed += 1;
                    let _ = window.emit(
                        "converter-progress",
                        ConversionProgress {
                            current: i + 1,
                            total,
                            filename,
                            source_path: file_path.clone(),
                            success: false,
                            skipped: false,
                            error: Some(err),
                        },
                    );
                }
            }
        }

        ConversionResult {
            total,
            succeeded,
            skipped,
            failed,
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    Ok(result)
}

fn convert_single_file(source: &Path, output: &Path) -> Result<(), String> {
    // 1. Decode raw image using rawler
    let raw_image = rawler::decode_file(source)
        .map_err(|e| format!("Failed to decode raw file: {}", e))?;

    let width = raw_image.width;
    let height = raw_image.height;

    // Extract pixel data as Vec<u16>
    let pixels: Vec<u16> = match raw_image.data {
        rawler::RawImageData::Integer(data) => data,
        rawler::RawImageData::Float(data) => {
            // Convert f32 data to u16, scaling to 0..65535
            data.iter()
                .map(|&v| (v.clamp(0.0, 1.0) * 65535.0) as u16)
                .collect()
        }
    };

    // Get CFA/Bayer pattern from camera definition
    let bayerpat = if raw_image.camera.cfa.is_valid() {
        Some(raw_image.camera.cfa.name.clone())
    } else {
        None
    };

    // 2. Read EXIF metadata from the original file
    let source_str = source.to_string_lossy().to_string();
    let exif_header = dslr_parser::read_dslr_header(&source_str).ok();

    // 3. Build FitsMetadata and write FITS
    let meta = FitsMetadata {
        width,
        height,
        exptime: exif_header.as_ref().and_then(|h| h.exptime),
        gain: exif_header.as_ref().and_then(|h| h.gain),
        date_obs: exif_header.as_ref().and_then(|h| h.date_obs.clone()),
        instrume: exif_header.as_ref().and_then(|h| h.instrume.clone()),
        bayerpat,
    };

    fits_writer::write_fits_u16(output, &pixels, &meta)?;

    Ok(())
}
