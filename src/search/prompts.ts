import { checkbox, confirm, input, select } from '@inquirer/prompts';

import { LinkedInURLParseError } from './errors.js';
import {
  DATE_POSTED_CHOICES,
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  WORKPLACE_TYPE_CHOICES,
  WORKPLACE_TYPE_LABELS,
  type DatePostedSeconds,
  type WorkplaceTypeValue,
} from './labels.js';
import { parseLinkedInJobsSearchURL, type ParsedLinkedInSearchURL } from './url-parser.js';

export interface SearchConfigurationPreview {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { readonly name: string; readonly geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export interface SearchPrompts {
  askSearchQueries(existing: readonly string[]): Promise<readonly string[]>;
  askDatePosted(existing: DatePostedSeconds | null): Promise<DatePostedSeconds>;
  askWorkplaceTypes(existing: readonly WorkplaceTypeValue[]): Promise<readonly WorkplaceTypeValue[]>;
  askLocationURLs(
    existing: readonly { readonly name: string; readonly geoId: string }[],
  ): Promise<readonly { readonly name: string; readonly geoId: string; readonly originalUrl: string }[]>;
  askLocationName(geoId: string): Promise<string>;
  askRenameLabel(geoId: string, existingLabel: string, originalUrl: string): Promise<boolean>;
  showPreview(preview: SearchConfigurationPreview, matrixSize: number): Promise<void>;
  askConfirmation(preview: SearchConfigurationPreview, matrixSize: number): Promise<boolean>;
}

export function createFailingPrompts(reason: string): SearchPrompts {
  const fail = (): Promise<never> => Promise.reject(new Error(reason));
  return {
    askSearchQueries: () => fail(),
    askDatePosted: () => fail(),
    askWorkplaceTypes: () => fail(),
    askLocationURLs: () => fail(),
    askLocationName: () => fail(),
    askRenameLabel: () => fail(),
    showPreview: async () => undefined,
    askConfirmation: () => fail(),
  };
}

function datePostedDefault(existing: DatePostedSeconds | null): DatePostedSeconds | undefined {
  if (existing === null) return undefined;
  return DATE_POSTED_CHOICES.find((c) => c.value === existing)?.value;
}

function workplaceDefault(existing: readonly WorkplaceTypeValue[]): readonly WorkplaceTypeValue[] {
  if (existing.length === 0) return DEFAULT_WORKPLACE_TYPES;
  return existing;
}

function formatLocation(location: { name: string; geoId: string }): string {
  return `${location.name} (${location.geoId})`;
}

function formatPreview(preview: SearchConfigurationPreview, matrixSize: number): string {
  const queries = preview.searchQueries.join(', ');
  const locations = preview.locations.map(formatLocation).join(', ');
  const datePosted =
    DATE_POSTED_CHOICES.find((c) => c.value === preview.datePosted)?.label ??
    String(preview.datePosted);
  const workplaceTypes = preview.workplaceTypes
    .map((v) => WORKPLACE_TYPE_LABELS[v])
    .join(', ');
  return [
    'Search configuration preview:',
    `  Queries: ${queries}`,
    `  Locations: ${locations}`,
    `  Date posted: ${datePosted}`,
    `  Workplace types: ${workplaceTypes}`,
    `  Generated searches: ${matrixSize}`,
  ].join('\n');
}

const LOCATION_URL_PROMPT_MESSAGE =
  'LinkedIn jobs-search URL (geoId will be extracted; empty line to finish):';

const askSearchQueriesImpl: SearchPrompts['askSearchQueries'] = async (existing) => {
  if (existing.length > 0) {
    console.error(`Current queries: ${existing.join(', ')}`);
    const mode = await select<'keep' | 'add' | 'replace'>({
      message: 'Keep current queries, add more, or replace all?',
      choices: [
        { name: 'Keep current queries', value: 'keep' },
        { name: 'Add more queries', value: 'add' },
        { name: 'Replace all queries', value: 'replace' },
      ],
      default: 'keep',
    });
    if (mode === 'keep') return [...existing];
    if (mode === 'add') {
      const lines = [...existing];
      const first = await input({ message: 'Search query (empty line to keep current):' });
      const trimmed = first.trim();
      if (trimmed === '') return lines;
      lines.push(trimmed);
      while (true) {
        const next = await input({ message: 'Search query (empty line to finish):' });
        const t = next.trim();
        if (t === '') break;
        lines.push(t);
      }
      return lines;
    }
    // mode === 'replace': fall through to the at-least-one prompt loop.
  }
  const lines: string[] = [];
  while (lines.length === 0) {
    const first = await input({ message: 'Search query (one per line; empty line to finish):' });
    const trimmed = first.trim();
    if (trimmed === '') continue;
    lines.push(trimmed);
    while (true) {
      const next = await input({
        message: 'Search query (empty line to finish):',
      });
      const t = next.trim();
      if (t === '') break;
      lines.push(t);
    }
  }
  return lines;
};

const askRenameLabelImpl: SearchPrompts['askRenameLabel'] = async (geoId, existingLabel) => {
  return confirm({
    message: `geoId ${geoId} already exists as "${existingLabel}". Rename the label?`,
    default: false,
  });
};

const askLocationNameImpl: SearchPrompts['askLocationName'] = async (geoId) => {
  while (true) {
    const name = await input({
      message: `Human-readable label for geoId ${geoId}:`,
    });
    const trimmed = name.trim();
    if (trimmed !== '') return trimmed;
    console.error('Location name must not be empty.');
  }
};

const askLocationURLsImpl: SearchPrompts['askLocationURLs'] = async (existing) => {
  if (existing.length > 0) {
    console.error(`Current locations: ${existing.map((l) => `${l.name} (${l.geoId})`).join(', ')}`);
    const mode = await select<'keep' | 'add' | 'replace'>({
      message: 'Keep current locations, add more, or replace all?',
      choices: [
        { name: 'Keep current locations', value: 'keep' },
        { name: 'Add more locations', value: 'add' },
        { name: 'Replace all locations', value: 'replace' },
      ],
      default: 'keep',
    });
    if (mode === 'keep') {
      return existing.map((l) => ({ name: l.name, geoId: l.geoId, originalUrl: '' }));
    }
    if (mode === 'replace') {
      existing = [];
    }
    // mode === 'add': seed the dedup set from existing.
  }
  const map = new Map<string, { name: string; originalUrl: string }>();
  for (const loc of existing) {
    map.set(loc.geoId, { name: loc.name, originalUrl: '' });
  }
  while (true) {
    const raw = await input({ message: LOCATION_URL_PROMPT_MESSAGE });
    const trimmed = raw.trim();
    if (trimmed === '') break;
    let parsed: ParsedLinkedInSearchURL;
    try {
      parsed = parseLinkedInJobsSearchURL(trimmed);
    } catch (error) {
      if (error instanceof LinkedInURLParseError) {
        console.error(`${error.message}`);
        continue;
      }
      throw error;
    }
    const previous = map.get(parsed.geoId);
    if (previous !== undefined) {
      const rename = await askRenameLabelImpl(parsed.geoId, previous.name, trimmed);
      if (!rename) continue;
    }
    const name = await askLocationNameImpl(parsed.geoId);
    map.set(parsed.geoId, { name, originalUrl: trimmed });
  }
  return Array.from(map, ([geoId, value]) => ({
    name: value.name,
    geoId,
    originalUrl: value.originalUrl,
  }));
};

export const defaultInquirerPrompts: SearchPrompts = {
  askSearchQueries: askSearchQueriesImpl,

  async askDatePosted(existing) {
    const def = datePostedDefault(existing);
    const value = await select<DatePostedSeconds>({
      message: 'Date posted:',
      choices: DATE_POSTED_CHOICES.map((c) => ({ name: c.label, value: c.value })),
      default: def ?? DEFAULT_DATE_POSTED,
    });
    return value;
  },

  async askWorkplaceTypes(existing) {
    const initialSet = new Set<WorkplaceTypeValue>(workplaceDefault(existing));
    while (true) {
      const selected = await checkbox<WorkplaceTypeValue>({
        message: 'Workplace types (select at least one):',
        choices: WORKPLACE_TYPE_CHOICES.map((c) => ({
          name: c.label,
          value: c.value,
          checked: initialSet.has(c.value),
        })),
      });
      if (selected.length > 0) return selected;
      console.error('At least one workplace type is required.');
    }
  },

  askLocationURLs: askLocationURLsImpl,
  askLocationName: askLocationNameImpl,
  askRenameLabel: askRenameLabelImpl,

  async showPreview(preview, matrixSize) {
    console.error(formatPreview(preview, matrixSize));
  },

  async askConfirmation(_preview, _matrixSize) {
    return confirm({ message: 'Write this configuration to disk?', default: true });
  },
};
