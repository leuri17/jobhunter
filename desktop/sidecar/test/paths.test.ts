import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';

describe('GET /api/paths', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns resolved paths', async () => {
    const res = await fetch(`${baseUrl}/api/paths`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemaVersion: number; paths: Record<string, string> };
    expect(body.schemaVersion).toBe(1);
    for (const key of ['config', 'data', 'logs', 'diagnostics', 'cache', 'profileSources']) {
      expect(typeof body.paths[key]).toBe('string');
      expect(body.paths[key].length).toBeGreaterThan(0);
    }
  });
});
