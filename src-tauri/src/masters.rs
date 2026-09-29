use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::types::{ImportResult, MasterFileEntry, MasterMatch, MastersLibrary, OtherEntry};

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

/// Scan a directory (non-recursive) for supported files
fn scan_files(dir_path: &Path) -> Vec<ScannedFile> {
    let mut files: Vec<ScannedFile> = Vec::new();

    if !dir_path.exists() {
        return files;
    }

    let entries = match fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return files,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
        if !is_file {
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

/// Generate a standard filename for imported master frames
fn generate_filename(
    master_type: &str,
    ccd_temp: i32,
    binning: Option<i32>,
    resolution: &Option<String>,
    exposure_time: f64,
    ext: &str,
) -> String {
    let prefix = match master_type {
        "darks" => "masterDark",
        "darkFlats" => "masterDarkFlat",
        _ => "masterBias",
    };

    let temp_str = if ccd_temp >= 0 {
        format!("+{}C", ccd_temp)
    } else {
        format!("{}C", ccd_temp)
    };

    let bin_str = format!("BIN-{}", binning.unwrap_or(1));
    let res_str = resolution.as_deref().unwrap_or("unknown");

    let mut name = format!("{}_{}_{}_{}", prefix, temp_str, bin_str, res_str);

    if master_type != "biases" && exposure_time > 0.0 {
        name = format!("{}_EXPOSURE-{:.2}s", name, exposure_time);
    }

    format!("{}.{}", name, ext)
}

/// Collect "other" entries (non-master files and subdirectories) from the masters directory
fn collect_other_entries(dir_path: &Path) -> Vec<OtherEntry> {
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

        // Skip proper master files (they are in the darks/darkflats/biases lists)
        if !is_dir && (name.starts_with("masterDark") || name.starts_with("masterBias")) && is_supported_file(&name) {
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

/// Build a library entry from a scanned file, reading metadata from its name
fn master_entry(file: &ScannedFile) -> MasterFileEntry {
    let meta = parse_filename_metadata(&file.filename);
    MasterFileEntry {
        filename: file.filename.clone(),
        path: file.path.clone(),
        size_bytes: file.size_bytes,
        format: file.format.clone(),
        exposure_time: meta.exposure_time.unwrap_or(0.0),
        ccd_temp: meta.ccd_temp,
        binning: meta.binning,
        resolution: meta.resolution,
        camera: "Unknown".to_string(),
        temp_source: if meta.ccd_temp.is_some() { "filename".to_string() } else { "unknown".to_string() },
    }
}

fn by_exposure_then_temp(a: &MasterFileEntry, b: &MasterFileEntry) -> std::cmp::Ordering {
    a.exposure_time
        .partial_cmp(&b.exposure_time)
        .unwrap_or(std::cmp::Ordering::Equal)
        .then(
            a.ccd_temp
                .unwrap_or(0.0)
                .partial_cmp(&b.ccd_temp.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal),
        )
}

/// Scan the masters library (darks, darkflats and biases) from root_folder/masters/
pub fn scan_masters(root_folder: &str) -> Result<MastersLibrary, String> {
    let masters_path = PathBuf::from(root_folder).join("masters");
    let all_files = scan_files(&masters_path);

    let mut darks: Vec<MasterFileEntry> = Vec::new();
    let mut dark_flats: Vec<MasterFileEntry> = Vec::new();
    let mut biases: Vec<MasterFileEntry> = Vec::new();

    for file in &all_files {
        // masterDarkFlat must be tested before its prefix masterDark
        if file.filename.starts_with("masterDarkFlat") {
            dark_flats.push(master_entry(file));
        } else if file.filename.starts_with("masterDark") {
            darks.push(master_entry(file));
        } else if file.filename.starts_with("masterBias") {
            biases.push(master_entry(file));
        }
    }

    darks.sort_by(by_exposure_then_temp);
    dark_flats.sort_by(by_exposure_then_temp);

    biases.sort_by(|a, b| {
        a.ccd_temp
            .unwrap_or(0.0)
            .partial_cmp(&b.ccd_temp.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let other_files = collect_other_entries(&masters_path);

    Ok(MastersLibrary {
        darks,
        biases,
        dark_flats,
        other_files,
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

/// Import master files: copy to rootFolder/masters/ with proper naming
pub fn import_masters(
    root_folder: &str,
    files: &[String],
    master_type: &str,
    ccd_temp: i32,
    binning: Option<i32>,
    resolution: &Option<String>,
    exposure: Option<f64>,
) -> Result<ImportResult, String> {
    let target_dir = PathBuf::from(root_folder).join("masters");

    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    let mut imported: Vec<String> = Vec::new();

    for file_path in files {
        let ext = get_format(file_path);

        // Generate proper filename with user-provided metadata
        let new_filename = generate_filename(
            master_type,
            ccd_temp,
            binning,
            resolution,
            exposure.unwrap_or(0.0),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        fs::write(dir.join(name), b"x").unwrap();
    }

    #[test]
    fn darkflats_are_not_darks() {
        let root = std::env::temp_dir().join(format!("asm-masters-{}", std::process::id()));
        let masters = root.join("masters");
        fs::create_dir_all(&masters).unwrap();
        touch(&masters, "masterDarkFlat_-19C_BIN-1_6248x4176_EXPOSURE-0.04s.xisf");
        touch(&masters, "masterDark_-20C_BIN-1_6248x4176_EXPOSURE-300.00s.xisf");
        touch(&masters, "masterBias_-20C_BIN-1_6248x4176.xisf");
        let lib = scan_masters(root.to_str().unwrap()).unwrap();
        fs::remove_dir_all(&root).ok();

        assert_eq!(lib.darks.len(), 1);
        assert_eq!(lib.darks[0].exposure_time, 300.0);
        assert_eq!(lib.biases.len(), 1);
        assert_eq!(lib.dark_flats.len(), 1);
        let df = &lib.dark_flats[0];
        assert_eq!(df.exposure_time, 0.04);
        assert_eq!(df.ccd_temp, Some(-19.0));
        assert_eq!(df.resolution.as_deref(), Some("6248x4176"));
        assert!(lib.other_files.is_empty());
    }

    #[test]
    fn darkflat_filename_has_exposure() {
        let name = generate_filename("darkFlats", -19, Some(1), &Some("6248x4176".into()), 0.04, "xisf");
        assert_eq!(name, "masterDarkFlat_-19C_BIN-1_6248x4176_EXPOSURE-0.04s.xisf");
    }
}
