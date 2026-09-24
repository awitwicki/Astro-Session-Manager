//! Export a project's frames into a PixInsight WBPP keyword-folder layout.
//!
//! Safety contract: sources are only ever read. Destinations are created new
//! (`create_dir`, `create_new`) inside a fresh export folder; nothing that
//! already exists is overwritten and no source is renamed, moved or deleted.

use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};

pub const MANIFEST_NAME: &str = "export_manifest.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEntry {
    pub src: String,
    pub rel_dst: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Symlink,
    Hardlink,
    Copy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub current: usize,
    pub total: usize,
    pub filename: String,
    pub placement: Option<Placement>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFailure {
    pub src: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub export_dir: String,
    pub symlinked: usize,
    pub hardlinked: usize,
    pub copied: usize,
    pub failed: Vec<ExportFailure>,
    pub bytes_copied: u64,
    pub cancelled: bool,
}

#[cfg(unix)]
pub(crate) fn make_symlink(src: &Path, dst: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

#[cfg(windows)]
pub(crate) fn make_symlink(src: &Path, dst: &Path) -> io::Result<()> {
    std::os::windows::fs::symlink_file(src, dst)
}

/// A relative path made only of normal components (no `..`, `.`, root or
/// drive prefix), so joining it can never escape the export folder.
pub(crate) fn safe_rel_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("empty destination path".into());
    }
    let p = Path::new(rel);
    if p.components().all(|c| matches!(c, Component::Normal(_))) && !rel.split(['/', '\\']).any(|s| s == "." || s.is_empty()) {
        Ok(p.to_path_buf())
    } else {
        Err(format!("unsafe destination path: {rel}"))
    }
}

/// Creates `parent/name`, or `parent/name_2`, `_3`… if taken. Never reuses an
/// existing folder.
fn create_fresh_dir(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let base = safe_rel_path(name)?;
    if base.components().count() != 1 {
        return Err(format!("invalid export folder name: {name}"));
    }
    for n in 1..10_000 {
        let candidate = if n == 1 { parent.join(name) } else { parent.join(format!("{name}_{n}")) };
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Failed to create {}: {e}", candidate.display())),
        }
    }
    Err("could not find a free export folder name".into())
}

pub struct Placer {
    pub symlink_enabled: bool,
    pub hardlink_enabled: bool,
}

impl Placer {
    pub fn auto() -> Self {
        Self { symlink_enabled: true, hardlink_enabled: true }
    }

    /// Places `src` at `dst` (which must not exist). Returns the placement and
    /// the bytes copied (0 for links).
    fn place(&mut self, src: &Path, dst: &Path) -> io::Result<(Placement, u64)> {
        if self.symlink_enabled {
            match make_symlink(src, dst) {
                Ok(()) => return Ok((Placement::Symlink, 0)),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(e),
                // Symlinks unavailable here (e.g. Windows without Developer Mode):
                // stop trying for the rest of this run.
                Err(_) => self.symlink_enabled = false,
            }
        }
        if self.hardlink_enabled {
            match fs::hard_link(src, dst) {
                Ok(()) => return Ok((Placement::Hardlink, 0)),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(e),
                // Cross-volume or unsupported filesystem: copy this one.
                Err(_) => {}
            }
        }
        let bytes = copy_new(src, dst)?;
        Ok((Placement::Copy, bytes))
    }
}

/// Copies into a file that must not exist yet. A partial destination we just
/// created is removed on failure; the source is only ever opened for reading.
fn copy_new(src: &Path, dst: &Path) -> io::Result<u64> {
    let mut reader = File::open(src)?;
    let mut writer = OpenOptions::new().write(true).create_new(true).open(dst)?;
    match io::copy(&mut reader, &mut writer) {
        Ok(n) => Ok(n),
        Err(e) => {
            drop(writer);
            let _ = fs::remove_file(dst);
            Err(e)
        }
    }
}

fn is_inside(child: &Path, parent: &Path) -> bool {
    match (child.canonicalize(), parent.canonicalize()) {
        (Ok(c), Ok(p)) => c.starts_with(p),
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run_export(
    parent_dir: &Path,
    folder_name: &str,
    root_folder: &Path,
    entries: &[ExportEntry],
    settings: &serde_json::Value,
    placer: &mut Placer,
    is_cancelled: &dyn Fn() -> bool,
    on_progress: &mut dyn FnMut(ExportProgress),
) -> Result<ExportResult, String> {
    if !parent_dir.is_dir() {
        return Err(format!("Destination folder does not exist: {}", parent_dir.display()));
    }
    if is_inside(parent_dir, root_folder) {
        return Err("Export folder must be outside the projects root folder".into());
    }
    let export_dir = create_fresh_dir(parent_dir, folder_name)?;

    let total = entries.len();
    let mut result = ExportResult {
        export_dir: export_dir.to_string_lossy().into_owned(),
        symlinked: 0,
        hardlinked: 0,
        copied: 0,
        failed: Vec::new(),
        bytes_copied: 0,
        cancelled: false,
    };
    let mut manifest_files = Vec::new();

    for (i, entry) in entries.iter().enumerate() {
        if is_cancelled() {
            result.cancelled = true;
            break;
        }
        let src = Path::new(&entry.src);
        let filename = src.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();

        let placed = (|| -> Result<(Placement, u64, PathBuf), String> {
            if !src.is_absolute() {
                return Err("source path is not absolute".into());
            }
            // Checked explicitly: a symlink to a missing file would "succeed".
            if !src.is_file() {
                return Err("source missing".into());
            }
            let dst = export_dir.join(safe_rel_path(&entry.rel_dst)?);
            if let Some(dir) = dst.parent() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let (placement, bytes) = placer.place(src, &dst).map_err(|e| e.to_string())?;
            Ok((placement, bytes, dst))
        })();

        let placement = match placed {
            Ok((placement, bytes, dst)) => {
                match placement {
                    Placement::Symlink => result.symlinked += 1,
                    Placement::Hardlink => result.hardlinked += 1,
                    Placement::Copy => result.copied += 1,
                }
                result.bytes_copied += bytes;
                manifest_files.push(serde_json::json!({
                    "src": entry.src,
                    "dst": dst.to_string_lossy(),
                    "mode": placement,
                }));
                Some(placement)
            }
            Err(error) => {
                result.failed.push(ExportFailure { src: entry.src.clone(), error });
                None
            }
        };
        on_progress(ExportProgress { current: i + 1, total, filename, placement });
    }

    let manifest = serde_json::json!({ "settings": settings, "files": manifest_files });
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(export_dir.join(MANIFEST_NAME))
        .map_err(|e| format!("Failed to write manifest: {e}"))?;
    serde_json::to_writer_pretty(&mut file, &manifest).map_err(|e| format!("Failed to write manifest: {e}"))?;

    Ok(result)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCheck {
    pub ok: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightResult {
    pub symlink: LinkCheck,
    pub hardlink: LinkCheck,
    pub free_bytes: Option<u64>,
}

fn link_check(r: io::Result<()>, symlink: bool) -> LinkCheck {
    match r {
        Ok(()) => LinkCheck { ok: true, reason: None },
        Err(e) => {
            // ERROR_PRIVILEGE_NOT_HELD
            let reason = if symlink && cfg!(windows) && e.raw_os_error() == Some(1314) {
                "Enable Developer Mode or run as administrator to use symlinks".to_string()
            } else if !symlink && e.kind() == io::ErrorKind::CrossesDevices {
                "Destination is on a different drive than the frames".to_string()
            } else {
                e.to_string()
            };
            LinkCheck { ok: false, reason: Some(reason) }
        }
    }
}

/// Makes a real symlink and hard link to `sample_source` in a temporary folder
/// under `target_parent`, then removes exactly those entries it created.
pub fn preflight(target_parent: &Path, sample_source: &Path) -> Result<PreflightResult, String> {
    if !target_parent.is_dir() {
        return Err(format!("Destination folder does not exist: {}", target_parent.display()));
    }
    if !sample_source.is_file() {
        return Err(format!("Sample frame not found: {}", sample_source.display()));
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = target_parent.join(format!(".asm-preflight-{}-{stamp}", std::process::id()));
    fs::create_dir(&tmp).map_err(|e| format!("Destination is not writable: {e}"))?;

    let s = tmp.join("s");
    let h = tmp.join("h");
    let symlink = link_check(make_symlink(sample_source, &s), true);
    let hardlink = link_check(fs::hard_link(sample_source, &h), false);

    // Remove only our own two entries and the folder we created. Removing a
    // hard link or symlink never affects the source it points to.
    if symlink.ok {
        let _ = fs::remove_file(&s);
    }
    if hardlink.ok {
        let _ = fs::remove_file(&h);
    }
    let _ = fs::remove_dir(&tmp);

    Ok(PreflightResult { symlink, hardlink, free_bytes: free_bytes(target_parent) })
}

// Field widths differ per platform (u32 on macOS, u64 on Linux).
#[cfg(unix)]
#[allow(clippy::unnecessary_cast)]
fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid NUL-terminated path and `stat` a valid out-pointer.
    if unsafe { libc::statvfs(c.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    Some(stat.f_bavail as u64 * stat.f_frsize as u64)
}

#[cfg(windows)]
fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut available: u64 = 0;
    // SAFETY: `wide` is NUL-terminated; unused out-params may be null.
    let ok = unsafe {
        GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut())
    };
    if ok == 0 { None } else { Some(available) }
}

#[tauri::command]
pub async fn wbpp_export_preflight(
    target_parent: String,
    sample_source: String,
) -> Result<PreflightResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        preflight(Path::new(&target_parent), Path::new(&sample_source))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn wbpp_export(
    parent_dir: String,
    folder_name: String,
    root_folder: String,
    entries: Vec<ExportEntry>,
    settings: serde_json::Value,
    app_handle: tauri::AppHandle,
) -> Result<ExportResult, String> {
    use tauri::Emitter;
    crate::cancellation::reset_cancel("export");
    tauri::async_runtime::spawn_blocking(move || {
        run_export(
            Path::new(&parent_dir),
            &folder_name,
            Path::new(&root_folder),
            &entries,
            &settings,
            &mut Placer::auto(),
            &|| crate::cancellation::is_cancelled("export"),
            &mut |p| {
                let _ = app_handle.emit("wbpp-export:progress", &p);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "asm-wbpp-{}-{}-{}",
            std::process::id(),
            name,
            SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct Fixture {
        base: PathBuf,
        root: PathBuf,
        out_parent: PathBuf,
        sources: Vec<PathBuf>,
    }

    fn fixture(name: &str) -> Fixture {
        let base = scratch(name);
        let root = base.join("root");
        let lights = root.join("M31/Ha/Night 1/lights");
        fs::create_dir_all(&lights).unwrap();
        let sources: Vec<PathBuf> = (1..=3)
            .map(|i| {
                let p = lights.join(format!("L_{i}.fits"));
                fs::write(&p, vec![i as u8; 1000 * i]).unwrap();
                p
            })
            .collect();
        let out_parent = base.join("out");
        fs::create_dir_all(&out_parent).unwrap();
        Fixture { base, root, out_parent, sources }
    }

    fn entries(f: &Fixture) -> Vec<ExportEntry> {
        f.sources
            .iter()
            .map(|s| ExportEntry {
                src: s.to_string_lossy().into_owned(),
                rel_dst: format!(
                    "Lights/NIGHT_2026-09-01/FILTER_Ha/{}",
                    s.file_name().unwrap().to_string_lossy()
                ),
            })
            .collect()
    }

    fn snapshot(paths: &[PathBuf]) -> Vec<(Vec<u8>, SystemTime)> {
        paths
            .iter()
            .map(|p| (fs::read(p).unwrap(), fs::metadata(p).unwrap().modified().unwrap()))
            .collect()
    }

    fn run(f: &Fixture, placer: &mut Placer) -> ExportResult {
        run_export(
            &f.out_parent,
            "M31_WBPP_2026-09-24",
            &f.root,
            &entries(f),
            &serde_json::json!({"k": 1}),
            placer,
            &|| false,
            &mut |_| {},
        )
        .unwrap()
    }

    fn assert_exported_readable(f: &Fixture, r: &ExportResult) {
        let dir = PathBuf::from(&r.export_dir);
        for s in &f.sources {
            let d = dir
                .join("Lights/NIGHT_2026-09-01/FILTER_Ha")
                .join(s.file_name().unwrap());
            assert_eq!(fs::read(&d).unwrap(), fs::read(s).unwrap());
        }
        assert!(dir.join(MANIFEST_NAME).is_file());
    }

    #[test]
    fn auto_places_by_symlink_and_leaves_sources_untouched() {
        let f = fixture("auto");
        let before = snapshot(&f.sources);
        let r = run(&f, &mut Placer::auto());
        assert_eq!(r.symlinked, 3);
        assert!(r.failed.is_empty());
        assert!(!r.cancelled);
        assert_exported_readable(&f, &r);
        assert_eq!(snapshot(&f.sources), before);
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn falls_back_to_hardlink_when_symlink_disabled() {
        let f = fixture("hard");
        let before = snapshot(&f.sources);
        let r = run(&f, &mut Placer { symlink_enabled: false, hardlink_enabled: true });
        assert_eq!((r.symlinked, r.hardlinked, r.copied), (0, 3, 0));
        assert_exported_readable(&f, &r);
        assert_eq!(snapshot(&f.sources), before);
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn falls_back_to_copy_when_links_disabled() {
        let f = fixture("copy");
        let before = snapshot(&f.sources);
        let r = run(&f, &mut Placer { symlink_enabled: false, hardlink_enabled: false });
        assert_eq!((r.symlinked, r.hardlinked, r.copied), (0, 0, 3));
        assert_eq!(r.bytes_copied, 1000 + 2000 + 3000);
        assert_exported_readable(&f, &r);
        assert_eq!(snapshot(&f.sources), before);
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn existing_export_folder_gets_numeric_suffix() {
        let f = fixture("suffix");
        fs::create_dir(f.out_parent.join("M31_WBPP_2026-09-24")).unwrap();
        fs::write(f.out_parent.join("M31_WBPP_2026-09-24/keep.txt"), b"mine").unwrap();
        let r = run(&f, &mut Placer::auto());
        assert!(r.export_dir.ends_with("M31_WBPP_2026-09-24_2"));
        assert_eq!(fs::read(f.out_parent.join("M31_WBPP_2026-09-24/keep.txt")).unwrap(), b"mine");
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn duplicate_destination_is_failed_not_overwritten() {
        let f = fixture("dupdst");
        let mut e = entries(&f);
        e[1].rel_dst = e[0].rel_dst.clone();
        let r = run_export(&f.out_parent, "X", &f.root, &e, &serde_json::Value::Null,
            &mut Placer { symlink_enabled: false, hardlink_enabled: false }, &|| false, &mut |_| {}).unwrap();
        assert_eq!(r.copied, 2);
        assert_eq!(r.failed.len(), 1);
        let d = PathBuf::from(&r.export_dir).join(&e[0].rel_dst);
        assert_eq!(fs::read(d).unwrap(), fs::read(&f.sources[0]).unwrap());
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn missing_source_is_reported_not_linked() {
        let f = fixture("missing");
        let mut e = entries(&f);
        e[0].src = f.root.join("gone.fits").to_string_lossy().into_owned();
        let r = run_export(&f.out_parent, "X", &f.root, &e, &serde_json::Value::Null,
            &mut Placer::auto(), &|| false, &mut |_| {}).unwrap();
        assert_eq!(r.failed.len(), 1);
        assert!(r.failed[0].error.contains("source missing"));
        let d = PathBuf::from(&r.export_dir).join(&e[0].rel_dst);
        assert!(fs::symlink_metadata(d).is_err(), "no dangling link may be created");
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn rejects_unsafe_relative_destinations() {
        for bad in ["../evil.fits", "/abs.fits", "Lights/../../x.fits", "", "Lights/./x.fits"] {
            assert!(safe_rel_path(bad).is_err(), "{bad} should be rejected");
        }
        assert!(safe_rel_path("Lights/NIGHT_2026-09-01/FILTER_Ha/a.fits").is_ok());
    }

    #[test]
    fn refuses_export_inside_root() {
        let f = fixture("inroot");
        let err = run_export(&f.root.join("M31"), "X", &f.root, &entries(&f),
            &serde_json::Value::Null, &mut Placer::auto(), &|| false, &mut |_| {}).unwrap_err();
        assert!(err.contains("outside"), "{err}");
        assert!(!f.root.join("M31/X").exists());
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn refuses_relative_source() {
        let f = fixture("relsrc");
        let mut e = entries(&f);
        e[0].src = "relative/L_1.fits".into();
        let r = run_export(&f.out_parent, "X", &f.root, &e, &serde_json::Value::Null,
            &mut Placer::auto(), &|| false, &mut |_| {}).unwrap();
        assert_eq!(r.failed.len(), 1);
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn cancel_stops_after_current_file() {
        let f = fixture("cancel");
        let cancelled = std::cell::Cell::new(false);
        let r = run_export(&f.out_parent, "X", &f.root, &entries(&f), &serde_json::Value::Null,
            &mut Placer::auto(), &|| cancelled.get(), &mut |_| cancelled.set(true)).unwrap();
        assert!(r.cancelled);
        assert_eq!(r.symlinked, 1);
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn manifest_lists_every_placed_file() {
        let f = fixture("manifest");
        let r = run(&f, &mut Placer::auto());
        let m: serde_json::Value =
            serde_json::from_slice(&fs::read(PathBuf::from(&r.export_dir).join(MANIFEST_NAME)).unwrap()).unwrap();
        assert_eq!(m["files"].as_array().unwrap().len(), 3);
        assert_eq!(m["files"][0]["mode"], "symlink");
        assert_eq!(m["settings"]["k"], 1);
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn preflight_reports_links_and_cleans_up_only_its_own_entries() {
        let f = fixture("preflight");
        fs::write(f.out_parent.join("user.txt"), b"keep").unwrap();
        let before = snapshot(&f.sources);
        let r = preflight(&f.out_parent, &f.sources[0]).unwrap();
        assert!(r.symlink.ok, "{:?}", r.symlink.reason);
        assert!(r.hardlink.ok, "{:?}", r.hardlink.reason);
        assert!(r.free_bytes.unwrap() > 0);
        let left: Vec<_> = fs::read_dir(&f.out_parent).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from("user.txt")]);
        assert_eq!(snapshot(&f.sources), before);
        fs::remove_dir_all(&f.base).unwrap();
    }

    #[test]
    fn preflight_errors_on_missing_target() {
        let f = fixture("preflight-missing");
        assert!(preflight(&f.base.join("nope"), &f.sources[0]).is_err());
        fs::remove_dir_all(&f.base).unwrap();
    }
}
