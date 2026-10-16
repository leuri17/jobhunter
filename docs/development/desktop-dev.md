# Desktop app development

Two supported dev workflows. There is no plain-browser mode — the desktop
app exists to test the Tauri webview + native surface; running the UI
against a Vite dev server without Tauri cannot exercise notifications,
the single-instance lock, or the `tauri://localhost` asset protocol. The
prior browser-only loop was removed when the HMR split landed
(see [#187](https://github.com/leuri17/jobhunter/issues/187) for the bug
analysis and [#188](https://github.com/leuri17/jobhunter/issues/188) for
the new contract).

## All-in-one (default)

```
cd desktop/tauri
cargo tauri dev
```

Tauri spawns and supervises the sidecar. No HMR on the sidecar — every
sidecar edit requires a Tauri full restart. Right choice for UI-only
iteration, native-surface smoke testing, and CI.

## HMR split (recommended when editing the sidecar)

The `JOBHUNTER_SIDECAR_EXTERNAL=1` flag flips Tauri's `run()` into
discovery-via-file mode (reads `desktop/sidecar/.sidecar-port` on every
`sidecar_port` IPC call). Set it via `.env` at the repo root (Tauri
auto-loads it via `dotenvy::dotenv()` in `desktop/tauri/src/main.rs`),
or inline as below.

Terminal A:

```
pnpm --filter @jobhunter/sidecar dev
```

Terminal B (inline, useful when you don't want to leave the flag on
permanently):

```
JOBHUNTER_SIDECAR_EXTERNAL=1 cargo tauri dev
```

Or just:

```
cargo tauri dev
```

— with `JOBHUNTER_SIDECAR_EXTERNAL=1` set in `.env`.

`tsx watch` reloads `desktop/sidecar/src/server.ts` on save (~2s).
Vite HMR reloads React components inside the Tauri webview (~1s).
Full native surface (notifications, single-instance, asset protocol) is
wired up.

## What `JOBHUNTER_SIDECAR_EXTERNAL=1` does

The sidecar writes its bound port to `desktop/sidecar/.sidecar-port`
after `listen()` resolves, and removes it on graceful shutdown. Tauri
reads that file once instead of starting its own sidecar. Default
`cargo tauri dev` is byte-identical to before; the new path is opt-in.

## Troubleshooting

**`timed out waiting for external sidecar port file ... ensure
`JOBHUNTER_SIDECAR_EXTERNAL=1` is set and the sidecar is running`**
Either Terminal A isn't running, or its port file was deleted by an
ungraceful kill and the next boot hasn't yet produced a replacement.
Start the sidecar in Terminal A first, then launch the Tauri process.
If Terminal A was running and the file is missing, check its stderr —
`unlink` failures are logged there.

**Sidecar banner appears in the webview.**
The Tauri IPC `invoke('sidecar_port')` returned null. Restart the Tauri
shell; the sidecar's bound port is read once at `run()` start.
