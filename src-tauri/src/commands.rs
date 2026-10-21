//! Tauri command surface exposed to the webview.
use crate::ai::{self, ChatRequest, ChatResult, prompts::FrameRequest};
use crate::error::{AppError, AppResult};
use crate::render::{self, RenderEvent, compose::RenderJob};
use crate::{bin, keys, media};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use tauri::ipc::Channel;

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    TextDelta { text: String },
}

fn text_sink(channel: Channel<AiStreamEvent>) -> impl FnMut(&str) + Send {
    move |t: &str| {
        let _ = channel.send(AiStreamEvent::TextDelta { text: t.to_string() });
    }
}

// ---- keys -----------------------------------------------------------------

#[tauri::command]
pub fn api_keys_status(profile_ids: Vec<String>) -> AppResult<HashMap<String, bool>> {
    keys::status(&profile_ids)
}

#[tauri::command]
pub fn api_key_set(profile_id: String, key: String) -> AppResult<()> {
    keys::set(&profile_id, &key)
}

#[tauri::command]
pub fn api_key_delete(profile_id: String) -> AppResult<()> {
    keys::delete(&profile_id)
}

// ---- AI -------------------------------------------------------------------

#[tauri::command]
pub async fn ai_chat(request: ChatRequest, on_event: Channel<AiStreamEvent>) -> AppResult<ChatResult> {
    let mut sink = text_sink(on_event);
    ai::chat(&request, &mut sink).await
}

#[tauri::command]
pub async fn ai_generate_frame(request: FrameRequest, on_event: Channel<AiStreamEvent>) -> AppResult<String> {
    let mut sink = text_sink(on_event);
    ai::prompts::generate_frame(&request, &mut sink).await
}

// ---- media ----------------------------------------------------------------

#[tauri::command]
pub async fn media_probe(path: String) -> AppResult<media::MediaInfo> {
    media::probe(&path).await
}

#[tauri::command]
pub async fn media_thumbnails(path: String, duration: f64, count: u32, height: u32) -> AppResult<Vec<String>> {
    media::thumbnails(&path, duration, count.clamp(1, 60), height.clamp(16, 360)).await
}

/// Raw file bytes for in-memory playback (WebKit stutters when streaming
/// media through the custom asset protocol).
#[tauri::command]
pub async fn media_bytes(path: String) -> AppResult<tauri::ipc::Response> {
    const MAX: u64 = 200 * 1024 * 1024;
    if tokio::fs::metadata(&path).await?.len() > MAX {
        return Err(AppError::msg("File is too large to load into memory"));
    }
    Ok(tauri::ipc::Response::new(tokio::fs::read(&path).await?))
}

#[tauri::command]
pub async fn media_retempo(path: String, tempo: f64) -> AppResult<String> {
    media::retempo(&path, tempo).await
}

#[tauri::command]
pub async fn media_waveform(path: String, buckets: usize) -> AppResult<Vec<f32>> {
    media::waveform(&path, buckets.clamp(1, 20000)).await
}

// ---- system / render --------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    ffmpeg: Option<String>,
    ffprobe: Option<String>,
    chrome: Option<String>,
    /// "macos", "windows" or "linux".
    os: &'static str,
    ffmpeg_install: Option<String>,
    chrome_install: Option<String>,
}

#[tauri::command]
pub fn system_status() -> SystemStatus {
    let s = |p: Option<std::path::PathBuf>| p.map(|p| p.to_string_lossy().into_owned());
    SystemStatus {
        ffmpeg: s(bin::find("ffmpeg")),
        ffprobe: s(bin::find("ffprobe")),
        chrome: s(bin::chrome()),
        os: std::env::consts::OS,
        ffmpeg_install: bin::install_command("ffmpeg"),
        chrome_install: bin::install_command("chrome"),
    }
}

#[tauri::command]
pub async fn install_in_terminal(what: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || bin::install_in_terminal(&what)).await.map_err(|e| AppError::msg(e.to_string()))?
}

#[derive(Default)]
pub struct RenderState(Mutex<Option<Arc<AtomicBool>>>);

#[tauri::command]
pub async fn render_start(job: RenderJob, on_event: Channel<RenderEvent>, state: State<'_, RenderState>) -> AppResult<()> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = state.0.lock().unwrap();
        if slot.is_some() {
            return Err(AppError::msg("Another render is already running"));
        }
        *slot = Some(cancel.clone());
    }
    let result = render::run(job, cancel, move |e| {
        let _ = on_event.send(e);
    })
    .await;
    *state.0.lock().unwrap() = None;
    result
}

#[tauri::command]
pub fn render_cancel(state: State<'_, RenderState>) {
    if let Some(flag) = state.0.lock().unwrap().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
}

// ---- library (workspaces & projects) ----------------------------------------

use crate::library::{Library, ProjectMeta, Workspace};
use crate::workspace;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    #[serde(flatten)]
    workspace: Workspace,
    project_count: usize,
    /// Bytes on disk of the workspace's video projects (the codebase folder itself is not counted).
    size: u64,
}

#[tauri::command]
pub fn workspaces_list(lib: State<'_, Library>) -> AppResult<Vec<WorkspaceInfo>> {
    let projects = lib.projects(None)?;
    Ok(lib
        .workspaces()?
        .into_iter()
        .map(|w| {
            let mine = projects.iter().filter(|p| p.workspace_id == w.id);
            let (project_count, size) = mine.fold((0, 0), |(n, s), p| (n + 1, s + p.size));
            WorkspaceInfo { workspace: w, project_count, size }
        })
        .collect())
}

#[tauri::command]
pub fn workspace_add(path: String, name: Option<String>, lib: State<'_, Library>) -> AppResult<Workspace> {
    lib.add_workspace(&path, name)
}

#[tauri::command]
pub fn workspace_rename(id: String, name: String, lib: State<'_, Library>) -> AppResult<()> {
    lib.rename_workspace(&id, &name)
}

#[tauri::command]
pub fn workspace_remove(id: String, lib: State<'_, Library>) -> AppResult<()> {
    lib.remove_workspace(&id)
}

#[tauri::command]
pub fn projects_list(workspace_id: Option<String>, lib: State<'_, Library>) -> AppResult<Vec<ProjectMeta>> {
    lib.projects(workspace_id.as_deref())
}

#[tauri::command]
pub fn project_store(id: String, json: String, lib: State<'_, Library>) -> AppResult<()> {
    lib.save_project(&id, &json)
}

#[tauri::command]
pub fn project_fetch(id: String, lib: State<'_, Library>) -> AppResult<String> {
    lib.load_project(&id)
}

#[tauri::command]
pub fn project_media(id: String, lib: State<'_, Library>) -> AppResult<Vec<crate::library::MediaFile>> {
    lib.media_files(&id)
}

/// Sizes in bytes of the given files (0 when missing).
#[tauri::command]
pub fn file_sizes(paths: Vec<String>) -> Vec<u64> {
    paths.iter().map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)).collect()
}

#[tauri::command]
pub fn project_media_delete(id: String, name: String, lib: State<'_, Library>) -> AppResult<()> {
    lib.delete_media(&id, &name)
}

#[tauri::command]
pub fn project_delete(id: String, lib: State<'_, Library>) -> AppResult<()> {
    lib.delete_project(&id)
}

// ---- workspace research (read-only, sandboxed) -------------------------------

fn ws_root(lib: &Library, workspace_id: &str) -> AppResult<String> {
    Ok(lib.workspace(workspace_id)?.path)
}

#[tauri::command]
pub fn ws_overview(workspace_id: String, lib: State<'_, Library>) -> AppResult<String> {
    workspace::overview(&ws_root(&lib, &workspace_id)?)
}

#[tauri::command]
pub fn ws_list_files(workspace_id: String, dir: String, depth: Option<usize>, lib: State<'_, Library>) -> AppResult<Vec<String>> {
    workspace::list_files(&ws_root(&lib, &workspace_id)?, &dir, depth.unwrap_or(2).clamp(1, 6), 400)
}

#[tauri::command]
pub fn ws_images(workspace_id: String, query: Option<String>, lib: State<'_, Library>) -> AppResult<Vec<String>> {
    workspace::list_images(&ws_root(&lib, &workspace_id)?, query.as_deref().unwrap_or(""), 80)
}

#[tauri::command]
pub fn ws_read_file(workspace_id: String, path: String, lib: State<'_, Library>) -> AppResult<String> {
    workspace::read_file(&ws_root(&lib, &workspace_id)?, &path, 60_000)
}

#[tauri::command]
pub fn ws_search(workspace_id: String, query: String, lib: State<'_, Library>) -> AppResult<Vec<String>> {
    workspace::search(&ws_root(&lib, &workspace_id)?, &query, 60)
}

#[tauri::command]
pub async fn ws_image(workspace_id: String, path: String, max_width: Option<u32>, lib: State<'_, Library>) -> AppResult<String> {
    let root = ws_root(&lib, &workspace_id)?;
    workspace::image_data_uri(&root, &path, max_width.unwrap_or(1600).clamp(64, 2400)).await
}

// ---- TTS ----------------------------------------------------------------------

#[tauri::command]
pub async fn tts_voices(profile_id: String, base_url: Option<String>) -> AppResult<Vec<ai::tts::VoiceOption>> {
    ai::tts::list_voices(&profile_id, base_url.as_deref()).await
}

/// Speaks a short sample for the settings "Test voice" button.
#[tauri::command]
pub async fn tts_preview(request: ai::tts::TtsRequest) -> AppResult<String> {
    let dir = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("klikreel").join("voice-preview");
    // Only the latest sample is played; don't let old ones pile up.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let out = dir.join(format!("{}.mp3", uuid::Uuid::new_v4().simple()));
    ai::tts::synthesize(&request, &out).await?;
    Ok(out.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn tts_generate(project_id: String, name: String, request: ai::tts::TtsRequest, lib: State<'_, Library>) -> AppResult<String> {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let out = lib.media_dir(&project_id)?.join(format!("{safe}.mp3"));
    ai::tts::synthesize(&request, &out).await?;
    Ok(out.to_string_lossy().into_owned())
}

// ---- terminal ---------------------------------------------------------------

use crate::terminal::{TerminalEvent, Terminals};

#[tauri::command]
pub fn terminal_open(cwd: String, cols: u16, rows: u16, on_event: Channel<TerminalEvent>, state: State<'_, Terminals>) -> AppResult<String> {
    state.open(&cwd, cols, rows, on_event)
}

#[tauri::command]
pub fn terminal_write(id: String, data: String, state: State<'_, Terminals>) -> AppResult<()> {
    state.write(&id, &data)
}

#[tauri::command]
pub fn terminal_resize(id: String, cols: u16, rows: u16, state: State<'_, Terminals>) -> AppResult<()> {
    state.resize(&id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(id: String, state: State<'_, Terminals>) {
    state.close(&id);
}
