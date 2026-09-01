import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticManager } from '../../src/diagnostics/manager.js';
import { HtmlSnapshotCapture } from '../../src/diagnostics/capture/html-snapshot.js';
import { Redactor } from '../../src/diagnostics/redactor.js';

import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../src/persistence/connection.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Minimal `Page`-shaped stub for the html-snapshot capture tests. The
 * strategy only exercises `page.content()` so we model just that surface.
 * We deliberately do NOT import from `src/linkedin/` to keep
 * `tests/diagnostics/` independent of the LinkedIn module (cross-domain
 * test imports are an anti-pattern).
 */
interface ContentPage {
  readonly content: () => Promise<string>;
}

function makeContentPage(
  result: string | (() => Promise<string>),
): ContentPage {
  return {
    content: async () => {
      if (typeof result === 'function') return result();
      return result;
    },
  };
}

describe('DiagnosticManager.recordScraperError + HtmlSnapshotCapture', () => {
  let directory: string;
  let diagnosticsDir: string;
  let connection: DatabaseConnection;
  let repos: ReturnType<typeof createRepositories>;
  let events: { code: string; message: string; metadata?: unknown }[];
  let runId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-mgr-html-'));
    diagnosticsDir = join(directory, 'diagnostics');
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repos = createRepositories(connection);
    events = [];
    const created = await repos.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-13T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [],
    );
    runId = created.runId;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function makeManager(
    overrides: Partial<ConstructorParameters<typeof DiagnosticManager>[0]> = {},
  ): DiagnosticManager {
    const paths = {
      diagnostics: {
        directory: diagnosticsDir,
        file: (n: string) => join(diagnosticsDir, n),
      },
    };
    return new DiagnosticManager({
      config: {
        screenshot: false,
        currentUrl: false,
        stackTrace: false,
        playwrightTrace: false,
        htmlSnapshot: true,
      },
      paths: paths as never,
      repositories: repos,
      strategies: {
        html_snapshot: new HtmlSnapshotCapture(),
      },
      redactor: new Redactor(),
      onError: (e) => events.push(e),
      ...overrides,
    });
  }

  it('persists the html_snapshot artifact (with page in DiagnosticInput)', async () => {
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>Hello, job hunter.</body></html>';
    const page = makeContentPage(html);
    const mgr = makeManager();
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('snapshot this'),
      page: page as never,
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.artifactIds).toHaveLength(1);

    const rows = await repos.diagnostics.listByRun(runId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.artifactType).toBe('html_snapshot');
    expect(row.mimeType).toBe('text/html; charset=utf-8');
    expect(row.fileSize).toBe(Buffer.byteLength(html, 'utf8'));
    expect(existsSync(row.storedPath)).toBe(true);

    const onDisk = readFileSync(row.storedPath, 'utf8');
    expect(onDisk).toContain('<!DOCTYPE html>');
    expect(onDisk).toContain('Hello, job hunter.');
  });

  it('does not persist an html_snapshot artifact when the htmlSnapshot flag is false', async () => {
    const html = '<html><body>Should not be saved</body></html>';
    const page = makeContentPage(html);
    const mgr = makeManager({
      config: {
        screenshot: false,
        currentUrl: false,
        stackTrace: false,
        playwrightTrace: false,
        htmlSnapshot: false,
      },
    });
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('no snapshot please'),
      page: page as never,
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.artifactIds).toHaveLength(0);
    expect(outcome.failures).toEqual([]);

    const rows = await repos.diagnostics.listByRun(runId);
    expect(rows.filter((r) => r.artifactType === 'html_snapshot')).toHaveLength(0);
  });

  it('records a capture_failed failure (without crashing the manager) when page is absent', async () => {
    const mgr = makeManager();
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('no page attached'),
      // page omitted intentionally — HtmlSnapshotCapture must throw
      // MissingBrowserImplementationError('browser_implementation_missing').
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.artifactIds).toHaveLength(0);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]!.artifactType).toBe('html_snapshot');
    expect(outcome.failures[0]!.code).toBe('capture_failed');
    expect(events.some((e) => e.code === 'capture_failed')).toBe(true);

    // A log_file diagnosticArtifacts row records the failure for the user.
    const rows = await repos.diagnostics.listByRun(runId);
    const failureRow = rows.find(
      (r) => r.artifactType === 'log_file' && r.errorCode === 'capture_failed',
    );
    expect(failureRow).toBeDefined();
  });

  it('records a capture_failed failure when page.content() throws', async () => {
    const page = makeContentPage(() => Promise.reject(new Error('navigation in progress')));
    const mgr = makeManager();
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('primary'),
      page: page as never,
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.artifactIds).toHaveLength(0);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]!.artifactType).toBe('html_snapshot');
    expect(outcome.failures[0]!.code).toBe('capture_failed');
  });
});