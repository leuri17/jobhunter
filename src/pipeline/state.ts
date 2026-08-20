/**
 * State vocabulary for TASK-015 — pipeline orchestration
 * (SPEC §8.4 + §27 + §29 + §30 + §33 + §38).
 *
 * The shapes below are the typed contract between the
 * orchestrator and the CLI renderer. Pure TypeScript types
 * — no runtime values, no I/O.
 */
export const PIPELINE_SCHEMA_VERSION = 1 as const;
export type PipelineSchemaVersion = typeof PIPELINE_SCHEMA_VERSION;

/**
 * Status values for a pipeline run (SPEC §38). The literal
 * type mirrors the `pipelineRuns.status` DDL.
 */
export type PipelineRunStatus =
  'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';

/**
 * The 21-count run summary (SPEC §38). The fields are the
 * final values the orchestrator persists via
 * `PipelineRunRepository.finalizeRunStats`.
 */
export interface RunSummary {
  readonly schemaVersion: PipelineSchemaVersion;
  readonly runId: number;
  readonly status: PipelineRunStatus;
  readonly startTimestamp: string;
  readonly endTimestamp: string;
  readonly searchesPlanned: number;
  readonly searchesAttempted: number;
  readonly searchesCompleted: number;
  readonly searchErrors: readonly { readonly code: string; readonly message: string }[];
  readonly jobsDiscovered: number;
  readonly newCompleteJobs: number;
  readonly existingCompleteJobsSkipped: number;
  readonly existingPartialJobsSkipped: number;
  readonly newPartialJobs: number;
  readonly failedExtractions: number;
  readonly jobsAccepted: number;
  readonly jobsRejected: number;
  readonly filterErrors: number;
  readonly jobsScored: number;
  readonly scoresReused: number;
  readonly scoringErrors: number;
  readonly scoringDeclinedByUser: boolean;
  readonly cancellationReason: string | null;
}

/**
 * Top-N row for the post-run renderer (SPEC §33.1).
 */
export interface TopNRow {
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly score: number;
  readonly displayScore: string;
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly firstDiscovered: string;
}
