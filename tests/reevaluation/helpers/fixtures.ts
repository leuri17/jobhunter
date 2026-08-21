import type { Repositories } from '../../../src/persistence/repositories/index.js';
import type { ProfessionalProfile } from '../../../src/profile/schema.js';
import type { JobFilterConfig } from '../../../src/filter/schema.js';
import { FakePage, type FakeLocator } from '../../../src/linkedin/fake-page.js';

/**
 * Minimal `ProfessionalProfile` shape accepted by the persistence
 * boundary (mirrors `tests/pipeline/helpers/fixtures.ts`).
 */
export const REEVAL_EVAL_PROFILE: ProfessionalProfile = {
  schemaVersion: 1,
  id: 'profile_reeval_1',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  contentHash: 'a'.repeat(64),
  sourceIds: ['source_1'],
  basics: {
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
 * Minimal `JobFilterConfig` shape — accepts every job (no excluded
 * companies, no required keywords, no seniority cap).
 */
export const REEVAL_MINIMAL_CONFIG: JobFilterConfig = {
  schemaVersion: 1,
  excludedCompanies: [],
  title: { excludedKeywords: [], requiredAnyKeywords: [] },
  description: { excludedKeywords: [], requiredAnyKeywords: [] },
  seniority: { maximum: null },
  languages: { accepted: [], rejectWhenExplicitlyRequiresOtherLanguage: false },
};

/**
 * Insert an approved + active profile version. Returns the new row's id.
 */
export async function insertApprovedProfileForReeval(repositories: Repositories): Promise<number> {
  const profileVersionId = await repositories.profileVersions.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: 'reeval-profile-content-hash',
    extractionFingerprint: 'reeval-profile-extraction-fp',
    sourceIds: [1],
    profileJson: REEVAL_EVAL_PROFILE,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    active: false,
  });
  await repositories.profileVersions.approve(profileVersionId, {
    approvedAt: '2026-08-20T00:00:00.000Z',
    supersededAt: '2026-08-20T00:00:00.000Z',
  });
  return profileVersionId;
}

/**
 * Insert an active filter configuration. Returns the new row's id.
 */
export async function insertActiveFilterForReeval(
  repositories: Repositories,
  contentHash = 'reeval-filter-content-hash',
): Promise<number> {
  return repositories.filterConfigurations.insert({
    schemaVersion: 1,
    contentHash,
    configJson: REEVAL_MINIMAL_CONFIG,
    createdAt: '2026-08-20T00:00:00.000Z',
    active: true,
  });
}

/**
 * Insert a single complete job. Returns the new job's id.
 */
export async function insertCompleteJobForReeval(
  repositories: Repositories,
  sourceJobId: string,
  pipelineRunId: number,
  searchExecutionId: number,
  overrides: {
    title?: string | null;
    company?: string | null;
    location?: string | null;
    description?: string | null;
    extractionStatus?: 'complete' | 'partial' | 'failed';
  } = {},
): Promise<number> {
  const result = await repositories.jobs.recordNewJob({
    job: {
      sourceJobId,
      extractionStatus: overrides.extractionStatus ?? 'complete',
      firstDiscoveryTimestamp: '2026-08-20T00:00:00.000Z',
      lastRediscoveryTimestamp: '2026-08-20T00:00:00.000Z',
      createdTimestamp: '2026-08-20T00:00:00.000Z',
      updatedTimestamp: '2026-08-20T00:00:00.000Z',
      ...(overrides.title !== undefined ? { title: overrides.title } : { title: null }),
      ...(overrides.company !== undefined ? { company: overrides.company } : { company: null }),
      ...(overrides.location !== undefined ? { location: overrides.location } : { location: null }),
      ...(overrides.description !== undefined
        ? { description: overrides.description }
        : { description: null }),
      successfulMethod: 'search_detail_panel',
    },
    discoveryEvent: {
      jobId: 0,
      pipelineRunId,
      searchExecutionId,
      timestamp: '2026-08-20T00:00:00.000Z',
      isNew: true,
      currentExtractionState: 'complete',
      extractionAttempted: true,
      skipReason: null,
    },
  });
  return result.jobId;
}

/**
 * Insert a pre-existing active filter result for the supplied jobId.
 * Returns the inserted row's id. The result is left `active = true`
 * unless `active === false` is passed.
 */
export async function insertActiveFilterResultForReeval(
  repositories: Repositories,
  input: {
    jobId: number;
    fingerprint: string;
    overallOutcome: 'accepted' | 'rejected' | 'error';
    filterConfigVersionId: number;
    profileVersionId: number | null;
    active?: boolean;
    pipelineRunId?: number | null;
  },
): Promise<number> {
  return repositories.filterResults.activateResult({
    jobId: input.jobId,
    pipelineRunId: input.pipelineRunId ?? null,
    filterConfigVersionId: input.filterConfigVersionId,
    filterConfigHash: 'reeval-filter-content-hash',
    profileVersionId: input.profileVersionId,
    profileHash: input.profileVersionId === null ? null : 'reeval-profile-content-hash',
    filterImplementationVersion: '1.0.0',
    fingerprint: input.fingerprint,
    timestamp: '2026-08-20T00:00:00.000Z',
    overallOutcome: input.overallOutcome,
    rulesEvaluated: [],
    rulesPassed: [],
    rulesFailed: [],
    rejectionReasons: input.overallOutcome === 'rejected' ? ['test_rejection'] : null,
  });
}

/**
 * Insert a pre-existing active successful score result. Returns the
 * inserted row's id.
 *
 * `pipelineRunId` must reference an existing pipeline run (the
 * `score_results.pipeline_run_id` column is a NOT NULL FK).
 */
export async function insertActiveScoreResultForReeval(
  repositories: Repositories,
  options: {
    jobId: number;
    filterResultId: number;
    fingerprint: string;
    pipelineRunId: number;
    success?: boolean;
  },
): Promise<number> {
  return repositories.scoreResults.activateResult({
    jobId: options.jobId,
    pipelineRunId: options.pipelineRunId,
    filterResultId: options.filterResultId,
    fingerprint: options.fingerprint,
    timestamp: '2026-08-20T00:00:00.000Z',
    promptVersion: 'v1',
    rubricVersion: '1',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'medium',
    scorerImplementationVersion: '1',
    categoryScores: [],
    overallScore: 80,
    explanation: 'reeval test score',
    success: options.success ?? true,
  });
}

/**
 * Build a single-element locator that the discovery service's
 * `loadMoreResults` loop can consume as one card-shaped anchor.
 * Mirrors `tests/pipeline/helpers/fixtures.ts`.
 */
export function makeFakePageWithCardForReeval(sourceJobId: string): FakePage {
  const cardLocator: FakeLocator = {
    count: async () => 1,
    all: async () => [cardLocator],
    first: () => cardLocator,
    elementHandle: async () => ({
      getAttribute: (name: string) => (name === 'data-occludable-job-id' ? sourceJobId : null),
      querySelector: () => null,
    }),
    click: async () => undefined,
    waitFor: async () => undefined,
  };
  return new FakePage({
    url: 'https://www.linkedin.com/jobs/search/?q=test',
    onLocator: (selector: string) => {
      if (selector === 'li.jobs-search-results__list-item' || selector === 'div.job-search-card') {
        return cardLocator;
      }
      return null;
    },
  });
}
