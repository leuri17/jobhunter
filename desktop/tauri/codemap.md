# desktop/tauri/

## Responsibility

Rust shell (`jobhunter-desktop` crate) that bundles the WebView-based UI and the Node.js sidecar into a single desktop application. Owns the native window lifecycle, OS integration (notifications, single-instance lock), and process orchestration of the embedded Node backend.

## Design

Tauri 2 application crate built on the Rust 2021 edition (MSRV `1.77`).

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
  - `[features]`: `default = ["custom-protocol"]`; `custom-protocol` flips on `tauri/custom-protocol` so production builds serve assets via the `tauri://` scheme instead of `http://`.

- **Build script (`build.rs`)** — single call to `tauri_build::build()`, which runs Tauri's build pipeline before the Rust crate compiles.

## Flow

1. `cargo build` invokes `build.rs` → `tauri_build::build()` generates Tauri artifacts (capabilities, bundled resource manifest).
2. Rust crate compiles against the generated bindings, producing `jobhunter-desktop` (lib + binary).
3. On launch, the Tauri runtime creates the main window hosting the WebView and loads the UI bundle (`desktop/ui/`).
4. `src/` (via `tokio`) spawns `desktop/sidecar/` as a child Node process, captures its stdio, and bridges it to the frontend over Tauri IPC commands.
5. Single-instance and notification plugins gate OS-level concerns; the `custom-protocol` feature ensures the same code path works in dev (`tauri dev`) and prod (`tauri build`).

## Integration

- Sub-map: [src/](desktop/tauri/src/codemap.md) — Tauri commands, sidecar plumbing, app setup.
- Ships with [desktop/ui/](../ui/codemap.md) — frontend bundle loaded into the WebView.
- Spawns [desktop/sidecar/](../sidecar/codemap.md) — Node.js process whose stdio is managed by `tokio::process`.

## Linux AppImage bundling

`tauri.conf.json` sets `bundle.targets = "all"`, so `cargo tauri build`
produces `.deb`, `.rpm`, and `.AppImage` artifacts. On rolling
distributions (Arch, CachyOS, Fedora 39+, Ubuntu 24.04+), the AppImage
step fails with repeated errors of the form:

```
ERROR: Strip call failed: .../strip: ...: unknown type [0x13] section `.relr.dyn'
ERROR: Strip call failed: .../strip: Unable to recognise the format of the input file ...
```

### Root cause

Tauri caches a `linuxdeploy` AppImage under `~/.cache/tauri/` and
launches it to assemble the AppDir. Inside that AppImage sits a
`binutils` `strip` that pre-dates the `.relr.dyn` ELF section
(`SHT_RELR = 0x13`), which glibc 2.36+ emits in every shared library on
modern distros. The cached `strip` cannot parse those libraries, so the
AppImage bundler aborts. The `.deb` and `.rpm` targets are unaffected
because they do not invoke linuxdeploy. Upstream discussion:
[linuxdeploy/linuxdeploy#272](https://github.com/linuxdeploy/linuxdeploy/issues/272),
[linuxdeploy/linuxdeploy#311](https://github.com/linuxdeploy/linuxdeploy/issues/311),
[linuxdeploy/linuxdeploy#336](https://github.com/linuxdeploy/linuxdeploy/issues/336);
Tauri tracking: [tauri-apps/tauri#11149](https://github.com/tauri-apps/tauri/issues/11149).

### Workaround

Set `NO_STRIP=true` in the environment when running the bundler.
linuxdeploy honors the variable and skips its internal `strip` step:

```bash
NO_STRIP=true cargo tauri build        # desktop/tauri/
```

Trade-off: the resulting AppImage ships unstripped shared libraries and
is roughly 10 MB larger than a stripped build. The `.deb` and `.rpm`
artifacts build normally without the flag. Refresh
`~/.cache/tauri/linuxdeploy-x86_64.AppImage` from
[linuxdeploy/linuxdeploy releases](https://github.com/linuxdeploy/linuxdeploy/releases)
does not resolve the failure on its own — the latest `1-alpha-*` builds
still ship the same outdated `strip`. The recommended long-term fix in
upstream linuxdeploy is to drop the bundled `strip` and call the host
`strip` instead.
