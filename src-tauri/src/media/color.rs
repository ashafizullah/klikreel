//! Color fixes for media layers before export. ffmpeg ignores ICC profiles
//! and reads untagged video as BT.601, while the preview (a webview) color
//! manages both, so exports would not match what the user sees.
use super::{cache_dir, run};
use crate::bin;
use crate::error::{AppError, AppResult};
use image::{ImageDecoder, ImageReader};
use moxcms::{ColorProfile, Layout, TransformOptions};
use serde_json::Value;
use tokio::process::Command;

/// An sRGB copy of an image with an embedded color profile (e.g. a Display P3
/// macOS screenshot), cached on disk. None when the image has no profile or
/// can't be converted, so the original is used as is.
pub async fn srgb_image(path: &str) -> Option<String> {
    let path = path.to_string();
    tokio::task::spawn_blocking(move || to_srgb(&path).ok().flatten()).await.ok().flatten()
}

fn to_srgb(path: &str) -> AppResult<Option<String>> {
    let mut decoder = ImageReader::open(path)?.with_guessed_format()?.into_decoder().map_err(img)?;
    let Some(icc) = decoder.icc_profile().map_err(img)? else { return Ok(None) };
    let out = cache_dir("srgb", path)?.join("image.png");
    if out.exists() {
        return Ok(Some(out.to_string_lossy().into_owned()));
    }
    let src = ColorProfile::new_from_slice(&icc).map_err(cms)?;
    let mut rgba = image::DynamicImage::from_decoder(decoder).map_err(img)?.to_rgba8();
    let transform =
        src.create_transform_8bit(Layout::Rgba, &ColorProfile::new_srgb(), Layout::Rgba, TransformOptions::default()).map_err(cms)?;
    let pixels = rgba.to_vec();
    transform.transform(&pixels, &mut rgba).map_err(cms)?;
    rgba.save(&out).map_err(img)?;
    Ok(Some(out.to_string_lossy().into_owned()))
}

fn img(e: image::ImageError) -> AppError {
    AppError::msg(e.to_string())
}

fn cms(e: moxcms::CmsError) -> AppError {
    AppError::msg(e.to_string())
}

/// The YCbCr matrix to read a video with when the file doesn't say: BT.709
/// for HD, as players assume. None when tagged (ffmpeg follows the tag) or SD.
pub async fn untagged_video_matrix(path: &str) -> Option<&'static str> {
    let out = run(Command::new(bin::ffprobe().ok()?).args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=color_space,height",
        "-print_format",
        "json",
        path,
    ]))
    .await
    .ok()?;
    let v: Value = serde_json::from_slice(&out).ok()?;
    let s = &v["streams"][0];
    implied_matrix(s["color_space"].as_str(), s["height"].as_u64().unwrap_or(0))
}

fn implied_matrix(color_space: Option<&str>, height: u64) -> Option<&'static str> {
    let untagged = matches!(color_space, None | Some("unknown") | Some(""));
    (untagged && height >= 720).then_some("bt709")
}

/// Points image layers at sRGB copies and records how to read untagged video.
pub async fn prepare(job: &mut crate::render::compose::RenderJob) {
    for l in &mut job.media {
        if l.kind == "image" {
            if let Some(p) = srgb_image(&l.path).await {
                l.path = p;
            }
        } else {
            l.color_matrix = untagged_video_matrix(&l.path).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untagged_hd_reads_as_bt709() {
        assert_eq!(implied_matrix(None, 1080), Some("bt709"));
        assert_eq!(implied_matrix(Some("unknown"), 720), Some("bt709"));
        assert_eq!(implied_matrix(Some("unknown"), 480), None);
        assert_eq!(implied_matrix(Some("bt709"), 1080), None);
        assert_eq!(implied_matrix(Some("smpte170m"), 1080), None);
    }

    #[test]
    fn untagged_image_is_left_alone() {
        let dir = std::env::temp_dir().join(format!("klikreel-color-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("plain.png");
        image::RgbaImage::from_pixel(4, 4, image::Rgba([0x34, 0xA8, 0x53, 255])).save(&p).unwrap();
        assert_eq!(to_srgb(p.to_str().unwrap()).unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
