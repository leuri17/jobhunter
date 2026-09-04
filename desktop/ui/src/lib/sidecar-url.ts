import { invoke } from '@tauri-apps/api/core';

export interface SidecarResolution {
  /** URL prefix the webview should use. Absolute (`http://127.0.0.1:<port>`) for Tauri
   * webview and explicit env-var overrides; empty string (`''`) for browser dev, where
   * Vite's dev proxy forwards `/api/*` to the sidecar at the configured target.
   */
  readonly url: string;
  /**
   * `true` when the URL is not high-confidence (Tauri IPC failed, or browser dev
   * relying on the proxy with no explicit override). Callers use this to decide
   * whether to verify reachability before issuing mutations.
   */
  readonly isFallback: boolean;
}

/**
 * Returns the base URL the webview uses to reach the sidecar, plus a flag
 * indicating whether the resolver is on a high-confidence path.
 *
 * - **Tauri webview**: call `invoke('sidecar_port')`. In a real Tauri runtime
 *   this returns the OS-assigned port the sidecar bound to; in a test or
 *   browser environment it throws and the catch returns `null`.
 * - **Browser dev**: rely on Vite's dev proxy. An explicit `VITE_SIDECAR_PORT`
 *   overrides the proxy for non-default targets. Otherwise the resolver
 *   returns an empty URL so fetches are same-origin and Vite proxies
 *   `/api/*` to the sidecar.
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
