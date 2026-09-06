import { useEffect, useState } from 'react';
import { resolveSidecar } from './sidecar-url';
import { notifyPipelineComplete } from './api';

export interface PipelineEvents {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed' | 'error';
  lines: string[];
  result: unknown | null;
  /**
   * Non-null when the SSE stream failed (transport error, malformed
   * payload, or JSON.parse throw). UI surfaces this in the LogPane so
   * the user sees a real failure description rather than a bare
   * 'status: error' flip.
   */
  error: Error | null;
}

const initialEvents: PipelineEvents = { status: 'idle', lines: [], result: null, error: null };

export function usePipelineEvents(runId: string | null): PipelineEvents {
  const [state, setState] = useState<PipelineEvents>(initialEvents);

  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    let es: EventSource | null = null;
    setState({ status: 'running', lines: [], result: null, error: null });
    (async () => {
      const baseUrl = (await resolveSidecar()).url;
      if (cancelled) return;
      es = new EventSource(`${baseUrl}/api/pipeline/${runId}/events`);
      es.addEventListener('log', (ev) => {
        const line = (ev as MessageEvent).data as string;
        setState((s) => ({ ...s, lines: [...s.lines, line] }));
      });
      es.addEventListener('done', async (ev) => {
        // Catch malformed payloads and surface them on the error field
        // rather than letting the throw escape the hook and unmount
        // the route (no ErrorBoundary in v1).
        let data: { status: string; result: unknown };
        try {
          data = JSON.parse((ev as MessageEvent).data) as { status: string; result: unknown };
        } catch (cause) {
          const wrapped = cause instanceof Error ? cause : new Error(String(cause));
          setState((s) => ({
            ...s,
            status: 'error',
            error: new Error(`SSE 'done' payload was malformed: ${wrapped.message}`),
          }));
          es?.close();
          return;
        }
        setState((s) => ({
          ...s,
          status: data.status as PipelineEvents['status'],
          result: data.result,
        }));
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
        setState((s) => ({
          ...s,
          status: 'error',
          error: new Error(
            'SSE transport closed unexpectedly. The sidecar may have crashed or ' +
              'lost its connection. Check the desktop app for further details.',
          ),
        }));
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
