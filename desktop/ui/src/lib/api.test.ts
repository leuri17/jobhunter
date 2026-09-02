import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from './api';

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('api.health calls /api/health', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ schemaVersion: 1, status: 'ok' }), { status: 200 }),
    );
    const result = await api.health();
    expect(result.status).toBe('ok');
  });

  it('throws ApiError on non-2xx', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'bad', message: 'oops' } }), { status: 400 }),
    );
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
  });
});