mod ai;
mod bin;
mod commands;
mod error;
mod keys;
mod library;
mod mcp;
mod media;
mod migrate;
mod render;
mod terminal;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    migrate::run(&context.config().identifier);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(commands::RenderState::default())
        .manage(terminal::Terminals::default())
        .setup(|app| {
            use tauri::Manager;
            let dir = app.path().app_data_dir()?;
            keys::init(dir.clone());
            app.manage(mcp::Mcp::new(dir.clone()));
            app.manage(library::Library::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_keys_status,
            commands::api_key_set,
            commands::api_key_delete,
            commands::ai_chat,
            commands::ai_generate_frame,
            commands::media_probe,
            commands::media_thumbnails,
            commands::media_waveform,
            commands::media_bytes,
            commands::media_retempo,
            commands::system_status,
            commands::install_in_terminal,
            commands::render_start,
            commands::render_cancel,
            commands::workspaces_list,
            commands::workspace_add,
            commands::workspace_rename,
            commands::workspace_remove,
            commands::projects_list,
            commands::project_store,
            commands::project_fetch,
            commands::project_delete,
            commands::project_media,
            commands::project_media_delete,
            commands::file_sizes,
            commands::ws_overview,
            commands::ws_list_files,
            commands::ws_read_file,
            commands::ws_search,
            commands::ws_image,
            commands::ws_images,
            commands::tts_generate,
            commands::tts_preview,
            commands::tts_voices,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::mcp_start,
            commands::mcp_stop,
            commands::mcp_link,
            commands::mcp_reply,
            commands::frame_rules,
            commands::frame_check,
            commands::frame_snapshot,
        ])
        .run(context)
        .expect("error while running tauri application");
}
