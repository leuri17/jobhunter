import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { pingSidecar, resolveSidecar, type SidecarResolution } from './sidecar-url';

const mockedInvoke = vi.mocked(invoke);

describe('resolveSidecar', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the IPC port when invoke resolves', async () => {
    mockedInvoke.mockResolvedValueOnce(54321);
    const result = await resolveSidecar();
    expect(result).toEqual<SidecarResolution>({
      url: 'http://127.0.0.1:54321',
      isFallback: false,
    });
  });

  it('returns the empty fallback when invoke rejects (component-test / unhinged runtime)', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('not running under Tauri'));
    const result = await resolveSidecar();
    expect(result).toEqual<SidecarResolution>({
      url: '',
      isFallback: true,
    });
  });

  it('treats invoke returning null as a fallback signal', async () => {
    mockedInvoke.mockResolvedValueOnce(null as unknown as number);
    const result = await resolveSidecar();
    expect(result.isFallback).toBe(true);
    expect(result.url).toBe('');
  });

  it('ignores VITE_SIDECAR_PORT (the browser-only dev loop was removed in feat/hmr-split-dev)', async () => {
    process.env['VITE_SIDECAR_PORT'] = '4000';
    try {
      mockedInvoke.mockRejectedValueOnce(new Error('not running under Tauri'));
      const result = await resolveSidecar();
      // The variable is silently ignored; we fall through to the empty fallback.
      expect(result).toEqual<SidecarResolution>({ url: '', isFallback: true });
    } finally {
      delete process.env['VITE_SIDECAR_PORT'];
    }
  });
});

describe('pingSidecar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when /api/health returns 2xx', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
    const reachable = await pingSidecar('http://127.0.0.1:14231');
    expect(reachable).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:14231/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns false when /api/health returns non-2xx', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('nope', { status: 500 }),
    );
    const reachable = await pingSidecar('http://127.0.0.1:14231');
    expect(reachable).toBe(false);
  });

  it('returns false when fetch rejects (port not bound)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('Failed to fetch'),
    );
    const reachable = await pingSidecar('http://127.0.0.1:14231');
    expect(reachable).toBe(false);
  });

  it('returns false when fetch exceeds the 2s timeout', async () => {
    // Simulate a hanging connection: the AbortController should kick in.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const reachable = await pingSidecar('http://127.0.0.1:14231');
    expect(reachable).toBe(false);
  });
});
