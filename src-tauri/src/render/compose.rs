//! Builds the ffmpeg command line that composites media layers, the HTML
//! overlay (PNG stream on stdin) and audio into the final video.
use serde::Deserialize;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub output: String,
    #[serde(default = "default_crf")]
    pub crf: u8,
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default = "default_bg")]
    pub background: String,
    /// Composition page for HTML/text layers; None when the project has none.
    #[serde(default)]
    pub composition_html: Option<String>,
    /// [start, end) ranges where any overlay layer is visible.
    #[serde(default)]
    pub overlay_ranges: Vec<[f64; 2]>,
    #[serde(default)]
    pub media: Vec<MediaLayer>,
    #[serde(default)]
    pub audio: Vec<AudioLayer>,
}

fn default_crf() -> u8 { 18 }
fn default_preset() -> String { "medium".into() }
fn default_bg() -> String { "black".into() }

/// A video or image clip, bottom-most first.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaLayer {
    pub path: String,
    /// video | image
    pub kind: String,
    pub start: f64,
    pub duration: f64,
    #[serde(default)]
    pub trim_in: f64,
    pub natural_width: u32,
    pub natural_height: u32,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "one")]
    pub scale: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioLayer {
    pub path: String,
    pub start: f64,
    pub duration: f64,
    #[serde(default)]
    pub trim_in: f64,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

fn one() -> f64 { 1.0 }

fn even(v: f64) -> u32 {
    ((v / 2.0).round() as u32).max(1) * 2
}

/// Output size of a layer: fit inside the canvas (contain), then user scale.
pub fn fit_size(job: &RenderJob, l: &MediaLayer) -> (u32, u32) {
    let (nw, nh) = (l.natural_width.max(1) as f64, l.natural_height.max(1) as f64);
    let fit = (job.width as f64 / nw).min(job.height as f64 / nh) * l.scale;
    (even(nw * fit), even(nh * fit))
}

pub fn ffmpeg_args(job: &RenderJob) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-v".into(), "error".into(), "-nostats".into(), "-progress".into(), "pipe:1".into()];
    let mut filters: Vec<String> = Vec::new();
    let mut input = 0usize;
    let fps = job.fps;

    let overlay_input = job.composition_html.as_ref().map(|_| {
        args.extend(["-f", "image2pipe", "-framerate", &fps.to_string(), "-c:v", "png", "-i", "pipe:0"].map(String::from));
        input += 1;
        input - 1
    });

    filters.push(format!(
        "color=c={}:s={}x{}:r={}:d={:.3},format=yuv420p[base0]",
        job.background, job.width, job.height, fps, job.duration
    ));
    let mut base = 0usize;
    for l in &job.media {
        if l.kind == "image" {
            args.extend(["-loop".into(), "1".into(), "-framerate".into(), fps.to_string(), "-t".into(), format!("{:.3}", l.duration), "-i".into(), l.path.clone()]);
        } else {
            args.extend(["-ss".into(), format!("{:.3}", l.trim_in), "-t".into(), format!("{:.3}", l.duration), "-i".into(), l.path.clone()]);
        }
        let (w, h) = fit_size(job, l);
        let mut chain = format!("[{input}:v]setpts=PTS-STARTPTS,fps={fps},scale={w}:{h},format=rgba");
        if l.rotation.abs() > 0.01 {
            let r = l.rotation.to_radians();
            chain += &format!(",rotate={r:.5}:c=none:ow=rotw({r:.5}):oh=roth({r:.5})");
        }
        if l.opacity < 0.999 {
            chain += &format!(",colorchannelmixer=aa={:.3}", l.opacity.max(0.0));
        }
        if l.fade_in > 0.0 {
            chain += &format!(",fade=t=in:st=0:d={:.3}:alpha=1", l.fade_in);
        }
        if l.fade_out > 0.0 {
            chain += &format!(",fade=t=out:st={:.3}:d={:.3}:alpha=1", (l.duration - l.fade_out).max(0.0), l.fade_out);
        }
        chain += &format!(",setpts=PTS+{:.3}/TB[m{input}]", l.start);
        filters.push(chain);
        filters.push(format!(
            "[base{base}][m{input}]overlay=x=(W-w)/2+{:.1}:y=(H-h)/2+{:.1}:eof_action=pass:enable='between(t,{:.3},{:.3})'[base{}]",
            l.x, l.y, l.start, l.start + l.duration, base + 1
        ));
        base += 1;
        input += 1;
    }
    match overlay_input {
        Some(i) => filters.push(format!("[{i}:v]format=rgba,setpts=PTS-STARTPTS[ov];[base{base}][ov]overlay=0:0:eof_action=pass,format=yuv420p[vout]")),
        None => filters.push(format!("[base{base}]null[vout]")),
    }

    let mut audio_labels = Vec::new();
    for a in &job.audio {
        args.extend(["-ss".into(), format!("{:.3}", a.trim_in), "-t".into(), format!("{:.3}", a.duration), "-i".into(), a.path.clone()]);
        let mut chain = format!("[{input}:a]asetpts=PTS-STARTPTS,aresample=48000,volume={:.3}", a.volume);
        if a.fade_in > 0.0 {
            chain += &format!(",afade=t=in:st=0:d={:.3}", a.fade_in);
        }
        if a.fade_out > 0.0 {
            chain += &format!(",afade=t=out:st={:.3}:d={:.3}", (a.duration - a.fade_out).max(0.0), a.fade_out);
        }
        let ms = (a.start * 1000.0).round() as u64;
        chain += &format!(",adelay={ms}:all=1[a{input}]");
        filters.push(chain);
        audio_labels.push(format!("[a{input}]"));
        input += 1;
    }
    if !audio_labels.is_empty() {
        filters.push(format!(
            "{}amix=inputs={}:normalize=0:dropout_transition=0,apad,atrim=0:{:.3}[aout]",
            audio_labels.join(""),
            audio_labels.len(),
            job.duration
        ));
    }

    args.extend(["-filter_complex".into(), filters.join(";"), "-map".into(), "[vout]".into()]);
    if audio_labels.is_empty() {
        args.push("-an".into());
    } else {
        args.extend(["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"].map(String::from));
    }
    args.extend([
        "-c:v".into(), "libx264".into(), "-preset".into(), job.preset.clone(), "-crf".into(), job.crf.to_string(),
        "-pix_fmt".into(), "yuv420p".into(), "-r".into(), fps.to_string(), "-t".into(), format!("{:.3}", job.duration),
        "-movflags".into(), "+faststart".into(), job.output.clone(),
    ]);
    args
}

/// Whether frame `n` needs a real screenshot (some overlay is visible).
pub fn overlay_active(job: &RenderJob, t: f64) -> bool {
    job.overlay_ranges.iter().any(|[s, e]| t >= *s && t < *e)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> RenderJob {
        serde_json::from_value(serde_json::json!({
            "width": 1920, "height": 1080, "fps": 30.0, "duration": 5.0, "output": "/tmp/o.mp4",
            "compositionHtml": "<html></html>", "overlayRanges": [[1.0, 2.0]],
            "media": [{"path":"/v.mp4","kind":"video","start":0.5,"duration":3.0,"trimIn":1.0,"naturalWidth":1280,"naturalHeight":720}],
            "audio": [{"path":"/v.mp4","start":0.5,"duration":3.0,"trimIn":1.0}]
        }))
        .unwrap()
    }

    #[test]
    fn fits_media_into_canvas() {
        let j = job();
        assert_eq!(fit_size(&j, &j.media[0]), (1920, 1080));
    }

    #[test]
    fn builds_complete_graph() {
        let args = ffmpeg_args(&job());
        let graph = &args[args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
        assert!(graph.contains("[1:v]setpts=PTS-STARTPTS"));
        assert!(graph.contains("enable='between(t,0.500,3.500)'"));
        assert!(graph.contains("[0:v]format=rgba"));
        assert!(graph.contains("adelay=500:all=1"));
        assert!(args.contains(&"pipe:0".to_string()));
        assert_eq!(args.last().unwrap(), "/tmp/o.mp4");
    }

    #[test]
    fn overlay_ranges_are_half_open() {
        let j = job();
        assert!(overlay_active(&j, 1.0));
        assert!(!overlay_active(&j, 2.0));
    }
}
