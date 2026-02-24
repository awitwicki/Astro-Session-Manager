use std::fs;
use std::path::PathBuf;

use tauri::Manager;

use crate::types::AppSettings;

/// Get the path to the settings JSON file in the app data directory
fn get_settings_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("settings.json"))
}

/// Load all settings from the JSON file, returning defaults if not found
pub fn load_settings(app_handle: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = get_settings_path(app_handle)?;

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read settings file: {}", e))?;

    let settings: AppSettings =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))?;

    Ok(settings)
}

/// Save all settings to the JSON file
fn save_settings(app_handle: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path(app_handle)?;

    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

/// Get all settings as a JSON value
pub fn get_all_settings(app_handle: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let settings = load_settings(app_handle)?;
    serde_json::to_value(&settings).map_err(|e| format!("Failed to convert settings: {}", e))
}

/// Get a single setting by key
pub fn get_setting(
    app_handle: &tauri::AppHandle,
    key: &str,
) -> Result<serde_json::Value, String> {
    let all = get_all_settings(app_handle)?;

    // Use camelCase key to match the serialized JSON
    if let Some(val) = all.get(key) {
        Ok(val.clone())
    } else {
        Ok(serde_json::Value::Null)
    }
}

/// Set a single setting by key
pub fn set_setting(
    app_handle: &tauri::AppHandle,
    key: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut settings = load_settings(app_handle)?;

    // Convert settings to a JSON object, update the key, and parse back
    let mut obj = serde_json::to_value(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    if let Some(map) = obj.as_object_mut() {
        map.insert(key.to_string(), value);
    }

    settings = serde_json::from_value(obj)
        .map_err(|e| format!("Failed to deserialize updated settings: {}", e))?;

    save_settings(app_handle, &settings)?;

    Ok(())
}
