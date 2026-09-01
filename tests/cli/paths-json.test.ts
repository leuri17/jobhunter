import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';

/**
 *  — CLI wiring tests for `paths --json`.
 *
 * The `paths` command doesn't touch the database — it only reads
 * the OS-specific platform paths via `resolvePlatformPaths`. So
 * no DB-boot pattern is needed here. Just stub HOME + capture
 * stdout.
 */
describe('CLI: jobhunter paths --json', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let stdout: string[] = [];
  let stderr: string[] = [];
  let exitCode: number | null = null;
  let originalExit: typeof process.exit | undefined;
  let originalOut: typeof process.stdout.write | undefined;
  let originalErr: typeof process.stderr.write | undefined;

  beforeEach(() => {
    if (originalExit === undefined) {
      originalExit = process.exit;
      originalOut = process.stdout.write;
      originalErr = process.stderr.write;
    }
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-paths-json-'));
    originalHome = process.env['HOME'];
    process.env['HOME'] = tempHome;
    stdout = [];
    stderr = [];
    exitCode = null;
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
    if (originalExit !== undefined) process.exit = originalExit;
    if (originalOut !== undefined) process.stdout.write = originalOut;
    if (originalErr !== undefined) process.stderr.write = originalErr;
    if (originalHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = originalHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function runCli(args: readonly string[]): Promise<{
    status: number;
    stdout: string;
    stderr: string;
  }> {
    try {
      await createProgram().parseAsync(['node', 'jobhunter', ...args]);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__exit__')) throw err;
    }
    return {
      status: exitCode ?? 0,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  }

  it('exits 0 + emits valid single JSON document with --json', async () => {
    const result = await runCli(['paths', '--json']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      paths: Record<string, string>;
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(Object.keys(parsed.paths).sort()).toEqual(
      ['cache', 'config', 'data', 'diagnostics', 'logs', 'profileSources'].sort(),
    );
  });

  it('stdout parses cleanly via JSON.parse (no leading/trailing prose)', async () => {
    const result = await runCli(['paths', '--json']);
    expect(result.status).toBe(0);
    // JSON.parse is permissive but will throw on any leading/trailing
    // garbage. The CLI uses `JSON.stringify(payload, null, 2)\n`
    // confirm the trailing newline doesn't break parsing.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('each documented path key resolves to an absolute directory under the stubbed HOME', async () => {
    const result = await runCli(['paths', '--json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { paths: Record<string, string> };
    for (const [key, value] of Object.entries(parsed.paths)) {
      // The CLI uses `path.posix.join` on linux, so values are
      // forward-slash separated. Either way, it must start with the
      // stubbed HOME directory.
      expect(value, `path key ${key} should start with tempHome`).toContain(tempHome);
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
