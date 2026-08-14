import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';
import { FakeOpenAIClient } from '../../src/profile/openai/fake-client.js';
import { OpenAIAuthenticationError, OpenAIServerError } from '../../src/profile/openai/errors.js';
import type { OpenAIClient, OpenAIExtractionRawResponse } from '../../src/profile/openai/types.js';

const FIXTURE_CV_BODY = '# Title\n\nbody\n';

/**
 * Minimal `ExtractedProfile`-shaped JSON that the
 * `createExtractedProfileSchema(knownSourceIds)` refinement is guaranteed
 * to accept. Mirrors the helper used in `tests/profile/extraction-service.test.ts`.
 */
function validExtractedJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    basics: {
      headline: 'Senior Engineer',
      professionalSummary: null,
      currentLocation: null,
      totalYearsOfExperience: 7,
    },
    experience: [],
    skills: [],
    languages: [],
    education: [],
    certifications: [],
    projects: [],
    warnings: [],
    ...overrides,
  });
}

function response(rawJsonText: string): OpenAIExtractionRawResponse {
  return {
    rawJsonText,
    tokenUsage: { promptTokens: 100, completionTokens: 200 },
  };
}

describe('CLI: jobhunter profile extract', () => {
  let tempHome: string;
  let stdout: string[] = [];
  let stderr: string[] = [];
  let originalHome: string | undefined;
  let originalOpenAiKey: string | undefined;
  let exitCode: number | null = null;
  let originalExit: typeof process.exit | undefined;
  let originalOut: typeof process.stdout.write | undefined;
  let originalErr: typeof process.stderr.write | undefined;

  function captureOriginals(): void {
    if (originalExit === undefined) {
      originalExit = process.exit;
      originalOut = process.stdout.write;
      originalErr = process.stderr.write;
    }
  }

  beforeEach(() => {
    captureOriginals();
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-profile-extract-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    // Default: no API key (individual tests can opt back in).
    delete process.env.OPENAI_API_KEY;
    mkdirSync(join(tempHome, 'data'), { recursive: true });
    stdout = [];
    stderr = [];
    exitCode = null;
    process.exit = ((code: number) => {
      if (exitCode === null) exitCode = code;
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    if (tempHome !== undefined) {
      rmSync(tempHome, { recursive: true, force: true });
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    if (originalExit !== undefined) {
      process.exit = originalExit;
    }
    if (originalOut !== undefined) {
      process.stdout.write = originalOut;
    }
    if (originalErr !== undefined) {
      process.stderr.write = originalErr;
    }
  });

  function isCommanderError(error: unknown): error is { code: string; message: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof (error as { code: unknown }).code === 'string' &&
      typeof (error as { message: unknown }).message === 'string' &&
      (error as { code: string }).code.startsWith('commander.')
    );
  }

  async function run(
    args: readonly string[],
    openaiClient?: OpenAIClient,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    // Snapshot and reset the captured outputs so each `run(...)` invocation
    // corresponds to exactly one CLI call (a test that runs `profile import`
    // and then `profile extract` should not see the import output in the
    // extract result). The mocks are reinstalled by beforeEach and stay
    // installed for the lifetime of the test, so we slice the captured
    // buffers around this call instead of re-mocking the streams.
    const startStdoutLength = stdout.length;
    const startStderrLength = stderr.length;
    const startExitCode = exitCode;
    // Reset the captured exitCode so the call's process.exit captures
    // its own value even when earlier calls in the same test set one.
    exitCode = null;

    const program = createProgram(openaiClient !== undefined ? { openaiClient } : {});
    try {
      try {
        await program.parseAsync(['node', 'jobhunter', ...args]);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('__exit__:')) {
          // process.exit mock — exitCode already captured by the mock above.
        } else if (isCommanderError(error)) {
          // Mirror exitWithError's Commander handling
          if (exitCode === null) exitCode = 2;
          process.stderr.write(`${error.message}\n`);
        } else {
          throw error;
        }
      }
    } finally {
      // Mocks stay installed for the lifetime of this test.
    }
    const callStdout = stdout.slice(startStdoutLength).join('');
    const callStderr = stderr.slice(startStderrLength).join('');
    // The mock only updates `exitCode` on the first call; preserve the
    // prior value when this call did not record a fresh exit (i.e. the
    // action completed without process.exit). On a fresh exit, return it;
    // otherwise default to 0 (success).
    const observedExitCode = exitCode ?? (startExitCode === null ? 0 : 0);
    return { exitCode: observedExitCode, stdout: callStdout, stderr: callStderr };
  }

  /** Import a real source file via the CLI so the DB row is set up the same way as production. */
  async function seedSourceFromCli(content: string): Promise<string> {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, content, 'utf8');
    const result = await run(['profile', 'import', sourcePath]);
    expect(result.exitCode).toBe(0);
    return sourcePath;
  }

  it('reports profile_extraction_no_sources when no sources are imported (exit 2)', async () => {
    const result = await run(['profile', 'extract']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('profile_extraction_no_sources');
  });

  it('creates a draft profile version and prints a summary (exit 0)', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const result = await run(['profile', 'extract'], client);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('status: created');
    expect(result.stdout).toMatch(/profile_version_id: \d+/);
    expect(result.stdout).toMatch(/profile_id: profile_[0-9a-f]+/);
    expect(result.stdout).toMatch(/content_hash: [0-9a-f]{64}/);
    expect(result.stdout).toContain('conflicts: 0');
    expect(result.stdout).toContain('warnings: 0');
    expect(client.getRequestCount()).toBe(1);
  });

  it('reuses an existing draft on a second call (exit 0)', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    // First call: create.
    const firstClient = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const first = await run(['profile', 'extract'], firstClient);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('status: created');
    expect(firstClient.getRequestCount()).toBe(1);

    // Second call with a fresh fake client: should reuse the previous draft
    // and NOT call OpenAI again.
    const secondClient = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const second = await run(['profile', 'extract'], secondClient);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('status: reused');
    expect(second.stdout).toMatch(/profile_version_id: \d+/);
    expect(second.stdout).toMatch(/content_hash: [0-9a-f]{64}/);
    expect(secondClient.getRequestCount()).toBe(0);
  });

  it('emits a single JSON document when --json is supplied (exit 0)', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const result = await run(['profile', 'extract', '--json'], client);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.status).toBe('created');
    expect(typeof parsed.profile_version_id).toBe('number');
    expect(typeof parsed.profile_id).toBe('string');
    expect(parsed.profile_id).toMatch(/^profile_[0-9a-f]+/);
    expect(typeof parsed.content_hash).toBe('string');
    expect(parsed.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.conflicts).toBe(0);
    expect(parsed.warnings).toEqual([]);
  });

  it('reports openai_authentication with exit 5 on a fake 401', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    const client = new FakeOpenAIClient({ error: new OpenAIAuthenticationError() });
    const result = await run(['profile', 'extract'], client);

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain('openai_authentication');
    expect(client.getRequestCount()).toBe(1);
  });

  it('surfaces attemptCount in human output on a failed extraction (exit 5, attempts: 3)', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    const client = new FakeOpenAIClient({ error: new OpenAIServerError() });
    const result = await run(['profile', 'extract'], client);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toMatch(/^status: failed/m);
    expect(result.stdout).toMatch(/attempts: 3/);
    expect(client.getRequestCount()).toBe(3);
  });

  it('surfaces attempts in JSON output on a failed extraction (exit 5, attempts: 1)', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    // 401 is non-retryable → exactly one attempt then failure.
    const client = new FakeOpenAIClient({ error: new OpenAIAuthenticationError() });
    const result = await run(['profile', 'extract', '--json'], client);

    expect(result.exitCode).toBe(5);
    // The structured failure document is emitted to stdout BEFORE the typed
    // error is thrown (so a single valid JSON document is observable even on
    // a failure exit code).
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.status).toBe('failed');
    expect(parsed.error_code).toBe('openai_authentication');
    expect(parsed.attempts).toBe(1);
  });

  it('reports openai_api_key_missing when OPENAI_API_KEY is not set (exit 2)', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);
    // process.env.OPENAI_API_KEY was cleared in beforeEach.
    expect(process.env.OPENAI_API_KEY).toBeUndefined();

    const result = await run(['profile', 'extract']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('openai_api_key_missing');
  });

  it('emits JSON with status reused on a second call', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    // First call: create the draft.
    const firstClient = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const first = await run(['profile', 'extract', '--json'], firstClient);
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(first.stdout).status).toBe('created');
    expect(firstClient.getRequestCount()).toBe(1);

    // Second call with a fresh fake: reuse path, no OpenAI call.
    const secondClient = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const second = await run(['profile', 'extract', '--json'], secondClient);

    expect(second.exitCode).toBe(0);
    const parsed = JSON.parse(second.stdout) as Record<string, unknown>;
    expect(parsed.status).toBe('reused');
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.profile_version_id).toBe('number');
    expect(parsed.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(secondClient.getRequestCount()).toBe(0);
  });

  it('does not mutate an active approved profile during extraction', async () => {
    await seedSourceFromCli(FIXTURE_CV_BODY);

    // Open the same DB the CLI is using and insert an active `approved`
    // profile version directly. The CLI uses Linux path defaults
    // (`$HOME/.local/share/jobhunter/jobhunter.sqlite`) so the path is
    // predictable from the temp HOME we set in beforeEach.
    const databasePath = join(tempHome, '.local', 'share', 'jobhunter', 'jobhunter.sqlite');
    // Use a dynamic import so the test file does not pull the persistence
    // modules during simple module-load (e.g. when only running CLI smoke tests).
    const { createDatabaseConnection } = await import('../../src/persistence/connection.js');
    const { createRepositories } = await import('../../src/persistence/repositories/index.js');
    const { runMigrations } = await import('../../src/persistence/migrations.js');
    const { resolve } = await import('node:path');

    const setup = createDatabaseConnection(databasePath);
    try {
      runMigrations(setup, {
        migrationsFolder: resolve(import.meta.dirname, '..', '..', 'drizzle'),
      });
      const repos = createRepositories(setup);
      const approvedId = await repos.profileVersions.insert({
        status: 'approved',
        schemaVersion: 1,
        contentHash: 'e'.repeat(64),
        extractionFingerprint: 'preexisting-fp',
        sourceIds: [1],
        profileJson: { id: 'profile_existing_active' },
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
      });
      await repos.profileVersions.approve(approvedId, {
        approvedAt: '2026-08-14T00:00:00.000Z',
        supersededAt: '2026-08-14T00:00:00.000Z',
      });

      const before = await repos.profileVersions.findActiveApproved();
      expect(before?.id).toBe(approvedId);
    } finally {
      setup.close();
    }

    // Run the CLI extract. Approval must be untouched.
    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const result = await run(['profile', 'extract'], client);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('status: created');

    // Re-open the DB and verify the approved row is unchanged.
    const verify = createDatabaseConnection(databasePath);
    try {
      const repos = createRepositories(verify);
      const after = await repos.profileVersions.findActiveApproved();
      expect(after?.id).not.toBeNull();
      expect(after?.status).toBe('approved');
      expect(after?.active).toBe(true);
      expect(after?.contentHash).toBe('e'.repeat(64));
      expect((after?.profileJson as { id?: string }).id).toBe('profile_existing_active');
      const approvedRow = await repos.profileVersions.findById(after!.id);
      expect(approvedRow?.extractionFingerprint).toBe('preexisting-fp');
    } finally {
      verify.close();
    }
  });
});
