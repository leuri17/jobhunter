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
    // Ensure the build-time env var does not leak across tests.
    vi.stubEnv('VITE_SIDECAR_PORT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('falls back to VITE_SIDECAR_PORT when invoke rejects', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('not running under Tauri'));
    vi.stubEnv('VITE_SIDECAR_PORT', '4000');
    const result = await resolveSidecar();
    expect(result).toEqual<SidecarResolution>({
      url: 'http://127.0.0.1:4000',
      isFallback: false,
    });
  });

  it('marks isFallback when invoke rejects and env is unset', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('not running under Tauri'));
    vi.stubEnv('VITE_SIDECAR_PORT', '');
    const result = await resolveSidecar();
    expect(result).toEqual<SidecarResolution>({
      url: 'http://127.0.0.1:14231',
      isFallback: true,
    });
  });

  it('treats invoke returning null as a fallback signal', async () => {
    mockedInvoke.mockResolvedValueOnce(null as unknown as number);
    vi.stubEnv('VITE_SIDECAR_PORT', '');
    const result = await resolveSidecar();
    expect(result.isFallback).toBe(true);
    expect(result.url).toBe('http://127.0.0.1:14231');
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
