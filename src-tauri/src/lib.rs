mod cache;
mod commands;
mod fits_parser;
mod fits_preview;
mod masters;
mod scanner;
mod settings;
mod thumbnail;
mod types;
mod xisf_parser;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Scanner
            commands::scan_root,
            // FITS
            commands::read_fits_header,
            commands::read_fits_pixel_data,
            commands::batch_read_fits_headers,
            // XISF
            commands::read_xisf_header,
            // Thumbnails
            commands::generate_thumbnail,
            commands::batch_generate_thumbnails,
            commands::get_cached_thumbnail,
            commands::get_cache_size,
            commands::clear_thumbnail_cache,
            // FITS Preview
            commands::get_fits_preview,
            commands::render_fits_preview,
            // Masters
            commands::scan_masters,
            commands::find_master_match,
            commands::import_masters,
            // Settings
            commands::get_setting,
            commands::set_setting,
            commands::get_all_settings,
            // Cache
            commands::save_cache,
            commands::load_cache,
            // File operations
            commands::copy_to_directory,
            commands::move_to_trash,
            commands::rename_path,
            commands::create_project,
            commands::create_session,
            commands::show_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
