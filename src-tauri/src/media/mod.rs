//! ffmpeg/ffprobe helpers: probing, thumbnails, waveforms, frame extraction.
use crate::bin;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::process::Command;

const IMAGE_EXT: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    /// video | audio | image
    pub kind: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
}

async fn run(cmd: &mut Command) -> AppResult<Vec<u8>> {
    let out = cmd.kill_on_drop(true).output().await?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = err.lines().rev().take(4).collect();
        return Err(AppError::msg(tail.into_iter().rev().collect::<Vec<_>>().join("\n")));
    }
    Ok(out.stdout)
}

fn parse_rate(r: &str) -> f64 {
    match r.split_once('/') {
        Some((n, d)) => {
            let (n, d) = (n.parse::<f64>().unwrap_or(0.0), d.parse::<f64>().unwrap_or(1.0));
            if d == 0.0 { 0.0 } else { n / d }
        }
        None => r.parse().unwrap_or(0.0),
    }
}

pub async fn probe(path: &str) -> AppResult<MediaInfo> {
    let out = run(Command::new(bin::ffprobe()?).args([
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path,
    ]))
    .await?;
    let v: Value = serde_json::from_slice(&out)?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
    let has_audio = streams.iter().any(|s| s["codec_type"] == "audio");
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let kind = if IMAGE_EXT.contains(&ext.as_str()) {
        "image"
    } else if video.is_some() {
        "video"
    } else if has_audio {
        "audio"
    } else {
        return Err(AppError::msg("Unsupported media format"));
    };
    let duration = v["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
    Ok(MediaInfo {
        path: path.to_string(),
        name: Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or(path).to_string(),
        kind: kind.to_string(),
        duration: if kind == "image" { 0.0 } else { duration },
        width: video.and_then(|s| s["width"].as_u64()).unwrap_or(0) as u32,
        height: video.and_then(|s| s["height"].as_u64()).unwrap_or(0) as u32,
        fps: video.and_then(|s| s["avg_frame_rate"].as_str()).map(parse_rate).unwrap_or(0.0),
        has_audio,
    })
}

fn cache_dir(kind: &str, path: &str) -> AppResult<PathBuf> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    if let Ok(m) = std::fs::metadata(path).and_then(|m| m.modified()) {
        m.hash(&mut h);
    }
    let dir = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("klikreel")
        .join(kind)
        .join(format!("{:016x}", h.finish()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Evenly spaced JPEG thumbnails, cached on disk. Returns file paths.
pub async fn thumbnails(path: &str, duration: f64, count: u32, height: u32) -> AppResult<Vec<String>> {
    let dir = cache_dir("thumbs", path)?;
    let files: Vec<PathBuf> = (0..count).map(|i| dir.join(format!("t{height}_{i:03}.jpg"))).collect();
    if files.iter().all(|f| f.exists()) {
        return Ok(files.iter().map(|f| f.to_string_lossy().into_owned()).collect());
    }
    let ffmpeg = bin::ffmpeg()?;
    let tasks = files.iter().enumerate().map(|(i, file)| {
        let t = if duration > 0.0 { duration * (i as f64 + 0.5) / count as f64 } else { 0.0 };
        let ffmpeg = ffmpeg.clone();
        let file = file.clone();
        async move {
            run(Command::new(ffmpeg).args([
                "-y", "-v", "error", "-ss", &format!("{t:.3}"), "-i", path, "-frames:v", "1",
                "-vf", &format!("scale=-2:{height}"), "-q:v", "6",
            ]).arg(&file))
            .await
        }
    });
    for r in futures::future::join_all(tasks).await {
        r?;
    }
    Ok(files.iter().filter(|f| f.exists()).map(|f| f.to_string_lossy().into_owned()).collect())
}

/// Writes a copy of `path` played `tempo`× faster (pitch preserved) and returns its path.
pub async fn retempo(path: &str, tempo: f64) -> AppResult<String> {
    if !(0.5..=2.0).contains(&tempo) {
        return Err(AppError::msg("Tempo must be between 0.5 and 2.0"));
    }
    let src = Path::new(path);
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let out = src.with_file_name(format!("{stem}_x{:.0}.mp3", tempo * 100.0));
    run(Command::new(bin::ffmpeg()?)
        .args(["-y", "-v", "error", "-i", path, "-filter:a", &format!("atempo={tempo:.4}"), "-c:a", "libmp3lame", "-q:a", "2"])
        .arg(&out))
    .await?;
    Ok(out.to_string_lossy().into_owned())
}

/// Peak amplitude (0..1) per bucket over the whole file.
pub async fn waveform(path: &str, buckets: usize) -> AppResult<Vec<f32>> {
    let out = run(Command::new(bin::ffmpeg()?).args([
        "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "-",
    ]))
    .await?;
    let samples: Vec<i16> = out.as_chunks::<2>().0.iter().map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
    Ok(peaks(&samples, buckets))
}

pub fn peaks(samples: &[i16], buckets: usize) -> Vec<f32> {
    if samples.is_empty() || buckets == 0 {
        return vec![0.0; buckets];
    }
    let per = (samples.len() as f64 / buckets as f64).max(1.0);
    (0..buckets)
        .map(|b| {
            let start = (b as f64 * per) as usize;
            let end = (((b + 1) as f64 * per) as usize).min(samples.len());
            samples.get(start..end).map_or(0.0, |s| {
                s.iter().map(|x| x.unsigned_abs()).max().unwrap_or(0) as f32 / 32768.0
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peaks_bucket_max() {
        let p = peaks(&[0, 16384, -32768, 0], 2);
        assert_eq!(p, vec![0.5, 1.0]);
    }

    #[test]
    fn rate_parsing() {
        assert!((parse_rate("30000/1001") - 29.97).abs() < 0.01);
        assert_eq!(parse_rate("0/0"), 0.0);
    }
}
