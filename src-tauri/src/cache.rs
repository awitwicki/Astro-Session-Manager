use std::fs;
use std::path::PathBuf;

/// Get the cache file path: {rootFolder}/AstroSessionManagerDb.json
fn get_cache_file_path(root_folder: &str) -> PathBuf {
    PathBuf::from(root_folder).join("AstroSessionManagerDb.json")
}

/// Recursively convert absolute paths to relative (prefixed with "./") in a JSON value.
/// Paths are normalized to forward slashes for cross-platform portability.
fn make_paths_relative(value: serde_json::Value, root_prefix: &str) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => {
            let normalized = s.replace('\\', "/");
            if normalized == root_prefix {
                serde_json::Value::String(".".to_string())
            } else if let Some(relative) = normalized.strip_prefix(root_prefix).and_then(|r| r.strip_prefix('/')) {
                serde_json::Value::String(format!("./{}", relative))
            } else {
                serde_json::Value::String(s)
            }
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(
                arr.into_iter()
                    .map(|v| make_paths_relative(v, root_prefix))
                    .collect(),
            )
        }
        serde_json::Value::Object(map) => {
            let new_map: serde_json::Map<String, serde_json::Value> = map
                .into_iter()
                .map(|(k, v)| {
                    let new_key = {
                        let normalized = k.replace('\\', "/");
                        if normalized == root_prefix {
                            ".".to_string()
                        } else if let Some(relative) = normalized.strip_prefix(root_prefix).and_then(|r| r.strip_prefix('/')) {
                            format!("./{}", relative)
                        } else {
                            k
                        }
                    };
                    (new_key, make_paths_relative(v, root_prefix))
                })
                .collect();
            serde_json::Value::Object(new_map)
        }
        other => other,
    }
}

/// Recursively convert relative paths (prefixed with "./") back to absolute in a JSON value.
/// Uses PathBuf::join for correct platform-specific path separators.
fn make_paths_absolute(value: serde_json::Value, root_folder: &str) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => {
            if s == "." {
                serde_json::Value::String(root_folder.to_string())
            } else if let Some(relative) = s.strip_prefix("./") {
                let abs = PathBuf::from(root_folder).join(relative);
                serde_json::Value::String(abs.to_string_lossy().to_string())
            } else {
                serde_json::Value::String(s)
            }
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(
                arr.into_iter()
                    .map(|v| make_paths_absolute(v, root_folder))
                    .collect(),
            )
        }
        serde_json::Value::Object(map) => {
            let new_map: serde_json::Map<String, serde_json::Value> = map
                .into_iter()
                .map(|(k, v)| {
                    let new_key = if k == "." {
                        root_folder.to_string()
                    } else if let Some(relative) = k.strip_prefix("./") {
                        PathBuf::from(root_folder)
                            .join(relative)
                            .to_string_lossy()
                            .to_string()
                    } else {
                        k
                    };
                    (new_key, make_paths_absolute(v, root_folder))
                })
                .collect();
            serde_json::Value::Object(new_map)
        }
        other => other,
    }
}

/// Save data to the cache file, merging with existing cache.
/// Absolute paths are converted to relative paths (prefixed with "./") for portability.
pub fn save_cache(root_folder: &str, data: serde_json::Value) -> Result<(), String> {
    let file_path = get_cache_file_path(root_folder);
    let root_prefix = root_folder.replace('\\', "/").trim_end_matches('/').to_string();

    // Convert incoming absolute paths to relative before merging
    let relative_data = make_paths_relative(data, &root_prefix);

    // Merge with existing cache (already stored with relative paths) to avoid wiping fields
    let mut existing: serde_json::Value = if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read existing cache: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::Value::Object(Default::default()))
    } else {
        serde_json::Value::Object(Default::default())
    };

    // Merge: overlay new data on top of existing
    if let (Some(existing_map), Some(new_map)) =
        (existing.as_object_mut(), relative_data.as_object())
    {
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

/// Load data from the cache file.
/// Relative paths (prefixed with "./") are converted back to absolute using root_folder.
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

    // Convert relative paths back to absolute
    let absolute = make_paths_absolute(parsed, root_folder);

    log::info!(
        "[cache] loaded from {}",
        file_path.to_string_lossy()
    );

    Ok(absolute)
}
