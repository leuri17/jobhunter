import { z } from 'zod';

const positiveInt = z.number().int().positive();

const datePostedSchema = z.union([z.literal(86400), z.literal(604800), z.literal(2592000)]);

const locationSchema = z
  .object({
    name: z.string().min(1),
    geoId: z.string().min(1),
  })
  .strict();

const workplaceTypeSchema = z.enum(['1', '2', '3']);

const searchSchema = z
  .object({
    searchQueries: z.array(z.string().min(1)),
    locations: z.array(locationSchema),
    datePosted: datePostedSchema,
    workplaceTypes: z.array(workplaceTypeSchema),
  })
  .strict();

const reasoningEffortSchema = z.enum(['low', 'medium', 'high']);

const profileExtractionSchema = z
  .object({
    model: z.string().min(1),
    reasoningEffort: reasoningEffortSchema,
  })
  .strict();

const jobScoringSchema = z
  .object({
    model: z.string().min(1),
    reasoningEffort: reasoningEffortSchema,
    concurrency: positiveInt,
  })
  .strict();

/**
 * Substrings the model output is scanned for to flag a content-
 * policy refusal / empty body. Audit B2-M8. Defaults to the
 * module-level `DEFAULT_REFUSAL_MARKERS`; override via
 * `refusalMarkers` when a model variant emits a distinctive refusal
 * phrase the defaults miss.
 */
const refusalDetectionSchema = z
  .object({
    refusalMarkers: z.array(z.string().min(1)),
    flagEmptyBodies: z.boolean(),
  })
  .strict();

const aiProviderSchema = z
  .object({
    profileExtraction: profileExtractionSchema,
    jobScoring: jobScoringSchema,
    refusalDetection: refusalDetectionSchema,
  })
  .strict();

const timeoutsSchema = z
  .object({
    navigationMs: positiveInt,
    initialResultsMs: positiveInt,
    detailPanelMs: positiveInt,
    dedicatedPageMs: positiveInt,
    overlayDismissalMs: positiveInt,
  })
  .strict();

const scraperSchema = z
  .object({
    timeouts: timeoutsSchema,
    maxNoProgressAttempts: positiveInt,
    headless: z.boolean(),
  })
  .strict();

const outputSchema = z
  .object({
    runTopN: positiveInt,
    jobsListDefaultLimit: positiveInt,
  })
  .strict();

const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

const loggingSchema = z
  .object({
    level: logLevelSchema,
    prettyTerminal: z.boolean(),
  })
  .strict();

const diagnosticsSchema = z
  .object({
    onScraperError: z
      .object({
        screenshot: z.boolean(),
        currentUrl: z.boolean(),
        stackTrace: z.boolean(),
        playwrightTrace: z.boolean(),
        htmlSnapshot: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const OperationalConfigSchema = z
  .object({
    version: z.literal(1),
    search: searchSchema,
    aiProvider: aiProviderSchema,
    scraper: scraperSchema,
    output: outputSchema,
    logging: loggingSchema,
    diagnostics: diagnosticsSchema,
  })
  .strict();

export type OperationalConfig = z.infer<typeof OperationalConfigSchema>;

/**
 * Load-time variant of `OperationalConfigSchema`:
 * - fills `scraper.headless` for config files written before the key
 *   existed (#338 pattern);
 * - renames the legacy `openai` section to `aiProvider` for config
 *   files written before the provider-generic rename.
 * The output shape is identical to the canonical schema; only the
 * input side tolerates older files. Everything downstream of loading
 * (patches, Settings validation) uses the strict canonical schema.
 */
export const OperationalConfigFileSchema: z.ZodType<OperationalConfig> = z.preprocess(
  (raw) => {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      if (record['aiProvider'] === undefined && record['openai'] !== undefined) {
        const { openai: legacyOpenAi, ...rest } = record;
        return { ...rest, aiProvider: legacyOpenAi };
      }
    }
    return raw;
  },
  OperationalConfigSchema.extend({
    scraper: scraperSchema.extend({ headless: z.boolean().default(true) }),
  }),
);

export const DEFAULT_OPERATIONAL_CONFIG: OperationalConfig = {
  version: 1,
  search: {
    searchQueries: [],
    locations: [],
    datePosted: 86400,
    workplaceTypes: ['1', '2', '3'],
  },
  aiProvider: {
    profileExtraction: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    },
    jobScoring: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      concurrency: 3,
    },
    refusalDetection: {
      refusalMarkers: [
        "I can't",
        'I cannot',
        'as an AI',
        "I'm not able to",
        "I'm unable to",
        "I won't",
        'As a language model',
      ],
      flagEmptyBodies: true,
    },
  },
  scraper: {
    timeouts: {
      navigationMs: 30000,
      initialResultsMs: 20000,
      detailPanelMs: 10000,
      dedicatedPageMs: 20000,
      overlayDismissalMs: 5000,
    },
    maxNoProgressAttempts: 3,
    headless: true,
  },
  output: {
    runTopN: 20,
    jobsListDefaultLimit: 50,
  },
  logging: {
    level: 'info',
    prettyTerminal: true,
  },
  diagnostics: {
    onScraperError: {
      screenshot: true,
      currentUrl: true,
      stackTrace: true,
      playwrightTrace: false,
      htmlSnapshot: false,
    },
  },
};
