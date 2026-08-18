/**
 * Per-prerequisite status of the initialization state machine (SPEC §9.6).
 *
 * - `complete` — the prerequisite is satisfied; init skips it on resume.
 * - `incomplete` — the prerequisite is partially satisfied; init runs the
 *   matching service and continues on success.
 * - `failed` — the prerequisite failed in a non-resumable way; init stops
 *   and surfaces the typed error / `SetupSummary.errorCode`.
 * - `not_started` — the prerequisite has never been attempted; init runs
 *   the matching service.
 *
 * The vocabulary is local to `src/init/` and does not leak into other
 * modules — it is consumed by the orchestrator, the classify helpers,
 * the CLI renderer, and the test surface.
 */
export type InitStepStatus = 'complete' | 'incomplete' | 'failed' | 'not_started';

/**
 * Stable identifiers for the 10 classification prerequisites (SPEC §9.1
 * collapsed). The `INIT_STEPS` tuple below enumerates them in the order
 * the orchestrator walks them. Adding a new prerequisite requires:
 *   1. Adding the literal here.
 *   2. Adding a `classify*` helper in `src/init/classify.ts`.
 *   3. Wiring it into `InitOrchestrator.run()`.
 *   4. Updating the `INIT_SCHEMA_VERSION` if the order or set changes.
 */
export type InitStepId =
  | 'paths'
  | 'directories'
  | 'migrations'
  | 'config'
  | 'openaiKey'
  | 'search'
  | 'sources'
  | 'extract'
  | 'approvedProfile'
  | 'filters';

export const INIT_STEPS: readonly InitStepId[] = [
  'paths',
  'directories',
  'migrations',
  'config',
  'openaiKey',
  'search',
  'sources',
  'extract',
  'approvedProfile',
  'filters',
] as const;

/** The literal version of the init state vocabulary. Bump on any change to the step list. */
export const INIT_SCHEMA_VERSION = 1 as const;
export type InitSchemaVersion = typeof INIT_SCHEMA_VERSION;

/** Human-readable description for each step — used by the CLI renderer. */
export const INIT_STEP_LABELS: Readonly<Record<InitStepId, string>> = {
  paths: 'Resolve OS-specific runtime paths',
  directories: 'Create required runtime directories',
  migrations: 'Initialize SQLite + apply Drizzle migrations',
  config: 'Materialize default config.json when missing',
  openaiKey: 'Validate OPENAI_API_KEY presence',
  search: 'Configure LinkedIn search settings',
  sources: 'Import one or two CV sources',
  extract: 'Generate AI profile draft',
  approvedProfile: 'Approve a profile version',
  filters: 'Configure global deterministic filters',
};

/**
 * Per-step report emitted by the classifier and the orchestrator. The
 * orchestrator's `SetupSummary.steps` is a `readonly InitStepReport[]`
 * ordered by `INIT_STEPS`.
 */
export interface InitStepReport {
  readonly id: InitStepId;
  readonly status: InitStepStatus;
  /** Stable error code when `status === 'failed'`; null otherwise. */
  readonly errorCode: string | null;
  /** Short human-readable reason; null when not applicable. */
  readonly reason: string | null;
  /** Identifier of the persisted artifact referenced by the step (e.g. `profile_42`). */
  readonly artifactId: string | null;
}

/**
 * Top-level summary emitted by the orchestrator. Printed to stdout by
 * the CLI handler. The `ready` flag is the SPEC §9.5 completion bit
 * (derived, never persisted).
 */
export interface SetupSummary {
  readonly schemaVersion: InitSchemaVersion;
  readonly ready: boolean;
  readonly steps: readonly InitStepReport[];
  /**
   * When `true`, the next prerequisite the user must address. The CLI
   * surfaces this as "next: <label>". `null` when `ready === true` or
   * the last attempted step reached the end of the list.
   */
  readonly nextStep: InitStepId | null;
  /**
   * OpenAI key absence is NOT a failure. When `true`, the operator
   * must set OPENAI_API_KEY and re-run init.
   */
  readonly openAiKeyMissing: boolean;
}
