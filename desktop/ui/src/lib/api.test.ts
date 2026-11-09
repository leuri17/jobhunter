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

  it('api.importSources posts multipart with absolute paths as path field parts', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: 'completed',
          counts: { total: 1, extracted: 1, failed: 0, reused: 0 },
          sources: [],
          failedSourcePaths: [],
        }),
        { status: 200 },
      ),
    );
    const result = await api.importSources(['/abs/resume.md']);
    expect(result.schemaVersion).toBe(1);
    const [calledUrl, calledInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(calledUrl).toMatch(/\/api\/profile\/import$/);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBeInstanceOf(FormData);
    expect((calledInit.body as FormData).get('path')).toBe('/abs/resume.md');
  });

  it('throws ApiError on non-2xx', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'bad', message: 'oops' } }), { status: 400 }),
    );
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
  });

  it('api.runPipeline posts the confirmation option as JSON', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ schemaVersion: 1, runId: 'run-1' }), { status: 202 }),
    );
    const result = await api.runPipeline(true);
    expect(result.runId).toBe('run-1');

    const [calledUrl, calledInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(calledUrl).toMatch(/\/api\/pipeline\/run$/);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBe(JSON.stringify({ requireScoringConfirmation: true }));
  });

  it('api.getPipelinePrerequisites hits /api/pipeline/prerequisites', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          openaiKeyConfigured: true,
          activeProfile: { id: 1, contentHash: 'profile-hash' },
          activeFilter: { id: 2, contentHash: 'filter-hash' },
          configHash: 'config-hash',
        }),
        { status: 200 },
      ),
    );
    const result = await api.getPipelinePrerequisites();
    expect(result.activeProfile?.id).toBe(1);

    const [calledUrl] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toMatch(/\/api\/pipeline\/prerequisites$/);
  });

  it('api.getActivePipelineRun hits /api/pipeline/active', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ schemaVersion: 1, runId: null, status: null }), {
        status: 200,
      }),
    );
    const result = await api.getActivePipelineRun();
    expect(result.runId).toBeNull();

    const [calledUrl] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toMatch(/\/api\/pipeline\/active$/);
  });

  it('api.decideScoring posts the decision', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ schemaVersion: 1, status: 'decided', accepted: true }), {
        status: 200,
      }),
    );
    await api.decideScoring('run-1', true);

    const [calledUrl, calledInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(calledUrl).toMatch(/\/api\/pipeline\/run-1\/scoring-decision$/);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBe(JSON.stringify({ accepted: true }));
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

    const [calledUrl, calledInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(calledUrl).toMatch(/\/api\/linkedin\/geo-typeahead\?q=S%C3%A3o%20Paulo$/);
    expect(calledInit.method).toBe('GET');
  });

  it('maps an unparseable non-JSON 5xx body to sidecar_unreachable', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(api.health()).rejects.toMatchObject({
      status: 502,
      code: 'sidecar_unreachable',
      message: expect.not.stringContaining('Bad Gateway'),
    });
  });

  it('keeps unknown/statusText for an unparseable non-JSON 4xx body', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('<html>not found</html>', { status: 404, statusText: 'Not Found' }),
    );
    await expect(api.health()).rejects.toMatchObject({
      status: 404,
      code: 'unknown',
      message: 'Not Found',
    });
  });
});
