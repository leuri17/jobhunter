# Desktop app

The JobHunter desktop app is a Tauri 2 shell (`desktop/tauri/`) that hosts
the React UI (`desktop/ui/`) and supervises a Node sidecar
(`desktop/sidecar/`) over loopback HTTP. This document covers how the
binary is built and shipped.

For layered architecture, see
[`docs/architecture.md`](./architecture.md). For setup and day-to-day
commands, see [`README.md`](../README.md).

## Linux build

Build the desktop app from the repo root:

```bash
# 1. Build the UI bundle Vite emits.
pnpm --filter @jobhunter/ui build

# 2. Build the Rust binary + Linux bundles (deb).
cargo tauri build --bundles deb
# or, if `cargo tauri` is not installed locally:
pnpm dlx @tauri-apps/cli build --bundles deb
```

The release binary lands at
`desktop/tauri/target/release/jobhunter-desktop` and the Debian bundle
at
`desktop/tauri/target/release/bundle/deb/JobHunter_<version>_amd64.deb`.

### AppImage

`cargo tauri build --bundles appimage` requires `patchelf` (and
optionally `appimagetool`) on the host machine to bundle the GTK /
webkit2gtk runtime libraries. On a typical dev box install with the
system package manager (e.g. `apt install patchelf` on Debian/Ubuntu).
AppImage bundling is **not** available in every sandboxed CI / agent
environment; if `patchelf` is missing, fall back to the `deb` bundle or
the bare release binary.

### Smoke test

The release binary launches the sidecar child process and a webview.
On a graphical host with a display available, a quick smoke is:

```bash
chmod +x desktop/tauri/target/release/jobhunter-desktop
./desktop/tauri/target/release/jobhunter-desktop &
APP_PID=$!
sleep 5
ps -p $APP_PID && kill $APP_PID
```

Expected: the PID remains alive for the 5-second window and the
sidecar logs its graceful-shutdown line on SIGTERM.

## macOS / Windows builds

macOS / Windows builds require their host platforms (can't cross-compile
Tauri easily). Run `cargo tauri build` on each platform. Code signing &
notarization are out of scope for v1 — unsigned installers ship for
personal use.