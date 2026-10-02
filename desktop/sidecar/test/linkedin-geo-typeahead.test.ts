import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { __resetGeoTypeaheadCacheForTesting } from '../src/routes/linkedin-geo-typeahead.js';

const TYPEAHEAD_URL =
  'https://www.linkedin.com/jobs-guest/api/typeaheadHits' +
  '?typeaheadType=GEO' +
  '&geoTypes=POPULATED_PLACE,ADMIN_DIVISION_2,MARKET_AREA,COUNTRY_REGION' +
  '&query=lisbon';

describe('GET /api/linkedin/geo-typeahead', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let upstreamMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  // Capture the real fetch *before* any test stubs it, so the pass-through
  // spy below can call the real network for non-LinkedIn URLs.
  const realFetch = globalThis.fetch.bind(globalThis);

  afterAll(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    __resetGeoTypeaheadCacheForTesting();
    // Pass-through spy: real fetch handles the test's HTTP call to the
    // sidecar; the mock replaces only the upstream LinkedIn call by URL.
    upstreamMock = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('linkedin.com')) {
        return upstreamMock(url, init) as Promise<Response>;
      }
      return realFetch(input as never, init);
    });
  });

  it('forwards a User-Agent and forwards only GEO hits', async () => {
    upstreamMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: '100', type: 'GEO', displayName: 'Lisbon, Portugal', trackingId: 'abc' },
          { id: '200', type: 'COMPANY', displayName: 'LinkedIn', trackingId: 'def' },
          { id: '300', type: 'GEO', displayName: 'Lisbon, OH', trackingId: 'ghi' },
          // Malformed entry — missing displayName. Should be dropped.
          { id: '400', type: 'GEO' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await fetch(`${baseUrl}/api/linkedin/geo-typeahead?q=lisbon`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      hits: Array<{ id: string; type: string; displayName: string; trackingId: string }>;
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.hits).toEqual([
      { id: '100', type: 'GEO', displayName: 'Lisbon, Portugal', trackingId: 'abc' },
      { id: '300', type: 'GEO', displayName: 'Lisbon, OH', trackingId: 'ghi' },
    ]);

    expect(upstreamMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = upstreamMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(TYPEAHEAD_URL);
    const headers = (calledInit.headers ?? {}) as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/Chrome\//);
    expect(headers['Accept']).toBe('application/json');
  });

  it('returns 400 when q is missing', async () => {
    const res = await fetch(`${baseUrl}/api/linkedin/geo-typeahead`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBeDefined();
    expect(upstreamMock).not.toHaveBeenCalled();
  });

  it('returns 400 when q is empty after trimming', async () => {
    const res = await fetch(`${baseUrl}/api/linkedin/geo-typeahead?q=%20%20`);
    expect(res.status).toBe(400);
    expect(upstreamMock).not.toHaveBeenCalled();
  });

  it('returns 502 when the upstream returns non-2xx', async () => {
    upstreamMock.mockResolvedValueOnce(new Response('upstream down', { status: 503 }));
    const res = await fetch(`${baseUrl}/api/linkedin/geo-typeahead?q=lisbon`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('upstream_http_error');
  });

  it('returns 502 when the upstream response is not valid JSON', async () => {
    upstreamMock.mockResolvedValueOnce(
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await fetch(`${baseUrl}/api/linkedin/geo-typeahead?q=lisbon`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('upstream_parse_error');
  });

  it('returns 502 when the upstream fetch rejects', async () => {
    upstreamMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await fetch(`${baseUrl}/api/linkedin/geo-typeahead?q=lisbon`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('upstream_request_error');
  });
});
