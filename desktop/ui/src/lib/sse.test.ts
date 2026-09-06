// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the sidecar-url module so we control the resolved URL.
// We don't care about the sidecar URL semantics here — only that the
// hook receives a non-Promise string and threads it into EventSource.
vi.mock('./sidecar-url.js', () => ({
  resolveSidecar: vi.fn(() =>
    Promise.resolve({ url: 'http://127.0.0.1:54321', isFallback: false }),
  ),
  pingSidecar: vi.fn(() => Promise.resolve(true)),
}));

import { usePipelineEvents } from './sse.js';

// Test helpers — let each test inject its own MockEventSource and
// capture the event listeners. The previous version baked a single
// mock into module scope which made multi-listener tests impossible.
type Listener = (ev: MessageEvent) => void;

interface MockEventSourceHandle {
  fire: (type: string, data: string) => void;
  fireError: () => void;
  close: () => void;
}

let nextMock: MockEventSourceHandle | null = null;

class MockEventSource {
  url: string;
  onerror: ((ev: Event) => void) | null = null;
  private listeners: Map<string, Listener[]> = new Map();
  constructor(url: string) {
    this.url = url;
    // Record the construction so tests can fire events on the
    // most-recently-constructed instance without aliasing `this`.
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const l = listener as unknown as Listener;
    const arr = this.listeners.get(type) ?? [];
    arr.push(l);
    this.listeners.set(type, arr);
  }
  removeEventListener(): void {}
  close(): void {
    nextMock?.close();
  }
  dispatchEvent(): boolean {
    return true;
  }
  // Test-only helpers (exposed via the handle, not on EventSource).
  __fire(type: string, data: string): void {
    for (const l of this.listeners.get(type) ?? []) l({ data } as unknown as MessageEvent);
  }
  __fireError(): void {
    this.onerror?.(new Event('error'));
  }
  static instances: MockEventSource[] = [];
}
function recentInstance(): MockEventSource | null {
  return MockEventSource.instances[MockEventSource.instances.length - 1] ?? null;
}
(globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;

beforeEach(() => {
  nextMock = null;
  MockEventSource.instances = [];
});

describe('usePipelineEvents', () => {
  it('passes the resolved sidecar URL (not the Promise) to EventSource', async () => {
    const { result } = renderHook(() => usePipelineEvents('run_xyz'));
    // The hook's effect schedules a microtask via await resolveSidecar().
    // Flush microtasks + pending state updates.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const last = recentInstance();
    expect(last).not.toBeNull();
    // The original assertion was that the URL passed to EventSource is
    // the resolved string, not the Promise itself.
    expect(last!.url).not.toContain('[object Promise]');
    expect(last!.url).toContain('/api/pipeline/run_xyz/events');
    expect(last!.url.startsWith('http://127.0.0.1:54321')).toBe(true);
    // State should have transitioned to running.
    expect(result.current.status).toBe('running');
  });

  it('populates the error field on transport error and sets status=error', async () => {
    const { result } = renderHook(() => usePipelineEvents('run_xyz2'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const last = recentInstance();
    expect(last).not.toBeNull();
    act(() => {
      last!.__fireError();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toMatch(/transport closed/i);
  });

  it('populates the error field when the done payload is malformed JSON', async () => {
    const { result } = renderHook(() => usePipelineEvents('run_xyz3'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const last = recentInstance();
    expect(last).not.toBeNull();
    act(() => {
      last!.__fire('done', 'this is not valid JSON');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toMatch(/malformed/i);
  });

  it('happy path: a clean run leaves error=null', async () => {
    const { result } = renderHook(() => usePipelineEvents('run_xyz4'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const last = recentInstance();
    expect(last).not.toBeNull();
    act(() => {
      last!.__fire('log', 'extracting job 1');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('running');
    expect(result.current.lines).toEqual(['extracting job 1']);
  });
});
