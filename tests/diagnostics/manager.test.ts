import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticManager } from '../../src/diagnostics/manager.js';
import { StackTraceCapture } from '../../src/diagnostics/capture/stack-trace.js';
import { CurrentUrlCapture } from '../../src/diagnostics/capture/current-url.js';
import { Redactor } from '../../src/diagnostics/redactor.js';
import type {
  CaptureContext,
  CaptureResult,
  CaptureStrategy,
} from '../../src/diagnostics/capture/types.js';

import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../src/persistence/connection.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

class FakeScreenshot implements CaptureStrategy {
  readonly artifactType = 'screenshot' as const;
  async capture(_ctx: CaptureContext): Promise<CaptureResult> {
    void _ctx;
    return {
      artifactType: 'screenshot',
      extension: 'png',
      mimeType: 'image/png',
      contents: Buffer.from('PNG'),
    };
  }
}

describe('DiagnosticManager.recordScraperError', () => {
  let directory: string;
  let diagnosticsDir: string;
  let connection: DatabaseConnection;
  let repos: ReturnType<typeof createRepositories>;
  let events: { code: string; message: string; metadata?: unknown }[];
  let runId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-mgr-'));
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
        screenshot: true,
        currentUrl: true,
        stackTrace: true,
        playwrightTrace: false,
        htmlSnapshot: false,
      },
      paths: paths as never,
      repositories: repos,
      strategies: {
        screenshot: new FakeScreenshot(),
        current_url: new CurrentUrlCapture(),
        stack_trace: new StackTraceCapture(),
      },
      redactor: new Redactor(),
      onError: (e) => events.push(e),
      ...overrides,
    });
  }

  it('captures the configured artifacts and persists their metadata', async () => {
    const mgr = makeManager();
    const error = new Error('scraper crashed');
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error,
      currentUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.artifactIds).toHaveLength(3);

    const rows = await repos.diagnostics.listByRun(runId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.artifactType).sort()).toEqual(['current_url', 'screenshot', 'stack_trace']);

    expect(existsSync(diagnosticsDir)).toBe(true);
    for (const row of rows) expect(existsSync(row.storedPath)).toBe(true);

    const stack = rows.find((r) => r.artifactType === 'stack_trace');
    expect(stack).toBeDefined();
    expect(readFileSync(stack!.storedPath, 'utf8')).toContain('scraper crashed');
  });

  it('skips artifacts whose flags are disabled', async () => {
    const mgr = makeManager({
      config: {
        screenshot: false,
        currentUrl: true,
        stackTrace: true,
        playwrightTrace: false,
        htmlSnapshot: false,
      },
    });
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('x'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.artifactIds).toHaveLength(2);
    expect(outcome.failures).toEqual([]);
  });

  it('records a strategy_missing failure when a flag is on but the strategy is absent', async () => {
    const mgr = makeManager({
      strategies: { stack_trace: new StackTraceCapture() },
    });
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('x'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.artifactIds).toHaveLength(1);
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures.every((f) => f.code === 'strategy_missing')).toBe(true);

    const failedRows = await repos.diagnostics.listByRun(runId);
    expect(
      failedRows.find((r) => r.artifactType === 'log_file' && r.errorCode === 'strategy_missing'),
    ).toBeDefined();
  });

  it('never throws to the caller and records the failure when capture throws', async () => {
    const broken: CaptureStrategy = {
      artifactType: 'stack_trace',
      async capture() {
        throw new Error('disk full');
      },
    };
    const mgr = makeManager({
      strategies: {
        stack_trace: broken,
        current_url: new CurrentUrlCapture(),
      },
      config: {
        screenshot: false,
        currentUrl: true,
        stackTrace: true,
        playwrightTrace: false,
        htmlSnapshot: false,
      },
    });
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('primary'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]!.artifactType).toBe('stack_trace');
    expect(events.some((e) => e.code === 'capture_failed')).toBe(true);
    expect(outcome.artifactIds).toHaveLength(1);
  });

  it('redacts secret-like values in the persisted description', async () => {
    const mgr = makeManager();
    await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('failed: apiKey=sk-abcdef'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    const rows = await repos.diagnostics.listByRun(runId);
    for (const row of rows) {
      if (row.description !== null) {
        expect(row.description).not.toContain('sk-abcdef');
        expect(row.description).toContain('[REDACTED');
      }
    }
  });

  it('close() resolves without throwing', async () => {
    await expect(makeManager().close()).resolves.toBeUndefined();
  });
});
