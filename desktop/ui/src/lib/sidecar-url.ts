import { invoke } from '@tauri-apps/api/core';

export interface SidecarResolution {
  /** URL prefix the webview uses to reach the sidecar. Absolute
   * (`http://127.0.0.1:<port>`) when Tauri IPC returns the bound port; empty
   * string when IPC throws — a state only reachable from a component test
   * or an unhinged runtime (the only dev loop uses Tauri).
   */
  readonly url: string;
  /** `true` when the URL is not high-confidence (Tauri IPC failed). Callers
   * use this to decide whether to verify reachability before issuing
   * mutations. */
  readonly isFallback: boolean;
}

/**
 * Returns the base URL the webview uses to reach the sidecar, plus a flag
 * indicating whether the resolver is on a high-confidence path.
 *
 * The browser-only dev loop that previously relied on `VITE_SIDECAR_PORT`
 * and a Vite `/api` proxy was removed when the desktop app's only dev
 * workflow moved to `cargo tauri dev` (with `JOBHUNTER_SIDECAR_EXTERNAL=1`
 * opt-in for HMR). See `docs/development/desktop-dev.md`.
 */
export async function resolveSidecar(): Promise<SidecarResolution> {
  const ipcPort = await invoke<number>('sidecar_port').catch(() => null);
  if (ipcPort !== null && Number.isFinite(ipcPort)) {
    return { url: `http://127.0.0.1:${ipcPort}`, isFallback: false };
  }
  return { url: '', isFallback: true };
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
