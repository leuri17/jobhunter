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

  describe('invalidateByFilterConfigVersion', () => {
    let jobId3: number;

    beforeEach(async () => {
      // A third job is required to seed three concurrent active rows tied
      // to a single filter config version (the partial unique index
      // `filter_results_active_idx` allows only one active row per job).
      const { jobId } = await jobRepo.recordNewJob({
        job: {
          sourceJobId: '333',
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
      jobId3 = jobId;
    });

    async function seedConfigVersion(contentHash: string): Promise<number> {
      // Insert as inactive: the partial unique index
      // `filter_configuration_versions_active_idx` allows at most one
      // active row in this table, and the outer fixture already claims
      // that slot. The invalidation method keys on `filterConfigVersionId`
      // only, so the `active` flag on the config version is irrelevant
      // for these tests.
      return configRepo.insert({
        schemaVersion: 1,
        contentHash,
        configJson: {},
        createdAt: '2026-08-05T10:00:00.000Z',
        active: false,
      });
    }

    async function seedActiveRow(opts: {
      jobId: number;
      filterConfigVersionId: number;
      fingerprint: string;
    }): Promise<number> {
      return resultRepo.activateResult({
        jobId: opts.jobId,
        pipelineRunId: runId,
        filterConfigVersionId: opts.filterConfigVersionId,
        filterConfigHash: 'cfg-hash',
        profileVersionId: null,
        profileHash: null,
        filterImplementationVersion: 'filter-impl-1',
        fingerprint: opts.fingerprint,
        timestamp: '2026-08-05T10:00:00.000Z',
        overallOutcome: 'accepted',
        rulesEvaluated: [],
        rulesPassed: [],
        rulesFailed: [],
      });
    }

    it('flips active to false on every active row tied to the filter config version', async () => {
      const cfgA = await seedConfigVersion('cfg-A');
      await seedActiveRow({ jobId: jobId1, filterConfigVersionId: cfgA, fingerprint: 'fp-A1' });
      await seedActiveRow({ jobId: jobId2, filterConfigVersionId: cfgA, fingerprint: 'fp-A2' });
      await seedActiveRow({ jobId: jobId3, filterConfigVersionId: cfgA, fingerprint: 'fp-A3' });

      const flipped = await resultRepo.invalidateByFilterConfigVersion(cfgA);
      expect(flipped).toBe(3);

      // Every previously-active row for cfgA is now inactive; the rows
      // themselves are still present ( "kept but inactive").
      const remainingA1 = await resultRepo.listByJob(jobId1);
      const remainingA2 = await resultRepo.listByJob(jobId2);
      const remainingA3 = await resultRepo.listByJob(jobId3);
      expect(remainingA1.find((r) => r.active)).toBeUndefined();
      expect(remainingA2.find((r) => r.active)).toBeUndefined();
      expect(remainingA3.find((r) => r.active)).toBeUndefined();
      expect(remainingA1).toHaveLength(1);
      expect(remainingA2).toHaveLength(1);
      expect(remainingA3).toHaveLength(1);
    });

    it('is idempotent — re-running with no active rows returns 0', async () => {
      const cfgA = await seedConfigVersion('cfg-idem');
      await seedActiveRow({ jobId: jobId1, filterConfigVersionId: cfgA, fingerprint: 'fp-1' });
      await seedActiveRow({ jobId: jobId2, filterConfigVersionId: cfgA, fingerprint: 'fp-2' });
      await seedActiveRow({ jobId: jobId3, filterConfigVersionId: cfgA, fingerprint: 'fp-3' });

      const first = await resultRepo.invalidateByFilterConfigVersion(cfgA);
      expect(first).toBe(3);

      const again = await resultRepo.invalidateByFilterConfigVersion(cfgA);
      expect(again).toBe(0);
    });

    it('does not touch rows tied to a different filter config version', async () => {
      const cfgA = await seedConfigVersion('cfg-A2');
      const cfgB = await seedConfigVersion('cfg-B2');
      await seedActiveRow({ jobId: jobId1, filterConfigVersionId: cfgA, fingerprint: 'fp-A1' });
      await seedActiveRow({ jobId: jobId2, filterConfigVersionId: cfgB, fingerprint: 'fp-B1' });
      await seedActiveRow({ jobId: jobId3, filterConfigVersionId: cfgB, fingerprint: 'fp-B2' });

      const flipped = await resultRepo.invalidateByFilterConfigVersion(cfgA);
      // Only the single row tied to cfgA is flipped.
      expect(flipped).toBe(1);

      // Rows tied to cfgB remain active.
      const remainingB1 = await resultRepo.listByJob(jobId2);
      const remainingB2 = await resultRepo.listByJob(jobId3);
      const activeB1 = remainingB1.find((r) => r.active);
      const activeB2 = remainingB2.find((r) => r.active);
      expect(activeB1?.filterConfigVersionId).toBe(cfgB);
      expect(activeB2?.filterConfigVersionId).toBe(cfgB);
      expect(activeB1?.active).toBe(true);
      expect(activeB2?.active).toBe(true);
    });

    it('does not touch rows with active = false tied to the filter config version', async () => {
      const cfgA = await seedConfigVersion('cfg-A3');
      const cfgB = await seedConfigVersion('cfg-B3');
      // Insert an active row for cfgA on jobId1, then a new active row for
      // cfgB on the SAME job — this deactivates the cfgA row (the partial
      // unique index allows only one active row per job).
      await seedActiveRow({ jobId: jobId1, filterConfigVersionId: cfgA, fingerprint: 'fp-A1' });
      await seedActiveRow({ jobId: jobId1, filterConfigVersionId: cfgB, fingerprint: 'fp-B1' });
      // jobId1 now has: rowA (inactive, cfgA), rowB (active, cfgB).
      // Seed an active row for cfgA on a different job so the call has
      // at least one match to flip.
      await seedActiveRow({ jobId: jobId2, filterConfigVersionId: cfgA, fingerprint: 'fp-A2' });

      const flipped = await resultRepo.invalidateByFilterConfigVersion(cfgA);
      // Only the active row for cfgA (on jobId2) is flipped; the inactive
      // row for cfgA on jobId1 does NOT count (WHERE active = true).
      expect(flipped).toBe(1);

      // The inactive row for cfgA on jobId1 is left untouched: it must
      // still be inactive and still tied to cfgA. The new active row for
      // cfgB on the same job remains active.
      const remainingJ1 = await resultRepo.listByJob(jobId1);
      expect(remainingJ1).toHaveLength(2);
      const inactive = remainingJ1.filter((r) => !r.active);
      const active = remainingJ1.filter((r) => r.active);
      expect(inactive).toHaveLength(1);
      expect(inactive[0]?.filterConfigVersionId).toBe(cfgA);
      expect(inactive[0]?.active).toBe(false);
      expect(active).toHaveLength(1);
      expect(active[0]?.filterConfigVersionId).toBe(cfgB);
      expect(active[0]?.active).toBe(true);

      // jobId2 row (was active, cfgA) is now inactive.
      const remainingJ2 = await resultRepo.listByJob(jobId2);
      expect(remainingJ2.find((r) => r.active)).toBeUndefined();
    });

    it('returns 0 when no rows exist for the filter config version', async () => {
      const cfgA = await seedConfigVersion('cfg-orphan');
      const flipped = await resultRepo.invalidateByFilterConfigVersion(cfgA);
      expect(flipped).toBe(0);
    });
  });
});
