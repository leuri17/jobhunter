import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HourglassIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { usePipelineEvents } from '@/lib/sse';
import { LogPane } from '@/components/shared/ui/log-pane';
import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader, PageHeaderTitle } from '@/components/shared/layout/page-header';
import { deriveRunView } from '@/components/shared/features/pipeline/derive-run-view';
import { PrerequisitesBanner } from '@/components/shared/features/pipeline/prerequisites-banner';
import { StageStrip } from '@/components/shared/features/pipeline/stage-strip';
import { ScoringPanel } from '@/components/shared/features/pipeline/scoring-panel';
import { ScoringConfirmationDialog } from '@/components/shared/features/pipeline/scoring-confirmation-dialog';
import { RunStateIndicator } from '@/components/shared/features/pipeline/run-state-indicator';
import {
  asRunSummary,
  RunSummaryCard,
} from '@/components/shared/features/pipeline/run-summary-card';
import { Route as rootRoute } from './__root';

// Pipeline (`/pipeline`). Mission-control for one run, top to bottom in
// the run's own order: prerequisites, the five-stage strip (whose first
// cell carries the current search while the loop runs), the scoring
// plan + cost gate, the live log, and the summary once the terminal
// event lands. SSE-driven state comes from `usePipelineEvents`; failures
// surface through `ApiErrorDialog` per lib/error-surfaces.ts (failed
// start/cancel/run and a failed scoring decision are all user-initiated
// actions).

// Error codes whose guidance names a page to open — the copy lives in
// CODE_GUIDANCE (`lib/error-surfaces.ts`), the destination here.
const ACTION_ROUTES: Partial<Record<string, string>> = {
  no_active_profile: '/profile',
  openai_unavailable: '/settings',
  openai_api_key_missing: '/settings',
};

const GATE_STORAGE_KEY = 'pipeline:require-scoring-confirmation';

function readStoredGate(): boolean {
  try {
    return localStorage.getItem(GATE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pipeline',
  component: PipelinePage,
});

export function PipelinePage() {
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<ApiError | null>(null);
  const [cancelError, setCancelError] = useState<ApiError | null>(null);
  const [runFailure, setRunFailure] = useState<ApiError | null>(null);
  const [decisionError, setDecisionError] = useState<ApiError | null>(null);
  const [gateDismissed, setGateDismissed] = useState(false);
  const [requireScoringConfirmation, setRequireScoringConfirmation] = useState(readStoredGate);
  const events = usePipelineEvents(runId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const prerequisites = useQuery({
    queryKey: ['pipeline', 'prerequisites'],
    queryFn: api.getPipelinePrerequisites,
  });
  const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });

  const start = useMutation({
    mutationFn: () => api.runPipeline(requireScoringConfirmation),
    onSuccess: (data) => {
      setStartError(null);
      setRunId(data.runId);
      // The new run shows up on /runs immediately; refresh the runs
      // list so navigating there doesn't show a stale 'last seen at'.
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err: unknown) => {
      setStartError(err as ApiError);
    },
  });
  const cancel = useMutation({
    mutationFn: () => {
      if (runId === null) {
        throw new ApiError(0, 'invalid_state', 'No active run to cancel');
      }
      return api.cancelPipeline(runId);
    },
    onSuccess: () => {
      setCancelError(null);
      // Cancel transitions the run to 'cancelled' and updates
      // jobsScored on the run record. Refresh the runs list so
      // /runs reflects the new status without a manual remount.
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err: unknown) => {
      setCancelError(err as ApiError);
    },
  });
  const decide = useMutation({
    mutationFn: (accepted: boolean) => {
      if (runId === null) {
        throw new ApiError(0, 'invalid_state', 'No active run to decide for');
      }
      return api.decideScoring(runId, accepted);
    },
    onError: (err: unknown) => {
      setDecisionError(err as ApiError);
    },
  });

  // Coming back to the page mid-run: adopt the sidecar's active run so
  // the SSE hook resumes its stream. Ambient probe — a failure just
  // means no reconnect, the run can still be started fresh.
  useEffect(() => {
    let cancelled = false;
    api
      .getActivePipelineRun()
      .then((active) => {
        if (!cancelled && active.runId !== null) setRunId(active.runId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Stream loss is transient for the user (the run continues server-side,
  // the status line below keeps showing 'error'), so it announces itself
  // once via toast instead of holding the page hostage — see
  // lib/error-surfaces.ts.
  useEffect(() => {
    if (events.error === null) return;
    toast.add({
      type: 'error',
      title: 'Live event stream failed',
      description: events.error.message,
    });
  }, [events.error]);

  // A run that fails server-side reports why through the terminal SSE
  // event's error payload. Route it to the dialog tier: the user
  // started the run and must retry or fix something, so an
  // auto-dismissing toast would read as success (lib/error-surfaces.ts).
  useEffect(() => {
    if (events.runError === null) return;
    setRunFailure(new ApiError(500, events.runError.code, events.runError.message));
  }, [events.runError]);

  // Starting a new run closes the previous failure's dialog.
  useEffect(() => {
    if (runId !== null) setRunFailure(null);
  }, [runId]);

  // The gate flag resets between runs; so does the local dismissal.
  useEffect(() => {
    if (events.pendingConfirmation === null) setGateDismissed(false);
  }, [events.pendingConfirmation]);

  const view = deriveRunView(events.progress, events.status, events.pendingConfirmation !== null);
  const search = config.data?.config.search;
  const jobScoring = config.data?.config.openai.jobScoring;
  const matrixEmpty =
    search !== undefined && (search.searchQueries.length === 0 || search.locations.length === 0);
  const gatesMissing =
    prerequisites.data !== undefined &&
    (!prerequisites.data.openaiKeyConfigured ||
      prerequisites.data.activeProfile === null ||
      prerequisites.data.activeFilter === null);
  const runInProgress = start.isPending || events.status === 'running';
  const runDisabled = runInProgress || gatesMissing || matrixEmpty;

  const gateOpen = view.gateAwaitingDecision && events.pendingConfirmation !== null;
  const confirmation = events.pendingConfirmation;
  const summary = asRunSummary(events.result);

  const settingsLink = (
    <Link to="/settings" className="underline underline-offset-4 hover:text-foreground">
      Settings
    </Link>
  );
  let runDisabledReason: ReactNode = null;
  if (!runInProgress) {
    if (prerequisites.data !== undefined && !prerequisites.data.openaiKeyConfigured) {
      runDisabledReason = <>Add an OpenAI API key in {settingsLink} before running.</>;
    } else if (prerequisites.data !== undefined && prerequisites.data.activeProfile === null) {
      runDisabledReason = (
        <>
          Approve a profile on the{' '}
          <Link to="/profile" className="underline underline-offset-4 hover:text-foreground">
            Profile
          </Link>{' '}
          page before running.
        </>
      );
    } else if (prerequisites.data !== undefined && prerequisites.data.activeFilter === null) {
      runDisabledReason =
        'No filter configuration is active. One is created during first-run setup.';
    } else if (matrixEmpty) {
      runDisabledReason = <>Add at least one query and one location in {settingsLink} to run.</>;
    }
  }

  const startActionRoute = startError !== null ? ACTION_ROUTES[startError.code] : undefined;
  const runFailureActionRoute = runFailure !== null ? ACTION_ROUTES[runFailure.code] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader>
        <PageHeaderTitle subtitle="One pass: LinkedIn discovery, extraction, filter gating, and OpenAI scoring.">
          Pipeline
        </PageHeaderTitle>
        <div className="flex flex-wrap items-center gap-2">
          <RunStateIndicator status={events.status} />
          <Button
            variant="destructive"
            size="lg"
            onClick={() => cancel.mutate()}
            disabled={runId === null || events.status !== 'running'}
          >
            Cancel
          </Button>
          <Button size="lg" onClick={() => start.mutate()} disabled={runDisabled}>
            {start.isPending ? (
              'starting…'
            ) : (
              <>
                <PlayIcon aria-hidden="true" />
                Run pipeline
              </>
            )}
          </Button>
        </div>
      </PageHeader>

      {runDisabledReason !== null && (
        <p className="-mt-3 flex items-center gap-1.5 text-sm text-amber-400">
          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {runDisabledReason}
        </p>
      )}

      <PrerequisitesBanner data={prerequisites.data} failed={prerequisites.isError} />

      {gateOpen && gateDismissed && confirmation !== null && (
        <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-400">
          <HourglassIcon aria-hidden="true" />
          <AlertTitle>Scoring is paused</AlertTitle>
          <AlertDescription>
            {confirmation.jobsDiscovered} jobs are waiting on your decision — scoring hasn't
            started.
          </AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => setGateDismissed(false)}>
              Review scoring
            </Button>
          </AlertAction>
        </Alert>
      )}

      <StageStrip
        view={view}
        matrixSize={
          search === undefined ? null : search.searchQueries.length * search.locations.length
        }
        model={jobScoring?.model}
        concurrency={jobScoring?.concurrency}
      />

      <ScoringPanel
        jobScoring={jobScoring}
        failed={config.isError}
        gateOn={requireScoringConfirmation}
        onGateChange={(on) => {
          setRequireScoringConfirmation(on);
          try {
            localStorage.setItem(GATE_STORAGE_KEY, String(on));
          } catch {
            // persistence is best-effort; the toggle still applies to this session
          }
        }}
        gateDisabled={events.status === 'running'}
      />

      <section aria-label="Live log" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">Live log</h2>
            <p className="text-xs text-muted-foreground">
              Streamed from the sidecar while the run executes.
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground/80">
            {events.lines.length} lines
          </span>
        </div>
        <LogPane lines={events.lines} />
        {events.error !== null && (
          <p className="text-sm text-muted-foreground" data-testid="sse-error-note">
            Live updates stopped: {events.error.message}
          </p>
        )}
        {events.status === 'idle' && (
          <p className="text-sm text-muted-foreground">
            Past runs and their summaries live on the{' '}
            <Link to="/runs" className="underline underline-offset-4 hover:text-foreground">
              Runs
            </Link>{' '}
            page.
          </p>
        )}
      </section>

      {summary !== null && (
        <RunSummaryCard
          summary={summary}
          tokens={
            view.counters === null
              ? null
              : view.counters.promptTokens + view.counters.completionTokens
          }
        />
      )}

      {gateOpen && confirmation !== null && (
        <ScoringConfirmationDialog
          open={!gateDismissed}
          jobsDiscovered={confirmation.jobsDiscovered}
          newOpenAIRequests={confirmation.newOpenAIRequests}
          model={jobScoring?.model}
          deciding={decide.isPending}
          onScore={() => {
            setGateDismissed(true);
            decide.mutate(true);
          }}
          onSkip={() => {
            setGateDismissed(true);
            decide.mutate(false);
          }}
          onDismiss={() => setGateDismissed(true)}
        />
      )}

      <ApiErrorDialog
        error={runFailure}
        title="The run failed"
        onDismiss={() => setRunFailure(null)}
        onAction={
          runFailureActionRoute !== undefined
            ? () => {
                setRunFailure(null);
                void navigate({ to: runFailureActionRoute });
              }
            : undefined
        }
      />

      <ApiErrorDialog
        error={startError}
        title="Couldn't start the pipeline"
        onDismiss={() => setStartError(null)}
        onAction={
          startActionRoute !== undefined
            ? () => {
                setStartError(null);
                void navigate({ to: startActionRoute });
              }
            : undefined
        }
      />

      <ApiErrorDialog
        error={cancelError}
        title="Couldn't cancel the run"
        onDismiss={() => setCancelError(null)}
      />

      <ApiErrorDialog
        error={decisionError}
        title="Couldn't record the scoring decision"
        onDismiss={() => setDecisionError(null)}
      />
    </div>
  );
}
