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
