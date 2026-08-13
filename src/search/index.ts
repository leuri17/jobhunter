export { SearchConfigError, LinkedInURLParseError, SearchCancelledError } from './errors.js';

export {
  DATE_POSTED_CHOICES,
  DATE_POSTED_F_TPR,
  DATE_POSTED_VALUES,
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  DatePostedSecondsSchema,
  WORKPLACE_TYPE_CHOICES,
  WORKPLACE_TYPE_LABELS,
  WORKPLACE_TYPE_VALUES,
  WorkplaceTypeSchema,
  type DatePostedSeconds,
  type LabeledChoice,
  type WorkplaceTypeValue,
} from './labels.js';

export { dedupeQueries, isNonEmptyQuery, normalizeQueries, normalizeQuery } from './queries.js';

export {
  dedupeLocationsByGeoId,
  isValidLocation,
  normalizeLocationName,
  normalizeLocations,
  type RawLocationInput,
} from './locations.js';

export { parseLinkedInJobsSearchURL, type ParsedLinkedInSearchURL } from './url-parser.js';

export {
  buildLinkedInSearchParamMap,
  buildLinkedInSearchURL,
  LINKEDIN_JOBS_SEARCH_BASE,
  type LinkedInSearchURLInput,
} from './url-builder.js';

export {
  countSearches,
  generateSearchMatrix,
  matrixEntryToSearchExecutionInsert,
  type GenerateMatrixInput,
  type SearchMatrixEntry,
} from './matrix.js';

export {
  ConfigureSearchService,
  normalizePersistedSearchConfig,
  runConfigureSearch,
  type ConfigureSearchServiceOptions,
  type SearchConfiguration,
} from './service.js';

export {
  createFailingPrompts,
  defaultInquirerPrompts,
  type SearchConfigurationPreview,
  type SearchPrompts,
} from './prompts.js';
