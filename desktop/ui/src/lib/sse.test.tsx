// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { usePipelineEvents, type PipelineEvents } from './sse';

type FakeListener = (ev: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, FakeListener>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    const listener = this.listeners.get(type);
    if (listener !== undefined) listener({ data });
  }
}

let latest: PipelineEvents | null = null;

function Probe({ runId }: { runId: string | null }) {
  latest = usePipelineEvents(runId);
  return null;
}

describe('usePipelineEvents', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    latest = null;
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures the run error from a failed done event', async () => {
    render(<Probe runId="run-1" />);
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    es.emit(
      'done',
      JSON.stringify({
        status: 'failed',
        result: null,
        error: { code: 'no_active_profile', message: 'No active approved profile.' },
      }),
    );
    await waitFor(() => {
      expect(latest?.status).toBe('failed');
      expect(latest?.runError).toEqual({
        code: 'no_active_profile',
        message: 'No active approved profile.',
      });
    });
  });

  it('keeps runError null when a done event carries no error', async () => {
    render(<Probe runId="run-2" />);
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    es.emit('done', JSON.stringify({ status: 'done', result: { summary: {} } }));
    await waitFor(() => {
      expect(latest?.status).toBe('done');
    });
    expect(latest?.runError).toBeNull();
  });

  it('collects progress events and raises pendingConfirmation', async () => {
    render(<Probe runId="run-3" />);
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    es.emit('progress', JSON.stringify({ type: 'run_start', runId: 1, searchesPlanned: 2 }));
    es.emit(
      'progress',
      JSON.stringify({ type: 'confirmation_required', jobsDiscovered: 3, newOpenAIRequests: 2 }),
    );
    await waitFor(() => {
      expect(latest?.progress.map((e) => e.type)).toEqual(['run_start']);
    });
    expect(latest?.pendingConfirmation).toEqual({ jobsDiscovered: 3, newOpenAIRequests: 2 });
  });

  it('clears pendingConfirmation when the run ends', async () => {
    render(<Probe runId="run-4" />);
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    es.emit(
      'progress',
      JSON.stringify({ type: 'confirmation_required', jobsDiscovered: 1, newOpenAIRequests: 1 }),
    );
    await waitFor(() => {
      expect(latest?.pendingConfirmation).toEqual({ jobsDiscovered: 1, newOpenAIRequests: 1 });
    });
    es.emit('done', JSON.stringify({ status: 'cancelled', result: null }));
    await waitFor(() => {
      expect(latest?.status).toBe('cancelled');
    });
    expect(latest?.pendingConfirmation).toBeNull();
  });
});
