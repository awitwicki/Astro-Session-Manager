use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::Emitter;

use crate::cancellation;
use crate::fits_parser;
use crate::types::{
    FilterScanNode, FitsFileRef, FitsHeader, ProjectScanNode, ScanResult, ScanProgress,
    SessionScanNode,
};
use crate::xisf_parser;

fn header_cache() -> &'static Mutex<HashMap<String, FitsHeader>> {
    static CACHE: OnceLock<Mutex<HashMap<String, FitsHeader>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Seed the header cache with previously known headers (e.g. loaded from disk cache).
/// Existing entries are NOT overwritten so in-memory results from the current session win.
pub fn seed_header_cache(headers: HashMap<String, FitsHeader>) {
    if let Ok(mut cache) = header_cache().lock() {
        for (k, v) in headers {
            cache.entry(k).or_insert(v);
        }
    }
}

const FITS_EXTENSIONS: &[&str] = &[".fits", ".fit", ".fts", ".xisf"];

/// Simple glob matching supporting * (any chars) and ? (single char)
fn simple_glob_match(text: &[u8], pattern: &[u8]) -> bool {
    let mut ti = 0;
    let mut pi = 0;
    let mut star_pi = usize::MAX;
    let mut star_ti = 0;

    while ti < text.len() {
        if pi < pattern.len() && (pattern[pi] == b'?' || pattern[pi] == text[ti]) {
            ti += 1;
            pi += 1;
        } else if pi < pattern.len() && pattern[pi] == b'*' {
            star_pi = pi;
            star_ti = ti;
            pi += 1;
        } else if star_pi != usize::MAX {
            pi = star_pi + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }

    while pi < pattern.len() && pattern[pi] == b'*' {
        pi += 1;
    }

    pi == pattern.len()
}

/// Check if a directory name matches any of the exclude patterns (case-insensitive)
fn matches_exclude_pattern(name: &str, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }
    let lower = name.to_lowercase();
    let lower_bytes = lower.as_bytes();
    patterns.iter().any(|p| {
        let lp = p.to_lowercase();
        simple_glob_match(lower_bytes, lp.as_bytes())
    })
}

/// Check if a filename has a supported FITS/XISF extension
fn is_fits_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    FITS_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

/// Safely list directory entries, returning empty vec on error
fn list_dir_safe(dir_path: &Path) -> Vec<fs::DirEntry> {
    match fs::read_dir(dir_path) {
        Ok(entries) => entries.filter_map(|e| e.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Scan a directory for FITS/XISF files, returning sorted FitsFileRef list
fn scan_fits_files(dir_path: &Path) -> Vec<FitsFileRef> {
    let entries = list_dir_safe(dir_path);
    let mut refs: Vec<FitsFileRef> = Vec::new();

    for entry in entries {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_file() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if !is_fits_file(&name) {
            continue;
        }

        let full_path = dir_path.join(&name);
        if let Ok(metadata) = fs::metadata(&full_path) {
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|t| {
                    let datetime: chrono::DateTime<chrono::Utc> = t.into();
                    Some(datetime.to_rfc3339())
                })
                .unwrap_or_default();

            refs.push(FitsFileRef {
                filename: name,
                path: full_path.to_string_lossy().to_string(),
                size_bytes: metadata.len(),
                modified_at,
            });
        }
    }

    refs.sort_by(|a, b| a.filename.cmp(&b.filename));
    refs
}

/// Find a subdirectory by name, case-insensitive, from a list of DirEntry
fn find_dir_case_insensitive<'a>(
    entries: &'a [fs::DirEntry],
    names: &[&str],
) -> Option<&'a fs::DirEntry> {
    let lower_names: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    entries.iter().find(|e| {
        if let Ok(ft) = e.file_type() {
            if ft.is_dir() {
                let entry_name = e.file_name().to_string_lossy().to_lowercase();
                return lower_names.contains(&entry_name);
            }
        }
        false
    })
}

/// Scan a single session directory for lights and flats
fn scan_session(session_path: &Path, date_name: &str) -> SessionScanNode {
    let entries = list_dir_safe(session_path);

    // Look for lights/flats subdirectories (case-insensitive)
    let lights_dir = find_dir_case_insensitive(&entries, &["lights", "light"]);
    let flats_dir = find_dir_case_insensitive(&entries, &["flats", "flat"]);

    let mut lights: Vec<FitsFileRef> = Vec::new();
    let mut flats: Vec<FitsFileRef> = Vec::new();

    if let Some(ld) = lights_dir {
        lights = scan_fits_files(&session_path.join(ld.file_name()));
    }

    if let Some(fd) = flats_dir {
        flats = scan_fits_files(&session_path.join(fd.file_name()));
    }

    // If no lights subdirectory found, scan FITS files directly in session folder
    if lights.is_empty() {
        let direct_fits = scan_fits_files(session_path);
        if !direct_fits.is_empty() {
            lights = direct_fits;
        }
    }

    let total_size_bytes: u64 = lights.iter().map(|l| l.size_bytes).sum::<u64>()
        + flats.iter().map(|f| f.size_bytes).sum::<u64>();

    SessionScanNode {
        date: date_name.to_string(),
        path: session_path.to_string_lossy().to_string(),
        lights,
        flats,
        total_size_bytes,
        has_notes: session_path.join("notes.txt").exists(),
    }
}

/// Scan a filter directory for session subdirectories
fn scan_filter(filter_path: &Path, filter_name: &str, exclude_patterns: &[String]) -> FilterScanNode {
    let entries = list_dir_safe(filter_path);
    let mut sessions: Vec<SessionScanNode> = Vec::new();

    // Each subdirectory is a date/session
    let dir_entries: Vec<&fs::DirEntry> = entries
        .iter()
        .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
        .collect();

    for entry in &dir_entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if matches_exclude_pattern(&name, exclude_patterns) {
            continue;
        }
        let session = scan_session(&filter_path.join(&name), &name);
        sessions.push(session);
    }

    // Check if FITS files are directly in the filter folder
    // (some structures: project/filter/files.fits without date subfolder)
    if sessions
        .iter()
        .all(|s| s.lights.is_empty() && s.flats.is_empty())
    {
        let direct_fits = scan_fits_files(filter_path);
        if !direct_fits.is_empty() {
            let total: u64 = direct_fits.iter().map(|f| f.size_bytes).sum();
            sessions.push(SessionScanNode {
                date: "unsorted".to_string(),
                path: filter_path.to_string_lossy().to_string(),
                lights: direct_fits,
                flats: Vec::new(),
                total_size_bytes: total,
                has_notes: filter_path.join("notes.txt").exists(),
            });
        }
    }

    sessions.sort_by(|a, b| a.date.cmp(&b.date));
    let total_size_bytes: u64 = sessions.iter().map(|s| s.total_size_bytes).sum();

    FilterScanNode {
        name: filter_name.to_string(),
        path: filter_path.to_string_lossy().to_string(),
        sessions,
        total_size_bytes,
        has_notes: filter_path.join("notes.txt").exists(),
    }
}

/// Scan a project directory for filter subdirectories
fn scan_project(project_path: &Path, project_name: &str, exclude_patterns: &[String]) -> ProjectScanNode {
    let entries = list_dir_safe(project_path);
    let mut filters: Vec<FilterScanNode> = Vec::new();

    let dir_entries: Vec<&fs::DirEntry> = entries
        .iter()
        .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
        .collect();

    for entry in &dir_entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if matches_exclude_pattern(&name, exclude_patterns) {
            continue;
        }
        let filter = scan_filter(&project_path.join(&name), &name, exclude_patterns);
        filters.push(filter);
    }

    filters.sort_by(|a, b| a.name.cmp(&b.name));
    let total_size_bytes: u64 = filters.iter().map(|f| f.total_size_bytes).sum();

    ProjectScanNode {
        name: project_name.to_string(),
        path: project_path.to_string_lossy().to_string(),
        filters,
        total_size_bytes,
        has_notes: project_path.join("notes.txt").exists(),
    }
}

/// Enrich scan results with FITS headers by reading the first light of each session.
/// Re-uses cached headers for files that have already been parsed; only reads new ones.
fn enrich_with_headers(
    scan_result: &ScanResult,
    window: Option<&tauri::Window>,
) -> HashMap<String, FitsHeader> {
    let mut project_headers: HashMap<String, FitsHeader> = HashMap::new();

    // Snapshot the current cache so we only lock briefly
    let cached: HashMap<String, FitsHeader> = header_cache()
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default();

    // Collect all first-light paths for progress tracking
    let first_lights: Vec<&FitsFileRef> = scan_result
        .projects
        .iter()
        .flat_map(|p| &p.filters)
        .flat_map(|f| &f.sessions)
        .filter_map(|s| s.lights.first())
        .collect();

    let total = first_lights.len();

    for (i, first_light) in first_lights.iter().enumerate() {
        if cancellation::is_cancelled("scan") {
            log::info!("[scan] cancelled at header {}/{}", i, total);
            break;
        }

        // Emit progress
        if let Some(win) = window {
            let _ = win.emit(
                "scan:progress",
                ScanProgress {
                    phase: "headers".to_string(),
                    current: i + 1,
                    total,
                    file_path: first_light.path.clone(),
                },
            );
        }

        // Re-use cached header if available
        if let Some(existing) = cached.get(&first_light.path) {
            project_headers.insert(first_light.path.clone(), existing.clone());
            continue;
        }

        let header_result = if first_light
            .filename
            .to_lowercase()
            .ends_with(".xisf")
        {
            xisf_parser::read_xisf_header(&first_light.path)
        } else {
            fits_parser::read_fits_header(&first_light.path)
        };

        if let Ok(header) = header_result {
            project_headers.insert(first_light.path.clone(), header);
        }
    }

    // Update the cache: replace with current set (removed files are dropped automatically)
    if let Ok(mut cache) = header_cache().lock() {
        *cache = project_headers.clone();
    }

    project_headers
}

/// Like enrich_with_headers but merges results into existing cache instead of replacing it.
/// Used for single-project rescans where we don't want to evict headers for other projects.
fn enrich_with_headers_merge(
    scan_result: &ScanResult,
    window: Option<&tauri::Window>,
) -> HashMap<String, FitsHeader> {
    let mut project_headers: HashMap<String, FitsHeader> = HashMap::new();

    let cached: HashMap<String, FitsHeader> = header_cache()
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default();

    let first_lights: Vec<&FitsFileRef> = scan_result
        .projects
        .iter()
        .flat_map(|p| &p.filters)
        .flat_map(|f| &f.sessions)
        .filter_map(|s| s.lights.first())
        .collect();

    let total = first_lights.len();

    for (i, first_light) in first_lights.iter().enumerate() {
        if cancellation::is_cancelled("scan") {
            log::info!("[scan] cancelled at header {}/{}", i, total);
            break;
        }

        if let Some(win) = window {
            let _ = win.emit(
                "scan:progress",
                ScanProgress {
                    phase: "headers".to_string(),
                    current: i + 1,
                    total,
                    file_path: first_light.path.clone(),
                },
            );
        }

        if let Some(existing) = cached.get(&first_light.path) {
            project_headers.insert(first_light.path.clone(), existing.clone());
            continue;
        }

        let header_result = if first_light
            .filename
            .to_lowercase()
            .ends_with(".xisf")
        {
            xisf_parser::read_xisf_header(&first_light.path)
        } else {
            fits_parser::read_fits_header(&first_light.path)
        };

        if let Ok(header) = header_result {
            project_headers.insert(first_light.path.clone(), header);
        }
    }

    // Merge into cache (don't replace — preserve headers from other projects)
    if let Ok(mut cache) = header_cache().lock() {
        for (k, v) in &project_headers {
            cache.insert(k.clone(), v.clone());
        }
    }

    project_headers
}

/// Scan a single project directory and enrich with headers.
/// Merges new headers into the cache instead of replacing it.
pub fn scan_single_project_directory(
    project_path: &str,
    window: Option<&tauri::Window>,
    exclude_patterns: &[String],
) -> Result<ScanResult, String> {
    let path = Path::new(project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!(
            "Project path does not exist or is not a directory: {}",
            project_path
        ));
    }

    let project_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let start = Instant::now();
    let project = scan_project(path, &project_name, exclude_patterns);
    let duration = start.elapsed();

    let mut result = ScanResult {
        root_path: path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        projects: vec![project],
        scan_duration_ms: duration.as_millis() as u64,
        project_headers: HashMap::new(),
    };

    // Enrich with headers, merging into existing cache
    result.project_headers = enrich_with_headers_merge(&result, window);

    if cancellation::is_cancelled("scan") {
        return Err("Scan cancelled".to_string());
    }

    Ok(result)
}

/// Main scan function: scan a root directory for projects, filters, sessions
pub fn scan_root_directory(
    root_path: &str,
    window: Option<&tauri::Window>,
    exclude_patterns: &[String],
) -> Result<ScanResult, String> {
    let start = Instant::now();
    let root = Path::new(root_path);

    if !root.exists() || !root.is_dir() {
        return Err(format!(
            "Root path does not exist or is not a directory: {}",
            root_path
        ));
    }

    let entries = list_dir_safe(root);
    let mut projects: Vec<ProjectScanNode> = Vec::new();

    // Filter out "masters" directory and dot-directories
    let dir_entries: Vec<&fs::DirEntry> = entries
        .iter()
        .filter(|e| {
            if let Ok(ft) = e.file_type() {
                if ft.is_dir() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name == "masters" || name.starts_with('.') {
                        return false;
                    }
                    if matches_exclude_pattern(&name, exclude_patterns) {
                        return false;
                    }
                    return true;
                }
            }
            false
        })
        .collect();

    let total_projects = dir_entries.len();

    for (i, entry) in dir_entries.iter().enumerate() {
        if cancellation::is_cancelled("scan") {
            log::info!("[scan] cancelled at project {}/{}", i, total_projects);
            break;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Emit directory-scan progress
        if let Some(win) = window {
            let _ = win.emit(
                "scan:progress",
                ScanProgress {
                    phase: "scanning".to_string(),
                    current: i + 1,
                    total: total_projects,
                    file_path: name.clone(),
                },
            );
        }

        let project = scan_project(&root.join(&name), &name, exclude_patterns);
        projects.push(project);
    }

    projects.sort_by(|a, b| a.name.cmp(&b.name));

    let duration = start.elapsed();
    let mut result = ScanResult {
        root_path: root_path.to_string(),
        projects,
        scan_duration_ms: duration.as_millis() as u64,
        project_headers: HashMap::new(),
    };

    // Enrich with headers from first light of each session
    result.project_headers = enrich_with_headers(&result, window);

    if cancellation::is_cancelled("scan") {
        return Err("Scan cancelled".to_string());
    }

    Ok(result)
}
