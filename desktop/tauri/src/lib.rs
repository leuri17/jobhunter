pub mod sidecar;

use std::sync::Mutex;

use sidecar::{spawn_sidecar, stop_sidecar};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

/// Port the sidecar bound to; populated by `run()` and queried via Tauri IPC.
#[derive(Default, Clone, Copy)]
pub struct SidecarPort(pub u16);

/// Tauri command: returns the discovered sidecar port.
/// Phase D will call `await invoke<number>('sidecar_port')`.
#[tauri::command]
fn sidecar_port(state: tauri::State<SidecarPort>) -> u16 {
    state.0
}

/// Show an OS-level notification when the discovery pipeline finishes.
///
/// Invoked by the frontend (via `invoke('notify_pipeline_complete', …)`) when
/// the SSE `done` event arrives from `desktop/sidecar/src/routes/pipeline.ts`.
/// `status` is the run's terminal status (`done` | `failed` | `cancelled`);
/// `count` is the number of jobs discovered (only meaningful for `done`).
#[tauri::command]
fn notify_pipeline_complete(
    app: tauri::AppHandle,
    status: String,
    count: u32,
) -> Result<(), String> {
    let (title, body) = match status.as_str() {
        "done" => (
            "Pipeline complete".to_string(),
            format!(
                "Found {count} new job{} matching your profile.",
                if count == 1 { "" } else { "s" }
            ),
        ),
        "failed" => (
            "Pipeline failed".to_string(),
            "The discovery pipeline encountered an error. Check the runs tab for details."
                .to_string(),
        ),
        "cancelled" => (
            "Pipeline cancelled".to_string(),
            "The discovery pipeline was cancelled before completion.".to_string(),
        ),
        other => (
            "Pipeline update".to_string(),
            format!("Pipeline status: {other}."),
        ),
    };

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification failed: {e}"))
}

pub fn run() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let runtime_path = "npx";
    let entry_path = format!("{}/../sidecar/src/server.ts", manifest_dir);

    let (child, port) = spawn_sidecar(runtime_path, &entry_path)
        .expect("failed to start sidecar");

    // Keep the port for the webview (Tauri IPC; chromium doesn't inherit
    // parent-process env vars). The `JOBHUNTER_SIDECAR_PORT` env var is left
    // in place for tooling/debugging but the webview uses `sidecar_port()`.
    std::env::set_var("JOBHUNTER_SIDECAR_PORT", port.to_string());

    // Wrap the Child in `Mutex<Option<_>>` so the `FnMut` event callback (which
    // may fire multiple times) can move it out on the `ExitRequested` event
    // without violating closure capture rules.
    let child = Mutex::new(Some(child));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second invocation of the binary is intercepted by the
            // single-instance plugin and routed here. Bring the existing
            // window forward so the user lands on their existing session
            // rather than spawning a duplicate process that would fail to
            // bind the sidecar port.
            //
            // The window is labelled `main` (see `tauri.conf.json`); Tauri
            // uses `main` as the default label for the lone entry in
            // `app.windows[]`, but we set it explicitly for clarity.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarPort(port))
        .invoke_handler(tauri::generate_handler![sidecar_port, notify_pipeline_complete])
        .setup(|_app| Ok(()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Ok(mut guard) = child.lock() {
                if let Some(c) = guard.take() {
                    let _ = stop_sidecar(c);
                }
            }
        }
    });
}
