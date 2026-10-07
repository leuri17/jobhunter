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

  it('api.geoTypeahead hits /api/linkedin/geo-typeahead with encoded query', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          hits: [{ id: '100', type: 'GEO', displayName: 'Lisbon, Portugal', trackingId: 'abc' }],
        }),
        { status: 200 },
      ),
    );
    const result = await api.geoTypeahead('São Paulo');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.displayName).toBe('Lisbon, Portugal');

    const [calledUrl, calledInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toMatch(/\/api\/linkedin\/geo-typeahead\?q=S%C3%A3o%20Paulo$/);
    expect(calledInit.method).toBe('GET');
  });
});
