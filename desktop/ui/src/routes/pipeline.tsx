import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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

  const start = useMutation({
    mutationFn: api.runPipeline,
    onSuccess: (data) => setRunId(data.runId),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelPipeline(runId as unknown as string),
  });

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">Pipeline</h1>

      <div className="flex gap-2 items-center">
        <Button onClick={() => start.mutate()} disabled={start.isPending || events.status === 'running'}>
          {start.isPending ? 'starting…' : 'Run pipeline'}
        </Button>
        <Button variant="destructive" onClick={() => cancel.mutate()} disabled={runId === null || events.status !== 'running'}>
          Cancel
        </Button>
        <span className="self-center text-sm text-zinc-400">status: {events.status}</span>
      </div>

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
