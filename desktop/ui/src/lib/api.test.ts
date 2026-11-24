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

  describe('provider-scoped calls (#359)', () => {
    function lastCall(): [string, RequestInit] {
      return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    }

    function respond(body: unknown): void {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify(body), { status: 200 }),
      );
    }

    it('api.getApiKeyStatus asks for one provider', async () => {
      respond({ schemaVersion: 1, configured: false, source: 'none', provider: 'groq' });
      await api.getApiKeyStatus('groq');
      expect(lastCall()[0]).toMatch(/[?&]provider=groq(&|$)/);
    });

    it('api.getApiKeyStatus without a provider leaves the choice to the saved config', async () => {
      respond({ schemaVersion: 1, configured: false, source: 'none', provider: 'openrouter' });
      await api.getApiKeyStatus();
      const url = lastCall()[0];
      expect(url).toMatch(/\/api\/secrets\/api-key$/);
      expect(url).not.toMatch(/provider=/);
    });

    it('api.setApiKey sends the provider with the key', async () => {
      respond({ schemaVersion: 1, status: 'validated', configured: true, provider: 'groq' });
      await api.setApiKey('sk-test-1', { provider: 'groq' });
      const [url, init] = lastCall();
      expect(url).toMatch(/\/api\/secrets\/api-key$/);
      expect(JSON.parse(init.body as string)).toEqual({ apiKey: 'sk-test-1', provider: 'groq' });
    });

    it('api.setApiKey includes the custom base URL and the plaintext flag only when given', async () => {
      respond({ schemaVersion: 1, status: 'validated', configured: true, provider: 'custom' });
      await api.setApiKey('sk-test-1', {
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
        allowPlaintextFallback: true,
      });
      const [, init] = lastCall();
      expect(JSON.parse(init.body as string)).toEqual({
        apiKey: 'sk-test-1',
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
        allowPlaintextFallback: true,
      });
    });

    it('api.clearApiKey removes one provider', async () => {
      respond({ schemaVersion: 1, configured: false, source: 'none', provider: 'openai' });
      await api.clearApiKey('openai');
      const [url, init] = lastCall();
      expect(url).toMatch(/[?&]provider=openai(&|$)/);
      expect(init.method).toBe('DELETE');
    });

    it('api.listAiProviderModels asks for the selected provider', async () => {
      respond({ schemaVersion: 1, configured: true, models: ['m'] });
      await api.listAiProviderModels({ provider: 'groq' });
      const [url] = lastCall();
      expect(url).toMatch(/\/api\/ai-provider\/models\?provider=groq$/);
    });

    it('api.listAiProviderModels encodes a custom base URL', async () => {
      respond({ schemaVersion: 1, configured: true, models: ['m'] });
      await api.listAiProviderModels({
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
      });
      const [url] = lastCall();
      expect(url).toMatch(
        /\/api\/ai-provider\/models\?provider=custom&baseUrl=https%3A%2F%2Fcompat-proxy\.example%2Fv1$/,
      );
    });
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
          aiProviderKeyConfigured: true,
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

  it('api.createDefaultFilter hits /api/filters/default', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          filter: { id: 1, contentHash: 'filter-hash' },
          created: true,
        }),
        { status: 200 },
      ),
    );
    const result = await api.createDefaultFilter();
    expect(result.created).toBe(true);
    expect(result.filter.id).toBe(1);

    const [calledUrl, calledInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(calledUrl).toMatch(/\/api\/filters\/default$/);
    expect(calledInit.method).toBe('POST');
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
