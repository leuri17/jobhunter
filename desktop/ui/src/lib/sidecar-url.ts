import { invoke } from '@tauri-apps/api/core';

const DEFAULT_DEV_PORT = 14231;

export interface SidecarResolution {
  /** Fully-qualified `http://127.0.0.1:<port>` URL the webview should use. */
  readonly url: string;
  /**
   * `true` when both IPC resolution (`invoke('sidecar_port')`) and the
   * build-time `VITE_SIDECAR_PORT` env var were unavailable, so the resolver
   * fell back to the last-resort default port (14231). Callers use this to
   * decide whether to verify reachability before issuing requests.
   */
  readonly isFallback: boolean;
}

/**
 * Returns the base URL the webview uses to reach the sidecar, plus a flag
 * indicating whether the resolver fell back to the dev default port.
 *
 * In a Tauri-built production binary, the webview calls the `sidecar_port`
 * Tauri IPC command (added per C-Oracle-fix I-2) to discover the OS-assigned
 * port the sidecar bound to.
 *
 * In dev mode (`pnpm --filter @jobhunter/ui dev`), Tauri is not running, so
 * the webview falls back to the build-time `VITE_SIDECAR_PORT` env var, or to
 * the default 14231. The dev sidecar must be started on the same port.
 *
 * When `isFallback === true`, neither IPC nor the env var resolved; the URL
 * is almost certainly wrong, and callers should run {@link pingSidecar}
 * before issuing mutations.
 */
export async function resolveSidecar(): Promise<SidecarResolution> {
  const ipcPort = await invoke<number>('sidecar_port').catch(() => null);
  if (ipcPort !== null && Number.isFinite(ipcPort)) {
    return { url: `http://127.0.0.1:${ipcPort}`, isFallback: false };
  }
  const envPortRaw = import.meta.env['VITE_SIDECAR_PORT'];
  if (envPortRaw !== undefined && envPortRaw !== '') {
    const envPort = Number(envPortRaw);
    if (Number.isFinite(envPort)) {
      return { url: `http://127.0.0.1:${envPort}`, isFallback: false };
    }
  }
  return { url: `http://127.0.0.1:${DEFAULT_DEV_PORT}`, isFallback: true };
}

const PING_TIMEOUT_MS = 2_000;

/**
 * Probes `<url>/api/health` with a short timeout. Returns `true` when the
 * server answers with any 2xx (the body is intentionally discarded); `false`
 * on a non-2xx response, a network error, or an abort/timeout.
 *
 * The timeout uses `AbortController` rather than a setTimeout race so the
 * fetch rejects promptly even when the OS keeps a half-open connection to a
 * dead port.
 */
export async function pingSidecar(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
