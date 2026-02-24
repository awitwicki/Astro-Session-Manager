use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::cache;
use crate::fits_parser;
use crate::fits_preview;
use crate::masters;
use crate::scanner;
use crate::settings;
use crate::thumbnail;
use crate::types::*;
use crate::xisf_parser;

// ─── Scanner Commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_root(root_folder: String, app_handle: AppHandle) -> Result<ScanResult, String> {
    let _ = &app_handle;
    tauri::async_runtime::spawn_blocking(move || scanner::scan_root_directory(&root_folder))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

// ─── FITS Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_fits_header(file_path: String) -> Result<FitsHeader, String> {
    fits_parser::read_fits_header(&file_path)
}

#[tauri::command]
pub async fn read_fits_pixel_data(file_path: String) -> Result<PixelDataResult, String> {
    tauri::async_runtime::spawn_blocking(move || fits_parser::read_fits_pixel_data(&file_path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
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

// ─── Thumbnail Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_thumbnail(
    file_path: String,
    app_handle: AppHandle,
) -> Result<ThumbnailResult, String> {
    tauri::async_runtime::spawn_blocking(move || thumbnail::generate_thumbnail(&file_path, &app_handle))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn batch_generate_thumbnails(
    window: tauri::Window,
    file_paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<HashMap<String, ThumbnailResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        thumbnail::batch_generate_thumbnails(&window, &file_paths, &app_handle)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub fn get_cached_thumbnail(
    file_path: String,
    app_handle: AppHandle,
) -> Result<Option<ThumbnailResult>, String> {
    thumbnail::get_cached_thumbnail(&file_path, &app_handle)
}

#[tauri::command]
pub fn get_cache_size(app_handle: AppHandle) -> Result<CacheSizeInfo, String> {
    thumbnail::get_cache_size(&app_handle)
}

#[tauri::command]
pub fn clear_thumbnail_cache(app_handle: AppHandle) -> Result<bool, String> {
    thumbnail::clear_thumbnail_cache(&app_handle)
}

// ─── FITS Preview Commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn get_fits_preview(
    file_path: String,
    app_handle: AppHandle,
) -> Result<FitsPreviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || fits_preview::get_fits_preview(&file_path, &app_handle))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn render_fits_preview(
    file_path: String,
    shadows: f64,
    midtones: f64,
    highlights: f64,
    app_handle: AppHandle,
) -> Result<FitsPreviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fits_preview::render_fits_preview(
            &file_path,
            shadows as f32,
            midtones as f32,
            highlights as f32,
            &app_handle,
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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
) -> Result<ImportResult, String> {
    masters::import_masters(&root_folder, &files, &master_type, ccd_temp)
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
pub fn copy_to_directory(files: Vec<String>, target_dir: String) -> Result<CopyResult, String> {
    let target_path = Path::new(&target_dir);
    fs::create_dir_all(target_path)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    let mut copied: Vec<String> = Vec::new();

    for file_path in &files {
        let source = Path::new(file_path);
        let filename = source
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let target = target_path.join(&filename);

        match fs::copy(source, &target) {
            Ok(_) => {
                copied.push(target.to_string_lossy().to_string());
            }
            Err(_) => {
                // Skip failed copies
            }
        }
    }

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
        let lights_dir = filter_dir.join("night1").join("lights");
        let flats_dir = filter_dir.join("night1").join("flats");

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
