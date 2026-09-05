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

const openaiSchema = z
  .object({
    profileExtraction: profileExtractionSchema,
    jobScoring: jobScoringSchema,
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
    filePath: z.string().min(1).optional(),
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
    openai: openaiSchema,
    scraper: scraperSchema,
    output: outputSchema,
    logging: loggingSchema,
    diagnostics: diagnosticsSchema,
  })
  .strict();

export type OperationalConfig = z.infer<typeof OperationalConfigSchema>;

export const DEFAULT_OPERATIONAL_CONFIG: OperationalConfig = {
  version: 1,
  search: {
    searchQueries: [],
    locations: [],
    datePosted: 86400,
    workplaceTypes: ['1', '2', '3'],
  },
  openai: {
    profileExtraction: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    },
    jobScoring: {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      concurrency: 3,
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
