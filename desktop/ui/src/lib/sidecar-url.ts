import { invoke } from '@tauri-apps/api/core';

const DEFAULT_DEV_PORT = 14231;

/**
 * Returns the base URL the webview uses to reach the sidecar.
 *
 * In a Tauri-built production binary, the webview calls the `sidecar_port`
 * Tauri IPC command (added per C-Oracle-fix I-2) to discover the OS-assigned
 * port the sidecar bound to.
 *
 * In dev mode (`pnpm --filter @jobhunter/ui dev`), Tauri is not running, so
 * the webview falls back to the build-time `VITE_SIDECAR_PORT` env var, or to
 * the default 14231. The dev sidecar must be started on the same port.
 */
export async function sidecarBaseUrl(): Promise<string> {
  const port =
    (await invoke<number>('sidecar_port').catch(() => null)) ??
    Number(import.meta.env['VITE_SIDECAR_PORT'] ?? DEFAULT_DEV_PORT);
  return `http://127.0.0.1:${port}`;
}
