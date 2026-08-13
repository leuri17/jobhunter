import { describe, expect, it, vi } from 'vitest';
import * as inquirer from '@inquirer/prompts';

import {
  createFailingPrompts,
  defaultInquirerPrompts,
  type SearchPrompts,
} from '../../src/search/prompts.js';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
}));

describe('createFailingPrompts', () => {
  it('always rejects with the given reason', async () => {
    const prompts: SearchPrompts = createFailingPrompts('not allowed in tests');
    await expect(prompts.askSearchQueries([])).rejects.toThrow('not allowed in tests');
    await expect(prompts.askDatePosted(null)).rejects.toThrow('not allowed in tests');
    await expect(prompts.askWorkplaceTypes([])).rejects.toThrow('not allowed in tests');
    await expect(prompts.askLocationURLs([])).rejects.toThrow('not allowed in tests');
    await expect(prompts.askLocationName('1')).rejects.toThrow('not allowed in tests');
    await expect(prompts.askRenameLabel('1', 'Existing', 'https://example.com')).rejects.toThrow(
      'not allowed in tests',
    );
    await expect(
      prompts.askConfirmation(
        {
          searchQueries: ['Software Developer'],
          locations: [{ name: 'Rotterdam', geoId: '100467493' }],
          datePosted: 86400,
          workplaceTypes: ['1', '2', '3'],
        },
        1,
      ),
    ).rejects.toThrow('not allowed in tests');
    await expect(
      prompts.showPreview(
        {
          searchQueries: ['Software Developer'],
          locations: [{ name: 'Rotterdam', geoId: '100467493' }],
          datePosted: 86400,
          workplaceTypes: ['1', '2', '3'],
        },
        1,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('defaultInquirerPrompts.askSearchQueries — keep/add/replace', () => {
  const EXISTING = ['Software Developer', 'Frontend Developer'];

  it('returns existing when the user selects Keep', async () => {
    const selectMock = vi.mocked(inquirer.select);
    selectMock.mockReset();
    selectMock.mockResolvedValueOnce('keep');

    const result = await defaultInquirerPrompts.askSearchQueries(EXISTING);

    expect(result).toEqual(EXISTING);
  });

  it('appends new queries when the user selects Add', async () => {
    const selectMock = vi.mocked(inquirer.select);
    const inputMock = vi.mocked(inquirer.input);
    selectMock.mockReset();
    inputMock.mockReset();
    // Sequence:
    //   1. select → 'add'
    //   2. input → 'q1'
    //   3. input → 'q2'
    //   4. input → '' (finish)
    selectMock.mockResolvedValueOnce('add');
    inputMock.mockResolvedValueOnce('q1');
    inputMock.mockResolvedValueOnce('q2');
    inputMock.mockResolvedValueOnce('');

    const result = await defaultInquirerPrompts.askSearchQueries(EXISTING);

    expect(result).toEqual([...EXISTING, 'q1', 'q2']);
  });

  it('returns just new queries (no existing) when the user selects Replace', async () => {
    const selectMock = vi.mocked(inquirer.select);
    const inputMock = vi.mocked(inquirer.input);
    selectMock.mockReset();
    inputMock.mockReset();
    // Sequence:
    //   1. select → 'replace'
    //   2. input → 'q1'
    //   3. input → 'q2'
    //   4. input → '' (finish)
    selectMock.mockResolvedValueOnce('replace');
    inputMock.mockResolvedValueOnce('q1');
    inputMock.mockResolvedValueOnce('q2');
    inputMock.mockResolvedValueOnce('');

    const result = await defaultInquirerPrompts.askSearchQueries(EXISTING);

    expect(result).toEqual(['q1', 'q2']);
  });
});

describe('defaultInquirerPrompts.askLocationURLs — keep/add/replace', () => {
  const EXISTING = [
    { name: 'Rotterdam', geoId: '100467493' },
    { name: 'Amsterdam', geoId: '101889610' },
  ];

  it('returns existing when the user selects Keep', async () => {
    const selectMock = vi.mocked(inquirer.select);
    selectMock.mockReset();
    selectMock.mockResolvedValueOnce('keep');

    const result = await defaultInquirerPrompts.askLocationURLs(EXISTING);

    expect(result).toEqual([
      { name: 'Rotterdam', geoId: '100467493', originalUrl: '' },
      { name: 'Amsterdam', geoId: '101889610', originalUrl: '' },
    ]);
  });

  it('appends new locations when the user selects Add', async () => {
    const selectMock = vi.mocked(inquirer.select);
    const inputMock = vi.mocked(inquirer.input);
    const confirmMock = vi.mocked(inquirer.confirm);
    selectMock.mockReset();
    inputMock.mockReset();
    confirmMock.mockReset();
    // Sequence:
    //   1. select → 'add' (existing is seeded into the dedup map)
    //   2. input → new URL (different geoId, not in existing)
    //   3. input → label "Utrecht"
    //   4. input → '' (empty, finish)
    selectMock.mockResolvedValueOnce('add');
    inputMock.mockResolvedValueOnce('https://www.linkedin.com/jobs/search/?geoId=999999999');
    inputMock.mockResolvedValueOnce('Utrecht');
    inputMock.mockResolvedValueOnce('');

    const result = await defaultInquirerPrompts.askLocationURLs(EXISTING);

    expect(result).toEqual([
      { name: 'Rotterdam', geoId: '100467493', originalUrl: '' },
      { name: 'Amsterdam', geoId: '101889610', originalUrl: '' },
      { name: 'Utrecht', geoId: '999999999', originalUrl: 'https://www.linkedin.com/jobs/search/?geoId=999999999' },
    ]);
  });

  it('returns just new locations (no existing) when the user selects Replace', async () => {
    const selectMock = vi.mocked(inquirer.select);
    const inputMock = vi.mocked(inquirer.input);
    selectMock.mockReset();
    inputMock.mockReset();
    // Sequence:
    //   1. select → 'replace' (existing is NOT seeded)
    //   2. input → new URL
    //   3. input → label "Berlin"
    //   4. input → '' (empty, finish)
    selectMock.mockResolvedValueOnce('replace');
    inputMock.mockResolvedValueOnce('https://www.linkedin.com/jobs/search/?geoId=12345');
    inputMock.mockResolvedValueOnce('Berlin');
    inputMock.mockResolvedValueOnce('');

    const result = await defaultInquirerPrompts.askLocationURLs(EXISTING);

    expect(result).toEqual([
      { name: 'Berlin', geoId: '12345', originalUrl: 'https://www.linkedin.com/jobs/search/?geoId=12345' },
    ]);
  });
});

describe('defaultInquirerPrompts.askLocationURLs — rename flow', () => {
  const url = 'https://www.linkedin.com/jobs/search/?geoId=100467493';

  it('accepts rename: duplicate geoId, accepted rename → label becomes new value', async () => {
    const inputMock = vi.mocked(inquirer.input);
    const confirmMock = vi.mocked(inquirer.confirm);
    inputMock.mockReset();
    confirmMock.mockReset();
    // Sequence:
    //   1. URL prompt → url
    //   2. Label prompt → "A"
    //   3. URL prompt → url (duplicate geoId)
    //   4. confirm(rename) → true
    //   5. Label prompt → "Renamed"
    //   6. URL prompt → "" (empty, finish)
    inputMock.mockResolvedValueOnce(url);
    inputMock.mockResolvedValueOnce('A');
    inputMock.mockResolvedValueOnce(url);
    confirmMock.mockResolvedValueOnce(true);
    inputMock.mockResolvedValueOnce('Renamed');
    inputMock.mockResolvedValueOnce('');

    const result = await defaultInquirerPrompts.askLocationURLs([]);

    expect(result).toEqual([{ name: 'Renamed', geoId: '100467493', originalUrl: url }]);
  });

  it('declines rename: duplicate geoId, declined rename → first label preserved', async () => {
    const inputMock = vi.mocked(inquirer.input);
    const confirmMock = vi.mocked(inquirer.confirm);
    inputMock.mockReset();
    confirmMock.mockReset();
    // Sequence:
    //   1. URL prompt → url
    //   2. Label prompt → "A"
    //   3. URL prompt → url (duplicate geoId)
    //   4. confirm(rename) → false
    //   5. URL prompt → "" (empty, finish)
    inputMock.mockResolvedValueOnce(url);
    inputMock.mockResolvedValueOnce('A');
    inputMock.mockResolvedValueOnce(url);
    confirmMock.mockResolvedValueOnce(false);
    inputMock.mockResolvedValueOnce('');

    const result = await defaultInquirerPrompts.askLocationURLs([]);

    expect(result).toEqual([{ name: 'A', geoId: '100467493', originalUrl: url }]);
  });

  it('seeds the dedup set from existing locations and skips re-prompting them', async () => {
    const inputMock = vi.mocked(inquirer.input);
    const confirmMock = vi.mocked(inquirer.confirm);
    inputMock.mockReset();
    confirmMock.mockReset();
    // Existing Rotterdam is seeded → no rename prompt expected when the same URL is pasted.
    //   1. URL prompt → url (matches existing geoId)
    //   2. confirm(rename) → false
    //   3. URL prompt → "" (empty, finish)
    inputMock.mockResolvedValueOnce(url);
    confirmMock.mockResolvedValueOnce(false);
    inputMock.mockResolvedValueOnce('');

    const result = await defaultInquirerPrompts.askLocationURLs([
      { name: 'Rotterdam', geoId: '100467493' },
    ]);

    expect(result).toEqual([{ name: 'Rotterdam', geoId: '100467493', originalUrl: '' }]);
  });
});
