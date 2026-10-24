//! One-time move of app data from an earlier bundle identifier to the current
//! one. The config, data and cache dirs and the webview's data (localStorage)
//! are all named after the identifier. Runs before any window or store exists.

use std::path::PathBuf;

/// Earlier identifiers, newest first.
const OLD_IDS: &[&str] = &["com.ashafizullah.aivideoeditor"];

pub fn run(new_id: &str) {
    for base in base_dirs() {
        let new = base.join(new_id);
        if new.exists() {
            continue;
        }
        if let Some(old) = OLD_IDS.iter().map(|id| base.join(id)).find(|p| p.is_dir()) {
            // Best effort: on failure the app starts fresh and the old data stays put.
            let _ = std::fs::rename(&old, &new);
        }
    }
}

/// Parents of the identifier-named dirs.
fn base_dirs() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    if cfg!(target_os = "macos") {
        env("HOME")
            .map(|h| ["Application Support", "Caches", "WebKit"].iter().map(|d| h.join("Library").join(d)).collect())
            .unwrap_or_default()
    } else if cfg!(windows) {
        // %APPDATA%\<id> holds the config and data; %LOCALAPPDATA%\<id> the cache and EBWebView.
        [env("APPDATA"), env("LOCALAPPDATA")].into_iter().flatten().collect()
    } else {
        let home = env("HOME");
        let xdg = |k: &str, d: &str| env(k).or_else(|| home.as_ref().map(|h| h.join(d)));
        [xdg("XDG_CONFIG_HOME", ".config"), xdg("XDG_DATA_HOME", ".local/share"), xdg("XDG_CACHE_HOME", ".cache")]
            .into_iter()
            .flatten()
            .collect()
    }
}
