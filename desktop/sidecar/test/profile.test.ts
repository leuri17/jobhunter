import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildServer } from '../src/server.js';
import {
  initializeDatabase,
  createRepositories,
  resolveRepoRootForMigrations,
  schema,
} from '@jobhunter/core/persistence';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';

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
      sources: { id: number; originalFilename: string; storedPath: string }[];
    };
    expect(listBody.schemaVersion).toBe(1);
    const target = listBody.sources.find((s) => s.originalFilename === 'resume.md');
    expect(target).toBeDefined();
    expect(existsSync(dirname(target!.storedPath))).toBe(true);

    const del = await fetch(`${baseUrl}/api/profile/sources/${target!.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ schemaVersion: 1, removed: true });
    expect(existsSync(dirname(target!.storedPath))).toBe(false);

    const after = await fetch(`${baseUrl}/api/profile/sources`);
    const afterBody = (await after.json()) as { sources: { id: number }[] };
    expect(afterBody.sources.find((s) => s.id === target!.id)).toBeUndefined();
  });

  it('DELETE tolerates a missing storage folder', async () => {
    const tempFile = join(configHome, 'orphan.md');
    writeFileSync(tempFile, '# Orphan', 'utf-8');
    const form = new FormData();
    form.append('path', tempFile);
    await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body: form });
    const list = (await (await fetch(`${baseUrl}/api/profile/sources`)).json()) as {
      sources: { id: number; originalFilename: string; storedPath: string }[];
    };
    const row = list.sources.find((s) => s.originalFilename === 'orphan.md');
    expect(row).toBeDefined();
    rmSync(dirname(row!.storedPath), { recursive: true, force: true });
    const del = await fetch(`${baseUrl}/api/profile/sources/${row!.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = (await (await fetch(`${baseUrl}/api/profile/sources`)).json()) as {
      sources: { id: number }[];
    };
    expect(after.sources.find((s) => s.id === row!.id)).toBeUndefined();
  });

  it('DELETE returns 404 for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/profile/sources/999999`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('profile_source_not_found');
  });

  it('rejects imports beyond the 2-source library cap with 400', async () => {
    const files = ['cap-one.md', 'cap-two.md', 'cap-three.md'].map((name) => {
      const p = join(configHome, name);
      writeFileSync(p, `# ${name}`, 'utf-8');
      return p;
    });
    const form12 = new FormData();
    form12.append('path', files[0]!);
    form12.append('path', files[1]!);
    const ok = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body: form12 });
    expect(ok.status).toBe(200);

    const form3 = new FormData();
    form3.append('path', files[2]!);
    const res = await fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body: form3 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('profile_source_limit_reached');

    const list = (await (await fetch(`${baseUrl}/api/profile/sources`)).json()) as {
      sources: { id: number }[];
    };
    for (const s of list.sources) {
      const del = await fetch(`${baseUrl}/api/profile/sources/${s.id}`, { method: 'DELETE' });
      expect(del.status).toBe(200);
    }
  });
});

describe('POST /api/profile/:id/edit', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let configHome: string;

  beforeAll(async () => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-profile-edit-'));
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

  function profileFixture(id: string): Record<string, unknown> {
    return {
      schemaVersion: 1,
      id,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      contentHash: 'client-hash-ignored',
      sourceIds: [],
      basics: {
        fullName: 'Alex Vance',
        email: 'alex@example.com',
        phone: null,
        headline: 'Staff Engineer',
        professionalSummary: null,
        currentLocation: 'Berlin',
        totalYearsOfExperience: 9,
      },
      experience: [],
      skills: [],
      languages: [],
      education: [],
      certifications: [],
      projects: [],
      derived: {
        likelySeniority: {
          generatedValue: null,
          overrideActive: false,
          overrideValue: null,
          effectiveValue: null,
          generatedAt: null,
          overriddenAt: null,
        },
        primaryRoles: {
          generatedValue: [],
          overrideActive: false,
          overrideValue: null,
          effectiveValue: [],
          generatedAt: null,
          overriddenAt: null,
        },
        primaryDomains: {
          generatedValue: [],
          overrideActive: false,
          overrideValue: null,
          effectiveValue: [],
          generatedAt: null,
          overriddenAt: null,
        },
        strongestSkills: {
          generatedValue: [],
          overrideActive: false,
          overrideValue: null,
          effectiveValue: [],
          generatedAt: null,
          overriddenAt: null,
        },
      },
    };
  }

  async function seedProfileVersion(
    status: 'draft' | 'approved' | 'rejected' | 'superseded',
  ): Promise<string> {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const handle = await initializeDatabase(paths, {
      migrationsFolder: resolveRepoRootForMigrations(),
    });
    try {
      const repos = createRepositories(handle);
      const profileId = `prf_${Math.random().toString(36).slice(2, 10)}`;
      const inserted = repos.db
        .insert(schema.profileVersions)
        .values({
          status,
          schemaVersion: 1,
          contentHash: 'seeded',
          extractionFingerprint: 'fp',
          sourceIdsJson: '[]',
          profileJson: JSON.stringify(profileFixture(profileId)),
          model: 'gpt-5',
          reasoningEffort: 'medium',
          promptVersion: 'p1',
          structuredOutputSchemaVersion: 2,
          extractorImplementationVersion: 'e1',
          createdAt: '2026-11-02T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
          approvedAt: null,
          supersededAt: null,
          active: false,
        })
        .returning({ id: schema.profileVersions.id })
        .all();
      return `profile_${inserted[0]!.id}`;
    } finally {
      handle.close();
    }
  }

  it('saves a valid edit to a draft and persists the changes', async () => {
    const draftId = await seedProfileVersion('draft');
    const res = await fetch(`${baseUrl}/api/profile/${draftId}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profileFixture('prf_edited') }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schemaVersion: 1, status: 'draft', derived: false });

    const detail = await fetch(`${baseUrl}/api/profile/${draftId}`);
    const detailBody = (await detail.json()) as {
      profile: { basics: { fullName: string | null }; contentHash: string };
    };
    expect(detailBody.profile.basics.fullName).toBe('Alex Vance');
    expect(detailBody.profile.contentHash).not.toBe('client-hash-ignored');
  });

  it('returns 400 with invalid_profile_json for a malformed profile', async () => {
    const draftId = await seedProfileVersion('draft');
    const broken = profileFixture('prf_broken');
    delete broken['basics'];
    const res = await fetch(`${baseUrl}/api/profile/${draftId}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: broken }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('invalid_profile_json');
    expect(body.error.details).not.toBeNull();
  });

  it('approves an extraction-shaped draft via the profile_<int> form', async () => {
    // Extraction mints `profile_<hex>` JSON ids; the UI addresses
    // versions as `profile_<int>`. This pins the resolver interplay.
    const versionId = await seedProfileVersion('draft', 'profile_ab12cd34ef56');
    const res = await fetch(`${baseUrl}/api/profile/${versionId}/approve`, { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('rejects the raw hex JSON id with invalid_identifier (no scan fallback for profile_-prefixed ids)', async () => {
    await seedProfileVersion('draft', 'profile_ff9977aa11bb');
    const res = await fetch(`${baseUrl}/api/profile/profile_ff9977aa11bb/approve`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_identifier');
  });

  it('returns 409 when the target is superseded', async () => {
    const id = await seedProfileVersion('superseded');
    const res = await fetch(`${baseUrl}/api/profile/${id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profileFixture('prf_any') }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('profile_not_editable');
  });
});
