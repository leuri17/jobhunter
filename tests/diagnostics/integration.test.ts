import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DiagnosticManager,
  StackTraceCapture,
  CurrentUrlCapture,
  Redactor,
} from '../../src/diagnostics/index.js';

import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../src/persistence/connection.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

describe('diagnostics end-to-end', () => {
  let directory: string;
  let diagnosticsDir: string;
  let connection: DatabaseConnection;
  let runId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-diag-int-'));
    diagnosticsDir = join(directory, 'diagnostics');
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const repos = createRepositories(connection);
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

  it('captures stack_trace + current_url when only non-browser flags are enabled', async () => {
    const repos = createRepositories(connection);
    const mgr = new DiagnosticManager({
      config: {
        screenshot: false,
        currentUrl: true,
        stackTrace: true,
        playwrightTrace: false,
        htmlSnapshot: false,
      },
      paths: {
        diagnostics: {
          directory: diagnosticsDir,
          file: (n: string) => join(diagnosticsDir, n),
        },
      },
      repositories: repos,
      strategies: {
        current_url: new CurrentUrlCapture(),
        stack_trace: new StackTraceCapture(),
      },
      redactor: new Redactor(),
    });

    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: runId },
      error: new Error('failed: apiKey=sk-abcdef'),
      currentUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.artifactIds).toHaveLength(2);

    const rows = await repos.diagnostics.listByRun(runId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.artifactType).sort()).toEqual(['current_url', 'stack_trace']);
    for (const row of rows) {
      expect(existsSync(row.storedPath)).toBe(true);
      if (row.description !== null) {
        expect(row.description).not.toContain('sk-abcdef');
      }
    }

    expect(readdirSync(join(diagnosticsDir, `run-${runId}`))).toHaveLength(2);

    await expect(mgr.close()).resolves.toBeUndefined();
    await expect(mgr.close()).resolves.toBeUndefined();
  });
});
