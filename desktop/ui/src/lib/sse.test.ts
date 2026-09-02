// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePipelineEvents } from './sse.js';

// Mock EventSource so the test can capture the URL it was constructed with.
const lastUrl = vi.fn();
class MockEventSource {
  url: string;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    lastUrl(url);
  }
  addEventListener(_type: string, _listener: EventListenerOrEventListenerObject): void {}
  removeEventListener(): void {}
  close(): void {}
  dispatchEvent(): boolean {
    return true;
  }
}
(globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;

beforeEach(() => {
  lastUrl.mockClear();
});

describe('usePipelineEvents', () => {
  it('passes the resolved sidecarBaseUrl() (not the Promise) to EventSource', async () => {
    const { result } = renderHook(() => usePipelineEvents('run_xyz'));
    // The hook's effect schedules a microtask via await sidecarBaseUrl().
    // Flush microtasks + pending state updates.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastUrl).toHaveBeenCalledTimes(1);
    const url = lastUrl.mock.calls[0]?.[0] as string | undefined;
    expect(url).toBeDefined();
    expect(url).not.toContain('[object Promise]');
    expect(url).toContain('/api/pipeline/run_xyz/events');
    expect(url!.startsWith('http://127.0.0.1:')).toBe(true);
    // The state should have transitioned to running.
    expect(result.current.status).toBe('running');
  });
});

