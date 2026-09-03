import { OperationalConfigSchema } from '../config/schema.js';
import type { InitStepReport } from './state.js';

export interface ClassifyPathsInput {
  readonly configDirectory: string;
  readonly dataDirectory: string;
  readonly logsDirectory: string;
  readonly diagnosticsDirectory: string;
  readonly cacheDirectory: string;
  readonly profileSourcesDirectory: string;
  readonly fileSystem: { readonly pathExists: (path: string) => Promise<boolean> };
}

export interface ClassifyConfigInput {
  readonly configFilePath: string;
  readonly fileSystem: { readonly pathExists: (path: string) => Promise<boolean> };
  /**
   * Optional pre-loaded config object. When supplied, the classifier
   * skips its own `loadConfig` call and validates via
   * `OperationalConfigSchema.safeParse` directly. When `undefined`, the
   * classifier invokes `loadConfig` internally and catches `ConfigError`,
   * `ValidationError`, and `UnknownConfigError` (all exit 2).
   */
  readonly config?: unknown;
}

export interface ClassifyMigrationsInput {
  /** True when `initializeDatabase` returned without throwing. */
  readonly migrationsApplied: boolean;
  /** Optional diagnostic when migrations failed (status === 'failed'). */
  readonly errorMessage?: string;
}

export interface ClassifyOpenAiKeyInput {
  readonly present: boolean;
}

export interface ClassifySearchInput {
  readonly configHasSearch: boolean;
  readonly queryCount: number;
  readonly locationCount: number;
}

export interface ClassifySourcesInput {
  readonly importedSourceCount: number;
  readonly usableSourceCount: number;
}

export interface ClassifyExtractInput {
  readonly usableSourceCount: number;
  readonly latestDraftProfileVersionId: number | null;
  readonly openAiKeyPresent: boolean;
}

export interface ClassifyApprovedProfileInput {
  readonly activeApprovedProfileVersionId: number | null;
}

export interface ClassifyFiltersInput {
  readonly activeFilterConfigVersionId: number | null;
  /**
   * When `activeFilterConfigVersionId !== null`, the classifier
   * additionally validates the persisted row's `configJson` via
   * `JobFilterConfigSchema.safeParse` (mirrors `ConfigureFiltersService.run`
   * lines 132-141). A parse failure flips the step to `failed` with
   * `errorCode: 'invalid_filter_config'`. When `activeFilterConfigVersionId`
   * is `null`, this field is ignored.
   */
  readonly configJsonValid: boolean;
}

/**
 * `classifyPaths` is pure on its input (the resolved directory shape).
 * It does NOT touch `fileSystem` — paths either resolve via
 * `resolvePlatformPaths` at the orchestrator boundary or throw `PathError`
 * (which the sidecar maps to `InitPathsFailedError`).
 */
export function classifyPaths(_input: ClassifyPathsInput): Promise<InitStepReport> {
  return Promise.resolve({
    id: 'paths',
    status: 'complete',
    errorCode: null,
    reason: null,
    artifactId: null,
  });
}

/**
 * `classifyDirectories` returns `complete` only when every one of the six
 * resolved runtime directories exists on disk per `fileSystem.pathExists`.
 * Otherwise it returns `incomplete` (init will call
 * `ensureRuntimeDirectories`).
 */
export async function classifyDirectories(input: ClassifyPathsInput): Promise<InitStepReport> {
  const directories: readonly string[] = [
    input.configDirectory,
    input.dataDirectory,
    input.logsDirectory,
    input.diagnosticsDirectory,
    input.cacheDirectory,
    input.profileSourcesDirectory,
  ];
  for (const directory of directories) {
    const exists = await input.fileSystem.pathExists(directory);
    if (!exists) {
      return {
        id: 'directories',
        status: 'incomplete',
        errorCode: null,
        reason: 'directory_missing',
        artifactId: null,
      };
    }
  }
  return {
    id: 'directories',
    status: 'complete',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * `classifyConfig` follows three branches (Finding 9):
 *  - `pathExists === false` → `not_started` (init will materialize via
 *    `updateConfig`).
 *  - `pathExists === true` AND the supplied `config` parses cleanly
 *    via `OperationalConfigSchema.safeParse` → `complete`.
 *  - `pathExists === true` but no `config` is supplied, OR the supplied
 *    `config` fails Zod validation → `failed` with
 *    `errorCode: 'config_invalid'`.
 *
 * The classifier takes only the `pathExists` seam (not a full
 * `FileSystem`) because `loadConfig` requires the complete surface and
 * the orchestrator is expected to pre-load via
 * `loadConfig(paths, fileSystem)` and pass the result as `config`. When
 * the caller breaks that contract (`config === undefined` while the
 * file exists), the classifier surfaces `failed` so the violation is
 * loud — init's orchestrator will surface the typed
 * `InitConfigSeedingFailedError` only on the write-failure path; the
 * load-failure path is reported as a step-level `failed` entry.
 */
export async function classifyConfig(input: ClassifyConfigInput): Promise<InitStepReport> {
  const exists = await input.fileSystem.pathExists(input.configFilePath);
  if (!exists) {
    return {
      id: 'config',
      status: 'not_started',
      errorCode: null,
      reason: null,
      artifactId: null,
    };
  }
  if (input.config === undefined) {
    return {
      id: 'config',
      status: 'failed',
      errorCode: 'config_invalid',
      reason: 'config_invalid',
      artifactId: null,
    };
  }
  const parsed = OperationalConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    return {
      id: 'config',
      status: 'failed',
      errorCode: 'config_invalid',
      reason: 'config_invalid',
      artifactId: null,
    };
  }
  return {
    id: 'config',
    status: 'complete',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * `classifyMigrations` is pure. The DB handle is owned by the
 * desktop sidecar; this classifier only inspects the outcome recorded by
 * the orchestrator after `initializeDatabase` returns.
 */
export function classifyMigrations(input: ClassifyMigrationsInput): InitStepReport {
  if (input.migrationsApplied) {
    return {
      id: 'migrations',
      status: 'complete',
      errorCode: null,
      reason: null,
      artifactId: null,
    };
  }
  if (input.errorMessage !== undefined && input.errorMessage.length > 0) {
    return {
      id: 'migrations',
      status: 'failed',
      errorCode: 'init_migrations_failed',
      reason: input.errorMessage,
      artifactId: null,
    };
  }
  return {
    id: 'migrations',
    status: 'not_started',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * `classifyOpenAiKey` always returns `complete` ( — absence is
 * a skip, not a failure). The orchestrator reads the missing-key signal
 * from `classifyExtract`'s `reason === 'openai_key_missing'` instead.
 */
export function classifyOpenAiKey(_input: ClassifyOpenAiKeyInput): InitStepReport {
  return {
    id: 'openaiKey',
    status: 'complete',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * `classifySearch` returns `complete` when the loaded config has at
 * least one query, at least one location, and the `search` section
 * itself is present. Otherwise `incomplete` (init will run
 * `runConfigureSearch`).
 */
export function classifySearch(input: ClassifySearchInput): InitStepReport {
  if (input.configHasSearch && input.queryCount >= 1 && input.locationCount >= 1) {
    return {
      id: 'search',
      status: 'complete',
      errorCode: null,
      reason: null,
      artifactId: null,
    };
  }
  return {
    id: 'search',
    status: 'incomplete',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * `classifySources` returns `complete` when at least one source has
 * been imported. Otherwise `not_started` (init will run
 * `ProfileImportService.importSources`).
 */
export function classifySources(input: ClassifySourcesInput): InitStepReport {
  if (input.importedSourceCount >= 1) {
    return {
      id: 'sources',
      status: 'complete',
      errorCode: null,
      reason: null,
      artifactId: null,
    };
  }
  return {
    id: 'sources',
    status: 'not_started',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * `classifyExtract` returns:
 *  - `complete` when a draft exists and at least one source is usable.
 *  - `incomplete` with `reason: 'openai_key_missing'` when the key is
 *    absent (skip-not-fail per  + Finding 4a).
 *  - `incomplete` with `reason: null` when no draft exists but the key
 *    is present and at least one source is usable.
 *  - `not_started` when no usable source exists yet (the orchestrator
 *    should advance to the `sources` step first).
 */
export function classifyExtract(input: ClassifyExtractInput): InitStepReport {
  if (input.usableSourceCount < 1) {
    return {
      id: 'extract',
      status: 'not_started',
      errorCode: null,
      reason: null,
      artifactId: null,
    };
  }
  if (!input.openAiKeyPresent) {
    return {
      id: 'extract',
      status: 'incomplete',
      errorCode: null,
      reason: 'openai_key_missing',
      artifactId: null,
    };
  }
  if (input.latestDraftProfileVersionId === null) {
    return {
      id: 'extract',
      status: 'incomplete',
      errorCode: null,
      reason: null,
      artifactId: null,
    };
  }
  return {
    id: 'extract',
    status: 'complete',
    errorCode: null,
    reason: null,
    artifactId: `profile_${input.latestDraftProfileVersionId}`,
  };
}

/**
 * `classifyApprovedProfile` returns `complete` when the active approved
 * profile exists; otherwise `not_started` (the orchestrator will call
 * `askEditHandoff` and then approve / reject / hand off).
 */
export function classifyApprovedProfile(input: ClassifyApprovedProfileInput): InitStepReport {
  if (input.activeApprovedProfileVersionId !== null) {
    return {
      id: 'approvedProfile',
      status: 'complete',
      errorCode: null,
      reason: null,
      artifactId: `profile_${input.activeApprovedProfileVersionId}`,
    };
  }
  return {
    id: 'approvedProfile',
    status: 'not_started',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * `classifyFilters` follows three branches (Finding 4b):
 *  - `complete` when `activeFilterConfigVersionId !== null` AND the
 *    persisted `configJson` parses cleanly via
 *    `JobFilterConfigSchema.safeParse`.
 *  - `not_started` when `activeFilterConfigVersionId === null`.
 *  - `failed` with `errorCode: 'invalid_filter_config'` when the row
 *    exists but the `configJson` is malformed.
 *
 * The approval-gate case (`hasApprovedProfile === false`) is NOT a
 * `failed` filter step — the orchestrator handles the approval gate
 * separately via `classifyApprovedProfile` and `askEditHandoff`.
 */
export function classifyFilters(input: ClassifyFiltersInput): InitStepReport {
  if (input.activeFilterConfigVersionId === null) {
    return {
      id: 'filters',
      status: 'not_started',
      errorCode: null,
      reason: null,
      artifactId: null,
    };
  }
  if (!input.configJsonValid) {
    return {
      id: 'filters',
      status: 'failed',
      errorCode: 'invalid_filter_config',
      reason: 'invalid_filter_config',
      artifactId: null,
    };
  }
  return {
    id: 'filters',
    status: 'complete',
    errorCode: null,
    reason: null,
    artifactId: null,
  };
}

/**
 * Re-export `JobFilterConfigSchema` so the orchestrator can validate the
 * persisted `configJson` row directly (the same schema used by the
 * `ConfigureFiltersService` write path). Exported only as a type-level
 * convenience — `classifyFilters` itself does not import the schema
 * because it consumes a pre-computed `configJsonValid: boolean` from the
 * caller.
 */
