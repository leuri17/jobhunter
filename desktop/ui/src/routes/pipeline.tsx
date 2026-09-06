import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePipelineEvents } from '@/lib/sse';
import { LogPane } from '@/components/log-pane';
import { Button } from '@/components/ui/button';
import { Route as rootRoute } from './__root';

// Pipeline (`/pipeline`). Live pipeline runner UI: Start Run button,
// SSE-driven status + log lines via `usePipelineEvents`, Cancel
// button (only enabled while running), and a completion summary
// rendered from the final `done` event's `result` payload.
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pipeline',
  component: PipelinePage,
});

function PipelinePage() {
  const [runId, setRunId] = useState<string | null>(null);
  const events = usePipelineEvents(runId);
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: api.runPipeline,
    onSuccess: (data) => {
      setRunId(data.runId);
      // The new run shows up on /runs immediately; refresh the runs
      // list so navigating there doesn't show a stale 'last seen at'.
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelPipeline(runId as unknown as string),
    onSuccess: () => {
      // Cancel transitions the run to 'cancelled' and updates
      // jobsScored on the run record. Refresh the runs list so
      // /runs reflects the new status without a manual remount.
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

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
        <div
          role="alert"
          aria-live="assertive"
          data-testid="sse-error"
          className="rounded border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-100"
        >
          <p className="font-semibold mb-1">Live event stream failed</p>
          <p className="text-red-200">{events.error.message}</p>
        </div>
      )}

      <LogPane lines={events.lines} />

      {events.result !== null && (
        <div className="rounded border border-border bg-card p-4">
          <h3 className="font-bold mb-2">Result</h3>
          <pre className="text-xs">{JSON.stringify(events.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
