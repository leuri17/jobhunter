import { describe, expect, it } from 'vitest';

import {
  AI_PROVIDER_CHOICES,
  AI_PROVIDER_ENDPOINTS,
  AI_PROVIDER_IDS,
  AI_PROVIDER_REASONING_EFFORT_IDS,
  DEFAULT_OPERATIONAL_CONFIG,
  OperationalConfigFileSchema,
  OperationalConfigSchema,
  resolveAiProviderBaseUrl,
  type OperationalConfig,
} from '../../src/config/schema.js';

describe('OperationalConfigSchema', () => {
  it('accepts the documented default config', () => {
    const result = OperationalConfigSchema.safeParse(DEFAULT_OPERATIONAL_CONFIG);
    expect(result.success).toBe(true);
  });

  it('rejects unknown top-level keys', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      bogus: { something: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown nested keys', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      search: {
        ...DEFAULT_OPERATIONAL_CONFIG.search,
        weirdFilter: 'x',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid log levels', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      logging: { level: 'verbose', prettyTerminal: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive timeouts and concurrency', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      scraper: {
        timeouts: {
          navigationMs: 0,
          initialResultsMs: 20000,
          detailPanelMs: 10000,
          dedicatedPageMs: 20000,
          overlayDismissalMs: 5000,
        },
        maxNoProgressAttempts: 3,
      },
      aiProvider: {
        profileExtraction: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
        jobScoring: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', concurrency: 0 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive runTopN', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      output: { runTopN: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts only the three LinkedIn datePosted values (86400, 604800, 2592000)', () => {
    for (const value of [86400, 604800, 2592000]) {
      const result = OperationalConfigSchema.safeParse({
        ...DEFAULT_OPERATIONAL_CONFIG,
        search: { ...DEFAULT_OPERATIONAL_CONFIG.search, datePosted: value },
      });
      expect(result.success).toBe(true);
    }
    for (const value of [0, 1, 86401, -1, 86400.5]) {
      const result = OperationalConfigSchema.safeParse({
        ...DEFAULT_OPERATIONAL_CONFIG,
        search: { ...DEFAULT_OPERATIONAL_CONFIG.search, datePosted: value },
      });
      expect(result.success).toBe(false);
    }
  });

  it('round-trips through JSON to the same SHA-256-relevant shape', () => {
    const parsed: OperationalConfig = OperationalConfigSchema.parse(DEFAULT_OPERATIONAL_CONFIG);
    const round = OperationalConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(round).toEqual(parsed);
  });

  it('defaults scraper.headless to true when the key is missing (legacy configs)', () => {
    const { headless: _omit, ...legacyScraper } = DEFAULT_OPERATIONAL_CONFIG.scraper;
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      scraper: legacyScraper,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scraper.headless).toBe(true);
    }
  });

  it('keeps the canonical schema strict: missing scraper.headless is a validation error', () => {
    const { headless: _omit, ...legacyScraper } = DEFAULT_OPERATIONAL_CONFIG.scraper;
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      scraper: legacyScraper,
    });
    expect(result.success).toBe(false);
  });

  it('accepts scraper.headless false for headful runs', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      scraper: { ...DEFAULT_OPERATIONAL_CONFIG.scraper, headless: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scraper.headless).toBe(false);
    }
  });

  it('rejects a non-boolean scraper.headless', () => {
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      scraper: { ...DEFAULT_OPERATIONAL_CONFIG.scraper, headless: 'no' },
    });
    expect(result.success).toBe(false);
  });

  it('strips the removed output.jobsListDefaultLimit from legacy config files', () => {
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      output: { runTopN: 20, jobsListDefaultLimit: 50 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('jobsListDefaultLimit' in result.data.output).toBe(false);
      expect(result.data.output.runTopN).toBe(20);
    }
  });

  it('keeps the canonical schema strict: output.jobsListDefaultLimit is a validation error', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      output: { runTopN: 20, jobsListDefaultLimit: 50 },
    });
    expect(result.success).toBe(false);
  });

  it('maps legacy configs missing provider and baseUrl to the OpenAI provider', () => {
    const { provider: _drop, ...legacyAiProvider } = DEFAULT_OPERATIONAL_CONFIG.aiProvider;
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: legacyAiProvider,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiProvider.provider).toBe('openai');
      expect('baseUrl' in result.data.aiProvider).toBe(false);
    }
  });

  it('keeps the canonical schema strict: missing aiProvider.provider is a validation error', () => {
    const { provider: _omit, ...legacyAiProvider } = DEFAULT_OPERATIONAL_CONFIG.aiProvider;
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: legacyAiProvider,
    });
    expect(result.success).toBe(false);
  });

  it('renames a legacy openai section to aiProvider at load time', () => {
    const { provider: _drop, ...legacyAiProvider } = DEFAULT_OPERATIONAL_CONFIG.aiProvider;
    const { aiProvider: _drop2, ...rest } = DEFAULT_OPERATIONAL_CONFIG;
    const result = OperationalConfigFileSchema.safeParse({
      ...rest,
      openai: legacyAiProvider,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiProvider.provider).toBe('openai');
      expect(result.data.aiProvider.jobScoring.concurrency).toBe(
        DEFAULT_OPERATIONAL_CONFIG.aiProvider.jobScoring.concurrency,
      );
    }
  });

  it('rejects a config with both openai and aiProvider sections (ambiguous)', () => {
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      openai: DEFAULT_OPERATIONAL_CONFIG.aiProvider,
    });
    expect(result.success).toBe(false);
  });

  it('defaults a fresh install to OpenRouter with qualified model ids', () => {
    expect(DEFAULT_OPERATIONAL_CONFIG.aiProvider.provider).toBe('openrouter');
    expect('baseUrl' in DEFAULT_OPERATIONAL_CONFIG.aiProvider).toBe(false);
    expect(DEFAULT_OPERATIONAL_CONFIG.aiProvider.profileExtraction.model).toBe(
      'openai/gpt-5.6-sol',
    );
    expect(DEFAULT_OPERATIONAL_CONFIG.aiProvider.jobScoring.model).toBe('openai/gpt-5.6-sol');
  });

  it('rejects baseUrl alongside a known provider', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: {
        ...DEFAULT_OPERATIONAL_CONFIG.aiProvider,
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts custom with a valid baseUrl', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: {
        ...DEFAULT_OPERATIONAL_CONFIG.aiProvider,
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects custom without a baseUrl', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: { ...DEFAULT_OPERATIONAL_CONFIG.aiProvider, provider: 'custom' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown provider id', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: { ...DEFAULT_OPERATIONAL_CONFIG.aiProvider, provider: 'anthropic' },
    });
    expect(result.success).toBe(false);
  });

  it('infers the provider from a known baseUrl in legacy config files', () => {
    const { provider: _drop, ...legacyAiProvider } = DEFAULT_OPERATIONAL_CONFIG.aiProvider;
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: { ...legacyAiProvider, baseUrl: 'https://openrouter.ai/api/v1' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiProvider.provider).toBe('openrouter');
      expect('baseUrl' in result.data.aiProvider).toBe(false);
    }
  });

  it('keeps an unknown baseUrl as a custom provider in legacy config files', () => {
    const { provider: _drop, ...legacyAiProvider } = DEFAULT_OPERATIONAL_CONFIG.aiProvider;
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: { ...legacyAiProvider, baseUrl: 'https://compat-proxy.example/v1' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiProvider.provider).toBe('custom');
      expect(result.data.aiProvider.baseUrl).toBe('https://compat-proxy.example/v1');
    }
  });

  it('lets an explicit provider win over a stale baseUrl in config files', () => {
    const result = OperationalConfigFileSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: {
        ...DEFAULT_OPERATIONAL_CONFIG.aiProvider,
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiProvider.provider).toBe('openrouter');
      expect('baseUrl' in result.data.aiProvider).toBe(false);
    }
  });
});

describe('resolveAiProviderBaseUrl', () => {
  it('returns the catalog endpoint for each known provider', () => {
    for (const [id, baseUrl] of Object.entries(AI_PROVIDER_ENDPOINTS)) {
      const result = OperationalConfigSchema.safeParse({
        ...DEFAULT_OPERATIONAL_CONFIG,
        aiProvider: { ...DEFAULT_OPERATIONAL_CONFIG.aiProvider, provider: id },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(resolveAiProviderBaseUrl(result.data.aiProvider)).toBe(baseUrl);
      }
    }
  });

  it('returns the configured URL for a custom provider', () => {
    const parsed = OperationalConfigSchema.parse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: {
        ...DEFAULT_OPERATIONAL_CONFIG.aiProvider,
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
      },
    });
    expect(resolveAiProviderBaseUrl(parsed.aiProvider)).toBe('https://compat-proxy.example/v1');
  });
});

describe('AI_PROVIDER_CHOICES', () => {
  it('covers every provider id exactly once', () => {
    expect(AI_PROVIDER_CHOICES.map((choice) => choice.value)).toEqual([...AI_PROVIDER_IDS]);
  });
});

describe('AI_PROVIDER_REASONING_EFFORT_IDS', () => {
  it('lists exactly the providers that support the reasoning_effort parameter', () => {
    expect(AI_PROVIDER_REASONING_EFFORT_IDS).toEqual(['openai', 'openrouter', 'custom']);
  });
});
