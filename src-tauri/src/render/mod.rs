//! Export pipeline: headless Chrome renders HTML overlays frame-by-frame and
//! pipes PNGs into ffmpeg, which composites them with media and audio.
pub mod chromium;
pub mod compose;

use crate::bin;
use crate::error::{AppError, AppResult};
use compose::RenderJob;
use serde::Serialize;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RenderEvent {
    Status { message: String },
    Progress { ratio: f64 },
    Done { output: String },
}

pub async fn run(job: RenderJob, cancel: Arc<AtomicBool>, emit: impl Fn(RenderEvent) + Send + Sync + 'static) -> AppResult<()> {
    if job.duration <= 0.0 {
        return Err(AppError::msg("The timeline is empty"));
    }
    let emit = Arc::new(emit);
    let renderer = match &job.composition_html {
        Some(html) => {
            emit(RenderEvent::Status { message: "Preparing headless Chrome…".into() });
            Some(chromium::FrameRenderer::launch(html, job.width, job.height).await?)
        }
        None => None,
    };

    emit(RenderEvent::Status { message: "Rendering…".into() });
    let mut child = Command::new(bin::ffmpeg()?)
        .args(compose::ffmpeg_args(&job))
        .stdin(if renderer.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let stdout = child.stdout.take().expect("piped stdout");
    let duration = job.duration;
    let progress_emit = emit.clone();
    let progress = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<f64>().ok()) {
                progress_emit(RenderEvent::Progress { ratio: (us / 1e6 / duration).clamp(0.0, 1.0) });
            }
        }
    });
    let mut stderr = child.stderr.take().expect("piped stderr");
    let stderr_task = tokio::spawn(async move {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s).await;
        s
    });

    let mut feed_error = None;
    if let Some(renderer) = renderer {
        let mut stdin = child.stdin.take().expect("piped stdin");
        let total = (job.duration * job.fps).ceil() as u64;
        let blank = renderer.frame(-1.0).await?;
        for n in 0..total {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let t = n as f64 / job.fps;
            let png = if compose::overlay_active(&job, t) { renderer.frame(t).await } else { Ok(blank.clone()) };
            match png {
                Ok(png) => {
                    if stdin.write_all(&png).await.is_err() {
                        break; // ffmpeg exited; its stderr explains why
                    }
                }
                Err(e) => {
                    feed_error = Some(e);
                    break;
                }
            }
        }
        drop(stdin);
        renderer.close().await;
    }

    if feed_error.is_some() {
        let _ = child.kill().await;
    }
    // ffmpeg may keep encoding long after the last frame (or with no HTML layer at all): stay cancellable.
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill().await;
        }
        tokio::select! {
            status = child.wait() => break status?,
            _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {}
        }
    };
    let _ = progress.await;
    let err_text = stderr_task.await.unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&job.output);
        return Err(AppError::msg("Render cancelled"));
    }
    if let Some(e) = feed_error {
        return Err(e);
    }
    if !status.success() {
        let tail: Vec<&str> = err_text.lines().rev().take(6).collect();
        return Err(AppError::msg(format!("ffmpeg failed:\n{}", tail.into_iter().rev().collect::<Vec<_>>().join("\n"))));
    }
    emit(RenderEvent::Progress { ratio: 1.0 });
    emit(RenderEvent::Done { output: job.output.clone() });
    Ok(())
}

#[cfg(test)]
mod tests {
    /// End-to-end export. Run with:
    /// AIVE_JOB=/path/job.json cargo test render_job_from_env -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn render_job_from_env() {
        let path = std::env::var("AIVE_JOB").expect("AIVE_JOB not set");
        let job: super::RenderJob = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let start = std::time::Instant::now();
        super::run(job, cancel, |e| {
            if let super::RenderEvent::Status { message } = e {
                println!("{message}");
            }
        })
        .await
        .unwrap();
        println!("rendered in {:?}", start.elapsed());
    }
}
