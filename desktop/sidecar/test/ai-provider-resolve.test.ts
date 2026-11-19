import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePlatformPaths } from '@jobhunter/core/platform';
import type { PlatformAdapter } from '@jobhunter/core/platform';
import { DEFAULT_OPERATIONAL_CONFIG } from '@jobhunter/core/config/schemas';

import { resolveAiProviderBaseUrl } from '../src/routes/ai-provider-resolve.js';

function adapter(home: string): PlatformAdapter {
  return { platform: 'linux', home, environment: {} };
}

describe('resolveAiProviderBaseUrl', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-ai-provider-resolve-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  function writeConfig(raw: string): void {
    const configDir = join(tempHome, '.config', 'jobhunter');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), raw);
  }

  it('returns the configured baseUrl for a current config file', async () => {
    const { baseUrl: _drop, ...defaultAiProvider } = DEFAULT_OPERATIONAL_CONFIG.aiProvider;
    const { aiProvider: _drop2, ...rest } = DEFAULT_OPERATIONAL_CONFIG;
    writeConfig(
      JSON.stringify({
        ...rest,
        aiProvider: { ...defaultAiProvider, baseUrl: 'https://compat-proxy.example/v1' },
      }),
    );
    const url = await resolveAiProviderBaseUrl(resolvePlatformPaths(adapter(tempHome)));
    expect(url).toBe('https://compat-proxy.example/v1');
  });

  it('backfills the OpenAI endpoint for a legacy openai-section config file', async () => {
    const { baseUrl: _drop, ...legacyAiProvider } = DEFAULT_OPERATIONAL_CONFIG.aiProvider;
    const { aiProvider: _drop2, ...rest } = DEFAULT_OPERATIONAL_CONFIG;
    writeConfig(JSON.stringify({ ...rest, openai: legacyAiProvider }));
    const url = await resolveAiProviderBaseUrl(resolvePlatformPaths(adapter(tempHome)));
    expect(url).toBe('https://api.openai.com/v1');
  });

  it('defaults to OpenRouter when no config file exists', async () => {
    const url = await resolveAiProviderBaseUrl(resolvePlatformPaths(adapter(tempHome)));
    expect(url).toBe('https://openrouter.ai/api/v1');
  });
});
