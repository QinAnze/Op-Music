use crate::scanner::{self, build_library, MusicLibrary, Song};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};

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

/// Add a new directory and rebuild the full library from ALL accumulated dirs
#[tauri::command]
pub fn add_scan_dir(dir: String, state: State<'_, AppState>, app: tauri::AppHandle) -> Result<ScanResult, String> {
    // Accumulate: add new dir if not already present
    let mut all_dirs = {
        let sd = state.scan_dirs.lock().map_err(|e| e.to_string())?;
        sd.clone()
    };
    if !all_dirs.contains(&dir) {
        all_dirs.push(dir);
    }
    // Persist
    persist_scan_dirs(&app, &all_dirs)?;
    // Rebuild library from all directories
    let library = build_library(&all_dirs);
    let result = ScanResult {
        songs_total: library.songs.len(),
        playlists: library.playlists.clone(),
    };
    if let Ok(mut sd) = state.scan_dirs.lock() {
        *sd = all_dirs;
    }
    if let Ok(mut lib) = state.library.lock() {
        *lib = library;
    }
    Ok(result)
}

/// Remove a directory and rebuild
#[tauri::command]
pub fn remove_scan_dir(dir: String, state: State<'_, AppState>, app: tauri::AppHandle) -> Result<ScanResult, String> {
    let mut all_dirs = {
        let sd = state.scan_dirs.lock().map_err(|e| e.to_string())?;
        sd.clone()
    };
    all_dirs.retain(|d| d != &dir);
    persist_scan_dirs(&app, &all_dirs)?;
    let library = build_library(&all_dirs);
    let result = ScanResult {
        songs_total: library.songs.len(),
        playlists: library.playlists.clone(),
    };
    if let Ok(mut sd) = state.scan_dirs.lock() {
        *sd = all_dirs;
    }
    if let Ok(mut lib) = state.library.lock() {
        *lib = library;
    }
    Ok(result)
}

/// Scan ALL accumulated directories (used on startup to restore session)
#[tauri::command]
pub fn scan_all_dirs(state: State<'_, AppState>) -> Result<ScanResult, String> {
    let dirs = state.scan_dirs.lock().map_err(|e| e.to_string())?.clone();
    let library = build_library(&dirs);
    let result = ScanResult {
        songs_total: library.songs.len(),
        playlists: library.playlists.clone(),
    };
    if let Ok(mut lib) = state.library.lock() {
        *lib = library;
    }
    Ok(result)
}

fn persist_scan_dirs(app: &tauri::AppHandle, dirs: &[String]) -> Result<(), String> {
    use std::fs;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let path = data_dir.join("scan_dirs.json");
    let json = serde_json::to_string(dirs).map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write scan dirs: {}", e))?;
    Ok(())
}

pub fn load_persisted_scan_dirs(app: &tauri::AppHandle) -> Vec<String> {
    use std::fs;
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let path = data_dir.join("scan_dirs.json");
    if !path.exists() {
        return Vec::new();
    }
    let json = match fs::read_to_string(&path) {
        Ok(j) => j,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&json).unwrap_or_default()
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

/// Open a save-file dialog for ZIP export
#[tauri::command]
pub async fn pick_save_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app
        .dialog()
        .file()
        .add_filter("ZIP Archive", &["zip"])
        .set_file_name("favorites.zip")
        .blocking_save_file();
    Ok(result.map(|p| p.to_string()))
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

/// Save favorites list to a file on disk (survives cache clears)
#[tauri::command]
pub fn save_favorites(paths: Vec<String>, app: tauri::AppHandle) -> Result<(), String> {
    use std::fs;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let fav_path = data_dir.join("favorites.json");
    let json = serde_json::to_string(&paths).map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&fav_path, json).map_err(|e| format!("Failed to write favorites: {}", e))?;
    Ok(())
}

/// Load favorites from disk, verifying each path still exists. Stale paths are auto-removed.
#[tauri::command]
pub fn load_favorites(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use std::fs;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let fav_path = data_dir.join("favorites.json");
    if !fav_path.exists() {
        return Ok(Vec::new());
    }
    let json = fs::read_to_string(&fav_path).map_err(|e| format!("Failed to read favorites: {}", e))?;
    let paths: Vec<String> =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse favorites: {}", e))?;
    // Keep only paths where the file still exists
    let valid: Vec<String> = paths.into_iter().filter(|p| std::path::Path::new(p).exists()).collect();
    // Persist the cleaned list
    let cleaned = serde_json::to_string(&valid).map_err(|e| format!("Failed to serialize: {}", e))?;
    let _ = fs::write(&fav_path, cleaned);
    Ok(valid)
}

/// Toggle auto-start on boot (Windows registry)
#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    use std::process::Command;
    let output = Command::new("reg")
        .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "OpMusic"])
        .output()
        .map_err(|e| format!("reg query failed: {}", e))?;
    Ok(output.status.success())
}

#[tauri::command]
pub fn set_autostart(enable: bool) -> Result<bool, String> {
    use std::process::Command;
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {}", e))?;
    let exe_path = exe.to_string_lossy().to_string();
    if enable {
        Command::new("reg")
            .args(["add", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                   "/v", "OpMusic", "/t", "REG_SZ", "/d", &exe_path, "/f"])
            .output()
            .map_err(|e| format!("reg add failed: {}", e))?;
    } else {
        Command::new("reg")
            .args(["delete", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                   "/v", "OpMusic", "/f"])
            .output()
            .map_err(|e| format!("reg delete failed: {}", e))?;
    }
    Ok(enable)
}

/// Export favorited audio files into a ZIP archive
#[tauri::command]
pub fn export_favorites_zip(paths: Vec<String>, dest: String) -> Result<(), String> {
    use std::fs;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    let file = fs::File::create(&dest).map_err(|e| format!("Cannot create zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for src in &paths {
        let name = std::path::Path::new(src)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        match fs::read(src) {
            Ok(bytes) => {
                zip.start_file(name, options)
                    .map_err(|e| format!("zip start_file: {}", e))?;
                zip.write_all(&bytes)
                    .map_err(|e| format!("zip write: {}", e))?;
            }
            Err(e) => {
                eprintln!("Skipping {}: {}", src, e);
            }
        }
    }
    zip.finish().map_err(|e| format!("zip finish: {}", e))?;
    Ok(())
}

/// Clear all user data: scan dirs, favorites, and in-memory state
#[tauri::command]
pub fn clear_all_data(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let _ = fs::remove_file(data_dir.join("scan_dirs.json"));
    let _ = fs::remove_file(data_dir.join("favorites.json"));
    // Reset in-memory state
    if let Ok(mut sd) = state.scan_dirs.lock() { sd.clear(); }
    if let Ok(mut lib) = state.library.lock() { *lib = MusicLibrary { songs: Vec::new(), playlists: Vec::new() }; }
    Ok(())
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
