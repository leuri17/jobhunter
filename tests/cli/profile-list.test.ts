import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';

describe('CLI: jobhunter profile subcommands — wiring', () => {
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
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-profile-wiring-'));
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

  describe('profile list', () => {
    it('prints (no profile versions) when empty', async () => {
      const result = await runCli(['profile', 'list']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('(no profile versions)');
    });

    it('emits valid JSON with --json', async () => {
      const result = await runCli(['profile', 'list', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.profiles).toEqual([]);
    });

    it('exits 0 when --status is provided for an empty DB', async () => {
      const result = await runCli(['profile', 'list', '--status', 'approved']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('(no profile versions)');
    });
  });

  describe('profile show', () => {
    it('exits 2 when no id is supplied', async () => {
      const result = await runCli(['profile', 'show']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('profile_show_missing_id');
    });

    it('exits 2 when the id is unknown', async () => {
      const result = await runCli(['profile', 'show', 'profile_9999']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('profile_not_found');
    });

    it('exits 2 when the id has the wrong prefix shape', async () => {
      const result = await runCli(['profile', 'show', 'not_a_profile_id']);
      expect(result.status).toBe(2);
    });
  });

  describe('profile approve', () => {
    it('exits 2 for an unknown id', async () => {
      const result = await runCli(['profile', 'approve', 'profile_9999']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('profile_not_found');
    });
  });

  describe('profile reject', () => {
    it('exits 2 for an unknown id', async () => {
      const result = await runCli(['profile', 'reject', 'profile_9999']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('profile_not_found');
    });
  });
});
