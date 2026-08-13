import { dedupeQueries } from './queries.js';
import { dedupeLocationsByGeoId } from './locations.js';
import { SearchCancelledError, SearchConfigError } from './errors.js';
import {
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  WORKPLACE_TYPE_VALUES,
  type DatePostedSeconds,
  type WorkplaceTypeValue,
} from './labels.js';
import type { SearchPrompts, SearchConfigurationPreview } from './prompts.js';
import { generateSearchMatrix } from './matrix.js';

export interface SearchConfiguration {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { readonly name: string; readonly geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export interface ConfigureSearchServiceOptions {
  readonly prompts: SearchPrompts;
  readonly existing?: SearchConfiguration;
  readonly now?: () => Date;
}

function sortWorkplaceTypes(values: readonly WorkplaceTypeValue[]): readonly WorkplaceTypeValue[] {
  const order = new Map<string, number>(WORKPLACE_TYPE_VALUES.map((v, i) => [v, i]));
  return [...values].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function toPreview(config: SearchConfiguration): SearchConfigurationPreview {
  return {
    searchQueries: config.searchQueries,
    locations: config.locations,
    datePosted: config.datePosted,
    workplaceTypes: config.workplaceTypes,
  };
}

export function normalizePersistedSearchConfig(raw: {
  searchQueries: readonly string[];
  locations: readonly { readonly name: string; readonly geoId: string }[];
  datePosted: number;
  workplaceTypes: readonly string[];
}): SearchConfiguration {
  const datePosted: DatePostedSeconds = ([86400, 604800, 2592000] as readonly number[]).includes(
    raw.datePosted,
  )
    ? (raw.datePosted as DatePostedSeconds)
    : DEFAULT_DATE_POSTED;
  const workplace: WorkplaceTypeValue[] = raw.workplaceTypes.filter(
    (v): v is WorkplaceTypeValue => v === '1' || v === '2' || v === '3',
  );
  return {
    searchQueries: dedupeQueries(raw.searchQueries),
    locations: dedupeLocationsByGeoId(raw.locations),
    datePosted,
    workplaceTypes:
      workplace.length === 0 ? DEFAULT_WORKPLACE_TYPES : sortWorkplaceTypes(workplace),
  };
}

export class ConfigureSearchService {
  private readonly prompts: SearchPrompts;
  private readonly existing: SearchConfiguration | undefined;
  private readonly now: () => Date;

  constructor(options: ConfigureSearchServiceOptions) {
    this.prompts = options.prompts;
    this.existing = options.existing;
    this.now = options.now ?? ((): Date => new Date());
  }

  async run(): Promise<SearchConfiguration> {
    const ex = this.existing;
    const rawQueries = await this.prompts.askSearchQueries(ex?.searchQueries ?? []);
    const queries = dedupeQueries(rawQueries);
    if (queries.length === 0) {
      throw new SearchConfigError('empty_queries', 'At least one search query is required.', {
        receivedCount: rawQueries.length,
      });
    }

    const rawWorkplaceTypes = await this.prompts.askWorkplaceTypes(ex?.workplaceTypes ?? []);
    const workplaceTypes = sortWorkplaceTypes(rawWorkplaceTypes);
    if (workplaceTypes.length === 0) {
      throw new SearchConfigError(
        'empty_workplace_types',
        'At least one workplace type is required.',
      );
    }

    const datePosted = await this.prompts.askDatePosted(ex?.datePosted ?? null);

    const locationInputs = await this.prompts.askLocationURLs(ex?.locations ?? []);
    if (locationInputs.length === 0) {
      throw new SearchConfigError('empty_locations', 'At least one location URL is required.');
    }
    const locations = dedupeLocationsByGeoId(locationInputs);
    if (locations.length === 0) {
      throw new SearchConfigError('empty_locations', 'At least one valid location is required.');
    }

    const configuration: SearchConfiguration = {
      searchQueries: queries,
      locations,
      datePosted,
      workplaceTypes,
    };

    const preview = toPreview(configuration);
    const matrixSize = generateSearchMatrix({
      searchQueries: queries,
      locations,
      datePosted,
      workplaceTypes,
      startTimestamp: this.now().toISOString(),
    }).length;
    await this.prompts.showPreview(preview, matrixSize);

    const confirmed = await this.prompts.askConfirmation(preview, matrixSize);
    if (!confirmed) {
      throw new SearchCancelledError(
        'update_cancelled',
        'Search configuration update was declined by the user.',
        { matrixSize },
      );
    }

    return configuration;
  }
}

export function runConfigureSearch(
  options: ConfigureSearchServiceOptions,
): Promise<SearchConfiguration> {
  return new ConfigureSearchService(options).run();
}
