import type { RunSummary } from './state.js';

/**
 * Live counter snapshot for a running pipeline. A subset of
 * `RunSummary`'s counters — the values a progress UI renders while
 * the run executes (search loop, extraction, filter, scoring).
 */
export interface PipelineRunCounters {
  readonly searchesAttempted: number;
  readonly searchesCompleted: number;
  readonly jobsDiscovered: number;
  readonly newCompleteJobs: number;
  readonly failedExtractions: number;
  readonly jobsAccepted: number;
  readonly jobsRejected: number;
  readonly filterErrors: number;
  readonly jobsScored: number;
  readonly scoresReused: number;
  readonly scoringErrors: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Structured progress events emitted by `PipelineOrchestrator` at its
 * lifecycle boundaries. The sidecar forwards these verbatim as SSE
 * `progress` frames; the ordering guarantees the UI relies on:
 * `run_start` first, `search_start`/`stats` interleaved per search,
 * `scoring_plan` before any scoring decision, `run_summary` last.
 */
export type PipelineProgressEvent =
  | { readonly type: 'run_start'; readonly runId: number; readonly searchesPlanned: number }
  | {
      readonly type: 'search_start';
      readonly runId: number;
      readonly index: number;
      readonly total: number;
      readonly query: string;
      readonly locationName: string;
    }
  | {
      /** Which of the three sequential phases inside one search is executing. */
      readonly type: 'search_phase';
      readonly runId: number;
      readonly index: number;
      readonly phase: 'discovery' | 'extraction' | 'filter';
    }
  | { readonly type: 'stats'; readonly runId: number; readonly counters: PipelineRunCounters }
  | {
      readonly type: 'scoring_plan';
      readonly runId: number;
      readonly jobsDiscovered: number;
      readonly newOpenAIRequests: number;
    }
  | { readonly type: 'scoring_confirmed'; readonly runId: number }
  | { readonly type: 'scoring_declined'; readonly runId: number }
  | { readonly type: 'run_summary'; readonly runId: number; readonly summary: RunSummary };

/** Receiver for {@link PipelineProgressEvent}s; optional on the orchestrator. */
export type PipelineEventSink = (event: PipelineProgressEvent) => void;
