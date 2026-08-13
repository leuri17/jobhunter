import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePlatformPaths } from '../../src/platform/paths.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';
import { createProgram } from '../../src/cli.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { loadConfig } from '../../src/config/loader.js';
import { SearchCancelledError, SearchConfigError } from '../../src/search/errors.js';
import type { SearchConfiguration } from '../../src/search/service.js';
import type { SearchPrompts } from '../../src/search/prompts.js';

function adapter(home: string): PlatformAdapter {
  return { platform: 'linux', home, environment: {} };
}

const CONFIG: SearchConfiguration = {
  searchQueries: ['Software Developer', 'Frontend Developer'],
  locations: [
    { name: 'Rotterdam', geoId: '100467493' },
    { name: 'Amsterdam', geoId: '101889610' },
  ],
  datePosted: 86400,
  workplaceTypes: ['1', '2', '3'],
};

function fakePrompts(): SearchPrompts {
  return {
    askSearchQueries: async () => [...CONFIG.searchQueries],
    askDatePosted: async () => CONFIG.datePosted,
    askWorkplaceTypes: async () => [...CONFIG.workplaceTypes],
    askLocationURLs: async () =>
      CONFIG.locations.map((l) => ({
        name: l.name,
        geoId: l.geoId,
        originalUrl: `https://www.linkedin.com/jobs/search/?geoId=${l.geoId}`,
      })),
    askLocationName: async (geoId) => {
      const found = CONFIG.locations.find((l) => l.geoId === geoId);
      if (!found) throw new Error(`unexpected geoId ${geoId}`);
      return found.name;
    },
    askRenameLabel: async () => false,
    showPreview: async () => undefined,
    askConfirmation: async () => true,
  };
}

describe('CLI: jobhunter configure search', () => {
  let tempHome: string;
  let stdout: string[] = [];
  let stderr: string[] = [];
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-search-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    stdout = [];
    stderr = [];
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  async function run(
    args: readonly string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const program = createProgram({ prompts: fakePrompts() });
    const origExit = process.exit;
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    let exitCode = 0;
    process.exit = ((code: number) => {
      exitCode = code;
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
    try {
      try {
        await program.parseAsync(['node', 'jobhunter', ...args]);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('__exit__:')) throw error;
      }
    } finally {
      process.exit = origExit;
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
  }

  it('writes a valid search configuration to disk on success', async () => {
    const result = await run(['configure', 'search']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('search configuration updated');
    const paths = resolvePlatformPaths(adapter(tempHome));
    const loaded = await loadConfig(paths);
    expect(loaded.config.search.searchQueries).toEqual(CONFIG.searchQueries);
    expect(loaded.config.search.locations).toEqual(CONFIG.locations);
    expect(loaded.config.search.datePosted).toBe(86400);
    expect(loaded.config.search.workplaceTypes).toEqual(['1', '2', '3']);
  });

  it('emits the updated configuration to stdout when --json is set', async () => {
    const result = await run(['configure', 'search', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.search.searchQueries).toEqual(CONFIG.searchQueries);
    expect(parsed.search.locations).toEqual(CONFIG.locations);
    expect(parsed.search.datePosted).toBe(86400);
    expect(parsed.search.workplaceTypes).toEqual(['1', '2', '3']);
  });

  it('maps SearchCancelledError to exit code 130', async () => {
    const cancelError = new SearchCancelledError(
      'update_cancelled',
      'Search configuration update was declined by the user.',
    );
    expect(cancelError.exitCode).toBe(130);
  });

  it('maps SearchConfigError to exit code 2', async () => {
    const cfgError = new SearchConfigError('empty_queries', 'At least one query is required.');
    expect(cfgError.exitCode).toBe(2);
  });

  it('preserves unrelated configuration sections when writing the search section', async () => {
    // Seed an unrelated section change and re-run configure search.
    const paths = resolvePlatformPaths(adapter(tempHome));
    mkdirSync(paths.config.directory, { recursive: true });
    writeFileSync(
      paths.config.file('config.json'),
      JSON.stringify(
        {
          ...DEFAULT_OPERATIONAL_CONFIG,
          openai: {
            ...DEFAULT_OPERATIONAL_CONFIG.openai,
            jobScoring: { ...DEFAULT_OPERATIONAL_CONFIG.openai.jobScoring, concurrency: 9 },
          },
        },
        null,
        2,
      ),
    );
    await run(['configure', 'search']);
    const loaded = await loadConfig(paths);
    expect(loaded.config.openai.jobScoring.concurrency).toBe(9);
    expect(loaded.config.search.searchQueries).toEqual(CONFIG.searchQueries);
  });
});
