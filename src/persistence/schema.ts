import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// 1. application_metadata ----------------------------------------------------
// Stores singleton key/value rows (e.g. current schema version, install timestamp).
export const applicationMetadata = sqliteTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 2. profile_sources ---------------------------------------------------------
// Immutable copy of every imported CV file. Deduplication uses sha256.
export const profileSources = sqliteTable(
  'profile_sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceType: text('source_type', { enum: ['pdf', 'markdown', 'plain_text'] }).notNull(),
    originalFilename: text('original_filename').notNull(),
    originalAbsolutePath: text('original_absolute_path').notNull(),
    storedPath: text('stored_path').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    sha256: text('sha256').notNull(),
    importTimestamp: text('import_timestamp').notNull(),
    extractedTextHash: text('extracted_text_hash'),
    textExtractionStatus: text('text_extraction_status', {
      enum: ['pending', 'success', 'failed'],
    }).notNull(),
    textExtractionMessage: text('text_extraction_message'),
  },
  (t) => ({
    sha256Unique: uniqueIndex('profile_sources_sha256_idx').on(t.sha256),
  }),
);

// 3. profile_versions -------------------------------------------------------
// One row per profile draft, approved version, or historical snapshot.
// `active` is a logical flag for the single currently-approved profile.
export const profileVersions = sqliteTable(
  'profile_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    status: text('status', {
      enum: ['draft', 'approved', 'rejected', 'superseded'],
    }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
    contentHash: text('content_hash').notNull(),
    extractionFingerprint: text('extraction_fingerprint').notNull(),
    sourceIdsJson: text('source_ids_json').notNull(),
    profileJson: text('profile_json').notNull(),
    model: text('model'),
    reasoningEffort: text('reasoning_effort'),
    promptVersion: text('prompt_version'),
    structuredOutputSchemaVersion: integer('structured_output_schema_version'),
    extractorImplementationVersion: text('extractor_implementation_version'),
    validationWarningsJson: text('validation_warnings_json'),
    unresolvedConflictsJson: text('unresolved_conflicts_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    approvedAt: text('approved_at'),
    supersededAt: text('superseded_at'),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    extractionFingerprintIdx: index('profile_versions_extraction_fingerprint_idx').on(
      t.extractionFingerprint,
    ),
    contentHashIdx: index('profile_versions_content_hash_idx').on(t.contentHash),
    statusIdx: index('profile_versions_status_idx').on(t.status),
    activeApprovedUnique: uniqueIndex('profile_versions_active_approved_idx')
      .on(t.id)
      .where(sql`status = 'approved' AND active = 1`),
  }),
);

// 4. profile_revisions ------------------------------------------------------
// Field-level edit history for a single profile_version. Resolution events
// (conflict selection, manual entry) are recorded as a "source" string.
export const profileRevisions = sqliteTable(
  'profile_revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    revisionTimestamp: text('revision_timestamp').notNull(),
    source: text('source', {
      enum: ['openai', 'user', 'conflict_resolution', 'override'],
    }).notNull(),
    fieldPath: text('field_path').notNull(),
    previousValueJson: text('previous_value_json'),
    newValueJson: text('new_value_json'),
    note: text('note'),
  },
  (t) => ({
    profileVersionIdx: index('profile_revisions_profile_version_id_idx').on(t.profileVersionId),
  }),
);

// 5. profile_conflicts ------------------------------------------------------
// Unresolved or resolved conflicts surfaced by multi-source merging.
export const profileConflicts = sqliteTable(
  'profile_conflicts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    conflictType: text('conflict_type').notNull(),
    affectedField: text('affected_field').notNull(),
    valueSourceAJson: text('value_source_a_json'),
    valueSourceBJson: text('value_source_b_json'),
    sourceReferencesJson: text('source_references_json').notNull(),
    provisionalValueJson: text('provisional_value_json'),
    explanation: text('explanation'),
    resolutionStatus: text('resolution_status', {
      enum: ['unresolved', 'resolved', 'cleared'],
    }).notNull(),
    resolvedAt: text('resolved_at'),
    resolvedValueJson: text('resolved_value_json'),
  },
  (t) => ({
    profileVersionIdx: index('profile_conflicts_profile_version_id_idx').on(t.profileVersionId),
  }),
);

// 6. profile_warnings -------------------------------------------------------
// Non-blocking warnings attached to a profile version.
export const profileWarnings = sqliteTable(
  'profile_warnings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    severity: text('severity', { enum: ['blocking_conflict', 'warning'] }).notNull(),
    warningType: text('warning_type').notNull(),
    fieldPath: text('field_path'),
    message: text('message').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    profileVersionIdx: index('profile_warnings_profile_version_id_idx').on(t.profileVersionId),
  }),
);

// 7. derived_overrides ------------------------------------------------------
// Manual overrides for derived fields (likelySeniority, primaryRoles, etc).
export const derivedOverrides = sqliteTable(
  'derived_overrides',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    derivedField: text('derived_field', {
      enum: ['likelySeniority', 'primaryRoles', 'primaryDomains', 'strongestSkills'],
    }).notNull(),
    overrideActive: integer('override_active', { mode: 'boolean' }).notNull(),
    overrideValueJson: text('override_value_json'),
    generatedValueJson: text('generated_value_json'),
    generatedAt: text('generated_at'),
    overriddenAt: text('overridden_at'),
  },
  (t) => ({
    profileVersionFieldUnique: uniqueIndex(
      'derived_overrides_profile_version_field_idx',
    ).on(t.profileVersionId, t.derivedField),
  }),
);

// 8. filter_configuration_versions -----------------------------------------
// Immutable filter configuration snapshots; only one row is `active`.
export const filterConfigurationVersions = sqliteTable(
  'filter_configuration_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    schemaVersion: integer('schema_version').notNull(),
    contentHash: text('content_hash').notNull(),
    configJson: text('config_json').notNull(),
    createdAt: text('created_at').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    contentHashIdx: index('filter_configuration_versions_content_hash_idx').on(t.contentHash),
    activeUnique: uniqueIndex('filter_configuration_versions_active_idx')
      .on(t.id)
      .where(sql`active = 1`),
  }),
);

// 9. pipeline_runs ---------------------------------------------------------
// One row per `jobhunter run` invocation. Counts are denormalized for inspection.
export const pipelineRuns = sqliteTable(
  'pipeline_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    status: text('status', {
      enum: [
        'running',
        'cancelling',
        'completed',
        'completed_with_errors',
        'failed',
        'cancelled',
      ],
    }).notNull(),
    startTimestamp: text('start_timestamp').notNull(),
    endTimestamp: text('end_timestamp'),
    configSnapshotJson: text('config_snapshot_json').notNull(),
    configSchemaVersion: integer('config_schema_version').notNull(),
    configHash: text('config_hash').notNull(),
    applicationVersion: text('application_version').notNull(),
    profileVersionId: integer('profile_version_id').references(() => profileVersions.id),
    filterConfigVersionId: integer('filter_config_version_id').references(
      () => filterConfigurationVersions.id,
    ),
    searchesPlanned: integer('searches_planned').notNull().default(0),
    searchesAttempted: integer('searches_attempted').notNull().default(0),
    searchesCompleted: integer('searches_completed').notNull().default(0),
    searchErrorsJson: text('search_errors_json'),
    jobsDiscovered: integer('jobs_discovered').notNull().default(0),
    newCompleteJobs: integer('new_complete_jobs').notNull().default(0),
    existingCompleteJobsSkipped: integer('existing_complete_jobs_skipped').notNull().default(0),
    existingPartialJobsSkipped: integer('existing_partial_jobs_skipped').notNull().default(0),
    newPartialJobs: integer('new_partial_jobs').notNull().default(0),
    failedExtractions: integer('failed_extractions').notNull().default(0),
    jobsAccepted: integer('jobs_accepted').notNull().default(0),
    jobsRejected: integer('jobs_rejected').notNull().default(0),
    filterErrors: integer('filter_errors').notNull().default(0),
    jobsScored: integer('jobs_scored').notNull().default(0),
    scoresReused: integer('scores_reused').notNull().default(0),
    scoringErrors: integer('scoring_errors').notNull().default(0),
    scoringDeclinedByUser: integer('scoring_declined_by_user', { mode: 'boolean' })
      .notNull()
      .default(false),
    cancellationReason: text('cancellation_reason'),
  },
  (t) => ({
    statusStartIdx: index('pipeline_runs_status_start_idx').on(t.status, t.startTimestamp),
  }),
);

// 10. search_executions ----------------------------------------------------
// One row per generated query/location pair within a pipeline run.
export const searchExecutions = sqliteTable(
  'search_executions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchQuery: text('search_query').notNull(),
    locationName: text('location_name').notNull(),
    geoId: text('geo_id').notNull(),
    generatedUrl: text('generated_url').notNull(),
    startTimestamp: text('start_timestamp').notNull(),
    endTimestamp: text('end_timestamp'),
    finalStatus: text('final_status', {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull(),
    jobsDiscovered: integer('jobs_discovered').notNull().default(0),
    newJobs: integer('new_jobs').notNull().default(0),
    existingJobs: integer('existing_jobs').notNull().default(0),
    errorsJson: text('errors_json'),
    diagnosticRefsJson: text('diagnostic_refs_json'),
  },
  (t) => ({
    pipelineRunIdx: index('search_executions_pipeline_run_id_idx').on(t.pipelineRunId),
  }),
);

// 11. jobs -----------------------------------------------------------------
// Canonical job records. source_job_id is LinkedIn's job ID and is unique.
export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceJobId: text('source_job_id').notNull(),
    title: text('title'),
    company: text('company'),
    location: text('location'),
    description: text('description'),
    extractionStatus: text('extraction_status', {
      enum: ['complete', 'partial', 'failed'],
    }).notNull(),
    successfulMethod: text('successful_method', {
      enum: ['search_detail_panel', 'dedicated_job_page'],
    }),
    firstDiscoveryTimestamp: text('first_discovery_timestamp').notNull(),
    lastRediscoveryTimestamp: text('last_rediscovery_timestamp').notNull(),
    lastExtractionAttemptTimestamp: text('last_extraction_attempt_timestamp'),
    createdTimestamp: text('created_timestamp').notNull(),
    updatedTimestamp: text('updated_timestamp').notNull(),
  },
  (t) => ({
    sourceJobIdUnique: uniqueIndex('jobs_source_job_id_idx').on(t.sourceJobId),
    extractionStatusIdx: index('jobs_extraction_status_idx').on(t.extractionStatus),
  }),
);

// 12. discovery_events -----------------------------------------------------
// Per-discovery record: when a job was seen, by which search, whether it was new.
export const discoveryEvents = sqliteTable(
  'discovery_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    timestamp: text('timestamp').notNull(),
    isNew: integer('is_new', { mode: 'boolean' }).notNull(),
    currentExtractionState: text('current_extraction_state', {
      enum: ['complete', 'partial', 'failed'],
    }).notNull(),
    extractionAttempted: integer('extraction_attempted', { mode: 'boolean' }).notNull(),
    skipReason: text('skip_reason'),
  },
  (t) => ({
    runSearchIdx: index('discovery_events_run_search_idx').on(
      t.pipelineRunId,
      t.searchExecutionId,
    ),
  }),
);

// 13. discovery_errors -----------------------------------------------------
// Failures where we could not even identify a source_job_id.
export const discoveryErrors = sqliteTable(
  'discovery_errors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    cardPosition: integer('card_position'),
    cardIndex: integer('card_index'),
    availableMetadataJson: text('available_metadata_json'),
    errorCode: text('error_code').notNull(),
    diagnosticMessage: text('diagnostic_message').notNull(),
    timestamp: text('timestamp').notNull(),
    artifactRefsJson: text('artifact_refs_json'),
  },
  (t) => ({
    runSearchIdx: index('discovery_errors_run_search_idx').on(
      t.pipelineRunId,
      t.searchExecutionId,
    ),
  }),
);

// 14. extraction_attempts --------------------------------------------------
// Per-method attempt record (panel or dedicated page) for a single job.
export const extractionAttempts = sqliteTable(
  'extraction_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    attemptTimestamp: text('attempt_timestamp').notNull(),
    method: text('method', {
      enum: ['search_detail_panel', 'dedicated_job_page'],
    }).notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    jobIdx: index('extraction_attempts_job_id_idx').on(t.jobId),
  }),
);

// 15. filter_results -------------------------------------------------------
// Persisted filter outcomes; only one row per job is `active` at a time.
// Fingerprint ties the row to inputs (job, profile, filter version).
export const filterResults = sqliteTable(
  'filter_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
    filterConfigVersionId: integer('filter_config_version_id')
      .notNull()
      .references(() => filterConfigurationVersions.id),
    filterConfigHash: text('filter_config_hash').notNull(),
    profileVersionId: integer('profile_version_id').references(() => profileVersions.id),
    profileHash: text('profile_hash'),
    filterImplementationVersion: text('filter_implementation_version').notNull(),
    fingerprint: text('fingerprint').notNull(),
    timestamp: text('timestamp').notNull(),
    overallOutcome: text('overall_outcome', {
      enum: ['accepted', 'rejected', 'error'],
    }).notNull(),
    rulesEvaluatedJson: text('rules_evaluated_json').notNull(),
    rulesPassedJson: text('rules_passed_json').notNull(),
    rulesFailedJson: text('rules_failed_json').notNull(),
    rejectionReasonsJson: text('rejection_reasons_json'),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    fingerprintIdx: index('filter_results_fingerprint_idx').on(t.fingerprint),
    activeJobIdx: index('filter_results_active_job_idx').on(t.jobId, t.active),
    activeUnique: uniqueIndex('filter_results_active_idx')
      .on(t.jobId)
      .where(sql`active = 1`),
  }),
);

// 16. score_results --------------------------------------------------------
// Persisted scoring outcomes keyed by fingerprint; only one row per job is active.
export const scoreResults = sqliteTable(
  'score_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
    filterResultId: integer('filter_result_id').references(() => filterResults.id),
    fingerprint: text('fingerprint').notNull(),
    timestamp: text('timestamp').notNull(),
    promptVersion: text('prompt_version').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    model: text('model').notNull(),
    reasoningEffort: text('reasoning_effort').notNull(),
    scorerImplementationVersion: text('scorer_implementation_version').notNull(),
    categoryScoresJson: text('category_scores_json').notNull(),
    overallScore: real('overall_score').notNull(),
    explanation: text('explanation'),
    keyMatchesJson: text('key_matches_json'),
    importantGapsJson: text('important_gaps_json'),
    importantConcernsJson: text('important_concerns_json'),
    inferredSeniority: text('inferred_seniority'),
    recommendationSummary: text('recommendation_summary'),
    success: integer('success', { mode: 'boolean' }).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    fingerprintIdx: index('score_results_fingerprint_idx').on(t.fingerprint),
    activeJobIdx: index('score_results_active_job_idx').on(t.jobId, t.active),
    overallScoreIdx: index('score_results_overall_score_idx').on(t.overallScore),
    activeUnique: uniqueIndex('score_results_active_idx')
      .on(t.jobId)
      .where(sql`active = 1`),
  }),
);

// 17. openai_request_metadata ---------------------------------------------
// Per-request audit trail. Does not store raw prompts/responses.
export const openaiRequestMetadata = sqliteTable(
  'openai_request_metadata',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationType: text('operation_type', {
      enum: ['profile_extraction', 'job_scoring'],
    }).notNull(),
    relatedEntityType: text('related_entity_type', {
      enum: ['profile_version', 'score_result'],
    }),
    relatedEntityId: integer('related_entity_id'),
    inputHashesJson: text('input_hashes_json').notNull(),
    promptVersion: text('prompt_version').notNull(),
    structuredOutputSchemaVersion: integer('structured_output_schema_version').notNull(),
    model: text('model').notNull(),
    reasoningEffort: text('reasoning_effort').notNull(),
    configJson: text('config_json').notNull(),
    tokenUsageJson: text('token_usage_json'),
    validatedOutputJson: text('validated_output_json'),
    attemptCount: integer('attempt_count').notNull(),
    startTimestamp: text('start_timestamp').notNull(),
    endTimestamp: text('end_timestamp'),
    success: integer('success', { mode: 'boolean' }).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    operationIdx: index('openai_request_metadata_operation_idx').on(
      t.operationType,
      t.startTimestamp,
    ),
  }),
);

// 18. diagnostic_artifacts -------------------------------------------------
// References to artifacts captured on the filesystem for a run/search/job/error.
export const diagnosticArtifacts = sqliteTable(
  'diagnostic_artifacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id').references(() => searchExecutions.id),
    jobId: integer('job_id').references(() => jobs.id),
    discoveryErrorId: integer('discovery_error_id').references(() => discoveryErrors.id),
    extractionAttemptId: integer('extraction_attempt_id').references(
      () => extractionAttempts.id,
    ),
    artifactType: text('artifact_type', {
      enum: [
        'screenshot',
        'current_url',
        'stack_trace',
        'playwright_trace',
        'html_snapshot',
        'log_file',
      ],
    }).notNull(),
    storedPath: text('stored_path').notNull(),
    relativePath: text('relative_path').notNull(),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    createdAt: text('created_at').notNull(),
    errorCode: text('error_code'),
    description: text('description'),
  },
  (t) => ({
    runIdx: index('diagnostic_artifacts_run_id_idx').on(t.pipelineRunId),
  }),
);

// Aggregated schema object so downstream repositories can pass a single
// argument to `drizzle(sqlite, { schema })`.
export const schema = {
  applicationMetadata,
  profileSources,
  profileVersions,
  profileRevisions,
  profileConflicts,
  profileWarnings,
  derivedOverrides,
  filterConfigurationVersions,
  pipelineRuns,
  searchExecutions,
  jobs,
  discoveryEvents,
  discoveryErrors,
  extractionAttempts,
  filterResults,
  scoreResults,
  openaiRequestMetadata,
  diagnosticArtifacts,
};

export type Schema = typeof schema;