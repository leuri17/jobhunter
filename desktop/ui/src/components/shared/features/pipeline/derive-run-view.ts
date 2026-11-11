// Fold for the pipeline page: collapses the ordered SSE `progress`
// events into the view model the stage strip and matrix rows render.
// Latest `stats` snapshot wins; event order decides each stage's phase
// (run_start → search loop → scoring_plan → run_summary).

import type { PipelineEvents } from '@/lib/sse';
import type { PipelineProgressEvent, PipelineRunCounters } from '@/lib/types';
import type { RunSummary } from '@jobhunter/core/pipeline';

/** The five stage cards, in execution order. */
export type StageKey = 'matrix' | 'discovery' | 'extraction' | 'filter' | 'scoring';

/** Lifecycle of one stage card. `waiting` is the open cost gate; `skipped` is a declined gate. */
export type StagePhase = 'pending' | 'active' | 'done' | 'waiting' | 'skipped';

/** The three sequential phases inside one search, in execution order. */
type SearchLoopPhase = 'discovery' | 'extraction' | 'filter';

const SEARCH_PHASE_ORDER: readonly SearchLoopPhase[] = ['discovery', 'extraction', 'filter'];

export interface ScoringPlanSnapshot {
  readonly jobsDiscovered: number;
  readonly newOpenAIRequests: number;
}

export interface RunView {
  readonly stages: Readonly<Record<StageKey, StagePhase>>;
  /** Latest `stats` counters snapshot, once one has arrived. */
  readonly counters: PipelineRunCounters | null;
  readonly searchesPlanned: number | null;
  /** The search the loop is on (or last finished), from the latest `search_start`. */
  readonly currentSearch: CurrentSearch | null;
  readonly scoringPlan: ScoringPlanSnapshot | null;
  readonly scoringDeclined: boolean;
  /** `run_summary` progress payload — the terminal `done` result may differ, prefer that one. */
  readonly runSummaryEvent: RunSummary | null;
  /**
   * True while the cost gate is open and still undecided. Sharper than
   * `pendingConfirmation !== null`: that flag stays set until the run
   * ends even after `scoring_confirmed`/`scoring_declined` arrive.
   */
  readonly gateAwaitingDecision: boolean;
  readonly runStarted: boolean;
}

/** Identity + position of the search the loop is executing, echoed by `search_start`. */
export interface CurrentSearch {
  readonly query: string;
  readonly locationName: string;
  readonly index: number;
  readonly total: number;
}

export function deriveRunView(
  progress: readonly PipelineProgressEvent[],
  status: PipelineEvents['status'],
  pendingConfirmation: boolean,
): RunView {
  let searchesPlanned: number | null = null;
  let counters: PipelineRunCounters | null = null;
  let scoringPlan: ScoringPlanSnapshot | null = null;
  let scoringConfirmed = false;
  let scoringDeclined = false;
  let summary: RunSummary | null = null;
  let currentSearch: CurrentSearch | null = null;
  let lastPhase: SearchLoopPhase | null = null;

  for (const event of progress) {
    switch (event.type) {
      case 'run_start':
        searchesPlanned = event.searchesPlanned;
        break;
      case 'search_start':
        currentSearch = {
          query: event.query,
          locationName: event.locationName,
          index: event.index,
          total: event.total,
        };
        break;
      case 'search_phase':
        lastPhase = event.phase;
        break;
      case 'stats':
        counters = event.counters;
        break;
      case 'scoring_plan':
        scoringPlan = {
          jobsDiscovered: event.jobsDiscovered,
          newOpenAIRequests: event.newOpenAIRequests,
        };
        break;
      case 'scoring_confirmed':
        scoringConfirmed = true;
        break;
      case 'scoring_declined':
        scoringDeclined = true;
        break;
      case 'run_summary':
        summary = event.summary;
        break;
    }
  }

  const terminal = status === 'done' || status === 'cancelled' || status === 'failed';
  // 'error' means the stream dropped, not that the run stopped — keep
  // stages where they were so the counters don't lie about progress.
  const live = status === 'running' || status === 'error';

  const gateAwaitingDecision =
    pendingConfirmation && status === 'running' && !scoringConfirmed && !scoringDeclined;

  const runStarted = searchesPlanned !== null;
  const searchLoopDone = scoringPlan !== null || summary !== null;

  const matrixPhase: StagePhase = runStarted ? 'done' : live ? 'active' : 'pending';

  const loopPhase: StagePhase = searchLoopDone
    ? 'done'
    : runStarted && live
      ? 'active'
      : runStarted && terminal
        ? 'done'
        : 'pending';

  // With `search_phase` events, exactly one of the three search-loop
  // stages is active; earlier phases of the current search are done,
  // later ones pending. Without them (streams predating the events),
  // fall back to the shared loopPhase so nothing regresses on replay.
  const searchStagePhase = (stage: SearchLoopPhase): StagePhase => {
    if (searchLoopDone || !runStarted || lastPhase === null) return loopPhase;
    if (terminal) return 'done';
    if (stage === lastPhase) return 'active';
    return SEARCH_PHASE_ORDER.indexOf(stage) < SEARCH_PHASE_ORDER.indexOf(lastPhase)
      ? 'done'
      : 'pending';
  };

  let scoringPhase: StagePhase;
  if (summary !== null) {
    scoringPhase = scoringDeclined ? 'skipped' : 'done';
  } else if (gateAwaitingDecision) {
    scoringPhase = 'waiting';
  } else if (scoringDeclined) {
    scoringPhase = 'skipped';
  } else if (scoringPlan !== null && live) {
    scoringPhase = 'active';
  } else if (scoringPlan !== null && terminal) {
    scoringPhase = 'done';
  } else {
    scoringPhase = 'pending';
  }

  return {
    stages: {
      matrix: matrixPhase,
      discovery: searchStagePhase('discovery'),
      extraction: searchStagePhase('extraction'),
      filter: searchStagePhase('filter'),
      scoring: scoringPhase,
    },
    counters,
    searchesPlanned,
    scoringPlan,
    scoringDeclined,
    runSummaryEvent: summary,
    gateAwaitingDecision,
    runStarted,
    currentSearch,
  };
}
