/**
 * First-run filter bootstrap (issue #307): the desktop app requires an
 * active filter configuration to run the pipeline, and until in-app
 * filter management ships (#301) nothing else creates one. This helper
 * idempotently installs an accept-all default using the same
 * validate → normalize → hash → insert → activate path the
 * interactive `ConfigureFiltersService` takes.
 */

import type { Repositories } from '../persistence/repositories/index.js';
import { calculateFilterConfigContentHash } from './content-hash.js';
import { JobFilterConfigSchema, normalizeJobFilterConfig, type JobFilterConfig } from './schema.js';

/** Accept-all default: no exclusions, no seniority cap, no language restrictions. */
export const DEFAULT_JOB_FILTER_CONFIG: JobFilterConfig = {
  schemaVersion: 1,
  excludedCompanies: [],
  title: { excludedKeywords: [], requiredAnyKeywords: [] },
  description: { excludedKeywords: [], requiredAnyKeywords: [] },
  seniority: { maximum: null },
  languages: { accepted: [], rejectWhenExplicitlyRequiresOtherLanguage: false },
};

export interface DefaultFilterResult {
  readonly filterConfigVersionId: number;
  readonly contentHash: string;
  /** False when an active configuration already existed and was returned as-is. */
  readonly created: boolean;
}

export async function ensureDefaultFilterConfig(
  repositories: Repositories,
  now: () => Date = (): Date => new Date(),
): Promise<DefaultFilterResult> {
  const existing = await repositories.filterConfigurations.findActive();
  if (existing !== null) {
    return {
      filterConfigVersionId: existing.id,
      contentHash: existing.contentHash,
      created: false,
    };
  }
  const normalized = normalizeJobFilterConfig(
    JobFilterConfigSchema.parse(DEFAULT_JOB_FILTER_CONFIG),
  );
  const contentHash = calculateFilterConfigContentHash(normalized);
  const id = await repositories.filterConfigurations.insert({
    schemaVersion: 1,
    contentHash,
    configJson: normalized,
    createdAt: now().toISOString(),
    active: false,
  });
  await repositories.filterConfigurations.activate(id);
  return { filterConfigVersionId: id, contentHash, created: true };
}
