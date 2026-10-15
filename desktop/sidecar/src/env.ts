import { resolve } from 'node:path';

export interface SidecarEnv {
  readonly port: number; // 0 = OS-assigned
  readonly host: string; // always 127.0.0.1
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): SidecarEnv {
  const portRaw = env['JOBHUNTER_SIDECAR_PORT'];
  const port = portRaw === undefined ? 0 : Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid JOBHUNTER_SIDECAR_PORT: ${portRaw}`);
  }
  return {
    port,
    host: '127.0.0.1',
  };
}

/**
 * Resolves the sidecar port-discoverability file path. Each call reads
 * `__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE` (private: `__` prefix) so tests
 * can redirect the parent directory without reloading the module.
 *
 * The sidecar writes its bound port here after `listen()` resolves
 * and removes it on graceful shutdown. Tauri's `run_external_sidecar_mode`
 * reads it once; see `docs/superpowers/specs/2026-10-15-hmr-split-dev-design.md`.
 */
export function resolveSidecarPortFilePath(): string {
  const override = process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'];
  if (override !== undefined && override !== '') return resolve(override, '.sidecar-port');
  return resolve(import.meta.dirname, '..', '.sidecar-port');
}

export const SIDECAR_PORT_FILE_PATH: string = resolveSidecarPortFilePath();
