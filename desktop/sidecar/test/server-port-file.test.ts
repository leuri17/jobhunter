import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startSidecarWithPortFile } from '../src/server.js';

const repoSidecarPortFile = resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  '..',
  'desktop',
  'sidecar',
  '.sidecar-port',
);

describe('sidecar port-file lifecycle', () => {
  let tmpDir: string;
  let handle: Awaited<ReturnType<typeof startSidecarWithPortFile>>;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jobhunter-sidecar-port-'));
    process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'] = tmpDir;
    handle = await startSidecarWithPortFile({
      env: { port: 0, host: '127.0.0.1' },
    });
    await new Promise((r) => setTimeout(r, 50));
  });

  afterAll(async () => {
    await handle.shutdown();
    delete process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the bound port to the override dir after listen()', () => {
    const portFile = join(tmpDir, '.sidecar-port');
    expect(existsSync(portFile)).toBe(true);
    const written = readFileSync(portFile, 'utf8').trim();
    const port = Number(written);
    expect(Number.isInteger(port) && port > 0).toBe(true);
  });

  it('does not write to the package-local path when the override is set', () => {
    expect(existsSync(repoSidecarPortFile)).toBe(false);
  });
});
