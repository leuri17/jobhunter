import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePlatformPaths } from '../../src/platform/paths.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';
import { loadConfig } from '../../src/config/loader.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import {
  ConfigError,
  UnknownConfigError,
  ValidationError,
} from '../../src/errors/application-error.js';

function adapter(home: string, env: Record<string, string | undefined> = {}): PlatformAdapter {
  return { platform: 'linux', home, environment: env };
}

describe('loadConfig', () => {
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-loader-'));
    const paths = resolvePlatformPaths(adapter(tempHome));
    configPath = paths.config.file('config.json');
    mkdirSync(dirname(configPath), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns defaults when the config file does not exist', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    const loaded = await loadConfig(paths);

    expect(loaded.config).toEqual(DEFAULT_OPERATIONAL_CONFIG);
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.path).toBe(configPath);
  });

  it('reads, validates, and hashes a written config', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    writeFileSync(configPath, JSON.stringify(DEFAULT_OPERATIONAL_CONFIG, null, 2));

    const loaded = await loadConfig(paths);

    expect(loaded.config).toEqual(DEFAULT_OPERATIONAL_CONFIG);
    expect(loaded.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects malformed JSON with a ConfigError', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    writeFileSync(configPath, '{not json');

    await expect(loadConfig(paths)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects unknown top-level keys with an UnknownConfigError', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    writeFileSync(
      configPath,
      JSON.stringify({ ...DEFAULT_OPERATIONAL_CONFIG, bogus: { something: true } }),
    );

    await expect(loadConfig(paths)).rejects.toBeInstanceOf(UnknownConfigError);
  });

  it('rejects invalid schemas with a ValidationError', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    writeFileSync(
      configPath,
      JSON.stringify({
        ...DEFAULT_OPERATIONAL_CONFIG,
        logging: { level: 'verbose', prettyTerminal: true },
      }),
    );

    await expect(loadConfig(paths)).rejects.toBeInstanceOf(ValidationError);
  });

  it('produces a deterministic hash for the same config', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    writeFileSync(configPath, JSON.stringify(DEFAULT_OPERATIONAL_CONFIG));

    const a = await loadConfig(paths);
    const b = await loadConfig(paths);

    expect(a.hash).toBe(b.hash);
  });
});
