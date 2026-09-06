pub mod notification;
pub mod sidecar;

use std::sync::Mutex;

use sidecar::{spawn_sidecar, stop_sidecar};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

/// Bring the existing `main` window forward. Extracted from the
/// single-instance plugin callback so the call site stays readable and
/// the body is unit-testable with a mocked `AppHandle`.
pub fn bring_main_window_forward<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

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
///
/// The (title, body) computation lives in `notification::notification_payload_for`
/// so the 4-branch status mapping + the singular/plural inflection can be
/// unit-tested independently of the Tauri AppHandle (audit B4-B-L4.7 / H19).
#[tauri::command]
fn notify_pipeline_complete(
    app: tauri::AppHandle,
    status: String,
    count: u32,
) -> Result<(), String> {
    let (title, body) = notification::notification_payload_for(&status, count);

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
            // The body lives in `bring_main_window_forward` so it can be
            // unit-tested with a mocked AppHandle.
            bring_main_window_forward(app);
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
