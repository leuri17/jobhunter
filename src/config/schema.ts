import { z } from 'zod';

import type { LabeledChoice } from './labels.js';

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

/**
 * Well-known OpenAI-compatible providers (#357). Hand-curated on
 * purpose: community catalogs exist but none is canonical or
 * trustworthily maintained, so the shortlist stays small, reviewable,
 * and cheap to extend. `custom` carries no endpoint — the user
 * supplies `aiProvider.baseUrl` for it.
 */
export const AI_PROVIDER_IDS = [
  'openrouter',
  'openai',
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'xai',
  'custom',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type KnownAiProviderId = Exclude<AiProviderId, 'custom'>;

export const AI_PROVIDER_ENDPOINTS: Readonly<Record<KnownAiProviderId, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  xai: 'https://api.x.ai/v1',
};

export const AiProviderIdSchema = z.enum(AI_PROVIDER_IDS);

export const AI_PROVIDER_CHOICES: readonly LabeledChoice<AiProviderId>[] = [
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Groq', value: 'groq' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Mistral AI', value: 'mistral' },
  { label: 'Together AI', value: 'together' },
  { label: 'Fireworks AI', value: 'fireworks' },
  { label: 'xAI', value: 'xai' },
  { label: 'Custom…', value: 'custom' },
];

/** Resolve the endpoint a config's `aiProvider` section points at. */
export function resolveAiProviderBaseUrl(aiProvider: OperationalConfig['aiProvider']): string {
  if (aiProvider.provider !== 'custom') {
    return AI_PROVIDER_ENDPOINTS[aiProvider.provider];
  }
  if (aiProvider.baseUrl === undefined) {
    throw new Error('aiProvider.provider "custom" requires aiProvider.baseUrl');
  }
  return aiProvider.baseUrl;
}

function inferProviderFromBaseUrl(baseUrl: string): AiProviderId {
  for (const [id, endpoint] of Object.entries(AI_PROVIDER_ENDPOINTS)) {
    if (baseUrl === endpoint) return id as KnownAiProviderId;
  }
  return 'custom';
}

const aiProviderObjectSchema = z
  .object({
    /**
     * Which OpenAI-compatible service the SDK talks to. Known ids
     * derive their base URL from `AI_PROVIDER_ENDPOINTS`; `custom`
     * is the escape hatch carrying an explicit `baseUrl`.
     */
    provider: AiProviderIdSchema,
    /** Required iff `provider` is 'custom'. */
    baseUrl: z.url().optional(),
    profileExtraction: profileExtractionSchema,
    jobScoring: jobScoringSchema,
    refusalDetection: refusalDetectionSchema,
  })
  .strict();

const aiProviderSchema = aiProviderObjectSchema.superRefine((ai, ctx) => {
  if (ai.provider === 'custom' && ai.baseUrl === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['baseUrl'],
      message: 'baseUrl is required when provider is "custom"',
    });
  }
  if (ai.provider !== 'custom' && ai.baseUrl !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['baseUrl'],
      message: 'baseUrl is only allowed when provider is "custom"',
    });
  }
});

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
 *   files written before the provider-generic rename;
 * - derives `aiProvider.provider` for files written before the
 *   provider select (#357): a known `baseUrl` maps to its provider
 *   and is dropped, an unknown one keeps the URL as `custom`, and
 *   files with neither were de-facto OpenAI;
 * - strips the removed `output.jobsListDefaultLimit` for config files
 *   written before the setting was removed (#341) — the next config
 *   write drops the key from disk.
 * The output shape is identical to the canonical schema; only the
 * input side tolerates older files. Everything downstream of loading
 * (patches, Settings validation) uses the strict canonical schema.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLegacyAiProvider(raw: Record<string, unknown>): Record<string, unknown> {
  const { provider, baseUrl, ...rest } = raw;
  if (provider === undefined) {
    if (typeof baseUrl === 'string') {
      const inferred = inferProviderFromBaseUrl(baseUrl);
      return inferred === 'custom'
        ? { ...rest, provider: inferred, baseUrl }
        : { ...rest, provider: inferred };
    }
    return { ...rest, provider: 'openai' };
  }
  if (provider !== 'custom' && baseUrl !== undefined) {
    return { ...rest, provider };
  }
  return raw;
}

export const OperationalConfigFileSchema: z.ZodType<OperationalConfig> = z.preprocess(
  (raw) => {
    if (isPlainRecord(raw)) {
      const record: Record<string, unknown> = raw;

      let next = record;
      if (next['aiProvider'] === undefined && next['openai'] !== undefined) {
        const { openai: legacyOpenAi, ...rest } = next;
        next = { ...rest, aiProvider: legacyOpenAi };
      }

      if (isPlainRecord(next['aiProvider'])) {
        next = { ...next, aiProvider: normalizeLegacyAiProvider(next['aiProvider']) };
      }

      const output = next['output'];
      if (isPlainRecord(output) && 'jobsListDefaultLimit' in output) {
        const { jobsListDefaultLimit: _removed, ...legacyOutput } = output;
        next = { ...next, output: legacyOutput };
      }

      return next;
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
    provider: 'openrouter',
    profileExtraction: {
      model: 'openai/gpt-5.6-sol',
      reasoningEffort: 'medium',
    },
    jobScoring: {
      model: 'openai/gpt-5.6-sol',
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
