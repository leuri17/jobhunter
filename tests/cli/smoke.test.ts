import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..');
const cliEntry = join(repoRoot, 'dist', 'cli.js');

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliEntry, ...args], {
    env,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('CLI smoke (paths / config show / config validate)', () => {
  let tempHome: string;
  let baseEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-smoke-'));
    baseEnv = {
      ...process.env,
      HOME: tempHome,
      XDG_CONFIG_HOME: join(tempHome, 'config'),
      XDG_DATA_HOME: join(tempHome, 'data'),
      XDG_STATE_HOME: join(tempHome, 'state'),
      XDG_CACHE_HOME: join(tempHome, 'cache'),
    };
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('prints paths and creates no directories', () => {
    const { status, stdout } = runCli(['paths'], baseEnv);
    expect(status).toBe(0);
    expect(stdout).toContain('config:');
    expect(stdout).toContain('data:');
    expect(stdout).toContain('logs:');
    expect(stdout).toContain('cache:');
    expect(stdout).toContain('diagnostics:');
    expect(stdout).toContain('profile-sources:');
    expect(() => readFileSync(join(tempHome, 'config', 'jobhunter', 'config.json'))).toThrow();
  });

  it('config show prints the normalized default config', () => {
    const { status, stdout } = runCli(['config', 'show'], baseEnv);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.logging.level).toBe('info');
  });

  it('config validate exits 0 on a valid default config', () => {
    const { status, stdout, stderr } = runCli(['config', 'validate'], baseEnv);
    expect(stderr).toBe('');
    expect(stdout.trim()).toBe('valid');
    expect(status).toBe(0);
  });

  it('config validate exits 2 on a corrupt config', () => {
    const configDir = join(tempHome, 'config', 'jobhunter');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{not json');

    const { status, stderr } = runCli(['config', 'validate'], baseEnv);
    expect(status).toBe(2);
    expect(stderr).toMatch(/parse|invalid|configuration/i);
  });
});
