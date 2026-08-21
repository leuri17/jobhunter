/**
 * Zod schemas for the `--json` output of every inspection command
 * (SPEC §36 + §37).
 *
 * The schemas are the source of truth for the JSON contract — the
 * producer (services + CLI handler) trusts the service output, but
 * consumers + tests run `safeParse` against the schema to catch
 * regressions. Every payload carries a `schemaVersion: 1` first key
 * so consumers can branch on version without parsing the whole
 * document.
 *
 * All ISO 8601 timestamps use `z.string().datetime({ offset: true })`
 * so the runtime check rejects non-ISO 8601 strings. The format is
 * what SQLite stores (UTC ISO 8601 without offset) and what the
 * services serialize.
 */

import { z } from 'zod';

import {
  type JobListResult,
  type JobShowPayload,
  type PipelineRunSearchExecutionRow,
  type RunListRow,
  type RunShowPayload,
} from './state.js';

/** The literal schema version (SPEC §36). Mirrors `INSPECTION_SCHEMA_VERSION`. */
const SCHEMA_VERSION = z.literal(1);

/** ISO 8601 timestamp string. Accepts both UTC (`Z`) and offset suffixes. */
const iso8601 = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Per-state `JobListRow` variants
// ---------------------------------------------------------------------------

const JobListRowAllSchema = z
  .object({
    state: z.literal('all'),
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    extraction: z.union([z.literal('complete'), z.literal('partial'), z.literal('failed')]),
    filter: z.union([
      z.literal('accepted'),
      z.literal('rejected'),
      z.literal('error'),
      z.literal('—'),
    ]),
    scoreStatus: z.union([
      z.literal('complete'),
      z.literal('reused'),
      z.literal('failed'),
      z.literal('skipped'),
      z.literal('cancelled'),
      z.literal('—'),
    ]),
    score: z.string(),
    title: z.string(),
    company: z.string(),
    location: z.string(),
    firstDiscoveredAt: iso8601,
  })
  .strict();

const JobListRowScoredSchema = z
  .object({
    state: z.literal('scored'),
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    overallScore: z.number(),
    displayScore: z.string(),
    firstDiscoveredAt: iso8601,
  })
  .strict();

const JobListRowAcceptedSchema = z
  .object({
    state: z.literal('accepted'),
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    scoreStatus: z.union([
      z.literal('complete'),
      z.literal('reused'),
      z.literal('failed'),
      z.literal('skipped'),
      z.literal('cancelled'),
      z.literal('—'),
    ]),
    filteredAt: iso8601,
  })
  .strict();

const JobListRowRejectedSchema = z
  .object({
    state: z.literal('rejected'),
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    scoreStatus: z.union([
      z.literal('complete'),
      z.literal('reused'),
      z.literal('failed'),
      z.literal('skipped'),
      z.literal('cancelled'),
      z.literal('—'),
    ]),
    rejectionReason: z.string(),
    filteredAt: iso8601,
  })
  .strict();

const JobListRowUnscoredSchema = z
  .object({
    state: z.literal('unscored'),
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    scoringStatus: z.union([
      z.literal('pending'),
      z.literal('failed'),
      z.literal('cancelled'),
      z.literal('skipped'),
    ]),
    lastAttemptAt: iso8601.nullable(),
  })
  .strict();

const JobListRowPartialSchema = z
  .object({
    state: z.literal('partial'),
    id: z.string(),
    internalId: z.number().int(),
    linkedinJobId: z.string(),
    availableTitle: z.string(),
    missingFields: z.array(z.string()),
    errorCode: z.string(),
    discoveredAt: iso8601,
  })
  .strict();

const JobListRowFailedSchema = z
  .object({
    state: z.literal('failed'),
    errorId: z.number().int(),
    searchQuery: z.string(),
    locationName: z.string(),
    cardIndex: z.number().int().nullable(),
    errorCode: z.string(),
    diagnosticMessage: z.string(),
    discoveredAt: iso8601,
  })
  .strict();

const JobListRowFilterErrorsSchema = z
  .object({
    state: z.literal('filter-errors'),
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    errorCode: z.string(),
    lastAttemptAt: iso8601,
  })
  .strict();

const JobListRowScoringErrorsSchema = z
  .object({
    state: z.literal('scoring-errors'),
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    errorCode: z.string(),
    attempts: z.number().int(),
    lastAttemptAt: iso8601,
  })
  .strict();

export const JobListRowJsonSchema = z.discriminatedUnion('state', [
  JobListRowAllSchema,
  JobListRowScoredSchema,
  JobListRowAcceptedSchema,
  JobListRowRejectedSchema,
  JobListRowUnscoredSchema,
  JobListRowPartialSchema,
  JobListRowFailedSchema,
  JobListRowFilterErrorsSchema,
  JobListRowScoringErrorsSchema,
]);

// ---------------------------------------------------------------------------
// `jobs list` envelope
// ---------------------------------------------------------------------------

const JobListFiltersSchema = z
  .object({
    minimumScore: z.number().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    runId: z.number().int().nullable(),
  })
  .strict();

export const JobListJsonSchema = z
  .object({
    schemaVersion: SCHEMA_VERSION,
    state: z.union([
      z.literal('all'),
      z.literal('scored'),
      z.literal('accepted'),
      z.literal('rejected'),
      z.literal('unscored'),
      z.literal('partial'),
      z.literal('failed'),
      z.literal('filter-errors'),
      z.literal('scoring-errors'),
    ]),
    filters: JobListFiltersSchema,
    limit: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    jobs: z.array(JobListRowJsonSchema),
  })
  .strict();

export type JobListJsonPayload = z.infer<typeof JobListJsonSchema>;

// ---------------------------------------------------------------------------
// `jobs show` payload
// ---------------------------------------------------------------------------

const JobShowCurrentFilterSchema = z
  .object({
    outcome: z.union([z.literal('accepted'), z.literal('rejected'), z.literal('error'), z.null()]),
    fingerprint: z.string().nullable(),
    rejectionReasons: z.array(z.string()),
    filteredAt: iso8601.nullable(),
    hasHistory: z.boolean(),
  })
  .strict();

const JobShowCategoryScoreSchema = z
  .object({
    category: z.string(),
    score: z.number().int().min(0).max(100),
    explanation: z.string(),
  })
  .strict();

const JobShowCurrentScoreSchema = z
  .object({
    overallScore: z.number().nullable(),
    displayScore: z.string().nullable(),
    categoryScores: z.array(JobShowCategoryScoreSchema),
    explanation: z.string().nullable(),
    matches: z.array(z.string()),
    gaps: z.array(z.string()),
    concerns: z.array(z.string()),
    inferredSeniority: z.string().nullable(),
    recommendationSummary: z.string().nullable(),
    timestamp: iso8601.nullable(),
    hasHistory: z.boolean(),
  })
  .strict();

const JobShowTimestampsSchema = z
  .object({
    firstDiscoveredAt: iso8601,
    lastRediscoveryAt: iso8601,
    lastExtractionAttemptAt: iso8601.nullable(),
    createdAt: iso8601,
    updatedAt: iso8601,
  })
  .strict();

const JobShowDiscoveryEntrySchema = z
  .object({
    runId: z.number().int(),
    searchExecutionId: z.number().int(),
    timestamp: iso8601,
    isNew: z.boolean(),
  })
  .strict();

export const JobShowJsonSchema = z
  .object({
    schemaVersion: SCHEMA_VERSION,
    id: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    linkedinUrl: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    description: z.string().nullable(),
    extractionStatus: z.union([z.literal('complete'), z.literal('partial'), z.literal('failed')]),
    successfulMethod: z.union([
      z.literal('search_detail_panel'),
      z.literal('dedicated_job_page'),
      z.null(),
    ]),
    discoveryHistory: z.array(JobShowDiscoveryEntrySchema),
    currentFilter: JobShowCurrentFilterSchema,
    currentScore: JobShowCurrentScoreSchema,
    timestamps: JobShowTimestampsSchema,
  })
  .strict();

export type JobShowJsonPayload = z.infer<typeof JobShowJsonSchema>;

// ---------------------------------------------------------------------------
// `runs list` / `runs show`
// ---------------------------------------------------------------------------

export const RunListRowJsonSchema = z
  .object({
    id: z.string(),
    internalId: z.number().int(),
    startTimestamp: iso8601,
    endTimestamp: iso8601.nullable(),
    status: z.union([
      z.literal('running'),
      z.literal('cancelling'),
      z.literal('completed'),
      z.literal('completed_with_errors'),
      z.literal('failed'),
      z.literal('cancelled'),
    ]),
    searchesAttempted: z.number().int().nonnegative(),
    jobsDiscovered: z.number().int().nonnegative(),
    jobsScored: z.number().int().nonnegative(),
    errorSummary: z.string(),
  })
  .strict();

export const RunListJsonSchema = z
  .object({
    schemaVersion: SCHEMA_VERSION,
    limit: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    runs: z.array(RunListRowJsonSchema),
  })
  .strict();

export type RunListJsonPayload = z.infer<typeof RunListJsonSchema>;

const PipelineRunSearchExecutionJsonSchema: z.ZodType<PipelineRunSearchExecutionRow> = z
  .object({
    id: z.number().int(),
    pipelineRunId: z.number().int(),
    searchQuery: z.string(),
    locationName: z.string(),
    geoId: z.string(),
    generatedUrl: z.string(),
    startTimestamp: iso8601,
    endTimestamp: iso8601.nullable(),
    finalStatus: z.union([
      z.literal('pending'),
      z.literal('running'),
      z.literal('completed'),
      z.literal('failed'),
      z.literal('cancelled'),
    ]),
    jobsDiscovered: z.number().int().nonnegative(),
    newJobs: z.number().int().nonnegative(),
    existingJobs: z.number().int().nonnegative(),
  })
  .strict();

const RunShowConfigurationSchema = z
  .object({
    snapshotJson: z.unknown(),
    schemaVersion: z.number().int(),
    hash: z.string(),
    applicationVersion: z.string(),
  })
  .strict();

const RunShowJobCountsSchema = z
  .object({
    complete: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

const RunShowFilterCountsSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  })
  .strict();

const RunShowScoreCountsSchema = z
  .object({
    scored: z.number().int().nonnegative(),
    reused: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  })
  .strict();

const RunShowReusedSchema = z
  .object({
    jobsReused: z.number().int().nonnegative(),
  })
  .strict();

const RunShowErrorsSchema = z
  .object({
    searchErrors: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    extractionFailures: z.number().int().nonnegative(),
    filterErrors: z.number().int().nonnegative(),
    scoringErrors: z.number().int().nonnegative(),
  })
  .strict();

const RunShowCancellationSchema = z
  .object({
    isCancelled: z.boolean(),
    reason: z.string().nullable(),
  })
  .strict();

const RunShowDiagnosticReferenceSchema = z
  .object({
    id: z.number().int(),
    artifactType: z.string(),
    relativePath: z.string(),
    createdAt: iso8601,
  })
  .strict();

export const RunShowJsonSchema = z
  .object({
    schemaVersion: SCHEMA_VERSION,
    id: z.string(),
    internalId: z.number().int(),
    status: z.union([
      z.literal('running'),
      z.literal('cancelling'),
      z.literal('completed'),
      z.literal('completed_with_errors'),
      z.literal('failed'),
      z.literal('cancelled'),
    ]),
    startTimestamp: iso8601,
    endTimestamp: iso8601.nullable(),
    configuration: RunShowConfigurationSchema,
    profileVersionId: z.number().int().nullable(),
    filterConfigVersionId: z.number().int().nullable(),
    searchExecutions: z.array(PipelineRunSearchExecutionJsonSchema),
    jobCounts: RunShowJobCountsSchema,
    filterCounts: RunShowFilterCountsSchema,
    scoreCounts: RunShowScoreCountsSchema,
    reusedResults: RunShowReusedSchema,
    errors: RunShowErrorsSchema,
    cancellationState: RunShowCancellationSchema,
    diagnosticReferences: z.array(RunShowDiagnosticReferenceSchema),
  })
  .strict();

export type RunShowJsonPayload = z.infer<typeof RunShowJsonSchema>;

// ---------------------------------------------------------------------------
// `paths --json`
// ---------------------------------------------------------------------------

const PathsJsonSchema = z
  .object({
    schemaVersion: SCHEMA_VERSION,
    paths: z
      .object({
        config: z.string(),
        data: z.string(),
        logs: z.string(),
        diagnostics: z.string(),
        cache: z.string(),
        profileSources: z.string(),
      })
      .strict(),
  })
  .strict();

export { PathsJsonSchema };
export type PathsJsonPayload = z.infer<typeof PathsJsonSchema>;

// ---------------------------------------------------------------------------
// Aggregate schemas for tests + the re-exports
// ---------------------------------------------------------------------------

/**
 * Re-export of the `JobListResult` row shape consumed by the
 * service layer. The schema validators do NOT enforce it; this is
 * here for documentation + the test harness only.
 */
export type JobListResultShape = JobListResult;
export type JobShowPayloadShape = JobShowPayload;
export type RunListRowShape = RunListRow;
export type RunShowPayloadShape = RunShowPayload;
