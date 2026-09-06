import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';

describe('profile endpoints', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /api/profile returns a list (possibly empty)', async () => {
    const res = await fetch(`${baseUrl}/api/profile`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemaVersion: number; profiles: unknown[] };
    expect(body.schemaVersion).toBe(1);
    expect(Array.isArray(body.profiles)).toBe(true);
  });
});

describe('POST /api/profile/import multipart guards', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  // Build a minimal multipart/form-data body for a file part. We
  // use FormData + Blob via the WHATWG fetch body types so the
  // Content-Type + boundary are set correctly.
  function buildMultipart(
    parts: { name: string; filename: string; mime: string; body: string }[],
  ): { body: FormData; headers: Record<string, string> } {
    const form = new FormData();
    for (const p of parts) {
      form.append(p.name, new Blob([p.body], { type: p.mime }), p.filename);
    }
    return { body: form, headers: {} }; // boundary auto-set by fetch
  }

  it('rejects a request whose file mimetype is not in the allowlist', async () => {
    const { body } = buildMultipart([
      { name: 'file', filename: 'evil.html', mime: 'text/html', body: '<script>1</script>' },
    ]);
    const res = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body });
    expect(res.status).toBe(415);
    const errBody = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(errBody.error?.code).toBe('unsupported_profile_mime_type');
    // Response must not echo the attacker-controlled filename or mimetype.
    const asString = JSON.stringify(errBody);
    expect(asString).not.toContain('evil.html');
    expect(asString).not.toContain('text/html');
  });

  it('accepts a text/plain file and ignores the body (v1 filename-only contract)', async () => {
    // The handler in v1 doesn't read the file body, only the filename.
    // The desktop UI passes absolute paths in `filename`. We use a
    // path that resolves to a real file the test setup can read, or
    // accept that the importer will fail at the file-not-found step
    // (a 4xx from the importer rather than 415 from the guard).
    const { body } = buildMultipart([
      { name: 'file', filename: '/nonexistent.txt', mime: 'text/plain', body: 'ignored' },
    ]);
    const res = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body });
    // Either the importer fails (4xx) or the guard accepts and the
    // importer returns 200. Either way, NOT 415.
    expect(res.status).not.toBe(415);
  });

  it('accepts a PDF file and rejects the body rejection path', async () => {
    const { body } = buildMultipart([
      { name: 'file', filename: '/nonexistent.pdf', mime: 'application/pdf', body: 'ignored' },
    ]);
    const res = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body });
    expect(res.status).not.toBe(415);
  });

  it('accepts a Markdown file', async () => {
    const { body } = buildMultipart([
      { name: 'file', filename: '/nonexistent.md', mime: 'text/markdown', body: 'ignored' },
    ]);
    const res = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body });
    expect(res.status).not.toBe(415);
  });

  it('rejects an octet-stream payload (not in the allowlist)', async () => {
    const { body } = buildMultipart([
      { name: 'file', filename: 'data.bin', mime: 'application/octet-stream', body: 'x' },
    ]);
    const res = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body });
    expect(res.status).toBe(415);
  });
});
