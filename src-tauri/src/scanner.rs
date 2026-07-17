use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use lofty::prelude::*;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

/// Supported audio file extensions
const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "wma", "opus", "aiff"];

/// Emoji pool for generating cover visuals — mirrors the original JS
const EMOJI_POOL: [&str; 80] = [
    "😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊",
    "😋", "😎", "😍", "🥰", "😘", "😗", "😙", "😚", "🙂", "🤗",
    "🤩", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😏", "😣", "😥",
    "😮", "🤐", "😯", "😪", "😫", "🥱", "😴", "😌", "😛", "😜",
    "😝", "🤤", "😒", "😓", "😔", "😕", "🙃", "🤑", "😲", "☹️",
    "🙁", "😖", "😞", "😟", "😤", "😢", "😭", "😦", "😧", "😨",
    "😩", "🤯", "😬", "😰", "😱", "🥵", "🥶", "😳", "🤪", "😵",
    "🥴", "😠", "😡", "🤬", "😷", "🤒", "🤕", "🤢", "🤮", "🤧",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u64,
    pub path: String,
    pub cover_emoji: String,
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

fn emoji_for_id(id: u64) -> String {
    let idx = (id as usize) % EMOJI_POOL.len();
    EMOJI_POOL[idx].to_string()
}

/// Extract the 'best guess' title by stripping common parenthetical suffixes
fn clean_title(raw: &str) -> String {
    raw.trim().to_string()
}

/// Read a single audio file's metadata using `lofty`
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
    let id = hash_path(&path_str);
    let cover_emoji = emoji_for_id(id);

    Some(Song {
        id,
        title: clean_title(&title),
        artist,
        album,
        duration,
        path: path_str,
        cover_emoji,
    })
}

/// Fallback when lofty can't read the file
fn fallback_song(path: &Path) -> Option<Song> {
    let path_str = path.to_string_lossy().to_string();
    let id = hash_path(&path_str);
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    Some(Song {
        id,
        title,
        artist: "Unknown Artist".to_string(),
        album: "Unknown Album".to_string(),
        duration: 240, // guessed
        path: path_str,
        cover_emoji: emoji_for_id(id),
    })
}

/// Scan a directory recursively for audio files
pub fn scan_directory(dir: &str) -> Vec<Song> {
    let mut songs: Vec<Song> = Vec::new();
    let walker = WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok());

    for entry in walker {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if AUDIO_EXTS.contains(&ext.as_str()) {
            if let Some(song) = read_metadata(path) {
                songs.push(song);
            }
        }
    }

    // Sort by title for consistent ordering
    songs.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    songs
}

/// Build a full library from a list of directories
pub fn build_library(dirs: &[String]) -> MusicLibrary {
    let mut all_songs: Vec<Song> = Vec::new();
    let mut playlists: Vec<Playlist> = Vec::new();

    for dir in dirs {
        let songs = scan_directory(dir);
        if songs.is_empty() {
            // No songs found in this directory — skip
            continue;
        }

        let path = Path::new(dir);
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(dir)
            .to_string();
        let letter = name.chars().next().unwrap_or('♪').to_string();
        let id = hash_path(dir);

        // Check for duplicates
        for song in &songs {
            if !all_songs.iter().any(|s| s.id == song.id) {
                all_songs.push(song.clone());
            }
        }

        if !songs.is_empty() {
            playlists.push(Playlist {
                id: id.to_string(),
                name: name.clone(),
                letter,
                songs: songs.clone(),
            });
        }

        // Also create sub-playlists for immediate subdirectories
        if let Ok(read_dir) = std::fs::read_dir(dir) {
            for entry in read_dir.filter_map(|e| e.ok()) {
                let sub_path = entry.path();
                if sub_path.is_dir() {
                    let sub_songs = scan_directory(&sub_path.to_string_lossy());
                    if sub_songs.len() >= 2 {
                        let sub_name = sub_path
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_string();
                        let sub_letter = sub_name.chars().next().unwrap_or('♪').to_string();
                        let sub_id = hash_path(&sub_path.to_string_lossy());

                        playlists.push(Playlist {
                            id: sub_id.to_string(),
                            name: format!("{}/{}", name, sub_name),
                            letter: sub_letter,
                            songs: sub_songs,
                        });
                    }
                }
            }
        }
    }

    // Add an "All Songs" playlist
    if !all_songs.is_empty() {
        let all_playlist = Playlist {
            id: "all".to_string(),
            name: "全部歌曲".to_string(),
            letter: "全".to_string(),
            songs: all_songs.clone(),
        };
        playlists.insert(0, all_playlist);
    }

    MusicLibrary {
        songs: all_songs,
        playlists,
    }
}
