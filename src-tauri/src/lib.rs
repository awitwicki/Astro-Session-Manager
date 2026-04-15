mod analyzer;
mod cache;
mod cancellation;
mod converter;
mod commands;
mod dslr_parser;
mod fits_parser;
mod fits_preview;
mod fits_writer;
mod masters;
mod preview_queue;
mod scanner;
mod settings;
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

            // Initialize preview config from saved settings
            if let Ok(s) = settings::load_settings(app.handle()) {
                fits_preview::init_config(s.preview_cache_limit_mb, s.preview_concurrency);
            }

            // Background sweeper: evict stale preview cache entries every 60s
            tauri::async_runtime::spawn(async {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                interval.tick().await; // skip immediate first tick
                loop {
                    interval.tick().await;
                    fits_preview::evict_stale();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Cancellation
            commands::cancel_operation,
            // Scanner
            commands::scan_root,
            commands::scan_single_project,
            commands::seed_header_cache,
            // FITS
            commands::read_fits_header,
            commands::batch_read_fits_headers,
            // XISF
            commands::read_xisf_header,
            // FITS Preview
            commands::get_fits_preview,
            commands::enqueue_previews,
            commands::clear_preview_queue,
            commands::clear_preview_cache,
            commands::update_preview_config,
            // Analyzer
            commands::analyze_subs,
            commands::analyze_stars_detail,
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
            // Notes
            commands::read_note,
            commands::write_note,
            // Converter
            converter::scan_raw_files,
            converter::convert_dslr_to_fits,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
