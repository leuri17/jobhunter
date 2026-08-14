import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';
import { JobRepository } from '../../../src/persistence/repositories/jobs.js';
import { FilterConfigurationRepository } from '../../../src/persistence/repositories/filter-configurations.js';
import { FilterResultRepository } from '../../../src/persistence/repositories/filter-results.js';
import { ProfileVersionRepository } from '../../../src/persistence/repositories/profile-versions.js';
import { ProfileSourceRepository } from '../../../src/persistence/repositories/profile-sources.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) {
  return { db: c.db };
}

async function seedProfileSource(
  sourceRepo: ProfileSourceRepository,
  sha256: string,
): Promise<number> {
  return sourceRepo.insert({
    sourceType: 'pdf',
    originalFilename: `${sha256}.pdf`,
    originalAbsolutePath: `/tmp/${sha256}.pdf`,
    storedPath: `/opt/${sha256}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 100,
    sha256,
    importTimestamp: '2026-08-05T10:00:00.000Z',
    textExtractionStatus: 'success',
  });
}

async function seedProfileVersion(
  versionRepo: ProfileVersionRepository,
  sourceRepo: ProfileSourceRepository,
  fingerprint: string,
): Promise<number> {
  const sourceId = await seedProfileSource(sourceRepo, sha256For(fingerprint));
  return versionRepo.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: `hash-${fingerprint}`,
    extractionFingerprint: fingerprint,
    sourceIds: [sourceId],
    profileJson: { id: `prf_${fingerprint}` },
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
  });
}

function sha256For(fingerprint: string): string {
  // 64 hex chars; pad the fingerprint deterministically.
  const padded = (fingerprint + '0'.repeat(64)).slice(0, 64);
  return padded;
}

describe('FilterResultRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let jobRepo: JobRepository;
  let configRepo: FilterConfigurationRepository;
  let resultRepo: FilterResultRepository;
  let versionRepo: ProfileVersionRepository;
  let sourceRepo: ProfileSourceRepository;
  let runId: number;
  let searchId: number;
  let filterConfigId: number;
  let jobId1: number;
  let jobId2: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-filter-results-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    jobRepo = new JobRepository(ctxFrom(connection));
    configRepo = new FilterConfigurationRepository(ctxFrom(connection));
    resultRepo = new FilterResultRepository(ctxFrom(connection));
    versionRepo = new ProfileVersionRepository(ctxFrom(connection));
    sourceRepo = new ProfileSourceRepository(ctxFrom(connection));
    const { runId: rid, searchIds } = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
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
    runId = rid;
    searchId = searchIds[0]!;
    filterConfigId = await configRepo.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash',
      configJson: {},
      createdAt: '2026-08-05T10:00:00.000Z',
      active: true,
    });
    const { jobId: j1 } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '111',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
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
    jobId1 = j1;
    const { jobId: j2 } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '222',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
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
    jobId2 = j2;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('activateResult atomically replaces the previous active row for a job', async () => {
    const first = await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted',
      rulesEvaluated: ['r1'],
      rulesPassed: ['r1'],
      rulesFailed: [],
    });
    const second = await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash',
      filterImplementationVersion: 'filter-impl-2',
      fingerprint: 'fp-B',
      timestamp: '2026-08-05T11:00:00.000Z',
      overallOutcome: 'rejected',
      rulesEvaluated: ['r1'],
      rulesPassed: [],
      rulesFailed: ['r1'],
      rejectionReasons: ['r1'],
    });
    expect(second).toBeGreaterThan(first);

    const history = await resultRepo.listByJob(jobId1);
    expect(history).toHaveLength(2);
    const active = history.find((r) => r.active);
    expect(active?.id).toBe(second);
    expect(active?.overallOutcome).toBe('rejected');
    const inactive = history.find((r) => !r.active);
    expect(inactive?.id).toBe(first);
  });

  it('findActiveByJob returns the active row only when the fingerprint matches', async () => {
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted',
      rulesEvaluated: ['r1'],
      rulesPassed: ['r1'],
      rulesFailed: [],
    });
    const match = await resultRepo.findActiveByJob(jobId1, 'fp-A');
    expect(match?.fingerprint).toBe('fp-A');
    const miss = await resultRepo.findActiveByJob(jobId1, 'fp-OLD');
    expect(miss).toBeNull();
  });

  it('listByRun returns every filter result for the run', async () => {
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-1',
      timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted',
      rulesEvaluated: [],
      rulesPassed: [],
      rulesFailed: [],
    });
    await resultRepo.activateResult({
      jobId: jobId2,
      pipelineRunId: runId,
      filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-2',
      timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'rejected',
      rulesEvaluated: ['r1'],
      rulesPassed: [],
      rulesFailed: ['r1'],
      rejectionReasons: ['r1'],
    });
    const rows = await resultRepo.listByRun(runId);
    expect(rows).toHaveLength(2);
  });

  describe('invalidateByProfileVersion', () => {
    async function seedActiveForProfile(fingerprint: string): Promise<number> {
      const profileVersionId = await seedProfileVersion(versionRepo, sourceRepo, fingerprint);
      await resultRepo.activateResult({
        jobId: jobId1,
        pipelineRunId: runId,
        filterConfigVersionId: filterConfigId,
        filterConfigHash: 'cfg-hash',
        profileVersionId,
        profileHash: 'h',
        filterImplementationVersion: 'filter-impl-1',
        fingerprint: `fp-${fingerprint}-${jobId1}`,
        timestamp: '2026-08-05T10:00:00.000Z',
        overallOutcome: 'accepted',
        rulesEvaluated: [],
        rulesPassed: [],
        rulesFailed: [],
      });
      await resultRepo.activateResult({
        jobId: jobId2,
        pipelineRunId: runId,
        filterConfigVersionId: filterConfigId,
        filterConfigHash: 'cfg-hash',
        profileVersionId,
        profileHash: 'h',
        filterImplementationVersion: 'filter-impl-1',
        fingerprint: `fp-${fingerprint}-${jobId2}`,
        timestamp: '2026-08-05T10:00:00.000Z',
        overallOutcome: 'accepted',
        rulesEvaluated: [],
        rulesPassed: [],
        rulesFailed: [],
      });
      return profileVersionId;
    }

    it('flips active to false on every active row tied to the profile version', async () => {
      const profileVersionId = await seedActiveForProfile('fp_7');
      const flipped = await resultRepo.invalidateByProfileVersion(profileVersionId);
      expect(flipped).toBe(2);
      const remaining = await resultRepo.listByJob(jobId1);
      expect(remaining.find((r) => r.active)).toBeUndefined();
    });

    it('is idempotent — re-running with no active rows returns 0', async () => {
      const profileVersionId = await seedActiveForProfile('fp_idem');
      await resultRepo.invalidateByProfileVersion(profileVersionId);
      const again = await resultRepo.invalidateByProfileVersion(profileVersionId);
      expect(again).toBe(0);
    });

    it('does not touch rows tied to a different profile version', async () => {
      const idA = await seedActiveForProfile('fp_a');
      const idB = await seedActiveForProfile('fp_b');
      await resultRepo.invalidateByProfileVersion(idA);
      const other = await resultRepo.listByJob(jobId2);
      const stillActive = other.find((r) => r.active);
      expect(stillActive?.profileVersionId).toBe(idB);
    });

    it('returns 0 when no rows exist for the profile version', async () => {
      const idA = await seedActiveForProfile('fp_one');
      const fakeId = 99_999; // not seeded
      const flipped = await resultRepo.invalidateByProfileVersion(fakeId);
      expect(flipped).toBe(0);
      // Original rows still active.
      const rows = await resultRepo.listByJob(jobId1);
      expect(rows.find((r) => r.active)?.profileVersionId).toBe(idA);
    });
  });
});
