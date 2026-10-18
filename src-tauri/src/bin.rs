//! Locate external binaries. GUI apps on macOS don't inherit the shell PATH,
//! so check the bundled sidecar location and common install prefixes first.
use std::path::PathBuf;

pub fn find(name: &str) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(dir.join(&exe_name));
    }
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        candidates.push(PathBuf::from(prefix).join(&exe_name));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|p| p.join(&exe_name)));
    }
    candidates.into_iter().find(|p| p.is_file())
}

pub fn ffmpeg() -> crate::error::AppResult<PathBuf> {
    find("ffmpeg").ok_or_else(|| crate::error::AppError::msg("ffmpeg not found. Install it: brew install ffmpeg"))
}

pub fn ffprobe() -> crate::error::AppResult<PathBuf> {
    find("ffprobe").ok_or_else(|| crate::error::AppError::msg("ffprobe not found. Install it: brew install ffmpeg"))
}

pub fn chrome() -> Option<PathBuf> {
    let fixed: &[&str] = if cfg!(target_os = "macos") {
        &[
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
    } else if cfg!(windows) {
        &[
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ]
    } else {
        &[]
    };
    fixed
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .or_else(|| ["google-chrome", "chromium", "chromium-browser"].iter().find_map(|n| find(n)))
}
