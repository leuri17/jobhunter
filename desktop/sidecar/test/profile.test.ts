import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { buildServer } from '../src/server.js';
import { assertFilenameWithinProfileSources } from '../src/routes/profile.js';
import {
  resolvePlatformPaths,
  createDefaultPlatformAdapter,
} from '@jobhunter/core/platform';

interface ErrorEnvelope {
  readonly schemaVersion: number;
  readonly error: { code: string; message: string; details: unknown };
}

async function postImport(
  baseUrl: string,
  filename: string,
  body: string,
): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([body]), filename);
  return fetch(`${baseUrl}/api/profile/import`, { method: 'POST', body: form });
}

// Pure-function tests for the validator. These run each rejection class
// against an in-memory allowlist, with no filesystem or HTTP plumbing —
// every check in the validator must produce the expected `code` so the
// desktop UI can branch on it.
describe('assertFilenameWithinProfileSources', () => {
  const allowlist = pathResolve('/tmp/profile-sources-allowlist');
  const allowlistWithSep = allowlist + '/';

  it('resolves a relative filename inside the allowlist', () => {
    const out = assertFilenameWithinProfileSources('resume.txt', allowlist);
    expect(out).toBe(`${allowlistWithSep}resume.txt`);
  });

  it('resolves a nested relative path inside the allowlist', () => {
    const out = assertFilenameWithinProfileSources(
      'subdir/resume.txt',
      allowlist,
    );
    expect(out).toBe(`${allowlistWithSep}subdir/resume.txt`);
  });

  describe('rejection cases', () => {
    const cases: ReadonlyArray<readonly [string, () => unknown, string]> = [
      [
        'empty string',
        () => '',
        'profile_import_invalid_filename',
      ],
      [
        'non-string (number)',
        () => 42,
        'profile_import_invalid_filename',
      ],
      [
        'non-string (null)',
        () => null,
        'profile_import_invalid_filename',
      ],
      [
        '.. segment (parent traversal)',
        () => '../../etc/passwd',
        'profile_import_path_traversal',
      ],
      [
        '.. segment (embedded)',
        () => 'subdir/../../etc/passwd',
        'profile_import_path_traversal',
      ],
      [
        '.. segment (lone)',
        () => '..',
        'profile_import_path_traversal',
      ],
      [
        'absolute path (POSIX)',
        () => '/etc/passwd',
        'profile_import_absolute_path',
      ],
      [
        'absolute path (POSIX, nested)',
        () => '/etc/passwd/sub',
        'profile_import_absolute_path',
      ],
    ];

    for (const [label, input, expectedCode] of cases) {
      it(`returns code=${expectedCode} for ${label}`, () => {
        expect(() => assertFilenameWithinProfileSources(input(), allowlist)).toThrow(
          expect.objectContaining({ code: expectedCode }),
        );
      });
    }
  });

  it('throws a ValidationError (not a plain Error) so the HTTP error handler maps it to 400', () => {
    // Sanity: the thrown value must be an ApplicationError subclass so
    // `statusFor()` returns 400. If a future refactor regresses this to a
    // plain Error, the endpoint would silently turn rejections into 500s.
    expect(() => assertFilenameWithinProfileSources('../x', allowlist)).toThrow(
      expect.objectContaining({ exitCode: 2 }),
    );
  });
});

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

// End-to-end tests for the B2-H1 / #21 path-traversal fix on
// `POST /api/profile/import`. These pin the wiring contract: a multipart
// upload reaches the validator, a legitimate filename inside the allowlist
// is imported, and any path-traversal attempt is rejected with a 4xx.
//
// The unit tests above test the validator's exact rejection codes. The HTTP
// tests below verify the route is wired to it and never returns a 5xx on a
// rejection — the sidecar's `setErrorHandler` is the load-bearing boundary
// between validator throws and HTTP status codes.
describe('POST /api/profile/import path validation (B2-H1 / #21)', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let workdir: string;
  let allowlistDir: string;
  const previousHome = process.env['HOME'];

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();

    // Point HOME at a hermetic workdir so the validator's resolved
    // allowlist is deterministic and we don't touch the real user profile
    // directory. The server's DB handle resolves paths on each request via
    // `createDefaultPlatformAdapter()`, so re-resolving paths after the
    // HOME change gives us the matching allowlist.
    workdir = await mkdtemp(join(tmpdir(), 'jobhunter-profile-import-test-'));
    process.env['HOME'] = workdir;
    allowlistDir = resolvePlatformPaths(createDefaultPlatformAdapter())
      .profileSources.directory;
    await mkdir(allowlistDir, { recursive: true });
  });

  afterAll(async () => {
    await server.close();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    await rm(workdir, { recursive: true, force: true });
  });

  it('accepts a filename inside the allowlist (happy path)', async () => {
    const filename = 'happy-path.txt';
    await writeFile(join(allowlistDir, filename), 'sample resume body\n', 'utf8');
    try {
      const res = await postImport(baseUrl, filename, 'sample resume body\n');
      // The import succeeded end-to-end. Anything other than a 4xx proves
      // the validation passed the filename through; the importer outcome
      // (status='success' | 'partial' | 'failure') is incidental here.
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        schemaVersion: number;
        counts: { total: number; extracted: number; failed: number; reused: number };
      };
      expect(body.schemaVersion).toBe(1);
      expect(body.counts.total).toBe(1);
    } finally {
      await rm(join(allowlistDir, filename), { force: true });
    }
  });

  it('returns a 400 (never 5xx) for an attacker-supplied filename with a traversal segment', async () => {
    // `@fastify/busboy` strips the path portion at the multipart boundary:
    // `../etc/passwd` becomes `passwd`, `/etc/passwd` becomes `passwd`,
    // and bare `..` becomes the empty string. The endpoint must never
    // read an attacker-controlled absolute path or escape the allowlist,
    // and must never return a 5xx for a rejected request. The exact
    // `error.code` here is not pinned because busboy's sanitization may
    // feed the importer a benign-looking basename (e.g. `passwd`) that
    // then fails at extension-check or file-existence time with the
    // importer's own 400 (`unsupported_format` / `source_unreadable`).
    // The unit tests above pin the validator's exact codes; this test
    // pins the HTTP contract: never 5xx, always the standard envelope.
    const res = await postImport(baseUrl, '../etc/passwd', 'x');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.error.code).toBe('string');
    expect(body.error.message).toBeTruthy();
  });

  it('returns a 400 for an attacker-supplied absolute POSIX path', async () => {
    // Same shape as above: busboy strips the leading `/`, the result
    // resolves inside the allowlist, and the importer fails because the
    // file is missing or has no recognized extension. Either way the
    // endpoint never reads `/etc/passwd` and never returns a 5xx.
    const res = await postImport(baseUrl, '/etc/passwd', 'x');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('does not import when no file part is sent (returns 400 envelope)', async () => {
    const form = new FormData();
    form.append('not-a-file', 'just a string field');
    const res = await fetch(`${baseUrl}/api/profile/import`, {
      method: 'POST',
      body: form,
    });
    // The handler skips non-file parts, so `filePaths` ends up empty.
    // `ProfileImportService.importSources([])` then throws
    // `InvalidArgumentCountError`, which the global error handler maps
    // to a 4xx with the standard envelope.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.error.code).toBe('string');
  });
});
