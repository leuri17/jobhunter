import type { Repositories } from '../../../src/persistence/repositories/index.js';
import type { ProfessionalProfile } from '../../../src/profile/schema.js';
import type { JobFilterConfig } from '../../../src/filter/schema.js';
import { FakePage, type FakeLocator } from '../../../src/linkedin/fake-page.js';

/**
 * Minimal `ProfessionalProfile` shape accepted by the persistence
 * boundary (the `profileVersions.insert` method serialises via
 * `unknownJson.encode` and does NOT re-validate the JSON, so any
 * structurally-typed object works for the orchestrator's
 * `findActiveApproved` lookup).
 */
export const EVAL_PROFILE_VERSION_1: ProfessionalProfile = {
  schemaVersion: 1,
  id: 'profile_eval_1',
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
 * Insert an approved + active profile version directly via the
 * `profileVersions` repository. Returns the new row's id.
 */
export async function insertApprovedProfile(repositories: Repositories): Promise<number> {
  const profileVersionId = await repositories.profileVersions.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: 'profile-content-hash-1',
    extractionFingerprint: 'profile-extraction-fp-1',
    sourceIds: [1],
    profileJson: EVAL_PROFILE_VERSION_1,
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
 * Minimal `JobFilterConfig` shape — accepts every job (no excluded
 * companies, no required keywords, no seniority cap, no language
 * restrictions).
 */
export const MINIMAL_FILTER_CONFIG: JobFilterConfig = {
  schemaVersion: 1,
  excludedCompanies: [],
  title: { excludedKeywords: [], requiredAnyKeywords: [] },
  description: { excludedKeywords: [], requiredAnyKeywords: [] },
  seniority: { maximum: null },
  languages: { accepted: [], rejectWhenExplicitlyRequiresOtherLanguage: false },
};

/**
 * Insert an active filter configuration. Returns the new row's id.
 */
export async function insertActiveFilter(repositories: Repositories): Promise<number> {
  const configId = await repositories.filterConfigurations.insert({
    schemaVersion: 1,
    contentHash: 'filter-content-hash-1',
    configJson: MINIMAL_FILTER_CONFIG,
    createdAt: '2026-08-20T00:00:00.000Z',
    active: true,
  });
  return configId;
}

/**
 * Build a single-element locator that the discovery service's
 * `loadMoreResults` loop can consume as one card-shaped anchor.
 *
 * The locator advertises `count() === 1` and exposes a
 * `getAttribute('data-occludable-job-id')` returning the supplied
 * `sourceJobId`. This is the minimum surface the discovery flow
 * needs to insert a new job row.
 *
 * NOTE: this helper is NOT used by any test in Wave D — the
 * orchestrator tests cannot inject a custom page factory through the
 * current `buildRunHarness` helper (the harness's `FakeBrowserSession`
 * is constructed without exposing its `createPage` hook). The helper
 * is preserved here for future Wave E work that wires the page
 * factory into the harness.
 */
export function makeFakePageWithCard(sourceJobId: string): FakePage {
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
