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
            // Load persisted scan directories from disk on startup
            let dirs = commands::load_persisted_scan_dirs(&app.handle());
            let lib = if dirs.is_empty() {
                MusicLibrary { songs: Vec::new(), playlists: Vec::new() }
            } else {
                scanner::build_library(&dirs)
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
            commands::get_library_stats,
            commands::read_audio_data_url,
            commands::save_favorites,
            commands::load_favorites,
            commands::clear_all_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Op Music");
}
