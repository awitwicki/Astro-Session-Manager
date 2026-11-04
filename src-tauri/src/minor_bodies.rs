//! Storage for downloaded MPC comet / asteroid orbit files in the app data dir.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinorBodyFile {
    pub text: String,
    pub modified_ms: u64,
}

#[derive(Serialize)]
pub struct MinorBodyFiles {
    pub comets: Option<MinorBodyFile>,
    pub asteroids: Option<MinorBodyFile>,
}

fn minor_bodies_dir(base: &Path) -> PathBuf {
    base.join("minor-bodies")
}

fn check_kind(kind: &str) -> Result<(), String> {
    match kind {
        "comets" | "asteroids" => Ok(()),
        _ => Err(format!("Invalid minor body kind: {}", kind)),
    }
}

fn save_text(dir: &Path, kind: &str, text: &str) -> Result<(), String> {
    check_kind(kind)?;
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    let part = dir.join(format!("{}.txt.part", kind));
    fs::write(&part, text).map_err(|e| format!("Failed to write {}: {}", part.display(), e))?;
    fs::rename(&part, dir.join(format!("{}.txt", kind)))
        .map_err(|e| format!("Failed to finalize {}: {}", kind, e))
}

/// Returns the file's text and modification time (epoch ms), or None if absent/unreadable.
fn load_text(dir: &Path, kind: &str) -> Option<(String, u64)> {
    check_kind(kind).ok()?;
    let path = dir.join(format!("{}.txt", kind));
    let text = fs::read_to_string(&path).ok()?;
    let modified_ms = fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some((text, modified_ms))
}

fn app_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let base = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(minor_bodies_dir(&base))
}

#[tauri::command]
pub fn save_minor_bodies(kind: String, text: String, app_handle: AppHandle) -> Result<(), String> {
    check_kind(&kind)?;
    save_text(&app_dir(&app_handle)?, &kind, &text)
}

#[tauri::command]
pub fn load_minor_bodies(app_handle: AppHandle) -> Result<MinorBodyFiles, String> {
    let dir = app_dir(&app_handle)?;
    let load = |kind: &str| {
        load_text(&dir, kind).map(|(text, modified_ms)| MinorBodyFile { text, modified_ms })
    };
    Ok(MinorBodyFiles { comets: load("comets"), asteroids: load("asteroids") })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("asm-minor-{}-{}-{}", tag, std::process::id(), nanos))
    }

    #[test]
    fn save_then_load_round_trips() {
        let base = unique_dir("rt");
        let dir = minor_bodies_dir(&base);
        assert!(load_text(&dir, "comets").is_none());
        save_text(&dir, "comets", "line one\nline two\n").unwrap();
        let (text, modified) = load_text(&dir, "comets").unwrap();
        assert_eq!(text, "line one\nline two\n");
        assert!(modified > 0);
        assert!(load_text(&dir, "asteroids").is_none());
        // Overwrite leaves no .part behind
        save_text(&dir, "comets", "new").unwrap();
        assert_eq!(load_text(&dir, "comets").unwrap().0, "new");
        assert!(!dir.join("comets.txt.part").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn invalid_kind_is_rejected() {
        let base = unique_dir("bad");
        let dir = minor_bodies_dir(&base);
        assert!(save_text(&dir, "../evil", "x").is_err());
        assert!(save_text(&dir, "planets", "x").is_err());
        assert!(!dir.exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
