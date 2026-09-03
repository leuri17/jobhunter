import { describe, expect, it } from 'vitest';

import { createFailingPrompts, type SearchPrompts } from '../../src/search/prompts.js';

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
