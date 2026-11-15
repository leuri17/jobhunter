import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OPERATIONAL_CONFIG,
  OperationalConfigFileSchema,
  OperationalConfigSchema,
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
      openai: {
        profileExtraction: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
        jobScoring: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', concurrency: 0 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive runTopN and jobsListDefaultLimit', () => {
    const result = OperationalConfigSchema.safeParse({
      ...DEFAULT_OPERATIONAL_CONFIG,
      output: { runTopN: 0, jobsListDefaultLimit: 0 },
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
});
