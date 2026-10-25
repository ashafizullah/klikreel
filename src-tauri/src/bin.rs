//! Locate external binaries. GUI apps on macOS don't inherit the shell PATH,
//! so check next to the app's executable and common install prefixes first.
//! Nothing is bundled: these are the user's own installs.
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

const HOMEBREW_INSTALL: &str = r#"/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)""#;

/// Shell command that installs a missing dependency ("ffmpeg" or "chrome"),
/// using Homebrew on macOS (installing Homebrew first when it is missing).
pub fn install_command(what: &str) -> Option<String> {
    let package = match what {
        "ffmpeg" => "ffmpeg",
        "chrome" => "--cask google-chrome",
        _ => return None,
    };
    if cfg!(target_os = "macos") {
        return Some(match find("brew") {
            Some(brew) => format!("{} install {package}", brew.display()),
            None => format!("{HOMEBREW_INSTALL} && export PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\" && brew install {package}"),
        });
    }
    if cfg!(windows) {
        return Some(if what == "ffmpeg" { "winget install --id Gyan.FFmpeg -e" } else { "winget install --id Google.Chrome -e" }.into());
    }
    Some(if what == "ffmpeg" { "sudo apt install ffmpeg" } else { "sudo apt install chromium" }.into())
}

/// Opens Terminal.app running `install_command(what)` (macOS only).
pub fn install_in_terminal(what: &str) -> crate::error::AppResult<()> {
    if !cfg!(target_os = "macos") {
        return Err(crate::error::AppError::msg("Opening Terminal is only supported on macOS"));
    }
    let cmd = install_command(what).ok_or_else(|| crate::error::AppError::msg(format!("Unknown dependency: {what}")))?;
    let escaped = cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell");
    let status = std::process::Command::new("osascript").arg("-e").arg(script).status()?;
    if !status.success() {
        return Err(crate::error::AppError::msg("Could not open Terminal"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_commands_are_fixed() {
        assert!(install_command("ffmpeg").unwrap().to_lowercase().contains("ffmpeg"));
        assert!(install_command("chrome").unwrap().to_lowercase().contains("chrom"));
        assert!(install_command("rm -rf /").is_none());
    }
}
