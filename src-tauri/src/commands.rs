use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

use crate::analyzer;
use crate::cache;
use crate::cancellation;
use crate::fits_parser;
use crate::fits_preview;
use crate::masters;
use crate::preview_queue;
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
    // Foreground: pause queue admissions so the visible frame gets the CPU.
    let _foreground = preview_queue::foreground_guard();
    tauri::async_runtime::spawn_blocking(move || {
        fits_preview::get_fits_preview(&file_path)
            // Clone is required for Tauri IPC serialization — the Arc benefit
            // is primarily in the batch path where results stay internal.
            .map(|arc| (*arc).clone())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Replace pending prefetch work with the window around the selected frame
/// (paths ordered nearest-first): a preview job per path, each followed by a
/// star-detail job when `include_stars` is set. Fire-and-forget: progress is
/// delivered via `preview:queue_state` events.
#[tauri::command]
pub async fn enqueue_prefetch_window(
    window: tauri::Window,
    file_paths: Vec<String>,
    include_stars: bool,
) -> Result<(), String> {
    preview_queue::prefetch_window(&window, file_paths, include_stars);
    Ok(())
}

/// Drain the pending preview queue. In-flight items continue to completion.
#[tauri::command]
pub async fn clear_preview_queue(window: tauri::Window) -> Result<(), String> {
    preview_queue::clear(&window);
    Ok(())
}

/// "Cache all previews": queue a preview job per path behind the navigation
/// window, replacing any previous sweep. Already-cached paths complete
/// instantly, so restarting a stopped sweep only generates what is missing.
/// Fire-and-forget: progress arrives via `preview:queue_state` (bulk fields).
#[tauri::command]
pub async fn enqueue_bulk_previews(
    window: tauri::Window,
    file_paths: Vec<String>,
) -> Result<(), String> {
    preview_queue::bulk_previews(&window, file_paths);
    Ok(())
}

/// Stop a "Cache all previews" sweep. In-flight items continue to completion.
#[tauri::command]
pub async fn clear_bulk_previews(window: tauri::Window) -> Result<(), String> {
    preview_queue::clear_bulk(&window);
    Ok(())
}

#[tauri::command]
pub fn clear_preview_cache() {
    fits_preview::clear_preview_cache();
}

#[tauri::command]
pub fn update_preview_config(cache_limit_mb: u32, concurrency: u32) {
    fits_preview::update_config(cache_limit_mb, concurrency);
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
    // Foreground: pause queue admissions so the visible frame's overlay
    // analysis doesn't finish last behind a batch of prefetch jobs.
    let _foreground = preview_queue::foreground_guard();
    tauri::async_runtime::spawn_blocking(move || {
        analyzer::stars_detail_cached(&file_path)
            // Clone is required for Tauri IPC serialization — the Arc benefit
            // is in the cache/prefetch path where results stay internal.
            .map(|arc| (*arc).clone())
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

pub const SOURCE_UNREACHABLE: &str =
    "Source folder not reachable — is the share mounted / USB plugged in?";

#[derive(Debug, PartialEq)]
pub(crate) enum CopyOutcome {
    Copied(PathBuf),
    Skipped(PathBuf),
    Failed(String),
}

/// Copies through a hidden `.<name>.part` file and renames it into place only
/// once its size matches the source, so an interrupted copy (a dropped SMB
/// link) never leaves a truncated frame behind. Never overwrites: a file of
/// the same name and size is taken as already imported, a different size is
/// a conflict.
pub(crate) fn copy_file_safely(src: &Path, target_dir: &Path) -> CopyOutcome {
    let name = match src.file_name() {
        Some(n) => n.to_string_lossy().to_string(),
        None => return CopyOutcome::Failed("Not a file path".to_string()),
    };
    let src_len = match fs::metadata(src) {
        Ok(m) => m.len(),
        Err(e) => return CopyOutcome::Failed(format!("Cannot read source: {e}")),
    };
    let dst = target_dir.join(&name);
    if let Ok(existing) = fs::metadata(&dst) {
        return if existing.len() == src_len {
            CopyOutcome::Skipped(dst)
        } else {
            CopyOutcome::Failed("A different file with this name already exists".to_string())
        };
    }
    let part = target_dir.join(format!(".{name}.part"));
    let result = fs::copy(src, &part)
        .map_err(|e| format!("Copy failed: {e}"))
        .and_then(|written| {
            if written != src_len {
                return Err(format!("Copied {written} of {src_len} bytes"));
            }
            fs::rename(&part, &dst).map_err(|e| format!("Rename failed: {e}"))
        });
    match result {
        Ok(()) => CopyOutcome::Copied(dst),
        Err(e) => {
            let _ = fs::remove_file(&part);
            CopyOutcome::Failed(e)
        }
    }
}

fn source_gone(file_path: &str) -> bool {
    Path::new(file_path).parent().is_none_or(|p| !p.exists())
}

#[tauri::command]
pub async fn copy_to_directory(
    files: Vec<String>,
    target_dir: String,
    app_handle: AppHandle,
) -> Result<CopyResult, String> {
    let target_path = PathBuf::from(&target_dir);
    fs::create_dir_all(&target_path)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    // An unmounted share fails the whole job at once instead of per file.
    if files.first().is_some_and(|f| source_gone(f)) {
        return Err(SOURCE_UNREACHABLE.to_string());
    }

    cancellation::reset_cancel("import");
    let total = files.len();
    let mut result = CopyResult { copied: Vec::new(), skipped: Vec::new(), failed: Vec::new() };

    for (i, file_path) in files.iter().enumerate() {
        if cancellation::is_cancelled("import") {
            log::info!("[import] cancelled at {}/{}", i, total);
            break;
        }

        let filename = Path::new(file_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let _ = app_handle.emit("import:progress", serde_json::json!({
            "current": i + 1,
            "total": total,
            "filename": &filename,
        }));

        let src = PathBuf::from(file_path);
        let dir = target_path.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || copy_file_safely(&src, &dir))
            .await
            .unwrap_or_else(|e| CopyOutcome::Failed(e.to_string()));

        match outcome {
            CopyOutcome::Copied(p) => result.copied.push(p.to_string_lossy().to_string()),
            CopyOutcome::Skipped(p) => result.skipped.push(p.to_string_lossy().to_string()),
            CopyOutcome::Failed(error) => {
                if source_gone(file_path) {
                    // The share dropped: fail the rest without touching them.
                    for rest in &files[i..] {
                        result.failed.push(CopyFailure { file: rest.clone(), error: SOURCE_UNREACHABLE.to_string() });
                    }
                    break;
                }
                result.failed.push(CopyFailure { file: file_path.clone(), error });
            }
        }
    }

    let _ = app_handle.emit("import:done", serde_json::json!({
        "copied": result.copied.len(),
        "total": total,
    }));

    Ok(result)
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

/// Subfolders `create_session` may create — the ones `scanner.rs` reads.
const SESSION_SUBFOLDERS: [&str; 4] = ["lights", "flats", "darks", "biases"];

#[tauri::command]
pub fn create_session(
    filter_path: String,
    session_name: String,
    root_folder: String,
    subfolders: Vec<String>,
) -> Result<String, String> {
    if let Some(bad) = subfolders.iter().find(|s| !SESSION_SUBFOLDERS.contains(&s.as_str())) {
        return Err(format!("Unknown session subfolder: {}", bad));
    }

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
    fs::create_dir_all(&session_dir)
        .map_err(|e| format!("Failed to create session directory: {}", e))?;
    for sub in &subfolders {
        fs::create_dir_all(session_dir.join(sub))
            .map_err(|e| format!("Failed to create {} directory: {}", sub, e))?;
    }

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

// ─── Horizon Commands ───────────────────────────────────────────────────────

/// Read a user-chosen custom-horizon (.hrz) file. Deliberately narrow: the app
/// has no filesystem plugin, and this feature needs exactly one read and one
/// write, so a general-purpose file API would grant far more than it needs.
#[tauri::command]
pub fn read_horizon_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(Path::new(&file_path))
        .map_err(|e| format!("Failed to read horizon file: {}", e))
}

/// Write a custom-horizon (.hrz) file to a user-chosen path.
#[tauri::command]
pub fn write_horizon_file(file_path: String, contents: String) -> Result<(), String> {
    fs::write(Path::new(&file_path), &contents)
        .map_err(|e| format!("Failed to write horizon file: {}", e))
}

#[cfg(test)]
mod copy_tests {
    use super::*;

    fn temp_dirs(name: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("asm-copy-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("src")).unwrap();
        fs::create_dir_all(base.join("dst")).unwrap();
        (base.join("src"), base.join("dst"))
    }

    fn part_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".part"))
            .collect()
    }

    #[test]
    fn copies_a_new_file_without_leaving_a_part_file() {
        let (src, dst) = temp_dirs("new");
        fs::write(src.join("Light_1.fit"), b"abcdef").unwrap();
        let outcome = copy_file_safely(&src.join("Light_1.fit"), &dst);
        assert_eq!(outcome, CopyOutcome::Copied(dst.join("Light_1.fit")));
        assert_eq!(fs::read(dst.join("Light_1.fit")).unwrap(), b"abcdef");
        assert!(part_files(&dst).is_empty());
    }

    #[test]
    fn skips_an_existing_file_of_the_same_size() {
        let (src, dst) = temp_dirs("same");
        fs::write(src.join("Light_1.fit"), b"abcdef").unwrap();
        fs::write(dst.join("Light_1.fit"), b"ABCDEF").unwrap();
        let outcome = copy_file_safely(&src.join("Light_1.fit"), &dst);
        assert_eq!(outcome, CopyOutcome::Skipped(dst.join("Light_1.fit")));
        assert_eq!(fs::read(dst.join("Light_1.fit")).unwrap(), b"ABCDEF");
    }

    #[test]
    fn never_overwrites_a_different_file_with_the_same_name() {
        let (src, dst) = temp_dirs("conflict");
        fs::write(src.join("Light_1.fit"), b"abcdef").unwrap();
        fs::write(dst.join("Light_1.fit"), b"xyz").unwrap();
        let outcome = copy_file_safely(&src.join("Light_1.fit"), &dst);
        assert!(matches!(outcome, CopyOutcome::Failed(ref e) if e.contains("already exists")));
        assert_eq!(fs::read(dst.join("Light_1.fit")).unwrap(), b"xyz");
        assert!(part_files(&dst).is_empty());
    }

    #[test]
    fn a_missing_source_fails_and_leaves_nothing_behind() {
        let (src, dst) = temp_dirs("missing");
        let outcome = copy_file_safely(&src.join("Light_gone.fit"), &dst);
        assert!(matches!(outcome, CopyOutcome::Failed(_)));
        assert_eq!(fs::read_dir(&dst).unwrap().count(), 0);
    }
}

#[cfg(test)]
mod create_session_tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("asm-session-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("P").join("Ha")).unwrap();
        base
    }

    fn subdirs(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    fn create(base: &Path, subs: &[&str]) -> Result<String, String> {
        create_session(
            base.join("P").join("Ha").to_string_lossy().to_string(),
            "Night 1".to_string(),
            base.to_string_lossy().to_string(),
            subs.iter().map(|s| s.to_string()).collect(),
        )
    }

    #[test]
    fn creates_only_the_requested_subfolders() {
        let base = root("some");
        let dir = create(&base, &["lights", "darks"]).unwrap();
        assert_eq!(subdirs(Path::new(&dir)), ["darks", "lights"]);
    }

    #[test]
    fn creates_an_empty_session_without_subfolders() {
        let base = root("none");
        let dir = create(&base, &[]).unwrap();
        assert!(subdirs(Path::new(&dir)).is_empty());
    }

    #[test]
    fn rejects_unknown_subfolders() {
        let base = root("bad");
        assert!(create(&base, &["../escape"]).is_err());
        assert!(!base.join("P").join("Ha").join("Night 1").exists());
    }
}
