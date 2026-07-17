use crate::scanner::{self, build_library, MusicLibrary, Song};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

/// Application state holding the music library (behind a mutex for interior mutability)
pub struct AppState {
    pub library: Mutex<MusicLibrary>,
    pub scan_dirs: Mutex<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub songs_total: usize,
    pub playlists: Vec<scanner::Playlist>,
}

// ── Commands ──────────────────────────────────────────────

/// Scan one or more directories and rebuild the library
#[tauri::command]
pub fn scan_directories(dirs: Vec<String>, state: State<'_, AppState>) -> Result<ScanResult, String> {
    let library = build_library(&dirs);

    let result = ScanResult {
        songs_total: library.songs.len(),
        playlists: library.playlists.clone(),
    };

    if let Ok(mut sd) = state.scan_dirs.lock() {
        *sd = dirs;
    }
    if let Ok(mut lib) = state.library.lock() {
        *lib = library;
    }

    Ok(result)
}

/// Return the current library
#[tauri::command]
pub fn get_library(state: State<'_, AppState>) -> Result<MusicLibrary, String> {
    state
        .library
        .lock()
        .map(|lib| lib.clone())
        .map_err(|e| e.to_string())
}

/// Return songs for a specific playlist by id
#[tauri::command]
pub fn get_playlist(playlist_id: String, state: State<'_, AppState>) -> Result<Option<Vec<Song>>, String> {
    let lib = state.library.lock().map_err(|e| e.to_string())?;
    let songs = lib
        .playlists
        .iter()
        .find(|p| p.id == playlist_id)
        .map(|p| p.songs.clone());
    Ok(songs)
}

/// Search local library by keyword (title, artist, album)
#[tauri::command]
pub fn search_library(keyword: String, state: State<'_, AppState>) -> Result<Vec<Song>, String> {
    let lib = state.library.lock().map_err(|e| e.to_string())?;
    let kw = keyword.to_lowercase();

    let mut matched: Vec<Song> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for song in &lib.songs {
        if seen.contains(&song.id) {
            continue;
        }
        if song.title.to_lowercase().contains(&kw)
            || song.artist.to_lowercase().contains(&kw)
            || song.album.to_lowercase().contains(&kw)
        {
            seen.insert(song.id);
            matched.push(song.clone());
        }
    }
    Ok(matched)
}

/// Get saved scan directories
#[tauri::command]
pub fn get_scan_dirs(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state
        .scan_dirs
        .lock()
        .map(|d| d.clone())
        .map_err(|e| e.to_string())
}

/// Open a directory picker dialog and return the selected path
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app
        .dialog()
        .file()
        .add_filter("Audio", &["mp3", "flac", "wav", "ogg", "m4a", "aac", "wma", "opus"])
        .blocking_pick_folder();

    Ok(result.map(|p| p.to_string()))
}

/// Get stats for the library view
#[tauri::command]
pub fn get_library_stats(state: State<'_, AppState>) -> Result<LibraryStats, String> {
    let lib = state.library.lock().map_err(|e| e.to_string())?;
    Ok(LibraryStats {
        total_tracks: lib.songs.len(),
        total_playlists: lib.playlists.len(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LibraryStats {
    pub total_tracks: usize,
    pub total_playlists: usize,
}

/// Read an audio file and return it as a base64 data URL (bypasses CSP/protocol issues)
#[tauri::command]
pub fn read_audio_data_url(path: String) -> Result<String, String> {
    use std::fs;
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Detect MIME type from extension
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime = match ext.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "m4a" | "aac" => "audio/mp4",
        "wma" => "audio/x-ms-wma",
        "aiff" | "aif" => "audio/aiff",
        _ => "audio/mpeg", // fallback
    };

    let b64 = BASE64.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}
