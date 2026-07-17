mod commands;
mod scanner;

use commands::AppState;
use scanner::MusicLibrary;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            library: Mutex::new(MusicLibrary {
                songs: Vec::new(),
                playlists: Vec::new(),
            }),
            scan_dirs: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directories,
            commands::get_library,
            commands::get_playlist,
            commands::search_library,
            commands::get_scan_dirs,
            commands::pick_folder,
            commands::get_library_stats,
            commands::read_audio_data_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Op Music");
}
