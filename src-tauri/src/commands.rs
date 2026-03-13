use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use crate::analyzer;
use crate::cache;
use crate::cancellation;
use crate::fits_parser;
use crate::fits_preview;
use crate::masters;
use crate::scanner;
use crate::settings;
use crate::types::*;
use crate::xisf_parser;

// ─── Scanner Commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn cancel_operation(operation: String) {
    cancellation::request_cancel(&operation);
}

#[tauri::command]
pub async fn scan_root(
    root_folder: String,
    window: tauri::Window,
    app_handle: AppHandle,
) -> Result<ScanResult, String> {
    let patterns = load_exclude_patterns(&app_handle);
    cancellation::reset_cancel("scan");
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_root_directory(&root_folder, Some(&window), &patterns)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn scan_single_project(
    project_path: String,
    window: tauri::Window,
    app_handle: AppHandle,
) -> Result<ScanResult, String> {
    let patterns = load_exclude_patterns(&app_handle);
    cancellation::reset_cancel("scan");
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_single_project_directory(&project_path, Some(&window), &patterns)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub fn seed_header_cache(headers: HashMap<String, FitsHeader>) {
    scanner::seed_header_cache(headers);
}

// ─── FITS Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_fits_header(file_path: String) -> Result<FitsHeader, String> {
    fits_parser::read_fits_header(&file_path)
}

#[tauri::command]
pub fn batch_read_fits_headers(file_paths: Vec<String>) -> Result<Vec<Option<FitsHeader>>, String> {
    Ok(fits_parser::batch_read_fits_headers(&file_paths))
}

// ─── XISF Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_xisf_header(file_path: String) -> Result<FitsHeader, String> {
    xisf_parser::read_xisf_header(&file_path)
}

// ─── FITS Preview Commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn get_fits_preview(
    file_path: String,
) -> Result<FitsPreviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || fits_preview::get_fits_preview(&file_path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Batch generate previews using async semaphore pattern (like athenaeum).
/// Cache hits bypass the semaphore entirely. Only actual processing acquires a permit.
/// Double-check locking prevents duplicate work when multiple tasks target the same file.
#[tauri::command]
pub async fn batch_generate_previews(
    window: tauri::Window,
    file_paths: Vec<String>,
) -> Result<HashMap<String, FitsPreviewResult>, String> {
    let total = file_paths.len();
    let completed = Arc::new(AtomicUsize::new(0));
    let semaphore = Arc::new(Semaphore::new(fits_preview::concurrent_limit()));

    let mut handles = Vec::with_capacity(total);

    for file_path in file_paths {
        let sem = Arc::clone(&semaphore);
        let window = window.clone();
        let completed = Arc::clone(&completed);

        handles.push(tokio::spawn(async move {
            // Fast path: cache hit — no semaphore, returns instantly
            if let Some(cached) = fits_preview::try_cache(&file_path) {
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = window.emit(
                    "preview:progress",
                    PreviewProgress {
                        current: done,
                        total,
                        file_path: file_path.clone(),
                    },
                );
                return Some((file_path, cached));
            }

            // Slow path: acquire semaphore permit for actual processing
            let _permit = sem.acquire().await.ok()?;

            // Double-check cache — another task may have filled it while we waited
            if let Some(cached) = fits_preview::try_cache(&file_path) {
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = window.emit(
                    "preview:progress",
                    PreviewProgress {
                        current: done,
                        total,
                        file_path: file_path.clone(),
                    },
                );
                return Some((file_path, cached));
            }

            // Process on blocking thread pool (CPU-intensive FITS work)
            let fp = file_path.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                fits_preview::generate_preview(&fp)
            })
            .await
            .ok()?
            .ok()?;

            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = window.emit(
                "preview:progress",
                PreviewProgress {
                    current: done,
                    total,
                    file_path: file_path.clone(),
                },
            );

            Some((file_path, result))
        }));
    }

    let mut results = HashMap::new();
    for handle in handles {
        if let Ok(Some((path, result))) = handle.await {
            results.insert(path, result);
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn clear_preview_cache() {
    fits_preview::clear_preview_cache();
}

// ─── Masters Commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn scan_masters(root_folder: String) -> Result<MastersLibrary, String> {
    masters::scan_masters(&root_folder)
}

#[tauri::command]
pub fn find_master_match(
    root_folder: String,
    exposure_time: f64,
    ccd_temp: f64,
    temp_tolerance: Option<f64>,
) -> Result<MasterMatch, String> {
    masters::find_master_match(&root_folder, exposure_time, ccd_temp, temp_tolerance)
}

#[tauri::command]
pub fn import_masters(
    root_folder: String,
    files: Vec<String>,
    master_type: String,
    ccd_temp: i32,
    binning: Option<i32>,
    width: Option<i32>,
    height: Option<i32>,
    exposure: Option<f64>,
) -> Result<ImportResult, String> {
    let resolution = match (width, height) {
        (Some(w), Some(h)) => Some(format!("{}x{}", w, h)),
        _ => None,
    };
    masters::import_masters(&root_folder, &files, &master_type, ccd_temp, binning, &resolution, exposure)
}

// ─── Analyzer Commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn analyze_subs(
    file_paths: Vec<String>,
    window: tauri::Window,
) -> Result<HashMap<String, SubAnalysis>, String> {
    cancellation::reset_cancel("analyze");
    tauri::async_runtime::spawn_blocking(move || {
        analyzer::analyze_batch(&file_paths, Some(&window))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
}

#[tauri::command]
pub async fn analyze_stars_detail(
    file_path: String,
) -> Result<StarsDetailResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyzer::analyze_stars_detail(&file_path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ─── Settings Commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_setting(key: String, app_handle: AppHandle) -> Result<serde_json::Value, String> {
    settings::get_setting(&app_handle, &key)
}

#[tauri::command]
pub fn set_setting(
    key: String,
    value: serde_json::Value,
    app_handle: AppHandle,
) -> Result<(), String> {
    settings::set_setting(&app_handle, &key, value)
}

#[tauri::command]
pub fn get_all_settings(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    settings::get_all_settings(&app_handle)
}

// ─── Cache Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_cache(root_folder: String, data: serde_json::Value) -> Result<(), String> {
    cache::save_cache(&root_folder, data)
}

#[tauri::command]
pub fn load_cache(root_folder: String) -> Result<serde_json::Value, String> {
    cache::load_cache(&root_folder)
}

// ─── File Operation Commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn copy_to_directory(
    files: Vec<String>,
    target_dir: String,
    app_handle: AppHandle,
) -> Result<CopyResult, String> {
    let target_path = PathBuf::from(&target_dir);
    fs::create_dir_all(&target_path)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    cancellation::reset_cancel("import");
    let total = files.len();
    let mut copied: Vec<String> = Vec::new();

    for (i, file_path) in files.iter().enumerate() {
        if cancellation::is_cancelled("import") {
            log::info!("[import] cancelled at {}/{}", i, total);
            break;
        }

        let source = Path::new(file_path);
        let filename = source
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let target = target_path.join(&filename);

        let _ = app_handle.emit("import:progress", serde_json::json!({
            "current": i + 1,
            "total": total,
            "filename": &filename,
        }));

        let src = source.to_path_buf();
        let dst = target.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            fs::copy(&src, &dst)
        })
        .await;

        match result {
            Ok(Ok(_)) => {
                copied.push(target.to_string_lossy().to_string());
            }
            _ => {
                // Skip failed copies
            }
        }
    }

    let _ = app_handle.emit("import:done", serde_json::json!({
        "copied": copied.len(),
        "total": total,
    }));

    Ok(CopyResult {
        copied: copied.len(),
        files: copied,
    })
}

#[tauri::command]
pub fn move_to_trash(file_path: String) -> Result<TrashResult, String> {
    match trash::delete(Path::new(&file_path)) {
        Ok(_) => Ok(TrashResult {
            success: true,
            error: None,
        }),
        Err(e) => Ok(TrashResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub fn rename_path(old_path: String, new_path: String, root_folder: String) -> Result<(), String> {
    let resolved_old = PathBuf::from(&old_path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve old path: {}", e))?;

    let resolved_root = PathBuf::from(&root_folder)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve root folder: {}", e))?;

    // Security: old path must be under root folder
    if !resolved_old.starts_with(&resolved_root) {
        return Err("Old path must be within the root folder".to_string());
    }

    // Resolve new path (it may not exist yet, so resolve its parent)
    let new_path_buf = PathBuf::from(&new_path);
    if let Some(parent) = new_path_buf.parent() {
        let resolved_parent = parent
            .canonicalize()
            .map_err(|e| format!("Failed to resolve new path parent: {}", e))?;
        if !resolved_parent.starts_with(&resolved_root) {
            return Err("New path must be within the root folder".to_string());
        }
    }

    // Check source exists
    if !resolved_old.exists() {
        return Err("Source path does not exist".to_string());
    }

    // Check target doesn't exist
    if new_path_buf.exists() {
        return Err("Target already exists".to_string());
    }

    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn create_project(
    root_folder: String,
    project_name: String,
    filters: Vec<String>,
) -> Result<String, String> {
    let project_dir = PathBuf::from(&root_folder).join(&project_name);
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;

    for filter_name in &filters {
        let filter_dir = project_dir.join(filter_name);
        let lights_dir = filter_dir.join("Night 1").join("lights");
        let flats_dir = filter_dir.join("Night 1").join("flats");

        fs::create_dir_all(&lights_dir)
            .map_err(|e| format!("Failed to create lights directory: {}", e))?;
        fs::create_dir_all(&flats_dir)
            .map_err(|e| format!("Failed to create flats directory: {}", e))?;
    }

    Ok(project_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_session(
    filter_path: String,
    session_name: String,
    root_folder: String,
) -> Result<String, String> {
    let resolved_filter = PathBuf::from(&filter_path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve filter path: {}", e))?;

    let resolved_root = PathBuf::from(&root_folder)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve root folder: {}", e))?;

    if !resolved_filter.starts_with(&resolved_root) {
        return Err("Path must be within the root folder".to_string());
    }

    let session_dir = resolved_filter.join(&session_name);
    let lights_dir = session_dir.join("lights");
    let flats_dir = session_dir.join("flats");

    fs::create_dir_all(&lights_dir)
        .map_err(|e| format!("Failed to create lights directory: {}", e))?;
    fs::create_dir_all(&flats_dir)
        .map_err(|e| format!("Failed to create flats directory: {}", e))?;

    Ok(session_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to show in folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to show in folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open on the parent directory
        let parent = Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path.clone());
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("Failed to show in folder: {}", e))?;
    }

    Ok(())
}

/// Parse exclude patterns text (newline-separated, # comments, empty lines ignored)
fn parse_exclude_patterns(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().trim_end_matches('/').trim_end_matches('\\').to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect()
}

fn load_exclude_patterns(app_handle: &tauri::AppHandle) -> Vec<String> {
    settings::load_settings(app_handle)
        .map(|s| parse_exclude_patterns(&s.exclude_patterns))
        .unwrap_or_default()
}

// ─── Notes Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_note(folder_path: String) -> Result<String, String> {
    let note_path = Path::new(&folder_path).join("notes.txt");
    if !note_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&note_path)
        .map_err(|e| format!("Failed to read note: {}", e))
}

#[tauri::command]
pub fn write_note(folder_path: String, content: String) -> Result<(), String> {
    let note_path = Path::new(&folder_path).join("notes.txt");
    if content.trim().is_empty() {
        if note_path.exists() {
            fs::remove_file(&note_path)
                .map_err(|e| format!("Failed to delete note: {}", e))?;
        }
        return Ok(());
    }
    fs::write(&note_path, &content)
        .map_err(|e| format!("Failed to write note: {}", e))
}
