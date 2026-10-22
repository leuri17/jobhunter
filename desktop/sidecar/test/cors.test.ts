import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';

describe('CORS', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('echoes the Vite dev server origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('echoes the Tauri webview origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'tauri://localhost' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
  });

  it('accepts any localhost port as the Vite dev server origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:3001' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
  });

  it('does not echo a non-allowlisted origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('omits Access-Control-Allow-Origin when no Origin header is present', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows PATCH in the preflight Access-Control-Allow-Methods', async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'tauri://localhost',
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    expect(res.headers.get('access-control-allow-methods')?.split(/,\s*/)).toContain('PATCH');
  });

  it('allows PUT in the preflight Access-Control-Allow-Methods', async () => {
    const res = await fetch(`${baseUrl}/api/secrets/api-key`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'tauri://localhost',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    expect(res.headers.get('access-control-allow-methods')?.split(/,\s*/)).toContain('PUT');
  });

  it('allows every non-safelisted method the server registers', async () => {
    const tree = server.printRoutes();
    const registered = new Set<string>();
    for (const match of tree.matchAll(/\(([^()]*)\)/g)) {
      for (const token of (match[1] ?? '').split(', ')) {
        if (/^[A-Z]+$/.test(token)) registered.add(token);
      }
    }
    const safelisted = new Set(['GET', 'HEAD', 'POST']);
    const guarded = [...registered].filter((method) => !safelisted.has(method)).sort();
    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded).toContain('PUT');

    for (const method of guarded) {
      const res = await fetch(`${baseUrl}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'tauri://localhost',
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      const allowed = res.headers.get('access-control-allow-methods')?.split(/,\s*/) ?? [];
      expect(allowed, `${method} is not allowed by the CORS allowlist`).toContain(method);
    }
  });
});
