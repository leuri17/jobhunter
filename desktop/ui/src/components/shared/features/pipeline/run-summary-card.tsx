// Run summary, rendered from the terminal SSE event's `result`
// payload once the run ends. Token totals come from the last live
// `stats` snapshot — the summary itself doesn't carry them.

import { Link } from '@tanstack/react-router';
import type { PipelineRunStatus, RunSummary } from '@jobhunter/core/pipeline';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from 'cn';

interface RunSummaryCardProps {
  readonly summary: RunSummary;
  /** prompt + completion tokens from the last stats snapshot, if any arrived. */
  readonly tokens: number | null;
}

const STATUS_BADGE: Readonly<Record<PipelineRunStatus, string>> = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  completed_with_errors: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  cancelled: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  running: 'border-border bg-muted/50 text-muted-foreground',
  cancelling: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
};

const STATUS_LABEL: Readonly<Record<PipelineRunStatus, string>> = {
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  cancelled: 'Cancelled',
  failed: 'Failed',
  running: 'Running',
  cancelling: 'Cancelling',
};

function formatDuration(startTimestamp: string, endTimestamp: string): string | null {
  const ms = Date.parse(endTimestamp) - Date.parse(startTimestamp);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function Stat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-lg leading-none tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** `events.result` is typed `unknown`; check the shape before trusting it. */
export function asRunSummary(result: unknown): RunSummary | null {
  if (typeof result !== 'object' || result === null) return null;
  const summary = (result as Record<string, unknown>)['summary'];
  if (typeof summary !== 'object' || summary === null) return null;
  const candidate = summary as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.runId !== 'number' ||
    typeof candidate.status !== 'string'
  ) {
    return null;
  }
  return summary as RunSummary;
}

export function RunSummaryCard({ summary, tokens }: RunSummaryCardProps) {
  const duration = formatDuration(summary.startTimestamp, summary.endTimestamp);

  return (
    <Card data-testid="run-summary">
      <CardHeader>
        <CardTitle>Run summary</CardTitle>
        <CardDescription>
          Run {summary.runId}
          {duration !== null ? ` · finished in ${duration}` : ''}
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className={cn(STATUS_BADGE[summary.status])}>
            {STATUS_LABEL[summary.status]}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
          <Stat
            value={`${summary.searchesCompleted}/${summary.searchesPlanned}`}
            label="Searches"
          />
          <Stat value={summary.jobsDiscovered.toLocaleString()} label="Jobs discovered" />
          <Stat
            value={(
              summary.existingCompleteJobsSkipped + summary.existingPartialJobsSkipped
            ).toLocaleString()}
            label="Jobs skipped"
          />
          <Stat
            value={`${summary.jobsAccepted}/${summary.jobsAccepted + summary.jobsRejected}`}
            label="Passed filter"
          />
          <Stat value={summary.jobsScored.toLocaleString()} label="Scored" />
          <Stat
            value={tokens === null ? '—' : tokens.toLocaleString()}
            label="Tokens (prompt + completion)"
          />
        </div>
        {summary.scoringDeclinedByUser && (
          <p className="text-sm text-muted-foreground">Scoring skipped at your request.</p>
        )}
        {summary.cancellationReason !== null && (
          <p className="text-sm text-muted-foreground">Cancelled: {summary.cancellationReason}</p>
        )}
      </CardContent>
      <CardFooter>
        <Link to="/runs" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          View all runs
        </Link>
      </CardFooter>
    </Card>
  );
}
