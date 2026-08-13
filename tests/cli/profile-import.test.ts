import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';

describe('CLI: jobhunter profile import', () => {
  let tempHome: string;
  let stdout: string[] = [];
  let stderr: string[] = [];
  let originalHome: string | undefined;
  let exitCode: number | null = null;
  let originalExit: typeof process.exit;
  let originalOut: typeof process.stdout.write;
  let originalErr: typeof process.stderr.write;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-profile-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    mkdirSync(join(tempHome, 'data'), { recursive: true });
    stdout = [];
    stderr = [];
    exitCode = null;
    originalExit = process.exit;
    originalOut = process.stdout.write;
    originalErr = process.stderr.write;
    process.exit = ((code: number) => {
      if (exitCode === null) exitCode = code;
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    process.exit = originalExit;
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  });

  function isCommanderError(error: unknown): error is { code: string; message: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof (error as { code: unknown }).code === 'string' &&
      typeof (error as { message: unknown }).message === 'string' &&
      (error as { code: string }).code.startsWith('commander.')
    );
  }

  async function run(
    args: readonly string[],
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const program = createProgram();
    try {
      try {
        await program.parseAsync(['node', 'jobhunter', ...args]);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('__exit__:')) {
          // process.exit mock
        } else if (isCommanderError(error)) {
          // Mirror exitWithError's Commander handling
          if (exitCode === null) exitCode = 2;
          process.stderr.write(`${error.message}\n`);
        } else {
          throw error;
        }
      }
    } finally {
      // restore for next test
    }
    return { exitCode: exitCode ?? 0, stdout: stdout.join(''), stderr: stderr.join('') };
  }

  it('rejects profile import with no arguments (exit 2)', async () => {
    const result = await run(['profile', 'import']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toLowerCase()).toMatch(/argument|missing/);
  });

  it('rejects unreadable files (exit 2)', async () => {
    const result = await run(['profile', 'import', join(tempHome, 'missing.md')]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('source_unreadable');
    expect(result.stderr.toLowerCase()).toContain('does not exist');
  });

  it('imports a valid Markdown file and prints a summary (exit 0)', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, '# Title\n\nbody\n', 'utf8');
    const result = await run(['profile', 'import', sourcePath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('source_1');
    expect(result.stdout).toContain('success');
    expect(result.stdout).toContain('extracted: 1');
    expect(result.stdout).toContain('failed: 0');
    expect(result.stdout).toContain('reused: 0');
  });

  it('emits a JSON document when --json is supplied', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, '# Title\n\nbody\n', 'utf8');
    const result = await run(['profile', 'import', '--json', sourcePath]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.status).toBe('success');
    expect(parsed.counts).toEqual({
      total: 1,
      extracted: 1,
      failed: 0,
      reused: 0,
    });
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0].id).toBe('source_1');
  });

  it('reuses the same source on a second import of identical content', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, 'duplicate', 'utf8');
    const first = await run(['profile', 'import', sourcePath]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('success');
    const second = await run(['profile', 'import', sourcePath]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('reused-success');
    expect(second.stdout).toContain('reused: 1');
  });

  it('does not register --paste (Commander rejects unknown options)', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, 'hello', 'utf8');
    const result = await run(['profile', 'import', '--paste', sourcePath]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toLowerCase()).toContain("unknown option '--paste'");
  });

  it('prints error code in stderr for application errors', async () => {
    const result = await run(['profile', 'import', join(tempHome, 'missing.md')]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('source_unreadable');
  });

  it('surfaces extracted/failed/reused counts in mixed batches', async () => {
    const valid = join(tempHome, 'cv.md');
    writeFileSync(valid, 'ok', 'utf8');
    const fixturesPath = join(import.meta.dirname, '..', 'profile', 'fixtures');
    const imageOnly = join(tempHome, 'image-only.pdf');
    const fixtureBytes = await import('node:fs').then((m) =>
      m.readFileSync(join(fixturesPath, 'image-only.pdf')),
    );
    writeFileSync(imageOnly, fixtureBytes);

    // First import: image-only gets a fresh row (status: failed, not reused).
    const first = await run(['profile', 'import', imageOnly]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('status: failure');
    expect(first.stdout).toMatch(/extracted: 0/);
    expect(first.stdout).toMatch(/failed: 1/);

    // Second import: both files in one batch; image-only is reused-failed.
    const second = await run(['profile', 'import', valid, imageOnly]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('status: partial');
    expect(second.stdout).toMatch(/extracted: 1/);
    expect(second.stdout).toMatch(/failed: 1/);
    expect(second.stdout).toMatch(/reused: 1/);
    expect(second.stdout).toContain('reused-failed');
    expect(second.stdout).toContain('(ocr_required)');
  });
});
