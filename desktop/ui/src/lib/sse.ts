import { useEffect, useState } from 'react';
import { sidecarBaseUrl } from './sidecar-url';
import { notifyPipelineComplete } from './api';

export interface PipelineEvents {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed' | 'error';
  lines: string[];
  result: unknown | null;
}

export function usePipelineEvents(runId: string | null): PipelineEvents {
  const [state, setState] = useState<PipelineEvents>({ status: 'idle', lines: [], result: null });

  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    let es: EventSource | null = null;
    setState({ status: 'running', lines: [], result: null });
    (async () => {
      const baseUrl = await sidecarBaseUrl();
      if (cancelled) return;
      es = new EventSource(`${baseUrl}/api/pipeline/${runId}/events`);
      es.addEventListener('log', (ev) => {
        const line = (ev as MessageEvent).data as string;
        setState((s) => ({ ...s, lines: [...s.lines, line] }));
      });
      es.addEventListener('done', async (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { status: string; result: unknown };
        setState((s) => ({ ...s, status: data.status as PipelineEvents['status'], result: data.result }));
        es?.close();
        // I1: fire system notification on terminal state
        if (data.status === 'done' || data.status === 'failed' || data.status === 'cancelled') {
          const count = Array.isArray(data.result) ? data.result.length : 0;
          try {
            await notifyPipelineComplete({ status: data.status, count });
          } catch {
            // notification is best-effort; do not surface to user
          }
        }
      });
      es.onerror = () => {
        setState((s) => ({ ...s, status: 'error' }));
        es?.close();
      };
    })();
    return () => {
      cancelled = true;
      if (es !== null) es.close();
    };
  }, [runId]);

  return state;
}
