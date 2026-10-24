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
  `npx tsx <entry>` with `JOBHUNTER_SIDECAR_PORT=0` (OS-assigned port), the
  secrets bridge endpoint from `BridgeInfo`
  (`JOBHUNTER_SECRETS_BRIDGE_PORT` / `JOBHUNTER_SECRETS_BRIDGE_TOKEN`), pipes
  stdout into a reader thread, and blocks on an `mpsc` channel until
  `parse_ready_line` recognises the `READY <port>` handshake (15s deadline).
  `stop_sidecar` sends SIGTERM on Unix for graceful drain, polls `try_wait` for
  up to 5s, then falls back to SIGKILL.
- `secrets.rs` — the OS-keychain secrets bridge. `start_bridge` binds a
  token-authenticated loopback TCP listener (OS-assigned port, 128-bit hex
  token drawn from `RandomState` OS entropy) and serves the `SecretOps`
  surface (`get`/`set`/`delete` on the `keyring` entry
  `(com.leuri17.jobhunter, openai-api-key)`) as a lockstep,
  line-delimited JSON protocol on std-only threads (blocking keyring calls
  must not run on async runtime threads). `KeyringOps` maps keyring errors
  onto the serde-tagged wire error: `unavailable` for backend access
  failures (e.g. headless Linux without a Secret Service), `failed`
  otherwise, with `NoEntry` as a get miss and an idempotent delete.
  Wrong/missing token, malformed JSON, unknown op, non-UTF-8, or >64 KiB
  request lines close the connection with no response. The webview never
  talks to this bridge (no Tauri command wraps it); only the sidecar
  receives the port/token.
- The `Child` handle is wrapped in `Mutex<Option<Child>>` so the `FnMut` run-event
  callback can `take()` it exactly once.

## Flow

1. `main()` → `run()`.
2. `run()` starts the secrets bridge (`secrets::start_bridge`, fatal on bind
   failure) before spawning anything, then calls
   `spawn_sidecar("npx", "<manifest>/../sidecar/src/server.ts", &bridge)`,
   which passes the bridge port/token as env vars and blocks on the
   `READY <port>` line parsed by `parse_ready_line`.
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
  `done` event that drives the notification command). The sidecar is also the
  sole client of the secrets bridge, reached over loopback TCP with the
  per-launch token (TypeScript client planned in a later lane).
- **UI**: consumes the two Tauri commands via `invoke`; no direct Rust↔DOM coupling.
- **Config**: `desktop/tauri/Cargo.toml` (deps incl. `keyring`, `libc`,
  `tauri-plugin-notification`, `tauri-plugin-single-instance`),
  `desktop/tauri/tauri.conf.json` (the `main` window label, bundle settings),
  `capabilities/` (IPC permissions), `build.rs` (`tauri-build` codegen).
- **Tests**: `desktop/tauri/tests/` covers the handshake parser, the shutdown
  path, and the secrets bridge wire protocol (against an injected fake
  `SecretOps`; no test touches a real OS keychain).
