use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::Path;
use lofty::prelude::*;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "wma", "opus", "aiff"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub letter: String,
    pub songs: Vec<Song>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicLibrary {
    pub songs: Vec<Song>,
    pub playlists: Vec<Playlist>,
}

fn hash_path(path: &str) -> u64 {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    h.finish()
}

fn read_metadata(path: &Path) -> Option<Song> {
    let tagged_file = match Probe::open(path) {
        Ok(p) => match p.read() {
            Ok(tf) => tf,
            Err(_) => return fallback_song(path),
        },
        Err(_) => return fallback_song(path),
    };

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
    let props = tagged_file.properties();

    let title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string()
        });

    let artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown Artist".to_string());

    let album = tag
        .and_then(|t| t.album().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown Album".to_string());

    let duration = props.duration().as_secs();
    let path_str = path.to_string_lossy().to_string();

    Some(Song {
        id: hash_path(&path_str),
        title,
        artist,
        album,
        duration,
        path: path_str,
    })
}

fn fallback_song(path: &Path) -> Option<Song> {
    let path_str = path.to_string_lossy().to_string();
    Some(Song {
        id: hash_path(&path_str),
        title: path.file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown").to_string(),
        artist: "Unknown Artist".to_string(),
        album: "Unknown Album".to_string(),
        duration: 240,
        path: path_str,
    })
}

/// Scan a directory recursively for audio files
pub fn scan_directory(dir: &str) -> Vec<Song> {
    let mut songs: Vec<Song> = Vec::new();
    for entry in WalkDir::new(dir).follow_links(true).into_iter().filter_map(|e| e.ok()) {
        if !entry.path().is_file() { continue; }
        let ext = entry.path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if AUDIO_EXTS.contains(&ext.as_str()) {
            if let Some(song) = read_metadata(entry.path()) {
                songs.push(song);
            }
        }
    }
    songs.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    songs
}

/// Build a full library from a list of directories
pub fn build_library(dirs: &[String]) -> MusicLibrary {
    let mut all_songs: Vec<Song> = Vec::new();
    let mut seen_ids: HashSet<u64> = HashSet::new();
    let mut playlists: Vec<Playlist> = Vec::new();

    for dir in dirs {
        let songs = scan_directory(dir);
        if songs.is_empty() { continue; }

        let path = Path::new(dir);
        let name = path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(dir)
            .to_string();
        let letter = name.chars().next().unwrap_or('♪').to_string();

        // Deduplicate into all_songs
        for song in &songs {
            if seen_ids.insert(song.id) {
                all_songs.push(song.clone());
            }
        }

        playlists.push(Playlist {
            id: hash_path(dir).to_string(),
            name: name.clone(),
            letter,
            songs,
        });
    }

    // Insert "All Songs" playlist first
    if !all_songs.is_empty() {
        playlists.insert(0, Playlist {
            id: "all".to_string(),
            name: "全部歌曲".to_string(),
            letter: "全".to_string(),
            songs: all_songs.clone(),
        });
    }

    MusicLibrary { songs: all_songs, playlists }
}
