//! Reads an import source — a mounted ASIAIR share, a USB stick or an SD card
//! — without ever writing to it. Lists FITS/XISF lights and flats with their
//! headers; deciding where each belongs is `src/lib/asiairImport.ts`'s job.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::cancellation;
use crate::commands::SOURCE_UNREACHABLE;
use crate::fits_parser::read_image_header;
use crate::types::{FitsHeader, ImportSourceFile, ImportSourceScan, UnreadableFile};

const IMAGE_EXTENSIONS: &[&str] = &[".fits", ".fit", ".fts", ".xisf"];

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FrameKind {
    Light,
    Flat,
}

/// `IMAGETYP` decides; the ASIAIR's `Light_` / `Flat_` filename prefix is the
/// fallback. Darks, biases and darkflats are never imported — the masters
/// library covers calibration.
pub fn classify(filename: &str, header: &FitsHeader) -> Option<FrameKind> {
    let imagetyp = header.imagetyp.as_deref().map(|t| t.trim().to_lowercase()).unwrap_or_default();
    if !imagetyp.is_empty() {
        if imagetyp.contains("dark") || imagetyp.contains("bias") {
            return None;
        }
        if imagetyp.contains("flat") {
            return Some(FrameKind::Flat);
        }
        if imagetyp.contains("light") {
            return Some(FrameKind::Light);
        }
        return None;
    }
    let lower = filename.to_lowercase();
    if lower.starts_with("light_") {
        Some(FrameKind::Light)
    } else if lower.starts_with("flat_") {
        Some(FrameKind::Flat)
    } else {
        None
    }
}

/// Dot-files are skipped: macOS writes `._name.fit` AppleDouble metadata
/// next to every file on exFAT sticks and SMB shares.
fn list_image_files(root: &Path) -> Vec<(PathBuf, u64)> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            !name.starts_with('.') && IMAGE_EXTENSIONS.iter().any(|ext| name.ends_with(ext))
        })
        .filter_map(|e| e.metadata().ok().map(|m| (e.into_path(), m.len())))
        .collect()
}

/// The command's core, free of Tauri so it can be tested directly.
pub fn scan_source(root: &Path, on_progress: &(dyn Fn(usize, usize) + Sync)) -> Result<ImportSourceScan, String> {
    if !root.is_dir() {
        return Err(SOURCE_UNREACHABLE.to_string());
    }
    let entries = list_image_files(root);
    let total = entries.len();
    let done = AtomicUsize::new(0);

    let results: Vec<Result<Option<ImportSourceFile>, UnreadableFile>> = entries
        .par_iter()
        .map(|(path, size)| {
            if cancellation::is_cancelled("source_scan") {
                return Ok(None);
            }
            let path_str = path.to_string_lossy().to_string();
            let filename = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let result = match read_image_header(&path_str) {
                Ok(header) => Ok(classify(&filename, &header).map(|kind| ImportSourceFile {
                    path: path_str,
                    filename,
                    size_bytes: *size,
                    kind: match kind {
                        FrameKind::Light => "light",
                        FrameKind::Flat => "flat",
                    }
                    .to_string(),
                    header,
                })),
                Err(error) => Err(UnreadableFile { path: path_str, error }),
            };
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if n.is_multiple_of(25) || n == total {
                on_progress(n, total);
            }
            result
        })
        .collect();

    if cancellation::is_cancelled("source_scan") {
        return Err("Cancelled".to_string());
    }

    let mut files = Vec::new();
    let mut unreadable = Vec::new();
    for r in results {
        match r {
            Ok(Some(f)) => files.push(f),
            Ok(None) => {}
            Err(u) => unreadable.push(u),
        }
    }
    files.sort_by(|a, b| a.filename.cmp(&b.filename).then_with(|| a.path.cmp(&b.path)));
    unreadable.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ImportSourceScan { files, unreadable })
}

#[tauri::command]
pub async fn scan_import_source(path: String, app_handle: AppHandle) -> Result<ImportSourceScan, String> {
    cancellation::reset_cancel("source_scan");
    tauri::async_runtime::spawn_blocking(move || {
        scan_source(Path::new(&path), &|current, total| {
            let _ = app_handle.emit(
                "import_source:progress",
                serde_json::json!({ "current": current, "total": total }),
            );
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;

    fn temp_root(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("asm-import-src-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// A minimal valid FITS file: one header block plus one data block.
    fn write_fits(path: &Path, imagetyp: &str) {
        let cards = [
            "SIMPLE  =                    T".to_string(),
            "BITPIX  =                   16".to_string(),
            "NAXIS   =                    2".to_string(),
            "NAXIS1  =                    2".to_string(),
            "NAXIS2  =                    2".to_string(),
            format!("IMAGETYP= '{imagetyp}'"),
            "END".to_string(),
        ];
        let mut header: String = cards.iter().map(|c| format!("{c:<80}")).collect();
        while header.len() % 2880 != 0 {
            header.push(' ');
        }
        let mut bytes = header.into_bytes();
        bytes.extend(std::iter::repeat(0u8).take(2880));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        walkdir::WalkDir::new(root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| (e.path().to_path_buf(), fs::read(e.path()).unwrap()))
            .collect()
    }

    fn header(imagetyp: Option<&str>) -> FitsHeader {
        FitsHeader { imagetyp: imagetyp.map(String::from), ..Default::default() }
    }

    #[test]
    fn classify_prefers_imagetyp_then_the_filename_prefix() {
        assert_eq!(classify("x.fit", &header(Some("Light"))), Some(FrameKind::Light));
        assert_eq!(classify("x.fit", &header(Some("Light Frame"))), Some(FrameKind::Light));
        assert_eq!(classify("Light_1.fit", &header(Some("Flat"))), Some(FrameKind::Flat));
        assert_eq!(classify("x.fit", &header(Some("Dark"))), None);
        assert_eq!(classify("x.fit", &header(Some("Dark Flat"))), None);
        assert_eq!(classify("x.fit", &header(Some("Bias"))), None);
        assert_eq!(classify("Light_M31_180.0s.fit", &header(None)), Some(FrameKind::Light));
        assert_eq!(classify("flat_L_1.fit", &header(Some("  "))), Some(FrameKind::Flat));
        assert_eq!(classify("Dark_300s.fit", &header(None)), None);
    }

    #[test]
    fn scan_lists_lights_and_flats_and_leaves_the_source_untouched() {
        let root = temp_root("tree");
        write_fits(&root.join("Autorun/Light/M31/Light_M31_180.0s_0001.fit"), "Light");
        write_fits(&root.join("Autorun/Flat/Flat_L_0001.fits"), "Flat");
        write_fits(&root.join("Autorun/Dark/Dark_300s_0001.fit"), "Dark");
        fs::write(root.join("notes.txt"), b"hello").unwrap();
        // macOS AppleDouble metadata on exFAT/SMB: same extension, not a FITS file.
        fs::write(root.join("Autorun/Light/M31/._Light_M31_180.0s_0001.fit"), b"junk").unwrap();
        fs::write(root.join("Autorun/Light/M31/Light_M31_180.0s_0002.fit"), b"truncated").unwrap();
        let before = snapshot(&root);

        let scan = scan_source(&root, &|_, _| {}).unwrap();

        let kinds: Vec<(&str, &str)> = scan.files.iter().map(|f| (f.filename.as_str(), f.kind.as_str())).collect();
        assert_eq!(kinds, vec![("Flat_L_0001.fits", "flat"), ("Light_M31_180.0s_0001.fit", "light")]);
        assert_eq!(scan.files[1].size_bytes, 5760);
        assert_eq!(scan.files[1].header.naxis1, 2);
        assert_eq!(scan.unreadable.len(), 1);
        assert!(scan.unreadable[0].path.ends_with("Light_M31_180.0s_0002.fit"));
        assert_eq!(snapshot(&root), before);
    }

    #[test]
    fn a_missing_root_is_reported_as_unreachable() {
        let root = temp_root("gone").join("not-mounted");
        let err = scan_source(&root, &|_, _| {}).unwrap_err();
        assert!(err.contains("not reachable"));
    }
}
