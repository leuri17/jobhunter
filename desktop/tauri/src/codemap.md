# desktop/tauri/src/

## Responsibility

Tauri application code: window/plugin setup, Tauri command handlers exposed over
IPC, and supervision of the Node.js sidecar process (spawn, ready handshake,
graceful shutdown).

## Design

- `main.rs` — thin binary entry point; sets `windows_subsystem = "windows"` for
  release builds and delegates to `jobhunter_desktop_lib::run()`.
- `lib.rs` — owns app construction and the IPC surface. Declares the
  `SidecarPort(u16)` managed state and two `#[tauri::command]` handlers:
  `sidecar_port` (returns the dynamically bound sidecar port, since the webview
  cannot inherit parent-process env vars) and `notify_pipeline_complete`
  (maps a run's terminal status — `done` / `failed` / `cancelled` — to an
  OS notification via `tauri_plugin_notification`). Registers
  `tauri_plugin_single_instance` so a second launch refocuses the existing
  `main` window instead of racing for the sidecar port.
- `sidecar.rs` — the sidecar supervisor. `spawn_sidecar` launches
  `npx tsx <entry>` with `JOBHUNTER_SIDECAR_PORT=0` (OS-assigned port), pipes
  stdout into a reader thread, and blocks on an `mpsc` channel until
  `parse_ready_line` recognises the `READY <port>` handshake (15s deadline).
  `stop_sidecar` sends SIGTERM on Unix for graceful drain, polls `try_wait` for
  up to 5s, then falls back to SIGKILL.
- The `Child` handle is wrapped in `Mutex<Option<Child>>` so the `FnMut` run-event
  callback can `take()` it exactly once.

## Flow

1. `main()` → `run()`.
2. `run()` calls `spawn_sidecar("npx", "<manifest>/../sidecar/src/server.ts")`,
   which blocks on the `READY <port>` line parsed by `parse_ready_line`.
3. Port is stored as managed state `SidecarPort(port)` and mirrored into the
   `JOBHUNTER_SIDECAR_PORT` env var for tooling/debugging.
4. `tauri::Builder` registers plugins, managed state, and
   `generate_handler![sidecar_port, notify_pipeline_complete]`, then builds the app.
5. Webview loads → JS calls `invoke('sidecar_port')` to discover the base URL, then
   talks to the sidecar over HTTP/SSE directly.
6. On SSE `done`, the frontend calls `invoke('notify_pipeline_complete', …)`.
7. On `RunEvent::ExitRequested`, the run callback takes the `Child` and calls
   `stop_sidecar(c)`.

## Integration

- **Node sidecar** (`desktop/sidecar/src/server.ts`): spawned as a child process;
  all data access happens over HTTP + SSE (e.g. `routes/pipeline.ts` emits the
  `done` event that drives the notification command).
- **UI**: consumes the two Tauri commands via `invoke`; no direct Rust↔DOM coupling.
- **Config**: `desktop/tauri/Cargo.toml` (deps incl. `libc`,
  `tauri-plugin-notification`, `tauri-plugin-single-instance`),
  `desktop/tauri/tauri.conf.json` (the `main` window label, bundle settings),
  `capabilities/` (IPC permissions), `build.rs` (`tauri-build` codegen).
- **Tests**: `desktop/tauri/tests/` covers the handshake parser and shutdown path.
