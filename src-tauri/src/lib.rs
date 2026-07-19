mod commands;
mod scanner;

use commands::AppState;
use scanner::MusicLibrary;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle();
            let dirs = commands::load_persisted_scan_dirs(&handle);
            // Try cached library first for instant startup, fall back to full scan
            let lib = if let Some(cached) = commands::load_cached_library(&handle) {
                cached
            } else if !dirs.is_empty() {
                let lib = scanner::build_library(&dirs);
                commands::cache_library(&handle, &lib);
                lib
            } else {
                MusicLibrary { songs: Vec::new(), playlists: Vec::new() }
            };
            app.manage(AppState {
                library: Mutex::new(lib),
                scan_dirs: Mutex::new(dirs),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_scan_dir,
            commands::remove_scan_dir,
            commands::scan_all_dirs,
            commands::get_library,
            commands::get_playlist,
            commands::search_library,
            commands::get_scan_dirs,
            commands::pick_folder,
            commands::pick_save_path,
            commands::get_library_stats,
            commands::read_audio_data_url,
            commands::save_favorites,
            commands::load_favorites,
            commands::clear_all_data,
            commands::read_lyrics,
            commands::read_cover_art,
            commands::get_autostart,
            commands::set_autostart,
            commands::export_favorites_zip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Op Music");
}
