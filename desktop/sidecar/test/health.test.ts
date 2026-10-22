import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Writable } from 'node:stream';
import { pino, type Logger as PinoLogger } from 'pino';
import { buildServer, healthProbeLogging } from '../src/server.js';

describe('GET /api/health', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 with {status:"ok"}', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});

interface CapturedRecord {
  readonly level: number;
  readonly msg?: string;
  readonly [key: string]: unknown;
}

describe('GET /api/health request logging', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let records: CapturedRecord[];

  beforeAll(async () => {
    const captured: CapturedRecord[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback): void {
        captured.push(JSON.parse(String(chunk)) as CapturedRecord);
        callback();
      },
    });
    records = captured;
    server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      rootLogger: pino({ level: 'info' }, stream) satisfies PinoLogger,
    });
    server.get('/api/health-failing-stub', healthProbeLogging(), async () => {
      throw new Error('health probe stub failure');
    });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('writes no log records for a successful probe', async () => {
    await fetch(`${baseUrl}/api/paths`);
    await vi.waitFor(() => {
      expect(records.length).toBeGreaterThan(0);
    });
    records.length = 0;

    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ schemaVersion: 1, status: 'ok' });
    expect(records).toEqual([]);
  });

  it('still logs a failing probe at error level', async () => {
    const res = await fetch(`${baseUrl}/api/health-failing-stub`);
    expect(res.status).toBe(500);
    await vi.waitFor(() => {
      expect(records.some((r) => r['msg'] === 'health probe failed')).toBe(true);
    });
    const failure = records.find((r) => r['msg'] === 'health probe failed');
    expect(failure?.['level']).toBe(50);
    expect(failure?.['url']).toBe('/api/health-failing-stub');
    expect(failure?.['statusCode']).toBe(500);
  });
});
