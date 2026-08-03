import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePlatformPaths } from '../../src/platform/paths.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';
import { loadConfig } from '../../src/config/loader.js';
import { updateConfig } from '../../src/config/updater.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { ConfigError, ValidationError } from '../../src/errors/application-error.js';

function adapter(home: string): PlatformAdapter {
  return { platform: 'linux', home, environment: {} };
}

describe('updateConfig', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-updater-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('preserves unrelated sections when applying a patch', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    await paths.config.directory; // no-op reference to keep paths import alive

    const seeded = {
      ...DEFAULT_OPERATIONAL_CONFIG,
      openai: {
        ...DEFAULT_OPERATIONAL_CONFIG.openai,
        jobScoring: { ...DEFAULT_OPERATIONAL_CONFIG.openai.jobScoring, concurrency: 7 },
      },
    };
    const configPath = paths.config.file('config.json');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(seeded, null, 2));

    const result = await updateConfig(
      paths,
      { logging: { level: 'debug', prettyTerminal: false } },
      { confirm: async () => true },
    );

    expect(result.config.openai.jobScoring.concurrency).toBe(seeded.openai.jobScoring.concurrency);
    expect(result.config.logging).toEqual({ level: 'debug', prettyTerminal: false });
  });

  it('rejects the update when the patched config fails validation', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    await expect(
      updateConfig(
        paths,
        {
          scraper: {
            timeouts: { ...DEFAULT_OPERATIONAL_CONFIG.scraper.timeouts, navigationMs: 0 },
            maxNoProgressAttempts: 1,
          },
        },
        { confirm: async () => true },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('does not write the file when validation fails', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    const initial = await loadConfig(paths);
    const initialJson = JSON.stringify(initial.config);

    await expect(
      updateConfig(
        paths,
        { output: { runTopN: 0, jobsListDefaultLimit: 50 } },
        { confirm: async () => true },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await loadConfig(paths);
    expect(JSON.stringify(after.config)).toBe(initialJson);
    expect(await paths.config.directory).toBe(paths.config.directory);
  });

  it('refuses to write when the user declines the preview', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));

    await expect(
      updateConfig(
        paths,
        { logging: { level: 'debug', prettyTerminal: false } },
        { confirm: async () => false },
      ),
    ).rejects.toBeInstanceOf(ConfigError);

    const loaded = await loadConfig(paths);
    expect(loaded.config.logging).toEqual(DEFAULT_OPERATIONAL_CONFIG.logging);
  });

  it('produces an atomic write with a temporary file and a final rename', async () => {
    const paths = resolvePlatformPaths(adapter(tempHome));
    const result = await updateConfig(
      paths,
      { logging: { level: 'warn', prettyTerminal: false } },
      { confirm: async () => true },
    );

    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = JSON.parse(readFileSync(paths.config.file('config.json'), 'utf8'));
    expect(onDisk.logging).toEqual({ level: 'warn', prettyTerminal: false });
  });
});
