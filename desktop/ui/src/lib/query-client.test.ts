import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { shouldRetryQuery, queryRetryDelay, queryClient } from './query-client';

describe('query retry policy', () => {
  describe('shouldRetryQuery', () => {
    it('does not retry when the error is an ApiError', () => {
      const err = new ApiError(404, 'not_found', 'nope');
      expect(shouldRetryQuery(1, err)).toBe(false);
      expect(shouldRetryQuery(2, err)).toBe(false);
      expect(shouldRetryQuery(5, err)).toBe(false);
    });

    // TanStack Query's retry is called with failureCount starting at 1 for
    // the first failure. The predicate returns true for non-ApiError
    // failures while failureCount < 2, so attempt 1 fails -> retry, attempt
    // 2 fails -> give up. Net: one retry.
    it('retries once for non-ApiError failures (network / transport)', () => {
      expect(shouldRetryQuery(1, new TypeError('fetch failed'))).toBe(true);
      expect(shouldRetryQuery(2, new TypeError('fetch failed'))).toBe(false);
      expect(shouldRetryQuery(3, new TypeError('fetch failed'))).toBe(false);
    });

    it('retries once for plain Error (covers parse / unknown)', () => {
      expect(shouldRetryQuery(1, new Error('json parse'))).toBe(true);
      expect(shouldRetryQuery(2, new Error('json parse'))).toBe(false);
    });
  });

  describe('queryRetryDelay', () => {
    it('uses exponential backoff capped at 5s', () => {
      expect(queryRetryDelay(0)).toBe(1000);
      expect(queryRetryDelay(1)).toBe(2000);
      expect(queryRetryDelay(2)).toBe(4000);
      expect(queryRetryDelay(3)).toBe(5000); // capped from 8000
      expect(queryRetryDelay(4)).toBe(5000); // capped
    });
  });

  describe('queryClient integration', () => {
    it('configures the QueryClient with the retry predicate and delay', () => {
      const defaults = queryClient.getDefaultOptions();
      expect(defaults.queries?.retry).toBe(shouldRetryQuery);
      expect(defaults.queries?.retryDelay).toBe(queryRetryDelay);
    });
  });
});

describe('api retry behaviour', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drives a transient failure through one retry then succeeds', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ schemaVersion: 1, status: 'ok' }), { status: 200 }),
      );

    // Construct a one-off client so the retry policy under test isn't
    // shared with the production queryClient's in-flight cache.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay },
      },
    });

    // The QueryFn that mirrors api.health's contract: a fetch that
    // either resolves with a healthy body or rejects.
    const queryFn = vi.fn(async () => {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('bad status');
      return (await res.json()) as { schemaVersion: number; status: string };
    });

    // First call: TypeError -> retry. Second call: success.
    const result = await client.fetchQuery({
      queryKey: ['health'],
      queryFn,
    });
    expect(result.status).toBe('ok');
    expect(queryFn).toHaveBeenCalledTimes(2);
    // Sanity: the underlying fetch was hit twice (once failing, once succeeding).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    client.clear();
  });

  it('does not retry an ApiError', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'bad', message: 'oops' } }), { status: 400 }),
    );

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay },
      },
    });
    const queryFn = vi.fn(async () => api.health());

    await expect(
      client.fetchQuery({ queryKey: ['health'], queryFn }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(queryFn).toHaveBeenCalledTimes(1);

    client.clear();
  });
});