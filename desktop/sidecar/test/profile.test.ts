import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('profile source routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let configHome: string;

  beforeAll(async () => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-profile-sources-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    vi.stubEnv('HOME', configHome);
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
    vi.unstubAllEnvs();
    rmSync(configHome, { recursive: true, force: true });
  });

  it('lists imported sources and deletes by id', async () => {
    const tempFile = join(configHome, 'resume.md');
    writeFileSync(tempFile, '# Alex Vance\nReact developer', 'utf-8');
    const form = new FormData();
    form.append('path', tempFile);
    const imported = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body: form });
    expect(imported.status).toBe(200);

    const list = await fetch(`${baseUrl}/api/profile/sources`);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      schemaVersion: number;
      sources: { id: number; originalFilename: string }[];
    };
    expect(listBody.schemaVersion).toBe(1);
    const target = listBody.sources.find((s) => s.originalFilename === 'resume.md');
    expect(target).toBeDefined();

    const del = await fetch(`${baseUrl}/api/profile/sources/${target!.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ schemaVersion: 1, removed: true });

    const after = await fetch(`${baseUrl}/api/profile/sources`);
    const afterBody = (await after.json()) as { sources: { id: number }[] };
    expect(afterBody.sources.find((s) => s.id === target!.id)).toBeUndefined();
  });

  it('DELETE returns 404 for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/profile/sources/999999`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('profile_source_not_found');
  });
});
