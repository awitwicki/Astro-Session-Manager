use std::fs;
use std::path::PathBuf;

/// Get the cache file path: {rootFolder}/AstroSessionManagerDb.json
fn get_cache_file_path(root_folder: &str) -> PathBuf {
    PathBuf::from(root_folder).join("AstroSessionManagerDb.json")
}

/// Save data to the cache file, merging with existing cache
pub fn save_cache(root_folder: &str, data: serde_json::Value) -> Result<(), String> {
    let file_path = get_cache_file_path(root_folder);

    // Merge with existing cache to avoid wiping fields not included in this save
    let mut existing: serde_json::Value = if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read existing cache: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::Value::Object(Default::default()))
    } else {
        serde_json::Value::Object(Default::default())
    };

    // Merge: overlay new data on top of existing
    if let (Some(existing_map), Some(new_map)) = (existing.as_object_mut(), data.as_object()) {
        for (key, value) in new_map {
            existing_map.insert(key.clone(), value.clone());
        }
    }

    let content = serde_json::to_string_pretty(&existing)
        .map_err(|e| format!("Failed to serialize cache: {}", e))?;

    fs::write(&file_path, content).map_err(|e| format!("Failed to write cache file: {}", e))?;

    log::info!(
        "[cache] saved to {}",
        file_path.to_string_lossy()
    );

    Ok(())
}

/// Load data from the cache file
pub fn load_cache(root_folder: &str) -> Result<serde_json::Value, String> {
    let file_path = get_cache_file_path(root_folder);

    if !file_path.exists() {
        log::info!(
            "[cache] no cache file at {}",
            file_path.to_string_lossy()
        );
        return Ok(serde_json::Value::Null);
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read cache file: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse cache file: {}", e))?;

    log::info!(
        "[cache] loaded from {}",
        file_path.to_string_lossy()
    );

    Ok(parsed)
}
