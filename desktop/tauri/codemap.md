# desktop/tauri/

## Responsibility

Rust shell (`jobhunter-desktop` crate) that bundles the WebView-based UI and the Node.js sidecar into a single desktop application. Owns the native window lifecycle, OS integration (notifications, single-instance lock), and process orchestration of the embedded Node backend.

## Design

Tauri 2 application crate built on the Rust 2021 edition (MSRV `1.88`, driven
by `keyring` v4).

- **Cargo manifest (`Cargo.toml`)** — declarative configuration:
  - `[lib]` exposes `jobhunter_desktop_lib` as `staticlib`, `cdylib`, and `rlib` so the same code can power the desktop binary and potential FFI targets.
  - `[build-dependencies]` pins `tauri-build = "2"` for compile-time codegen (icon embedding, capability/schema generation, resource discovery).
  - `[dependencies]`:
    - `tauri = "2"` — core framework, WebView host, IPC runtime.
    - `tauri-plugin-single-instance = "2"` — enforces a single app instance and forwards launch args.
    - `tauri-plugin-notification = "2"` — native OS notifications.
    - `serde` / `serde_json` — Tauri command/event payload (de)serialization.
    - `tokio` (features: `process`, `io-util`, `macros`, `rt-multi-thread`) — async runtime for spawning and piping stdio of the Node sidecar.
    - `once_cell` — global/lazy initialization (e.g., sidecar handle).
    - `libc` — low-level process signaling on Unix.
    - `keyring = "4"` — OS keychain access with default features (macOS
      Keychain, Windows Credential Manager, Linux Secret Service via zbus;
      pure Rust); backs the loopback secrets bridge in `src/secrets.rs`.
  - `[features]`: `default = ["custom-protocol"]`; `custom-protocol` flips on `tauri/custom-protocol` so production builds serve assets via the `tauri://` scheme instead of `http://`.

- **Build script (`build.rs`)** — single call to `tauri_build::build()`, which runs Tauri's build pipeline before the Rust crate compiles.

## Flow

1. `cargo build` invokes `build.rs` → `tauri_build::build()` generates Tauri artifacts (capabilities, bundled resource manifest).
2. Rust crate compiles against the generated bindings, producing `jobhunter-desktop` (lib + binary).
3. On launch, the Tauri runtime creates the main window hosting the WebView and loads the UI bundle (`desktop/ui/`).
4. `src/` (via `tokio`) spawns `desktop/sidecar/` as a child Node process, captures its stdio, and bridges it to the frontend over Tauri IPC commands. Before the spawn, `src/secrets.rs` starts a token-authenticated loopback TCP bridge to the OS keychain (via `keyring`) and hands its port/token to the sidecar through env vars; the webview never talks to it.
5. Single-instance and notification plugins gate OS-level concerns; the `custom-protocol` feature ensures the same code path works in dev (`tauri dev`) and prod (`tauri build`).

## Integration

- Dev shutdown: the `beforeDevCommand` (`pnpm --filter @jobhunter/ui dev`)
  runs vite under a signal-forwarding supervisor
  (`desktop/ui/scripts/dev-server.mjs`) that exits 0 on a shell-initiated
  SIGTERM, so closing the app in `tauri dev` no longer prints pnpm's
  `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` block for the expected exit 143.
- Sub-map: [src/](desktop/tauri/src/codemap.md) — Tauri commands, sidecar plumbing, app setup.
- Ships with [desktop/ui/](../ui/codemap.md) — frontend bundle loaded into the WebView.
- Spawns [desktop/sidecar/](../sidecar/codemap.md) — Node.js process whose stdio is managed by `tokio::process`.
