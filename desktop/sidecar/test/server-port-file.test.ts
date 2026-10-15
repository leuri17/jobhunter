import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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

describe('sidecar port-file deletion on shutdown', () => {
  let tmpDir: string;
  let handle: Awaited<ReturnType<typeof startSidecarWithPortFile>>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jobhunter-sidecar-port-shutdown-'));
    process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'] = tmpDir;
    handle = await startSidecarWithPortFile({
      env: { port: 0, host: '127.0.0.1' },
    });
    await new Promise((r) => setTimeout(r, 30));
  });

  afterEach(async () => {
    await handle.shutdown().catch(() => undefined);
    delete process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the file when shutdown() runs', async () => {
    const portFile = join(tmpDir, '.sidecar-port');
    expect(existsSync(portFile)).toBe(true);
    await handle.shutdown();
    expect(existsSync(portFile)).toBe(false);
  });

  it('logs to stderr when the unlink fails (force-exit tolerance is not silent)', async () => {
    const portFile = join(tmpDir, '.sidecar-port');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Simulate a file-already-removed condition (e.g. a previous ungraceful
    // kill) — the production code must surface this to stderr so the dev
    // guide's "check its stderr — unlink failures are logged there" entry
    // is accurate.
    rmSync(portFile);
    await handle.shutdown();

    const calls = stderrSpy.mock.calls.flat().map(String);
    const loggedUnlink = calls.some((c) => c.includes('unlink') && c.includes(portFile));
    expect(loggedUnlink).toBe(true);
    stderrSpy.mockRestore();
  });
});

describe('sidecar port-file write failure does not abort boot', () => {
  it('continues past a writeFileSync failure (read-only filesystem tolerated)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'jobhunter-sidecar-port-writefail-'));
    process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'] = tmpDir;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Pre-create a directory at the port-file path so writeFileSync fails
    // with EISDIR. The boot must log and continue past the write — `READY`
    // must still appear on stdout.
    const portFile = join(tmpDir, '.sidecar-port');
    writeFileSync(join(tmpDir, '.sidecar-port-stub'), ''); // ensure dir exists
    rmSync(join(tmpDir, '.sidecar-port-stub'));
    mkdirSync(portFile, { recursive: true });
    // Re-target the override to a path inside `tmpDir` whose `.sidecar-port`
    // is itself a directory (writeFileSync on a directory fails with EISDIR).
    process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'] = tmpDir;

    const handle = await startSidecarWithPortFile({
      env: { port: 0, host: '127.0.0.1' },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(handle.port).toBeGreaterThan(0);

    const loggedWrite = stderrSpy.mock.calls
      .flat()
      .map(String)
      .some((c) => c.includes('write') && c.includes(portFile));
    expect(loggedWrite).toBe(true);

    await handle.shutdown().catch(() => undefined);
    delete process.env['__JOBHUNTER_SIDECAR_PORT_DIR_OVERRIDE'];
    rmSync(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });
});
