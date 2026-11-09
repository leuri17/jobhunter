import { createRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { usePipelineEvents } from '@/lib/sse';
import { LogPane } from '@/components/shared/ui/log-pane';
import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Route as rootRoute } from './__root';

// Pipeline (`/pipeline`). Live pipeline runner UI: Start Run button,
// SSE-driven status + log lines via `usePipelineEvents`, Cancel
// button (only enabled while running), and a completion summary
// rendered from the final `done` event's `result` payload. Failures
// surface through `ApiErrorDialog`: a failed start via the mutation
// error, a failed run via the terminal event's error payload.

// Error codes whose guidance names a page to open — the copy lives in
// CODE_GUIDANCE (`lib/error-surfaces.ts`), the destination here.
const ACTION_ROUTES: Partial<Record<string, string>> = {
  no_active_profile: '/profile',
  openai_unavailable: '/settings',
  openai_api_key_missing: '/settings',
};

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
  const events = usePipelineEvents(runId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const start = useMutation({
    mutationFn: api.runPipeline,
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

  const startActionRoute = startError !== null ? ACTION_ROUTES[startError.code] : undefined;
  const runFailureActionRoute = runFailure !== null ? ACTION_ROUTES[runFailure.code] : undefined;

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">Pipeline</h1>

      <div className="flex gap-2 items-center">
        <Button
          onClick={() => start.mutate()}
          disabled={start.isPending || events.status === 'running'}
        >
          {start.isPending ? 'starting…' : 'Run pipeline'}
        </Button>
        <Button
          variant="destructive"
          onClick={() => cancel.mutate()}
          disabled={runId === null || events.status !== 'running'}
        >
          Cancel
        </Button>
        <span className="self-center text-sm text-zinc-400">status: {events.status}</span>
      </div>

      {events.error !== null && (
        <p className="text-sm text-muted-foreground" data-testid="sse-error-note">
          Live updates stopped: {events.error.message}
        </p>
      )}

      <LogPane lines={events.lines} />

      {events.result !== null && (
        <div className="rounded border border-border bg-card p-4">
          <h3 className="font-bold mb-2">Result</h3>
          <pre className="text-xs">{JSON.stringify(events.result, null, 2)}</pre>
        </div>
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
    </div>
  );
}
