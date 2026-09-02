import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildServer } from '../src/server.js';

describe('pipeline endpoints', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
    vi.unstubAllEnvs();
  });

  it('POST /api/pipeline/run returns 503 when OPENAI_API_KEY is missing', async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
    expect(res.status).toBe(503);
    const body = await res.json() as {
      schemaVersion: number;
      error: { code: string; message: string };
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.error.code).toBe('openai_unavailable');
  });
});
