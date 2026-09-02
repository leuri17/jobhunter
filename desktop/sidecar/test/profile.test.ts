import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';

describe('profile endpoints', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => { await server.close(); });

  it('GET /api/profile returns a list (possibly empty)', async () => {
    const res = await fetch(`${baseUrl}/api/profile`);
    expect(res.status).toBe(200);
    const body = await res.json() as { schemaVersion: number; profiles: unknown[] };
    expect(body.schemaVersion).toBe(1);
    expect(Array.isArray(body.profiles)).toBe(true);
  });
});
