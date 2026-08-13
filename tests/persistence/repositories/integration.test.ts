import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../src/persistence/connection.js';
import { Repositories } from '../../../src/persistence/repositories/index.js';
import {
  formatId,
  resolveId,
  resolveJobIdentifier,
  InvalidIdentifierError,
} from '../../../src/persistence/identifiers.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

describe('repository integration + identifier round-trip', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repos: Repositories;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-integration-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repos = new Repositories({ db: connection.db });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('runs a full lifecycle: source → profile → filter config → run → job → filter result → score result', async () => {
    const sourceId = await repos.profileSources.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf',
      originalAbsolutePath: '/tmp/cv.pdf',
      storedPath: '/opt/cv.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      sha256: 'a'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    const profileId = await repos.profileVersions.insert({
      status: 'draft',
      schemaVersion: 1,
      contentHash: 'h1',
      extractionFingerprint: 'fp1',
      sourceIds: [sourceId],
      profileJson: { headline: 'Engineer' },
      createdAt: '2026-08-05T10:00:00.000Z',
      updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await repos.profileVersions.approve(profileId, {
      approvedAt: '2026-08-05T10:01:00.000Z',
      supersededAt: '2026-08-05T10:01:00.000Z',
    });
    const filterConfigId = await repos.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash',
      configJson: { excludedCompanies: [] },
      createdAt: '2026-08-05T10:00:00.000Z',
      active: true,
    });
    const { runId, searchIds } = await repos.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
        profileVersionId: profileId,
        filterConfigVersionId: filterConfigId,
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'q',
          locationName: 'L',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
      ],
    );
    const searchId = searchIds[0]!;

    const { jobId } = await repos.jobs.recordNewJob({
      job: {
        sourceJobId: '123456789',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        title: 'Engineer',
        company: 'Acme',
        location: 'Rotterdam',
        description: 'desc',
        successfulMethod: 'search_detail_panel',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: runId,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });

    const filterResultId = await repos.filterResults.activateResult({
      jobId,
      pipelineRunId: runId,
      filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash',
      profileVersionId: profileId,
      profileHash: 'h1',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted',
      rulesEvaluated: ['r1'],
      rulesPassed: ['r1'],
      rulesFailed: [],
    });
    const scoreResultId = await repos.scoreResults.activateResult({
      jobId,
      pipelineRunId: runId,
      filterResultId,
      fingerprint: 'fp-B',
      timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [{ name: 'skills', value: 0.8 }],
      overallScore: 0.8,
      success: true,
    });
    await repos.openaiMetadata.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result',
      relatedEntityId: scoreResultId,
      inputHashes: [{ jobId }],
      promptVersion: 'p1',
      structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      configJson: {},
      attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z',
      success: true,
    });
    await repos.diagnostics.insert({
      pipelineRunId: runId,
      artifactType: 'screenshot',
      storedPath: '/opt/diag.png',
      relativePath: 'run-1/screenshot.png',
      mimeType: 'image/png',
      fileSize: 100,
      createdAt: '2026-08-05T10:00:00.000Z',
    });

    await repos.pipelineRuns.finalizeRunStats(runId, {
      status: 'completed',
      endTimestamp: '2026-08-05T10:30:00.000Z',
      searchesPlanned: 1,
      searchesCompleted: 1,
      jobsDiscovered: 1,
      jobsAccepted: 1,
      jobsRejected: 0,
    });

    // Identifier round-trip
    expect(formatId('job', jobId)).toBe(`job_${jobId}`);
    expect(resolveId('job', `job_${jobId}`)).toBe(jobId);
    expect(resolveJobIdentifier('123456789')).toEqual({ sourceJobId: '123456789' });
    expect(() => resolveId('job', '123456789')).toThrow(InvalidIdentifierError);

    // Persisted history
    const finalRun = await repos.pipelineRuns.findRunById(runId);
    expect(finalRun?.status).toBe('completed');
    expect(finalRun?.jobsAccepted).toBe(1);
    const activeScore = await repos.scoreResults.findActiveByJob(jobId, 'fp-B');
    expect(activeScore?.overallScore).toBe(0.8);
  });
});
