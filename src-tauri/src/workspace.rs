//! Read-only, sandboxed access to a workspace folder (the user's product
//! codebase) so the AI can research it. Secrets are never exposed.
use crate::bin;
use crate::error::{AppError, AppResult};
use base64::Engine;
use ignore::WalkBuilder;
use std::path::{Component, Path, PathBuf};

const HEAVY_DIRS: [&str; 14] = [
    ".git",
    "node_modules",
    "vendor",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "coverage",
    "__pycache__",
    ".venv",
    "Pods",
    ".turbo",
];
const IMAGE_EXT: [&str; 6] = ["png", "jpg", "jpeg", "webp", "svg", "gif"];

/// Files that commonly hold credentials. Matched on the lowercase file name.
pub fn is_secret(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    name.starts_with(".env")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.contains("credential")
        || name.contains("secret")
        || matches!(name.as_str(), ".npmrc" | ".netrc" | ".pypirc" | "auth.json" | ".htpasswd")
        || matches!(ext.as_str(), "pem" | "key" | "p12" | "pfx" | "keystore" | "jks" | "p8" | "sqlite" | "db")
}

fn heavy(name: &str) -> bool {
    HEAVY_DIRS.contains(&name)
}

/// Resolves `rel` inside `root`, rejecting traversal and secret files.
pub fn resolve(root: &str, rel: &str) -> AppResult<PathBuf> {
    let root = Path::new(root).canonicalize().map_err(|_| AppError::msg("Workspace folder not found"))?;
    let rel = rel.trim().trim_start_matches(['/', '\\']);
    if Path::new(rel).components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(AppError::msg("Paths outside the workspace are not allowed"));
    }
    let full = root.join(rel);
    let canon = full.canonicalize().map_err(|_| AppError::msg(format!("Not found: {rel}")))?;
    if !canon.starts_with(&root) {
        return Err(AppError::msg("Paths outside the workspace are not allowed"));
    }
    if is_secret(&canon) {
        return Err(AppError::msg("This file holds credentials and cannot be read"));
    }
    Ok(canon)
}

fn walker(dir: &Path, depth: Option<usize>) -> WalkBuilder {
    let mut w = WalkBuilder::new(dir);
    w.hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .parents(true)
        .require_git(false)
        .max_depth(depth)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            !(e.file_type().is_some_and(|t| t.is_dir()) && heavy(name)) && !is_secret(e.path())
        });
    w
}

fn rel_of(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

/// Lists files and folders (folders end with "/") under `dir`.
pub fn list_files(root: &str, dir: &str, depth: usize, limit: usize) -> AppResult<Vec<String>> {
    let base = resolve(root, dir)?;
    let root_c = Path::new(root).canonicalize()?;
    let mut out = Vec::new();
    for entry in walker(&base, Some(depth.max(1))).build().flatten() {
        if entry.depth() == 0 {
            continue;
        }
        let mut rel = rel_of(&root_c, entry.path());
        if entry.file_type().is_some_and(|t| t.is_dir()) {
            rel.push('/');
        }
        out.push(rel);
        if out.len() >= limit {
            out.push(format!("… (dipotong di {limit} entri)"));
            break;
        }
    }
    Ok(out)
}

fn read_text(path: &Path, max_bytes: usize) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Err(AppError::msg("Binary files cannot be read as text"));
    }
    let mut text = String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).into_owned();
    if bytes.len() > max_bytes {
        text.push_str(&format!("\n… [dipotong, total {} byte]", bytes.len()));
    }
    Ok(text)
}

pub fn read_file(root: &str, rel: &str, max_bytes: usize) -> AppResult<String> {
    let path = resolve(root, rel)?;
    if path.is_dir() {
        return Err(AppError::msg("That is a folder; use list_files"));
    }
    read_text(&path, max_bytes)
}

/// Case-insensitive substring search across text files. Returns "path:line: text".
pub fn search(root: &str, query: &str, limit: usize) -> AppResult<Vec<String>> {
    let q = query.trim().to_lowercase();
    if q.len() < 2 {
        return Err(AppError::msg("Query is too short"));
    }
    let root_c = Path::new(root).canonicalize()?;
    let mut out = Vec::new();
    for entry in walker(&root_c, None).build().flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        if entry.metadata().map(|m| m.len() > 512_000).unwrap_or(true) {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else { continue };
        if bytes.iter().take(4000).any(|b| *b == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&q) {
                let snippet: String = line.trim().chars().take(200).collect();
                out.push(format!("{}:{}: {}", rel_of(&root_c, path), i + 1, snippet));
                if out.len() >= limit {
                    return Ok(out);
                }
            }
        }
    }
    Ok(out)
}

/// A compact first look at the codebase for the research agent.
pub fn overview(root: &str) -> AppResult<String> {
    let root_c = Path::new(root).canonicalize().map_err(|_| AppError::msg("Workspace folder not found"))?;
    let mut s = format!("Workspace: {}\n\n## File tree (depth 2)\n", root_c.file_name().and_then(|n| n.to_str()).unwrap_or(""));
    for line in list_files(root, "", 2, 250)? {
        s.push_str(&line);
        s.push('\n');
    }
    let mut images = Vec::new();
    for entry in walker(&root_c, Some(6)).build().flatten() {
        let p = entry.path();
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
        if IMAGE_EXT.contains(&ext.as_str())
            && ["logo", "brand", "icon", "screenshot", "hero", "og", "preview", "mockup"].iter().any(|k| name.contains(k))
        {
            images.push(rel_of(&root_c, p));
            if images.len() >= 40 {
                break;
            }
        }
    }
    if !images.is_empty() {
        s.push_str("\n## Candidate brand images\n");
        for i in images {
            s.push_str(&i);
            s.push('\n');
        }
    }
    for (name, max) in [
        ("README.md", 8000usize),
        ("readme.md", 8000),
        ("README", 8000),
        ("package.json", 3000),
        ("composer.json", 3000),
        ("Cargo.toml", 2000),
        ("pyproject.toml", 2000),
        ("go.mod", 1500),
        ("tailwind.config.js", 4000),
        ("tailwind.config.ts", 4000),
        ("tailwind.config.cjs", 4000),
    ] {
        let p = root_c.join(name);
        if p.is_file()
            && let Ok(t) = read_text(&p, max)
        {
            s.push_str(&format!("\n## {name}\n{t}\n"));
        }
    }
    Ok(s)
}

/// Loads an image from the workspace as a data URI, downscaled for embedding.
pub async fn image_data_uri(root: &str, rel: &str, max_width: u32) -> AppResult<String> {
    let path = resolve(root, rel)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let b64 = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
    match ext.as_str() {
        "svg" => {
            let bytes = std::fs::read(&path)?;
            if bytes.len() > 1_500_000 {
                return Err(AppError::msg("SVG is too large"));
            }
            Ok(format!("data:image/svg+xml;base64,{}", b64(&bytes)))
        }
        "png" | "jpg" | "jpeg" | "webp" | "gif" => {
            let (codec, mime) = if ext == "png" || ext == "webp" || ext == "gif" { ("png", "image/png") } else { ("mjpeg", "image/jpeg") };
            let out = tokio::process::Command::new(bin::ffmpeg()?)
                .args(["-v", "error", "-i"])
                .arg(&path)
                .args([
                    "-frames:v",
                    "1",
                    "-vf",
                    &format!("scale='min({max_width},iw)':-2"),
                    "-f",
                    "image2pipe",
                    "-c:v",
                    codec,
                    "-q:v",
                    "3",
                    "-",
                ])
                .kill_on_drop(true)
                .output()
                .await?;
            if !out.status.success() || out.stdout.is_empty() {
                return Err(AppError::msg(format!("Could not load image {rel}")));
            }
            Ok(format!("data:{mime};base64,{}", b64(&out.stdout)))
        }
        _ => Err(AppError::msg("Not a supported image file")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aive-ws-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("README.md"), "# Invoicely\nKirim invoice otomatis").unwrap();
        std::fs::write(dir.join(".env"), "SECRET=1").unwrap();
        std::fs::write(dir.join("src/invoice.ts"), "export function sendInvoice() {}").unwrap();
        std::fs::write(dir.join("node_modules/x/i.js"), "sendInvoice").unwrap();
        dir
    }

    #[test]
    fn hides_secrets_and_heavy_dirs() {
        let d = fixture();
        let root = d.to_str().unwrap();
        let files = list_files(root, "", 3, 100).unwrap();
        assert!(files.contains(&"src/invoice.ts".to_string()));
        assert!(!files.iter().any(|f| f.contains(".env") || f.contains("node_modules")));
        assert!(read_file(root, ".env", 100).is_err());
        assert!(read_file(root, "../etc/passwd", 100).is_err());
        let hits = search(root, "sendinvoice", 10).unwrap();
        assert_eq!(hits, vec!["src/invoice.ts:1: export function sendInvoice() {}".to_string()]);
        assert!(overview(root).unwrap().contains("Invoicely"));
        std::fs::remove_dir_all(d).unwrap();
    }
}
