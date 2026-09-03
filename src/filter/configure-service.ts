/**
 * `ConfigureFiltersService` — interactive filter configuration flow
 *
 * The service combines two existing patterns:
 *
 *   - The **prompt style** of `ConfigureSearchService` (collect →
 *     return → caller persists). Every user-facing question is
 *     delegated to the `FilterPrompts` seam so tests can drive the
 *     flow without a terminal.
 *
 *   - The **persistence style** of `ProfileApprovalService` (atomic
 *     version transition + dependent invalidation). On `save` the
 *     service inserts a new `filter_configuration_versions` row,
 *     activates it (which atomically deactivates the prior active
 *     row), and invalidates every dependent `filter_results` row
 *     tied to the prior active config.
 *
 * Flow (mirrors the brief exactly):
 *
 *   1. Load the active approved profile via
 *      `profileVersions.findActiveApproved()`. If absent, throw
 *      `NoActiveProfileError` — this is the  first-run gate
 *      and is checked BEFORE the config check.
 *   2. Load the existing active config via
 *      `filterConfigurations.findActive()` (may be `null`).
 *   3. If a prior config exists, parse the JSON via
 *      `JobFilterConfigSchema.safeParse`. A parse failure throws
 *      `InvalidFilterConfigError` — the persisted row is corrupt.
 *   4. Walk the prompts (10 calls in a fixed order; see `run()`).
 *   5. Show the preview; on `askConfirmation === false`, return
 *      `{ kind: 'discarded' }` without writing.
 *   6. Build the `JobFilterConfig`, validate via the schema, normalize
 *      via `normalizeJobFilterConfig`, and hash via
 *      `calculateFilterConfigContentHash`.
 *   7. Insert a new row (inactive), activate it (atomic deactivate-then-
 *      activate), and invalidate dependents tied to the prior config.
 *      Return `{ kind: 'saved', filterConfigVersionId, invalidatedFilterResults }`.
 *
 * Persistence failures from `insert` / `activate` / invalidation are
 * wrapped in `FilterStorageError` with the underlying cause attached.
 *
 * Domain-boundary note (AGENTS.md §5, §9): this module imports only the
 * sibling `src/filter/*` modules and the `Repositories` facade from
 * `src/persistence/repositories/index.js`. It does NOT import
 * Playwright, Drizzle directly, OpenAI, or Pino. The
 * `tests/filter/boundaries.test.ts` guard enforces this.
 */

import { type Repositories } from '../persistence/repositories/index.js';
import { type ProfessionalProfile } from '../profile/schema.js';
import { calculateFilterConfigContentHash } from './content-hash.js';
import { FilterStorageError, InvalidFilterConfigError, NoActiveProfileError } from './errors.js';
import { type FilterConfigurationPreview, type FilterPrompts } from './prompts.js';
import { JobFilterConfigSchema, normalizeJobFilterConfig, type JobFilterConfig } from './schema.js';

export interface ConfigureFiltersServiceOptions {
  readonly repositories: Repositories;
  readonly prompts: FilterPrompts;
  /** Override the wall-clock for tests; defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export type ConfigureFiltersOutcome =
  | {
      readonly kind: 'saved';
      readonly filterConfigVersionId: number;
      readonly invalidatedFilterResults: number;
    }
  | { readonly kind: 'discarded' };

/**
 * Narrowing helper: extract the languages array from a
 * `ProfessionalProfile`'s `profileJson` (the column is `unknown` at the
 * persistence boundary). Returns `[]` when the profile is missing or the
 * languages array is malformed — the fingerprint composer handles both
 * shapes identically (an empty `languages` field yields an empty slice).
 */
function readProfileLanguages(profileJson: unknown): readonly string[] {
  if (profileJson === null || typeof profileJson !== 'object') return [];
  const languages = (profileJson as { languages?: unknown }).languages;
  if (!Array.isArray(languages)) return [];
  const result: string[] = [];
  for (const entry of languages) {
    if (entry === null || typeof entry !== 'object') continue;
    const name = (entry as { normalizedName?: unknown }).normalizedName;
    if (typeof name === 'string' && name.length > 0) {
      result.push(name);
    }
  }
  return result;
}

function toPreview(config: JobFilterConfig): FilterConfigurationPreview {
  return {
    excludedCompanies: config.excludedCompanies,
    titleExcludedKeywords: config.title.excludedKeywords,
    titleRequiredAnyKeywords: config.title.requiredAnyKeywords,
    descriptionExcludedKeywords: config.description.excludedKeywords,
    descriptionRequiredAnyKeywords: config.description.requiredAnyKeywords,
    maximumSeniority: config.seniority.maximum,
    acceptedLanguages: config.languages.accepted,
    rejectUnsupportedLanguages: config.languages.rejectWhenExplicitlyRequiresOtherLanguage,
  };
}

export class ConfigureFiltersService {
  private readonly repositories: Repositories;
  private readonly prompts: FilterPrompts;
  private readonly now: () => Date;

  constructor(options: ConfigureFiltersServiceOptions) {
    this.repositories = options.repositories;
    this.prompts = options.prompts;
    this.now = options.now ?? ((): Date => new Date());
  }

  async run(): Promise<ConfigureFiltersOutcome> {
    const profileVersion = await this.repositories.profileVersions.findActiveApproved();
    if (profileVersion === null) {
      throw new NoActiveProfileError(
        'No active approved profile exists. Approve a profile before configuring filters.',
        { gate: 'configure_filters_first_run' },
      );
    }

    // 2. Existing active config (may be null on the first run).
    const existingConfigRow = await this.repositories.filterConfigurations.findActive();

    // 3. If a prior config exists, validate the persisted JSON.
    let existingConfig: JobFilterConfig | null = null;
    if (existingConfigRow !== null) {
      const parsed = JobFilterConfigSchema.safeParse(existingConfigRow.configJson);
      if (!parsed.success) {
        throw new InvalidFilterConfigError(
          `Persisted filter configuration (id=${existingConfigRow.id}) failed schema validation: ${parsed.error.message}`,
          { filterConfigVersionId: existingConfigRow.id, issues: parsed.error.issues },
        );
      }
      existingConfig = parsed.data;
    }

    // 4. Walk the prompts in the fixed order.
    const profileLanguages = readProfileLanguages(
      (profileVersion as { profileJson?: unknown }).profileJson,
    );
    const excludedCompanies = await this.prompts.askExcludedCompanies(
      existingConfig?.excludedCompanies ?? [],
    );
    const titleExcludedKeywords = await this.prompts.askTitleExcludedKeywords(
      existingConfig?.title.excludedKeywords ?? [],
    );
    const titleRequiredAnyKeywords = await this.prompts.askTitleRequiredAnyKeywords(
      existingConfig?.title.requiredAnyKeywords ?? [],
    );
    const descriptionExcludedKeywords = await this.prompts.askDescriptionExcludedKeywords(
      existingConfig?.description.excludedKeywords ?? [],
    );
    const descriptionRequiredAnyKeywords = await this.prompts.askDescriptionRequiredAnyKeywords(
      existingConfig?.description.requiredAnyKeywords ?? [],
    );
    const maximumSeniority = await this.prompts.askMaximumSeniority(
      existingConfig?.seniority.maximum ?? null,
    );
    const languagesResult = await this.prompts.askAcceptedLanguages(profileLanguages);
    const acceptedLanguages = [...languagesResult.chosen, ...languagesResult.added];
    const rejectUnsupportedLanguages = await this.prompts.askRejectUnsupportedLanguages(
      existingConfig?.languages.rejectWhenExplicitlyRequiresOtherLanguage ?? false,
    );

    // 5. Build the preview and ask for confirmation.
    const builtConfig: JobFilterConfig = {
      schemaVersion: 1,
      excludedCompanies: [...excludedCompanies],
      title: {
        excludedKeywords: [...titleExcludedKeywords],
        requiredAnyKeywords: [...titleRequiredAnyKeywords],
      },
      description: {
        excludedKeywords: [...descriptionExcludedKeywords],
        requiredAnyKeywords: [...descriptionRequiredAnyKeywords],
      },
      seniority: { maximum: maximumSeniority },
      languages: {
        accepted: acceptedLanguages,
        rejectWhenExplicitlyRequiresOtherLanguage: rejectUnsupportedLanguages,
      },
    };
    const preview = toPreview(builtConfig);
    await this.prompts.showPreview(preview);
    const confirmed = await this.prompts.askConfirmation(preview);
    if (!confirmed) {
      return { kind: 'discarded' };
    }

    // 6. Validate + normalize + hash.
    const parsed = JobFilterConfigSchema.parse(builtConfig);
    const normalized = normalizeJobFilterConfig(parsed);
    const contentHash = calculateFilterConfigContentHash(normalized);

    // 7. Insert + activate (atomic deactivate-then-activate) + invalidate.
    let newId: number;
    try {
      newId = await this.repositories.filterConfigurations.insert({
        schemaVersion: 1,
        contentHash,
        configJson: normalized,
        createdAt: this.now().toISOString(),
        active: false,
      });
      await this.repositories.filterConfigurations.activate(newId);
    } catch (cause) {
      throw new FilterStorageError(
        `Failed to persist filter configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
        {},
        cause instanceof Error ? cause : undefined,
      );
    }

    // 8. Invalidate dependents. `-1` matches no row (the WHERE clause
    //    `eq(filterResults.filterConfigVersionId, -1)` returns nothing),
    //    so the call returns 0 on a first-run save.
    const invalidatedFilterResults =
      await this.repositories.filterResults.invalidateByFilterConfigVersion(
        existingConfigRow?.id ?? -1,
      );

    return {
      kind: 'saved',
      filterConfigVersionId: newId,
      invalidatedFilterResults,
    };
  }
}

// Helper re-export so consumers don't need a second import. Used by
// integration tests that want to construct a minimal profile.
export type { ProfessionalProfile };
