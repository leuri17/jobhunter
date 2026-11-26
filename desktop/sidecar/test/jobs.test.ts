import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { buildServer } from '../src/server.js';
import { registerJobsRoutes } from '../src/routes/jobs.js';
import { resetSecretsBackendForTest } from '../src/secrets-backend.js';
import { DEFAULT_OPERATIONAL_CONFIG, type OperationalConfig } from '@jobhunter/core/config';
import { FILTER_IMPLEMENTATION_VERSION, ensureDefaultFilterConfig } from '@jobhunter/core/filter';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import {
  createDatabaseConnection,
  createRepositories,
  resolveRepoRootForMigrations,
  runMigrations,
  type Repositories,
} from '@jobhunter/core/persistence';
import { FakeAiProviderClient, type ProfessionalProfile } from '@jobhunter/core/profile';
import {
  computeFilterFingerprintForJob,
  computeScoreFingerprintForJob,
  type ReevaluationPlan,
} from '@jobhunter/core/reevaluation';

describe('jobs endpoints', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /api/jobs returns a list (possibly empty)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs?state=all&limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemaVersion: number; jobs: unknown[] };
    expect(body.schemaVersion).toBe(1);
    expect(Array.isArray(body.jobs)).toBe(true);
  });
});

type JobScoringPair = Pick<
  OperationalConfig['aiProvider']['jobScoring'],
  'model' | 'reasoningEffort'
>;

const PROFILE: ProfessionalProfile = {
  schemaVersion: 1,
  id: 'profile_373',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  contentHash: 'b'.repeat(64),
  sourceIds: [],
  basics: {
    fullName: null,
    email: null,
    phone: null,
    headline: null,
    professionalSummary: null,
    currentLocation: null,
    totalYearsOfExperience: null,
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

/**
 * Leave the database as a pipeline run does after scoring one job: a
 * run with a search execution, a complete job, an active filter
 * configuration, an approved active profile, an accepted filter result
 * carrying the canonical fingerprint, and an active score whose
 * fingerprint is the one `ScoringService.scoreOne` hashes for
 * `jobScoring`. Returns the job's id (#373).
 */
async function insertJobScoredWith(
  repositories: Repositories,
  jobScoring: JobScoringPair,
): Promise<number> {
  const timestamp = '2026-11-20T10:00:00.000Z';
  const run = await repositories.pipelineRuns.createRunWithSearches(
    {
      startTimestamp: timestamp,
      configSnapshotJson: {},
      configSchemaVersion: 1,
      configHash: 'h-jobs-reevaluate',
      applicationVersion: '0.1.0',
    },
    [
      {
        pipelineRunId: 0,
        searchQuery: 'q',
        locationName: 'L',
        geoId: '1',
        generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
        startTimestamp: timestamp,
      },
    ],
  );

  await ensureDefaultFilterConfig(repositories);
  const filterConfig = await repositories.filterConfigurations.findActive();
  if (filterConfig === null) throw new Error('no active filter configuration');

  const profileVersionId = await repositories.profileVersions.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: 'reevaluate-profile-content-hash',
    extractionFingerprint: 'reevaluate-profile-extraction-fingerprint',
    sourceIds: [],
    profileJson: PROFILE,
    createdAt: timestamp,
    updatedAt: timestamp,
    active: false,
  });
  await repositories.profileVersions.approve(profileVersionId, {
    approvedAt: timestamp,
    supersededAt: timestamp,
  });
  const profile = await repositories.profileVersions.findActiveApproved();
  if (profile === null) throw new Error('no active approved profile');

  const { jobId } = await repositories.jobs.recordNewJob({
    job: {
      sourceJobId: '373',
      extractionStatus: 'complete',
      title: 'Senior TypeScript Engineer',
      company: 'Acme',
      location: 'Berlin',
      description: 'Build the job search pipeline.',
      firstDiscoveryTimestamp: timestamp,
      lastRediscoveryTimestamp: timestamp,
      createdTimestamp: timestamp,
      updatedTimestamp: timestamp,
      successfulMethod: 'search_detail_panel',
    },
    discoveryEvent: {
      jobId: 0,
      pipelineRunId: run.runId,
      searchExecutionId: run.searchIds[0]!,
      timestamp,
      isNew: true,
      currentExtractionState: 'complete',
      extractionAttempted: true,
      skipReason: null,
    },
  });
  const job = await repositories.jobs.findById(jobId);
  if (job === null) throw new Error(`job ${jobId} not found`);

  const filterResultId = await repositories.filterResults.activateResult({
    jobId,
    pipelineRunId: run.runId,
    filterConfigVersionId: filterConfig.id,
    filterConfigHash: filterConfig.contentHash,
    profileVersionId,
    profileHash: profile.contentHash,
    filterImplementationVersion: FILTER_IMPLEMENTATION_VERSION,
    fingerprint: computeFilterFingerprintForJob(job, filterConfig.configJson, profile.profileJson),
    timestamp,
    overallOutcome: 'accepted',
    rulesEvaluated: [],
    rulesPassed: [],
    rulesFailed: [],
    rejectionReasons: null,
  });

  await repositories.scoreResults.activateResult({
    jobId,
    pipelineRunId: run.runId,
    filterResultId,
    fingerprint: computeScoreFingerprintForJob(
      job,
      profile.id,
      profile.contentHash,
      {},
      jobScoring.model,
      jobScoring.reasoningEffort,
    ),
    timestamp,
    promptVersion: 'v1',
    rubricVersion: '1',
    model: jobScoring.model,
    reasoningEffort: jobScoring.reasoningEffort,
    scorerImplementationVersion: '1',
    categoryScores: [],
    overallScore: 80,
    explanation: 'score the pipeline stored',
    success: true,
  });

  return jobId;
}

describe('POST /api/jobs/reevaluate scoring model (#373)', () => {
  const savedWith = DEFAULT_OPERATIONAL_CONFIG.aiProvider.jobScoring;
  const resavedWith: OperationalConfig['aiProvider']['jobScoring'] = {
    ...savedWith,
    model: 'openai/gpt-5.6-mini',
    reasoningEffort: 'high',
  };

  let app: FastifyInstance;
  let client: FakeAiProviderClient;
  let home: string;
  let configPath: string;
  let jobId: number;

  function writeConfig(jobScoring: OperationalConfig['aiProvider']['jobScoring']): void {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        ...DEFAULT_OPERATIONAL_CONFIG,
        aiProvider: { ...DEFAULT_OPERATIONAL_CONFIG.aiProvider, jobScoring },
      }),
    );
  }

  beforeAll(async () => {
    app = Fastify();
    home = mkdtempSync(join(tmpdir(), 'jobhunter-jobs-reevaluate-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('XDG_CONFIG_HOME', home);
    vi.stubEnv('AI_PROVIDER_API_KEY', 'sk-test-1234');
    vi.stubEnv('AI_PROVIDER_MODEL', 'gpt-4o');
    vi.stubEnv('OPENAI_MODEL', 'gpt-4o-mini');
    resetSecretsBackendForTest();
    configPath = resolvePlatformPaths(createDefaultPlatformAdapter()).config.file('config.json');
    // The POSTs below read config.json; refuse to aim them outside the throwaway HOME.
    expect(configPath.startsWith(home)).toBe(true);
    writeConfig(savedWith);

    const databasePath = join(home, 'jobhunter.sqlite');
    const setup = createDatabaseConnection(databasePath);
    try {
      runMigrations(setup, { migrationsFolder: resolveRepoRootForMigrations() });
      jobId = await insertJobScoredWith(createRepositories(setup), savedWith);
    } finally {
      setup.close();
    }

    client = new FakeAiProviderClient({
      error: new Error('The scoring response is not part of this test.'),
    });
    await registerJobsRoutes(app, {
      aiProviderClient: client,
      jobsDbOpener: async () => createDatabaseConnection(databasePath),
      rootLogger: pino({ level: 'silent' }),
    });
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    resetSecretsBackendForTest();
    rmSync(home, { recursive: true, force: true });
  });

  it('sends no scoring request when the stored score was made with the saved model + effort', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/reevaluate',
      payload: { scope: 'default' },
    });

    expect(res.statusCode).toBe(200);
    const body = (await res.json()) as { plan: ReevaluationPlan };
    expect(body.plan.jobsToScore.map((entry) => entry.jobId)).toEqual([]);
    expect(client.getRequestCount()).toBe(0);
  });

  it('scores a stale job with the model + effort saved in the config, not with the environment', async () => {
    writeConfig(resavedWith);
    const requestsBefore = client.getRequestCount();

    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/reevaluate',
      payload: { scope: 'default' },
    });

    expect(res.statusCode).toBe(200);
    const body = (await res.json()) as { plan: ReevaluationPlan };
    expect(body.plan.jobsToScore.map((entry) => entry.jobId)).toEqual([`job_${jobId}`]);
    const sent = client.requests.slice(requestsBefore);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      model: resavedWith.model,
      reasoningEffort: resavedWith.reasoningEffort,
    });
  });
});
