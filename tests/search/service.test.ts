import { describe, expect, it } from 'vitest';
import {
  ConfigureSearchService,
  normalizePersistedSearchConfig,
  runConfigureSearch,
  type SearchConfiguration,
} from '../../src/search/service.js';
import type { SearchPrompts } from '../../src/search/prompts.js';
import { SearchCancelledError, SearchConfigError } from '../../src/search/errors.js';

const FULL_PROMPT_ANSWERS: SearchConfiguration = {
  searchQueries: ['Software Developer', 'Frontend Developer'],
  locations: [
    { name: 'Rotterdam', geoId: '100467493' },
    { name: 'Amsterdam', geoId: '101889610' },
  ],
  datePosted: 86400,
  workplaceTypes: ['1', '2', '3'],
};

function fakePrompts(answers: {
  configuration: SearchConfiguration;
  confirm?: boolean;
  renameLabel?: boolean;
}): SearchPrompts {
  return {
    askSearchQueries: async () => [...answers.configuration.searchQueries],
    askDatePosted: async () => answers.configuration.datePosted,
    askWorkplaceTypes: async () => [...answers.configuration.workplaceTypes],
    askLocationURLs: async () =>
      answers.configuration.locations.map((l) => ({
        name: l.name,
        geoId: l.geoId,
        originalUrl: `https://www.linkedin.com/jobs/search/?geoId=${l.geoId}`,
      })),
    askLocationName: async (geoId) => {
      const found = answers.configuration.locations.find((l) => l.geoId === geoId);
      if (!found) throw new Error(`unexpected geoId ${geoId}`);
      return found.name;
    },
    askRenameLabel: async () => answers.renameLabel ?? false,
    showPreview: async () => undefined,
    askConfirmation: async () => answers.confirm ?? true,
  };
}

describe('ConfigureSearchService', () => {
  it('collects, normalizes, dedupes, and returns a valid configuration', async () => {
    const service = new ConfigureSearchService({
      prompts: fakePrompts({ configuration: FULL_PROMPT_ANSWERS }),
    });
    const result = await service.run();
    expect(result).toEqual(FULL_PROMPT_ANSWERS);
  });

  it('dedupes duplicate queries and locations supplied via prompts', async () => {
    const prompts = fakePrompts({
      configuration: {
        searchQueries: ['Software Developer', 'Software Developer', 'Frontend Developer'],
        locations: [
          { name: 'Rotterdam', geoId: '100467493' },
          { name: 'Rotterdam Area', geoId: '100467493' },
        ],
        datePosted: 86400,
        workplaceTypes: ['3', '1', '2'],
      },
    });
    const service = new ConfigureSearchService({ prompts });
    const result = await service.run();
    expect(result.searchQueries).toEqual(['Software Developer', 'Frontend Developer']);
    expect(result.locations).toEqual([{ name: 'Rotterdam', geoId: '100467493' }]);
    expect(result.workplaceTypes).toEqual(['1', '2', '3']);
  });

  it('keeps the existing label when the rename offer is declined', async () => {
    const prompts = fakePrompts({
      configuration: {
        searchQueries: ['Software Developer'],
        locations: [
          { name: 'Rotterdam', geoId: '100467493' },
          { name: 'Rotterdam Area', geoId: '100467493' },
        ],
        datePosted: 86400,
        workplaceTypes: ['1', '2', '3'],
      },
      renameLabel: false,
    });
    const service = new ConfigureSearchService({ prompts });
    const result = await service.run();
    expect(result.locations).toEqual([{ name: 'Rotterdam', geoId: '100467493' }]);
  });

  it('throws SearchConfigError when queries normalize to empty', async () => {
    const prompts: SearchPrompts = {
      ...fakePrompts({ configuration: FULL_PROMPT_ANSWERS }),
      askSearchQueries: async () => [],
    };
    await expect(new ConfigureSearchService({ prompts }).run()).rejects.toBeInstanceOf(
      SearchConfigError,
    );
  });

  it('throws SearchConfigError when locations normalize to empty', async () => {
    const prompts: SearchPrompts = {
      ...fakePrompts({ configuration: FULL_PROMPT_ANSWERS }),
      askLocationURLs: async () => [],
    };
    await expect(new ConfigureSearchService({ prompts }).run()).rejects.toBeInstanceOf(
      SearchConfigError,
    );
  });

  it('throws SearchCancelledError when the user declines the preview', async () => {
    const prompts = fakePrompts({ configuration: FULL_PROMPT_ANSWERS, confirm: false });
    await expect(new ConfigureSearchService({ prompts }).run()).rejects.toBeInstanceOf(
      SearchCancelledError,
    );
  });

  it('honors a custom clock for the matrix start timestamp', async () => {
    const fixed = new Date('2026-08-13T10:00:00.000Z');
    const prompts = fakePrompts({ configuration: FULL_PROMPT_ANSWERS });
    const service = new ConfigureSearchService({ prompts, now: () => fixed });
    const result = await service.run();
    expect(result.datePosted).toBe(86400);
  });

  it('pre-populates prompt defaults from the existing configuration', async () => {
    const calls: {
      queries: readonly string[] | undefined;
      workplace: readonly string[] | undefined;
      datePosted: number | null | undefined;
      locations: readonly { name: string; geoId: string }[] | undefined;
    } = { queries: undefined, workplace: undefined, datePosted: undefined, locations: undefined };

    const prompts: SearchPrompts = {
      ...fakePrompts({ configuration: FULL_PROMPT_ANSWERS }),
      askSearchQueries: async (existing) => {
        calls.queries = existing;
        return [...FULL_PROMPT_ANSWERS.searchQueries];
      },
      askWorkplaceTypes: async (existing) => {
        calls.workplace = existing;
        return [...FULL_PROMPT_ANSWERS.workplaceTypes];
      },
      askDatePosted: async (existing) => {
        calls.datePosted = existing;
        return FULL_PROMPT_ANSWERS.datePosted;
      },
      askLocationURLs: async (existing) => {
        calls.locations = existing;
        return FULL_PROMPT_ANSWERS.locations.map((l) => ({
          name: l.name,
          geoId: l.geoId,
          originalUrl: `https://www.linkedin.com/jobs/search/?geoId=${l.geoId}`,
        }));
      },
    };

    const service = new ConfigureSearchService({ prompts, existing: FULL_PROMPT_ANSWERS });
    await service.run();

    expect(calls.queries).toEqual(FULL_PROMPT_ANSWERS.searchQueries);
    expect(calls.workplace).toEqual(FULL_PROMPT_ANSWERS.workplaceTypes);
    expect(calls.datePosted).toBe(FULL_PROMPT_ANSWERS.datePosted);
    expect(calls.locations).toEqual(FULL_PROMPT_ANSWERS.locations);
  });
});

describe('normalizePersistedSearchConfig', () => {
  it('re-canonicalizes an already-persisted configuration', () => {
    const raw = {
      searchQueries: ['Software Developer', 'software developer', 'Frontend Developer'],
      locations: [
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
      ],
      datePosted: 86400 as const,
      workplaceTypes: ['3', '1', '2'] as const,
    };
    expect(normalizePersistedSearchConfig(raw)).toEqual({
      searchQueries: ['Software Developer', 'Frontend Developer'],
      locations: [
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
      ],
      datePosted: 86400,
      workplaceTypes: ['1', '2', '3'],
    });
  });
});

describe('runConfigureSearch helper', () => {
  it('is a one-call wrapper around ConfigureSearchService', async () => {
    const result = await runConfigureSearch({
      prompts: fakePrompts({ configuration: FULL_PROMPT_ANSWERS }),
    });
    expect(result).toEqual(FULL_PROMPT_ANSWERS);
  });
});
