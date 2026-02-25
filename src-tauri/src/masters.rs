use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use walkdir::WalkDir;

use crate::fits_parser;
use crate::types::{FitsHeader, ImportResult, MasterFileEntry, MasterMatch, MastersLibrary, OtherEntry};
use crate::xisf_parser;

const SUPPORTED_EXTENSIONS: &[&str] = &[".fits", ".fit", ".fts", ".xisf"];

/// Check if a file has a supported extension
fn is_supported_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    SUPPORTED_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

/// Get the file extension without the dot, lowercased
fn get_format(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Scanned file info (internal)
struct ScannedFile {
    filename: String,
    path: String,
    size_bytes: u64,
    format: String,
}

/// Recursively scan a directory for supported files
fn scan_files_recursive(dir_path: &Path) -> Vec<ScannedFile> {
    let mut files: Vec<ScannedFile> = Vec::new();

    if !dir_path.exists() {
        return files;
    }

    for entry in WalkDir::new(dir_path)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let filename = entry.file_name().to_string_lossy().to_string();
        if !is_supported_file(&filename) {
            continue;
        }

        let full_path = entry.path().to_string_lossy().to_string();
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let format = get_format(&filename);

        files.push(ScannedFile {
            filename,
            path: full_path,
            size_bytes,
            format,
        });
    }

    files
}

/// Parse a file header (FITS or XISF) returning Option<FitsHeader>
fn parse_file_header(file: &ScannedFile) -> Option<FitsHeader> {
    if file.format == "xisf" {
        xisf_parser::read_xisf_header(&file.path).ok()
    } else {
        fits_parser::read_fits_header(&file.path).ok()
    }
}

/// Parse metadata from filename template:
/// masterDark_-20C_BIN-1_6248x4176_EXPOSURE-180.00s.xisf
struct FilenameMeta {
    ccd_temp: Option<f64>,
    binning: Option<i32>,
    resolution: Option<String>,
    exposure_time: Option<f64>,
}

fn parse_filename_metadata(filename: &str) -> FilenameMeta {
    let mut meta = FilenameMeta {
        ccd_temp: None,
        binning: None,
        resolution: None,
        exposure_time: None,
    };

    // Temperature: _-20C_ or _+5C_ or _0C.
    let temp_re = Regex::new(r"_([+-]?\d+)C[_.]").unwrap();
    if let Some(cap) = temp_re.captures(filename) {
        if let Ok(t) = cap[1].parse::<f64>() {
            meta.ccd_temp = Some(t);
        }
    }

    // Binning: BIN-1, BIN-2
    let bin_re = Regex::new(r"(?i)BIN-(\d+)").unwrap();
    if let Some(cap) = bin_re.captures(filename) {
        if let Ok(b) = cap[1].parse::<i32>() {
            meta.binning = Some(b);
        }
    }

    // Resolution: 6248x4176
    let res_re = Regex::new(r"(\d{3,5}x\d{3,5})").unwrap();
    if let Some(cap) = res_re.captures(filename) {
        meta.resolution = Some(cap[1].to_string());
    }

    // Exposure: EXPOSURE-180.00s
    let exp_re = Regex::new(r"(?i)EXPOSURE-(\d+\.?\d*)s").unwrap();
    if let Some(cap) = exp_re.captures(filename) {
        if let Ok(e) = cap[1].parse::<f64>() {
            meta.exposure_time = Some(e);
        }
    }

    meta
}

/// Extract metadata from a FITS header and filename, with fallback to filename parsing
struct ExtractedMeta {
    exposure_time: f64,
    ccd_temp: Option<f64>,
    binning: Option<i32>,
    resolution: Option<String>,
    camera: String,
    temp_source: String,
}

fn extract_meta(header: &Option<FitsHeader>, filename: &str) -> ExtractedMeta {
    let mut exposure_time: f64 = 0.0;
    let mut ccd_temp: Option<f64> = None;
    let mut binning: Option<i32> = None;
    let mut resolution: Option<String> = None;
    let mut camera = "Unknown".to_string();
    let mut temp_source = "unknown".to_string();

    if let Some(h) = header {
        // Exposure
        if let Some(exp) = h.exptime {
            exposure_time = (exp * 100.0).round() / 100.0;
        }

        // Temperature
        if let Some(temp) = h.ccd_temp {
            ccd_temp = Some(temp.round());
            temp_source = "header".to_string();
        }

        // Camera
        if let Some(ref instr) = h.instrume {
            let trimmed = instr.trim();
            if !trimmed.is_empty() {
                camera = trimmed.to_string();
            }
        }

        // Binning
        if let Some(bin) = h.xbinning {
            binning = Some(bin);
        }

        // Resolution
        if h.naxis1 > 0 && h.naxis2 > 0 {
            resolution = Some(format!("{}x{}", h.naxis1, h.naxis2));
        }
    }

    // Fallback to filename parsing for missing values
    let fname_meta = parse_filename_metadata(filename);

    if ccd_temp.is_none() {
        if let Some(t) = fname_meta.ccd_temp {
            ccd_temp = Some(t);
            temp_source = "filename".to_string();
        }
    }
    if exposure_time == 0.0 {
        if let Some(e) = fname_meta.exposure_time {
            exposure_time = e;
        }
    }
    if binning.is_none() {
        binning = fname_meta.binning;
    }
    if resolution.is_none() {
        resolution = fname_meta.resolution;
    }

    ExtractedMeta {
        exposure_time,
        ccd_temp,
        binning,
        resolution,
        camera,
        temp_source,
    }
}

/// Generate a standard filename for imported master frames
fn generate_filename(
    master_type: &str,
    ccd_temp: i32,
    binning: Option<i32>,
    resolution: &Option<String>,
    exposure_time: f64,
    ext: &str,
) -> String {
    let prefix = if master_type == "darks" {
        "masterDark"
    } else {
        "masterBias"
    };

    let temp_str = if ccd_temp >= 0 {
        format!("+{}C", ccd_temp)
    } else {
        format!("{}C", ccd_temp)
    };

    let bin_str = format!("BIN-{}", binning.unwrap_or(1));
    let res_str = resolution.as_deref().unwrap_or("unknown");

    let mut name = format!("{}_{}_{}_{}", prefix, temp_str, bin_str, res_str);

    if master_type == "darks" && exposure_time > 0.0 {
        name = format!("{}_EXPOSURE-{:.2}s", name, exposure_time);
    }

    format!("{}.{}", name, ext)
}

/// Collect "other" entries (non-master files and subdirectories) from a directory
fn collect_other_entries(dir_path: &Path, master_prefix: &str) -> Vec<OtherEntry> {
    let mut others: Vec<OtherEntry> = Vec::new();
    if !dir_path.exists() {
        return others;
    }

    let entries = match fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return others,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

        // Skip proper master files (they are in the main list)
        if !is_dir && name.starts_with(master_prefix) && is_supported_file(&name) {
            continue;
        }

        // Skip PixInsight project bundles (they look like folders but aren't)
        if name.contains(".pxiproject") {
            continue;
        }

        let path = entry.path().to_string_lossy().to_string();
        let size_bytes = if is_dir {
            0
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };

        others.push(OtherEntry {
            name,
            path,
            size_bytes,
            is_dir,
        });
    }

    others.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });
    others
}

/// Scan the masters library (darks and biases) from root_folder/masters/
pub fn scan_masters(root_folder: &str) -> Result<MastersLibrary, String> {
    let masters_path = PathBuf::from(root_folder).join("masters");

    // Scan darks
    let darks_path = masters_path.join("darks");
    let dark_files = scan_files_recursive(&darks_path);

    let mut darks: Vec<MasterFileEntry> = Vec::new();
    for file in &dark_files {
        // Only files starting with "masterDark" are proper darks
        if !file.filename.starts_with("masterDark") {
            continue;
        }
        let header = parse_file_header(file);
        let meta = extract_meta(&header, &file.filename);
        darks.push(MasterFileEntry {
            filename: file.filename.clone(),
            path: file.path.clone(),
            size_bytes: file.size_bytes,
            format: file.format.clone(),
            exposure_time: meta.exposure_time,
            ccd_temp: meta.ccd_temp,
            binning: meta.binning,
            resolution: meta.resolution,
            camera: meta.camera,
            temp_source: meta.temp_source,
        });
    }
    darks.sort_by(|a, b| {
        a.exposure_time
            .partial_cmp(&b.exposure_time)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                a.ccd_temp
                    .unwrap_or(0.0)
                    .partial_cmp(&b.ccd_temp.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    let other_darks = collect_other_entries(&darks_path, "masterDark");

    // Scan biases
    let biases_path = masters_path.join("biases");
    let bias_files = scan_files_recursive(&biases_path);

    let mut biases: Vec<MasterFileEntry> = Vec::new();
    for file in &bias_files {
        // Only files starting with "masterBias" are proper biases
        if !file.filename.starts_with("masterBias") {
            continue;
        }
        let header = parse_file_header(file);
        let meta = extract_meta(&header, &file.filename);
        biases.push(MasterFileEntry {
            filename: file.filename.clone(),
            path: file.path.clone(),
            size_bytes: file.size_bytes,
            format: file.format.clone(),
            exposure_time: meta.exposure_time,
            ccd_temp: meta.ccd_temp,
            binning: meta.binning,
            resolution: meta.resolution,
            camera: meta.camera,
            temp_source: meta.temp_source,
        });
    }
    biases.sort_by(|a, b| {
        a.ccd_temp
            .unwrap_or(0.0)
            .partial_cmp(&b.ccd_temp.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let other_biases = collect_other_entries(&biases_path, "masterBias");

    Ok(MastersLibrary {
        darks,
        biases,
        other_darks,
        other_biases,
        root_path: masters_path.to_string_lossy().to_string(),
    })
}

/// Find a matching master dark and bias for given exposure and temperature
pub fn find_master_match(
    root_folder: &str,
    exposure_time: f64,
    ccd_temp: f64,
    temp_tolerance: Option<f64>,
) -> Result<MasterMatch, String> {
    let library = scan_masters(root_folder)?;
    let tolerance = temp_tolerance.unwrap_or(2.0);

    // Find matching darks: exposure +-0.5s + closest temperature within tolerance
    let mut matching_darks: Vec<&MasterFileEntry> = library
        .darks
        .iter()
        .filter(|f| {
            (f.exposure_time - exposure_time).abs() < 0.5
                && f.ccd_temp.is_some()
                && (f.ccd_temp.unwrap() - ccd_temp).abs() <= tolerance
        })
        .collect();

    // Sort by closest temperature
    matching_darks.sort_by(|a, b| {
        let diff_a = (a.ccd_temp.unwrap_or(0.0) - ccd_temp).abs();
        let diff_b = (b.ccd_temp.unwrap_or(0.0) - ccd_temp).abs();
        diff_a
            .partial_cmp(&diff_b)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let dark = matching_darks.first().cloned().cloned();
    let bias = library.biases.first().cloned();

    Ok(MasterMatch { dark, bias })
}

/// Import master files: copy to rootFolder/masters/{type}/ with proper naming
pub fn import_masters(
    root_folder: &str,
    files: &[String],
    master_type: &str,
    ccd_temp: i32,
) -> Result<ImportResult, String> {
    let target_dir = PathBuf::from(root_folder)
        .join("masters")
        .join(master_type);

    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    let mut imported: Vec<String> = Vec::new();

    for file_path in files {
        let ext = get_format(file_path);
        let filename = Path::new(file_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        // Read header to get metadata
        let scanned = ScannedFile {
            filename: filename.clone(),
            path: file_path.clone(),
            size_bytes: 0,
            format: ext.clone(),
        };

        let header = parse_file_header(&scanned);
        let meta = extract_meta(&header, &filename);

        // Generate proper filename with user-provided temperature
        let new_filename = generate_filename(
            master_type,
            ccd_temp,
            meta.binning,
            &meta.resolution,
            meta.exposure_time,
            &ext,
        );

        // Find unique target path (add numeric suffix if needed)
        let base_name = new_filename
            .strip_suffix(&format!(".{}", ext))
            .unwrap_or(&new_filename)
            .to_string();

        let mut target = target_dir.join(&new_filename);
        let mut counter = 1u32;

        while target.exists() {
            let suffixed = format!("{}_{:03}.{}", base_name, counter, ext);
            target = target_dir.join(suffixed);
            counter += 1;
        }

        // Copy the file
        match fs::copy(file_path, &target) {
            Ok(_) => {
                imported.push(target.to_string_lossy().to_string());
            }
            Err(_) => {
                // Skip failed copies
            }
        }
    }

    Ok(ImportResult {
        imported: imported.len(),
        files: imported,
    })
}
