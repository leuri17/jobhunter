// Five-stage strip: one instrument panel with hairline-separated cells
// (gap-px over a border-colored background), one cell per pipeline
// stage. Cell states come from the derived run view; the active cell
// gets a primary tint and the only motion on the panel — a pulsing dot.

import { cn } from 'cn';
import type { RunView, StageKey, StagePhase } from './derive-run-view';

interface StageStripProps {
  readonly view: RunView;
  /** queries × locations from config — shown before a run starts. */
  readonly matrixSize: number | null;
  readonly model: string | undefined;
  readonly concurrency: number | undefined;
}

const PHASE_DOT: Record<StagePhase, string> = {
  pending: 'bg-muted-foreground/40',
  active: 'bg-primary animate-pulse motion-reduce:animate-none',
  waiting: 'bg-amber-400 animate-pulse motion-reduce:animate-none',
  done: 'bg-emerald-500',
  skipped: 'bg-transparent ring-1 ring-inset ring-muted-foreground/50',
};

const PHASE_LABEL: Record<StagePhase, string> = {
  pending: 'not started',
  active: 'in progress',
  waiting: 'waiting on you',
  done: 'done',
  skipped: 'skipped',
};

function nf(n: number): string {
  return n.toLocaleString();
}

interface CellModel {
  readonly key: StageKey;
  readonly name: string;
  readonly blurb: string;
  readonly metric: string;
  readonly metricMuted: boolean;
}

function buildCells(props: StageStripProps): CellModel[] {
  const { view, matrixSize, model, concurrency } = props;
  const counters = view.counters;
  const planned = view.searchesPlanned ?? matrixSize;
  const tokens = counters === null ? 0 : counters.promptTokens + counters.completionTokens;

  // While the search loop runs, the matrix cell becomes the loop's
  // identity: the search executing now (query in location, position)
  // instead of the whole planned cross product.
  const current = view.currentSearch;
  const loopRunning =
    current !== null && view.scoringPlan === null && view.runSummaryEvent === null;

  const matrixBlurb =
    current !== null && loopRunning
      ? `${current.query} in ${current.locationName}`
      : 'Every query × location pair';

  const matrixMetric =
    current !== null && loopRunning
      ? `${current.index + 1}/${current.total} searches`
      : planned === null
        ? '—'
        : counters !== null
          ? `${counters.searchesCompleted}/${planned} searches`
          : `${planned} searches`;

  const scoringPhase = view.stages.scoring;
  const scoringMetric =
    scoringPhase === 'waiting'
      ? 'Waiting on your decision'
      : scoringPhase === 'skipped'
        ? 'Scoring skipped'
        : view.scoringPlan !== null && counters !== null
          ? `${nf(counters.jobsScored)} scored · ${nf(tokens)} tokens`
          : view.scoringPlan !== null
            ? `${nf(view.scoringPlan.newOpenAIRequests)} requests ready`
            : '—';

  return [
    {
      key: 'matrix',
      name: 'Search matrix',
      blurb: matrixBlurb,
      metric: matrixMetric,
      metricMuted: planned === null && !loopRunning,
    },
    {
      key: 'discovery',
      name: 'LinkedIn discovery',
      blurb: 'Headless LinkedIn searches',
      metric: counters === null ? '—' : `${nf(counters.jobsDiscovered)} jobs found`,
      metricMuted: counters === null,
    },
    {
      key: 'extraction',
      name: 'Extraction',
      blurb: 'Fetch full job descriptions',
      metric:
        counters === null
          ? '—'
          : `${nf(counters.newCompleteJobs)} extracted${
              counters.failedExtractions > 0 ? ` · ${nf(counters.failedExtractions)} failed` : ''
            }`,
      metricMuted: counters === null,
    },
    {
      key: 'filter',
      name: 'Filter gating',
      blurb: 'Rule-based triage',
      metric:
        counters === null
          ? '—'
          : `${nf(counters.jobsAccepted)} passed · ${nf(counters.jobsRejected)} rejected`,
      metricMuted: counters === null,
    },
    {
      key: 'scoring',
      name: 'OpenAI scoring',
      blurb:
        model !== undefined
          ? `${model}${concurrency !== undefined ? ` · ${concurrency} parallel` : ''}`
          : 'Scores jobs against your profile',
      metric: scoringMetric,
      metricMuted: scoringMetric === '—',
    },
  ];
}

export function StageStrip(props: StageStripProps) {
  const cells = buildCells(props);
  return (
    <section aria-label="Run stages" className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">Run stages</h2>
        <p className="text-xs text-muted-foreground">
          Counters update live while the run executes.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cells.map((cell, i) => {
          const phase = props.view.stages[cell.key];
          const waiting = phase === 'waiting';
          return (
            <div
              key={cell.key}
              data-phase={phase}
              className={cn(
                'flex min-h-32 flex-col gap-2 bg-card p-4',
                phase === 'active' && 'bg-primary/5',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={cn('size-2 rounded-full', PHASE_DOT[phase])} aria-hidden="true" />
              </div>
              <div className="text-sm font-medium">
                {cell.name}
                <span className="sr-only"> — {PHASE_LABEL[phase]}</span>
              </div>
              <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                {cell.blurb}
              </p>
              <div
                className={cn(
                  'mt-auto border-t border-border/60 pt-2 font-mono text-xs tabular-nums',
                  cell.metricMuted && 'text-muted-foreground',
                  waiting && 'text-amber-400',
                )}
              >
                {cell.metric}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
