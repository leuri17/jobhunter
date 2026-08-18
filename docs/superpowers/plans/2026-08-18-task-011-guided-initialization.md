# TASK-011 Implementation Plan — Guided Initialization and Resumable Setup Orchestration

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Compose the prerequisite services completed by TASK-006, TASK-007, TASK-008, TASK-009, and TASK-010 into an idempotent, resumable `jobhunter init` workflow (SPEC §9.1–9.6). The implementation is a single `InitOrchestrator` application service (`src/init/init-service.ts`) that classifies the existing persisted state at each prerequisite step, runs the first incomplete prerequisite, and emits a typed `SetupSummary` — without modifying any prerequisite service's behaviour. A thin `init` subcommand in `src/cli.ts` owns the lifecycle and exit-code mapping. No new schema, no new direct dependency, no schema migration, no `--json` for init in this task.

**Architecture:** A new `src/init/` sibling of `src/profile/`, `src/search/`, and `src/filter/` houses the orchestration layer. The pure layer (`src/init/state.ts`, `src/init/classify.ts`, `src/init/errors.ts`, `src/init/log.ts`) has no I/O. The application layer (`src/init/init-service.ts`) composes the existing services: `resolvePlatformPaths`, `ensureRuntimeDirectories`, `loadConfig`, `updateConfig`, `initializeDatabase`, `ProfileImportService`, `ProfileExtractionService`, `ProfileApprovalService`, `ProfileRejectionService`, `ConfigureFiltersService`, and `runConfigureSearch`. `src/init/prompts.ts` declares the `InitPrompts` seam (init-specific user interactions only — `askResume`, `askSourcePaths`, `askEditHandoff`, `confirmSummary`; "reuse plan" is decided by the pure classifier without prompting, and approval-handoff text is the `confirmSummary` message); `src/init/prompts-inquirer.ts` is the ONLY module under `src/init/` allowed to import `@inquirer/prompts`. Domain code never imports Commander, Inquirer, Playwright, Drizzle directly, or Pino directly — Pino is reached through the `InitLogger` adapter (mirrors `noopLogger` / `noopProfileExtractionLogger`). The CLI handler extends `createProgram({ ..., initPrompts })` (backward-compatible — `initPrompts` is the new optional slot) and lets the existing `exitWithError` map typed errors to exit codes.

**Tech Stack:** No new dependencies. Reuses `zod`, `drizzle-orm@0.45.2`, `better-sqlite3@13.0.3`, `commander`, `@inquirer/prompts`, `pino@10.3.1`, `vitest`, the existing `Repositories` facade, `initializeDatabase`, `loadConfig`/`updateConfig`, and every prerequisite service from TASK-006–010. No new database tables or migrations are required — TASK-003 already created every table the completion check reads. Completion is DERIVED from existing tables; no `applicationMetadata` write is performed for init markers (Decision 11).

## Open decisions confirmed before implementation

These map to the 13 pinned decisions in `.slim/deepwork/task-011-guided-initialization.md` and to the SPEC §8.3–8.6, §9.1–9.6, §31, §37, §40, §42 references. The implementing agent must stop and ask the user to confirm all 13 resolutions before any file in `src/init/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Directory location | New `src/init/` (sibling of `src/profile/`, `src/search/`, `src/filter/`). Layout: `init-service.ts`, `state.ts`, `classify.ts`, `errors.ts`, `prompts.ts`, `prompts-inquirer.ts`, `log.ts`, `index.ts`. | §9.1, §31 |
| 2 | State model | New discriminated union `InitStepStatus = 'complete' \| 'incomplete' \| 'failed' \| 'not_started'` introduced in `src/init/state.ts` (does NOT leak outside `src/init/`). The orchestrator class is named `InitOrchestrator` to match the established service style (`ProfileApprovalService`, `ConfigureFiltersService`). | §9.6, AGENTS.md §5 |
| 3 | Resume algorithm | Linear walk over a fixed ordered step list. SPEC §9.1's 14 steps collapse to **10 classification prerequisites** (paths / directories / migrations / config / openai-key / search / sources / extract / approved-profile / filters — note: `sources` and `extract` are reported separately to make the "import succeeded but extraction not yet" state observable). On `complete` skip; on the first non-complete prerequisite, run that step and STOP (resume on the next invocation). `failed` surfaces the typed error and stops. Cancellation is a separate signal caught by the orchestrator. | §9.1, §9.6 |
| 4 | OpenAI key gate | A pure `validateOpenAiApiKey(env)` reads `process.env.OPENAI_API_KEY` (or accepts an injected `Readonly<Record<string, string \| undefined>>` for hermetic tests), returns `{ present: boolean; trimmedKey: string \| null }`. The extract step is **skipped** when absent — NOT failed. SPEC §9.2: "explain how, stop before OpenAI-dependent steps, preserve completed work." Exit 5 is reserved for OpenAI *runtime* failures surfaced through `ProfileExtractionService`; missing key → exit 0 with partial summary. | §9.2, §37 |
| 5 | Default config seeding | `loadConfig` already returns `DEFAULT_OPERATIONAL_CONFIG` when `config.json` is missing. For SPEC §9.1 step 5 ("create a default `config.json` when missing") init explicitly calls `updateConfig` with a no-op owned-section patch (every `ConfigPatch` field omitted) using `confirm: async () => true` to materialize the file atomically (existing temp-file + rename contract). If `config.json` exists, init NEVER calls `updateConfig` for it. | §8.5, §9.3 |
| 6 | Profile editing boundary | `ProfileEditingService.startEdit` is an interactive `for(;;)` shell — its loop runs until `save \| discard \| exit`. The init orchestrator MUST NOT inline it. Behaviour: when the latest profile version is `draft` and unapproved, init shows the review summary, then prompts `askEditHandoff(...)` offering a handoff message ("Run `jobhunter profile edit <id>` to edit the draft, then re-run `jobhunter init`."), and exits 0 with a partial summary. Approval (`ProfileApprovalService.approve`) IS called inline because it is one-shot + atomic. | §9.1, §16.3, §16.6 |
| 7 | Cancellation | Every prerequisite service throws a `UserCancellation` subclass (e.g. `UserCancelledSearchConfigError`, `UserCancelledFilterConfigError`) mapped to `ExitCode.UserCancellation` (130). The orchestrator catches `UserCancellation` AND `SearchCancelledError` (uniform 130), persists the partial `SetupSummary`, and rethrows for the CLI boundary. The handler retains the `try/finally handle.close()` pattern. | §37, §40 |
| 8 | Setup summary output | A typed `SetupSummary` printed to stdout via the existing CLI formatting helper. SPEC §31 lists `jobhunter init` but does NOT enumerate `--json` for it; init is interactive. `--json` for init is deferred to TASK-016. The summary includes every step's `status`, `reason`, `errorCode`, and a `ready: boolean` derived from SPEC §9.5. | §9.5, §31, §36 |
| 9 | Failure isolation | Each prerequisite step is wrapped so an unhandled error from one step never leaves the DB handle open. The orchestrator's `run()` method returns either a `SetupSummary` (success / partial / cancelled) or throws — never aborts mid-flow with a dangling DB handle. The CLI handler retains the existing `try/finally handle.close()` pattern. The orchestrator's own catch wraps each step in `try/finally` so the handle closure happens at the CLI boundary regardless. | §40, AGENTS.md §5 |
| 10 | Test seams | `createProgram({ prompts, openaiClient, filterPrompts, initPrompts })` is extended with a fourth optional `initPrompts: InitPrompts` slot. The `InitPrompts` interface lives in `src/init/prompts.ts`. The inquirer adapter lives in `src/init/prompts-inquirer.ts` — the ONLY module under `src/init/` allowed to import `@inquirer/prompts` (mirrors `src/filter/prompts-inquirer.ts`). The `tests/init/` tree follows the established layout: `mkdtempSync` + `createDatabaseConnection` + `runMigrations` + `createRepositories` per test. | §5.3, AGENTS.md §11 |
| 11 | No new schema or migration | The orchestrator reads existing tables only. No DDL, no new columns, no `applicationMetadata` writes for init markers. Completion is DERIVED from existing state: valid config + ≥1 query + ≥1 location + active approved profile + active filter config + migrated DB. This satisfies SPEC §9.5 + §9.6 and respects AGENTS.md "no schema change without approval." | §9.5, §9.6, AGENTS.md §12 |
| 12 | Logging | Pino structured log per prerequisite (`component: 'init'`, `event: 'step.start' \| 'step.skip' \| 'step.complete' \| 'step.fail'`, `stepId`, optional `errorCode`, no secrets, no prompt transcripts). The `InitLogger` interface is the seam; `noopInitLogger` is the default for unit tests; `pinoInitLogger(logger)` is the production adapter. Mirrors `noopLogger` and `noopProfileExtractionLogger` patterns. | §5.7, AGENTS.md §5 |
| 13 | Exit-code mapping | 0 = success or clean partial (OpenAI key absent → "set OPENAI_API_KEY and rerun"); 1 = unrecoverable step failure (FS / DB / persistence); 2 = input / argument errors (`ExitCode.InvalidUsage`); 3 = `NoActiveProfileError` (when the approval gate is reached without a draft to approve — covers the profile-edit handoff scenario from Decision 6); 5 = OpenAI *runtime* family surfaced by `ProfileExtractionService` (`ExitCode.OpenAIFailure`); 130 = user cancellation. The orchestrator never calls `process.exit`. | §37, AGENTS.md §10 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system. `package.json` dependencies are unchanged.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/init/` — with the **single explicit carve-out** for `src/init/prompts-inquirer.ts` (the only module allowed to import `@inquirer/prompts`) — **must not** import Commander, Inquirer (outside the carve-out), Playwright, Drizzle directly, the `openai` SDK, or Pino directly. The `InitLogger` interface is the seam; `src/init/init-service.ts` takes the logger via constructor injection. `src/init/classify.ts` and `src/init/state.ts` are pure (no I/O at all).
- **Editor / Inquirer isolation:** The `InitPrompts` interface (`src/init/prompts.ts`) is the seam. The default Inquirer adapter (`src/init/prompts-inquirer.ts`) is the only module that imports `@inquirer/prompts`. Tests inject a `FailingInitPrompts` or `ScriptedInitPrompts`. The CLI never invokes `@inquirer/prompts` directly from `init`.
- **Validation:** Zod at every external boundary. `OperationalConfigSchema` is the canonical config validator (TASK-002). Persisted `profileJson` and `configJson` are revalidated through their respective `safeParse` paths on load (the prerequisite services own the schema validation; init never duplicates it). The `INIT_SCHEMA_VERSION` constant is the only new constant added by this task; it is `1`.
- **Errors:** Typed errors extending `ApplicationError`. New lifecycle error codes are added to `src/init/errors.ts`. Exit-code mapping follows Decision 13. The orchestrator's `run()` never throws `ApplicationError` for `failed` states — those are surfaced as `SetupSummary` records with `status: 'failed'`, `reason`, and `errorCode`. The orchestrator DOES throw typed errors for genuine unrecoverable conditions (`InitLifecycleError` subclasses).
- **History preservation (AGENTS.md §6):** Init never deletes, resets, or supersedes historical profile sources, profile versions, filter configuration versions, search executions, or `applicationMetadata` rows. Init never writes a new `profileJson` or `filter_configuration_versions` row of its own — those writes are delegated to the prerequisite services.
- **Determinism:** The classification helpers are pure functions of their inputs. The `ScriptedInitPrompts` and `FailingInitPrompts` adapters make the interactive flow deterministic in tests. The `validateOpenAiApiKey` helper is a pure function of its `env` record.
- **Tests:** Vitest. Pure-classify tests are deterministic and unit-style. Service tests use scripted prompts + scripted prerequisite prompts (the existing `SearchPrompts` and `FilterPrompts` seams) + scripted `OpenAIClient`. Repository tests use temporary SQLite databases (`mkdtempSync(join(tmpdir(), 'jobhunter-...'))`). CLI smoke tests use `process.exit`/`stdout`/`stderr` capture as in TASK-009 / TASK-010. No live network, no live LinkedIn, no live OpenAI.
- **JSON output discipline (AGENTS.md §10):** `jobhunter init` stays human-readable in TASK-011. Structured `--json` output for init is deferred to TASK-016 per the pinned Decision 8. Logs go to stderr; the typed `SetupSummary` goes to stdout.
- **No secrets:** Init never logs `OPENAI_API_KEY`, prompt transcripts, raw OpenAI responses, configuration payloads that include environment-derived secrets, or any user-typed filter/profile value beyond the field path and resolution type. The `InitLogger` adapter is responsible for redacting `apiKey` metadata; `src/init/init-service.ts` never adds the key to its log payload.

## Reconciler facts (from `.slim/deepwork/task-011-guided-initialization.md`)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and are not re-litigated in this plan.

- `createProgram` test seam is `{ prompts, openaiClient, filterPrompts }` — extended to `{ prompts, openaiClient, filterPrompts, initPrompts }`. The fourth slot is OPTIONAL and backward-compatible (Finding 2).
- Exit-code map is already established in `src/errors/application-error.ts` (`Success: 0`, `Fatal: 1`, `InvalidUsage: 2`, `MissingRequired: 3`, `LinkedInBlocked: 4`, `OpenAIFailure: 5`, `UserCancellation: 130`). Decision 13 maps init's lifecycle errors to these codes; no new codes are introduced.
- `loadConfig` returns `DEFAULT_OPERATIONAL_CONFIG` on missing file; init MUST still *materialize* `config.json` via `updateConfig` (no-op patch, Decision 5). When present, init never writes it.
- `ProfileEditingService.startEdit` is an interactive loop and MUST NOT be called inline by the orchestrator (Decision 6). The orchestrator surfaces a handoff message instead.
- `ProfileExtractionService.extract` returns a `ProfileExtractionStatus` union (`'created' | 'reused' | 'failed'`) — no thrown typed error for the OpenAI family. Init reads `kind: 'failed'` and surfaces exit 5 via `InitExtractRuntimeFailedError` (Decision 4).
- `EditOutcome.kind === 'cancelled'` is the only existing in-band cancellation return shape; everything else throws. `UserCancelledApprovalError`, `UserCancelledRejectionError`, `UserCancelledFilterConfigError`, and `SearchCancelledError` are the cancellation surfaces the orchestrator catches.
- `Repositories.findActiveApproved()` (profileVersions) and `Repositories.findActive()` (filterConfigurations) already answer the §9.5 completion question. Init composes them through `classifyApprovedProfile` and `classifyFilters`.
- `initializeDatabase` returns `DatabaseHandle { close }`; the `try/finally handle.close()` pattern is reused unchanged from the existing CLI handlers.
- `cliFileSystem` (`src/cli.ts:57-81`) is the canonical FileSystem shape; the init service takes it as a constructor option.
- No existing `Status` enum covers `'complete' | 'incomplete' | 'failed' | 'not_started'`; this task introduces it locally in `src/init/state.ts` (Decision 2). The vocabulary does NOT leak into other modules.

## File Structure

```text
src/init/
  state.ts                          # NEW: InitStepStatus, InitStepId, StepReport, SetupSummary (Task 1)
  errors.ts                         # NEW: InitLifecycleError family (Task 2)
  classify.ts                       # NEW: pure classifiers per prerequisite (Task 3)
  prompts.ts                        # NEW: InitPrompts interface + failing/scripted adapters (Task 4)
  prompts-inquirer.ts               # NEW: default @inquirer/prompts adapter (Task 5)
  log.ts                            # NEW: InitLogger interface + noopInitLogger + pinoInitLogger (Task 6; was Task 7 — Minor c: log.ts must precede init-service.ts because InitOrchestrator imports noopInitLogger)
  init-service.ts                   # NEW: InitOrchestrator (Task 7; was Task 6)
  format.ts                         # NEW: formatInitSummary human-readable renderer (Task 9; added per Oracle re-review)
  index.ts                          # NEW: public re-exports (Task 8)
src/cli.ts                          # MODIFIED: extend createProgram({ initPrompts }); add init subcommand (Task 9)
tests/init/
  state.test.ts                     # (Task 1)
  errors.test.ts                    # (Task 2)
  classify.test.ts                  # (Task 3)
  prompts.test.ts                   # (Task 4)
  prompts-inquirer.test.ts          # (Task 5; mandatory per Minor e)
  log.test.ts                       # (Task 6; pinoInitLogger emits structured logs)
  init-service.test.ts              # (Task 7 + Task 11 boundary)
  format.test.ts                     # (Task 9; assert formatInitSummary renders every documented SetupSummary shape — ready: true, ready: false + openAiKeyMissing, ready: false + edit handoff, ready: false + blocking conflict, ready: false + invalid config — deterministically)
  boundaries.test.ts                # NEW: assert no OpenAI/CLI/Playwright/Drizzle/Pino imports (created in Task 1 as skeleton, extended in Tasks 2 + 7, finalised in Task 11)
  cli/init.test.ts                  # NEW: CLI smoke for `jobhunter init` (introduced in Task 9; expanded scenarios in Task 11)
```

Files change together by responsibility. The pure helpers (`state.ts`, `errors.ts`, `classify.ts`, `log.ts`) have no Drizzle, no Commander, no Inquirer, no OpenAI, no Pino imports, no Playwright imports. The orchestrator (`init-service.ts`) is the only layer that touches both the helpers and the prerequisite services. The CLI layer is a thin shell that opens the database, builds the prompts adapter, calls the orchestrator, and renders the typed `SetupSummary`.

### ASCII dependency diagram

```text
                           ┌─────────────────────────────┐
                           │       src/cli.ts            │
                           │  (initCommand + createProgram)│
                           └──────────────┬──────────────┘
                                          │ uses
                                          ▼
   ┌───────────────────────────────────────────────────────────┐
   │                    src/init/index.ts (barrel)             │
   └────┬───────────────┬────────────────┬────────────────────┬─┘
        │               │                │                    │
        ▼               ▼                ▼                    ▼
 ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐ ┌─────────────────┐
 │ init-service│ │  state.ts    │ │  classify.ts    │ │  prompts.ts     │
 │ (orchestr.) │ │ (pure types) │ │ (pure helpers)  │ │ (InitPrompts)   │
 └──────┬──────┘ └──────────────┘ └────────┬────────┘ └────────┬────────┘
        │                                  │                   │
        │                                  │                   │ default impl
        │                                  │                   ▼
        │                                  │         ┌────────────────────────┐
        │                                  │         │ prompts-inquirer.ts    │
        │                                  │         │ (only @inquirer/       │
        │                                  │         │  prompts import)       │
        │                                  │         └────────────────────────┘
        │                                  │
        │                                  │
        │ composes (via existing barrels, no direct imports of
        │ Commander / Drizzle / Pino / Playwright / Inquirer):
        ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │   src/profile/{ProfileImportService, ProfileExtractionService,    │
 │                 ProfileApprovalService, ProfileRejectionService}  │
 │   src/filter/{ConfigureFiltersService}                            │
 │   src/search/{runConfigureSearch}                                 │
 │   src/config/{loadConfig, updateConfig}                           │
 │   src/persistence/{initializeDatabase, createRepositories}        │
 │   src/platform/{resolvePlatformPaths, ensureRuntimeDirectories}   │
 │   src/logging/logger.ts (reached via InitLogger adapter)          │
 └────────────────────────────────────────────────────────────────────┘
```

The arrows above are conceptual — `init-service.ts` imports each prerequisite service through its existing barrel (`src/profile/index.js`, `src/filter/index.js`, `src/search/index.js`, etc.) and never reaches into their internals. The InitLogger adapter (`src/init/log.ts`) wraps a Pino `Logger` from `src/logging/logger.ts`; the orchestrator itself never imports `pino`.

---

### Task 1: `state.ts` — `InitStepStatus`, `InitStepId`, `StepReport`, `SetupSummary`

**Files:**
- Create: `src/init/state.ts`
- Create: `tests/init/state.test.ts`
- Create: `tests/init/boundaries.test.ts` (skeleton — extended in Task 7; finalised in Task 10)

**Goal:** Establish the pure state vocabulary that drives every other module under `src/init/`. The `InitStepStatus` union introduces a new vocabulary for the first time in the codebase (deepwork reconciler: "No existing `Status` enum covers `'complete' | 'incomplete' | 'failed' | 'not_started'`"). The vocabulary is local to `src/init/` and does not leak into other modules.

**`state.ts`:**

```ts
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
export type InitStepStatus =
  | 'complete'
  | 'incomplete'
  | 'failed'
  | 'not_started';

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
```

**Tests (`tests/init/state.test.ts`):**
- `INIT_STEPS` contains exactly the 10 prerequisites in the documented order.
- `INIT_SCHEMA_VERSION` is the literal `1`.
- `INIT_STEP_LABELS` covers every `InitStepId` (no missing label, no extra label).
- `InitStepReport` and `SetupSummary` compile as readonly interfaces (TypeScript-only assertion).
- The `InitStepStatus` union covers exactly the four documented variants.
- The boundaries test skeleton added in this task asserts `src/init/state.ts` and `src/init/errors.ts` (created later) avoid all banned imports once the file is in place.

**Verification:**
- `pnpm test tests/init/state.test.ts tests/init/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 2: `errors.ts` — `InitLifecycleError` family

**Files:**
- Create: `src/init/errors.ts`
- Create: `tests/init/errors.test.ts`
- Extend: `tests/init/boundaries.test.ts` (assert no banned imports)

**Goal:** Typed error family mirroring `src/filter/errors.ts` and `src/profile/errors.ts`. Every error extends `ApplicationError` with the `exitCode` per Decision 13. The orchestrator uses these errors to short-circuit on unrecoverable failures (storage / FS); per-step `failed` outcomes are NOT thrown — they are surfaced as `SetupSummary` entries (Task 1).

**`errors.ts`:**

```ts
import {
  ApplicationError,
  type ApplicationErrorMetadata,
  type ExitCodeValue,
  ExitCode,
} from '../errors/application-error.js';

/**
 * Base class for every error raised by the init lifecycle. Subclasses
 * pin a specific exit code so the CLI boundary needs no `instanceof`
 * cascade. Step-level `failed` outcomes are NOT represented here — they
 * live on `SetupSummary.steps[].errorCode`.
 */
export class InitLifecycleError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    exitCode: ExitCodeValue,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, exitCode, metadata, cause);
  }
}

/** Filesystem / path resolution failure during init. Exit 1. */
export class InitPathsFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_paths_failed',
      'Failed to resolve OS-specific runtime paths during init.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/**
 * `updateConfig` no-op patch failed to materialize `config.json`.
 * Exit 1. Distinct from the load-time `config_invalid` error code
 * (which is reported on the `config` step's `SetupSummary` and does NOT
 * throw) — this error fires only when `updateConfig` itself throws after
 * `loadConfig` succeeded (write-failure path; Finding 8).
 */
export class InitConfigSeedingFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_config_seeding_failed',
      'Failed to materialize default config.json during init.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** SQLite handle open / migration failure. Exit 1. */
export class InitMigrationsFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_migrations_failed',
      'Failed to initialize SQLite or apply Drizzle migrations during init.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** Search configuration service threw a non-cancellation error. Exit 2. */
export class InitSearchFailedError extends InitLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/** Profile import failed for every supplied source. Exit 1. */
export class InitImportFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_import_failed',
      'Profile import failed for every supplied source.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** OpenAI extraction failed at the runtime layer (auth / billing / server). Exit 5. */
export class InitExtractRuntimeFailedError extends InitLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(code, message, ExitCode.OpenAIFailure, metadata, cause);
  }
}

/** Approval gate reached without a draft to approve. Exit 3. */
export class InitApprovalFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_approval_failed',
      'Profile approval could not be performed because no draft is available.',
      ExitCode.MissingRequired,
      metadata,
      cause,
    );
  }
}

/** Filter configuration failed. Exit 2. */
export class InitFiltersFailedError extends InitLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/** SetupSummary rendering failed (rare; only triggered by a bug). Exit 1. */
export class InitSummaryFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_summary_failed',
      'Failed to render the init setup summary.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}
```

**Tests (`tests/init/errors.test.ts`):**
- Each new error class maps to the documented `exitCode` and `code`.
- `toJSON()` returns the documented shape with `cause` populated when supplied.
- `InitLifecycleError` itself is exported and extends `ApplicationError`.

**Verification:**
- `pnpm test tests/init/errors.test.ts tests/init/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 3: `classify.ts` — pure per-step classifiers

**Files:**
- Create: `src/init/classify.ts`
- Create: `tests/init/classify.test.ts`

**Goal:** Pure functions that read persisted state (or pure input) and emit a `StepReport` per prerequisite. The orchestrator walks `INIT_STEPS`, calls the matching classifier, and decides whether to skip / run / stop. No I/O side effects — every classifier accepts the relevant repository row(s) or pre-loaded value as arguments and returns a fresh `StepReport`. The `FileSystem` seam is used only by the `paths` / `directories` classifiers (to check whether directories exist on disk) and by the `config` classifier (to check whether `config.json` exists).

**`classify.ts`:**

```ts
import type { InitStepReport, InitStepStatus } from './state.js';

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

export function classifyPaths(input: ClassifyPathsInput): Promise<InitStepReport>;
export function classifyDirectories(input: ClassifyPathsInput): Promise<InitStepReport>;
export function classifyConfig(input: ClassifyConfigInput): Promise<InitStepReport>;
export function classifyMigrations(input: ClassifyMigrationsInput): InitStepReport;
export function classifyOpenAiKey(input: ClassifyOpenAiKeyInput): InitStepReport;
export function classifySearch(input: ClassifySearchInput): InitStepReport;
export function classifySources(input: ClassifySourcesInput): InitStepReport;
export function classifyExtract(input: ClassifyExtractInput): InitStepReport;
export function classifyApprovedProfile(input: ClassifyApprovedProfileInput): InitStepReport;
export function classifyFilters(input: ClassifyFiltersInput): InitStepReport;
```

Behaviour summary (matches SPEC §9.5/§9.6):

| Classifier | `complete` when | `incomplete` / `not_started` when | `failed` when |
|---|---|---|---|
| `classifyPaths` | every directory resolves via `resolvePlatformPaths` (pure on input) | n/a — paths always resolve or throw `PathError` (init wraps as `InitPathsFailedError`) | thrown by caller |
| `classifyDirectories` | all six directories exist (per `fileSystem.pathExists`) | any directory missing | thrown by caller |
| `classifyConfig` | `config.json` exists on disk AND `OperationalConfigSchema.safeParse` succeeds | `config.json` missing → `not_started` (init will materialize) | `config.json` exists but fails Zod validation (or `loadConfig` throws `ConfigError` / `ValidationError` / `UnknownConfigError`) → `{ status: 'failed', errorCode: 'config_invalid', reason: 'config_invalid' }` |
| `classifyMigrations` | `migrationsApplied === true` | `migrationsApplied === false` and no `errorMessage` | `errorMessage` is set |
| `classifyOpenAiKey` | always `complete` (Decision 4: absence is a skip, not a failure). The actual "stop on missing key" logic lives in `classifyExtract`'s `reason === 'openai_key_missing'`; the orchestrator reads it from there, not from `classifyOpenAiKey`. | n/a | n/a |
| `classifySearch` | `queryCount ≥ 1` AND `locationCount ≥ 1` AND `configHasSearch === true` | otherwise | n/a |
| `classifySources` | `importedSourceCount ≥ 1` | `importedSourceCount === 0` | n/a (init runs import) |
| `classifyExtract` | `latestDraftProfileVersionId !== null` AND `usableSourceCount ≥ 1` | (a) `latestDraftProfileVersionId === null` AND `usableSourceCount ≥ 1` AND `openAiKeyPresent === true` → `{ status: 'incomplete', reason: null }`. (b) `openAiKeyPresent === false` (skip-not-fail) → `{ status: 'incomplete', reason: 'openai_key_missing' }` | n/a |
| `classifyApprovedProfile` | `activeApprovedProfileVersionId !== null` | otherwise | n/a |
| `classifyFilters` | `activeFilterConfigVersionId !== null` AND `configJsonValid === true` | `activeFilterConfigVersionId === null` AND `configJsonValid === true` → `not_started` | `activeFilterConfigVersionId !== null` AND `configJsonValid === false` → `{ status: 'failed', errorCode: 'invalid_filter_config' }`. The `hasApprovedProfile === false` case is NOT a `failed` filter step — the orchestrator handles the approval gate separately via `classifyApprovedProfile` and `askEditHandoff` (Decision 6). |

**Tests (`tests/init/classify.test.ts`):**
- Each classifier returns the documented `InitStepStatus` for the four canonical inputs (complete / incomplete / not-started / failed where applicable).
- `classifyPaths` does not depend on `fileSystem` (pure on the directory shape).
- `classifyConfig` returns `not_started` when `pathExists` is `false`; returns `complete` when `pathExists === true` and the supplied `config` passes `OperationalConfigSchema.safeParse`; returns `failed` with `errorCode: 'config_invalid'` when `pathExists === true` but the supplied `config` fails Zod validation (pre-loaded config) or when `loadConfig` is called and throws.
- `classifyExtract` returns the skip-not-fail `incomplete` reason `openai_key_missing` when the key is absent (verifies Decision 4 + Finding 4a).
- `classifyExtract` returns `incomplete` with `reason: null` when no draft exists but the key is present (verifies the split-row distinction).
- `classifyFilters` returns `complete` when `activeFilterConfigVersionId !== null` and `configJsonValid === true` (regardless of profile status — Finding 4b).
- `classifyFilters` returns `not_started` when `activeFilterConfigVersionId === null` (regardless of profile status — Finding 4b).
- `classifyFilters` returns `failed` with `errorCode: 'invalid_filter_config'` when the persisted `configJson` is malformed (Finding 4b).
- `INIT_STEPS` ordering is honoured by a snapshot test that lists `(stepId, classifierName)` pairs in order.

**Verification:**
- `pnpm test tests/init/classify.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 4: `prompts.ts` — `InitPrompts` interface + test adapters

**Files:**
- Create: `src/init/prompts.ts`
- Create: `tests/init/prompts.test.ts`

**Goal:** The seam that lets tests drive every interactive decision in the orchestrator. The interface intentionally has FEWER methods than `SearchPrompts` or `FilterPrompts` — init-specific prompts are limited to: "do you want to reuse the existing state when nothing has changed?" (handled by classification, so the prompt is reserved for the edge case where the orchestrator needs confirmation), "resume from the first incomplete step?" (a single yes/no), "edit handoff" (the message from Decision 6), "approval handoff" (Decision 6 follow-up). All other flows delegate to the existing `SearchPrompts` / `FilterPrompts` / `ProfileApprovalPrompts` seams — init composes them but does not re-implement them.

**`prompts.ts`:**

```ts
/**
 * Init-specific prompts. The orchestrator composes the existing
 * `SearchPrompts`, `FilterPrompts`, and `ProfileApprovalPrompts` for
 * every other user interaction — those are NOT part of this seam.
 */
export interface InitPrompts {
  /** Confirm resume from the first incomplete prerequisite. */
  askResume(input: { readonly nextStepLabel: string }): Promise<boolean>;
  /**
   * Collect 1 or 2 CV source file paths (PDF / Markdown / plain text).
   * The orchestrator calls this BEFORE invoking `ProfileImportService`
   * (Finding 1). The adapter returns 1 or 2 absolute paths; zero or
   * three+ paths is a contract violation that the orchestrator surfaces
   * as a `SetupSummary` step-level `failed` with `errorCode:
   * 'invalid_source_paths'`. The default inquirer adapter asks for the
   * first path (required), then offers an `@inquirer/confirm` for the
   * second (optional).
   */
  askSourcePaths(input: { readonly existing: readonly string[] }): Promise<readonly string[]>;
  /**
   * Confirm whether the user wants to edit the current draft through
   * `jobhunter profile edit` before init offers to approve it. The
   * orchestrator NEVER calls `ProfileEditingService.startEdit` directly
   * (Decision 6).
   */
  askEditHandoff(input: {
    readonly draftProfileVersionId: number;
    readonly warnings: readonly string[];
  }): Promise<'edit_then_return' | 'approve_now' | 'reject' | 'exit_init'>;
  /**
   * Print the final setup summary (the CLI handler owns the actual
   * stdout write) and ask whether to exit cleanly. The orchestrator
   * treats `false` as a SOFT exit — it returns the typed `SetupSummary`
   * to the caller; the CLI prints it; exit 0. `confirmSummary: false`
   * is NOT cancellation (Finding 5). Cancellation is signalled
   * exclusively via `UserCancellation` subclasses thrown by the
   * prerequisite services or `SearchCancelledError`.
   */
  confirmSummary(input: { readonly ready: boolean; readonly nextStep: string | null }): Promise<boolean>;
}

export function createFailingInitPrompts(reason: string): InitPrompts {
  return {
    askResume: async () => { throw new Error(reason); },
    askSourcePaths: async () => { throw new Error(reason); },
    askEditHandoff: async () => { throw new Error(reason); },
    confirmSummary: async () => { throw new Error(reason); },
  };
}

export class ScriptedInitPrompts implements InitPrompts {
  public readonly calls: Array<{ readonly method: keyof InitPrompts; readonly input: unknown }> = [];
  private readonly script: {
    readonly resume?: boolean;
    readonly sourcePaths?: readonly string[];
    readonly editHandoff?: 'edit_then_return' | 'approve_now' | 'reject' | 'exit_init';
    readonly confirmSummary?: boolean;
  };
  constructor(script: ScriptedInitPrompts['script'] = {}) {
    this.script = script;
  }
  async askResume(input: { readonly nextStepLabel: string }): Promise<boolean> {
    this.calls.push({ method: 'askResume', input });
    return this.script.resume ?? true;
  }
  async askSourcePaths(input: { readonly existing: readonly string[] }): Promise<readonly string[]> {
    this.calls.push({ method: 'askSourcePaths', input });
    if (this.script.sourcePaths !== undefined) return this.script.sourcePaths;
    return input.existing.length > 0 ? input.existing : ['/tmp/cv.pdf'];
  }
  async askEditHandoff(input: { readonly draftProfileVersionId: number; readonly warnings: readonly string[] }): Promise<'edit_then_return' | 'approve_now' | 'reject' | 'exit_init'> {
    this.calls.push({ method: 'askEditHandoff', input });
    return this.script.editHandoff ?? 'approve_now';
  }
  async confirmSummary(input: { readonly ready: boolean; readonly nextStep: string | null }): Promise<boolean> {
    this.calls.push({ method: 'confirmSummary', input });
    return this.script.confirmSummary ?? true;
  }
}
```

**Tests (`tests/init/prompts.test.ts`):**
- `ScriptedInitPrompts` records every call (including `askSourcePaths`) and returns the scripted answers in order.
- `createFailingInitPrompts` throws on every method invocation (including `askSourcePaths`) with the supplied reason.
- `InitPrompts` is exported as a structural interface (TypeScript-only assertion); includes `askResume`, `askSourcePaths`, `askEditHandoff`, `confirmSummary`.
- `ScriptedInitPrompts` with `script.sourcePaths: ['/tmp/a.pdf', '/tmp/b.pdf']` returns both paths verbatim (Finding 1).

**Verification:**
- `pnpm test tests/init/prompts.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 5: `prompts-inquirer.ts` — default Inquirer adapter

**Files:**
- Create: `src/init/prompts-inquirer.ts`
- Create: `tests/init/prompts-inquirer.test.ts` (mandatory per Minor e)

**Goal:** The ONLY module under `src/init/` that imports `@inquirer/prompts`. Each method delegates to the appropriate `@inquirer/prompts` API (`confirm`, `input`, `select`).

**`prompts-inquirer.ts`:**

```ts
import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  select as inquirerSelect,
} from '@inquirer/prompts';
import type { InitPrompts } from './prompts.js';

export const defaultInquirerInitPrompts: InitPrompts = {
  async askResume(input) {
    return inquirerConfirm({
      message: `Resume initialization from "${input.nextStepLabel}"?`,
      default: true,
    });
  },
  async askSourcePaths(_input) {
    const first = await inquirerInput({
      message: 'Path to the first CV source file (PDF / Markdown / plain text):',
      validate: (value: string) => (typeof value === 'string' && value.trim().length > 0 ? true : 'Path is required.'),
    });
    const second = await inquirerConfirm({
      message: 'Add a second CV source file?',
      default: false,
    });
    if (!second) return [first.trim()];
    const secondPath = await inquirerInput({
      message: 'Path to the second CV source file:',
      validate: (value: string) => (typeof value === 'string' && value.trim().length > 0 ? true : 'Path is required.'),
    });
    return [first.trim(), secondPath.trim()];
  },
  async askEditHandoff(input) {
    return inquirerSelect<ReturnType<InitPrompts['askEditHandoff']>>({
      message: `Draft profile_${input.draftProfileVersionId} is unapproved. What would you like to do?`,
      choices: [
        { name: 'Edit it via "jobhunter profile edit", then re-run init', value: 'edit_then_return' },
        { name: 'Approve it now (with remaining warnings if any)', value: 'approve_now' },
        { name: 'Reject it (prior approved profile stays active)', value: 'reject' },
        { name: 'Exit init and address it later', value: 'exit_init' },
      ],
      default: 'approve_now',
    });
  },
  async confirmSummary(input) {
    return inquirerConfirm({
      message: input.ready
        ? 'Initialization is complete. Print summary and exit?'
        : `Initialization is partial (next: ${input.nextStep ?? 'done'}). Print summary and exit?`,
      default: true,
    });
  },
};
```

> Note: `prompts-inquirer.test.ts` is **mandatory** (Minor e). It imports the file and asserts it conforms to the `InitPrompts` structural interface. The boundaries test (Task 11) already asserts that `prompts-inquirer.ts` is the ONLY module under `src/init/` that imports `@inquirer/prompts`; the structural-interface test complements that runtime guarantee.

**Tests (`tests/init/prompts-inquirer.test.ts`):**
- Assert `defaultInquirerInitPrompts` conforms to the `InitPrompts` structural interface (every method present, return types match).
- Optional unit test: stub `@inquirer/prompts` and assert `askSourcePaths` returns the right shape (1 path when second = false; 2 paths when second = true).

**Verification:**
- `pnpm test tests/init/boundaries.test.ts tests/init/prompts-inquirer.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 6: `log.ts` — `InitLogger` interface + adapters (Minor c: was Task 7)

**Files:**
- Create: `src/init/log.ts`
- Create: `tests/init/log.test.ts` (Minor h)

**Goal:** The Pino seam for the orchestrator. Mirrors the `ProfileImportLogger` / `ProfileExtractionLogger` pattern (TASK-007/008 of the existing codebase). `noopInitLogger` is the default for unit tests; `pinoInitLogger(logger)` wraps a Pino `Logger` and emits structured logs (`component: 'init'`, `event`, `stepId`, `errorCode` when applicable). The orchestrator NEVER imports `pino` directly; it only sees the `InitLogger` interface. **This task precedes the orchestrator task (Task 7)** because `InitOrchestratorOptions.logger` defaults to `noopInitLogger` (Minor c).

**`log.ts`:**

```ts
import type { Logger } from 'pino';                 // type-only import
import type { InitStepId } from './state.js';

export interface InitLogger {
  stepStart(input: { readonly stepId: InitStepId }): void;
  stepSkip(input: { readonly stepId: InitStepId; readonly reason: string }): void;
  stepComplete(input: { readonly stepId: InitStepId; readonly artifactId: string | null }): void;
  stepFail(input: { readonly stepId: InitStepId; readonly errorCode: string; readonly message: string }): void;
}

export const noopInitLogger: InitLogger = {
  stepStart: () => undefined,
  stepSkip: () => undefined,
  stepComplete: () => undefined,
  stepFail: () => undefined,
};

export function pinoInitLogger(logger: Logger): InitLogger {
  return {
    stepStart: ({ stepId }) => logger.info({ component: 'init', event: 'step.start', stepId }, 'init step started'),
    stepSkip: ({ stepId, reason }) => logger.info({ component: 'init', event: 'step.skip', stepId, reason }, 'init step skipped'),
    stepComplete: ({ stepId, artifactId }) => logger.info({ component: 'init', event: 'step.complete', stepId, artifactId }, 'init step completed'),
    stepFail: ({ stepId, errorCode, message }) => logger.warn({ component: 'init', event: 'step.fail', stepId, errorCode }, message),
  };
}
```

> Note: `pino` is imported as a **type-only** import in `src/init/log.ts`. The boundaries test (`tests/init/boundaries.test.ts`) treats `pino` as a banned runtime import but accepts a type-only import via the literal `RUNTIME_IMPORT_RE` regex (Task 11). The implementing agent must double-check the boundaries test's regex.

**Tests (`tests/init/log.test.ts`, Minor h):**
- Assert `pinoInitLogger(logger)` emits structured logs with `component: 'init'`, `event`, `stepId`, and optional `errorCode`. Use a fake `Logger` that records `info` / `warn` calls and assert the structured payload shape.
- Assert `noopInitLogger` is a no-op (returns `undefined` for every method).
- Assert `RUNTIME_IMPORT_RE.test("import type { Logger } from 'pino'")` returns `false` (cross-reference with Task 11's boundaries test).

**Verification:**
- `pnpm test tests/init/boundaries.test.ts tests/init/log.test.ts` — all green (the tree walk covers `src/init/log.ts`).
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 7: `init-service.ts` — `InitOrchestrator` (the core) (was Task 6)

**Files:**
- Create: `src/init/init-service.ts`
- Extend: `tests/init/boundaries.test.ts` (full tree scan + Inquirer allow-list)
- Create: `tests/init/init-service.test.ts` (integration-level test on a temporary SQLite)
- Depends on: Task 6 (`src/init/log.ts` — `noopInitLogger` is the default `logger`)

**Goal:** The orchestrator that composes every prerequisite service. The orchestrator NEVER re-implements prerequisite service logic — it delegates. The orchestrator NEVER calls `process.exit`. The orchestrator NEVER throws for `failed` step outcomes — those are returned as `SetupSummary` entries. The orchestrator DOES throw typed `InitLifecycleError` subclasses for unrecoverable conditions (FS / DB / persistence).

**`init-service.ts`:**

```ts
import type { Repositories } from '../persistence/repositories/index.js';
import type { PlatformPaths } from '../platform/paths.js';
import { ensureRuntimeDirectories } from '../platform/paths.js';
import { loadConfig, updateConfig, type UpdateOptions } from '../config/index.js';
import { ProfileImportService } from '../profile/index.js';
import {
  ProfileExtractionService,
  type ProfileExtractionStatus,
} from '../profile/index.js';
import { ProfileApprovalService } from '../profile/index.js';
import { ProfileRejectionService } from '../profile/index.js';
import { ProfileReviewService } from '../profile/index.js';
import type {
  ProfileImportLogger,
  ProfileExtractionLogger,
  ProfileApprovalPrompts,
  ProfileRejectionPrompts,
} from '../profile/index.js';
import { ConfigureFiltersService } from '../filter/index.js';
import { runConfigureSearch } from '../search/index.js';
import type { SearchPrompts } from '../search/index.js';
import type { FilterPrompts } from '../filter/index.js';
import type { FileSystem } from '../config/file-system.js';
import type { OpenAIClient } from '../profile/openai/types.js';
import {
  BlockingConflictsUnresolvedError,
  UserCancelledApprovalError,
  UserCancelledRejectionError,
} from '../profile/errors.js';
import { SearchCancelledError } from '../search/errors.js';
import { UserCancelledFilterConfigError } from '../filter/errors.js';
import {
  InitApprovalFailedError,
  InitConfigSeedingFailedError,
  InitExtractRuntimeFailedError,
  InitFiltersFailedError,
  InitImportFailedError,
  InitMigrationsFailedError,
  InitPathsFailedError,
  InitSearchFailedError,
} from './errors.js';
import {
  type InitLogger,
  noopInitLogger,
} from './log.js';
import type { InitPrompts } from './prompts.js';
import {
  INIT_STEPS,
  type InitStepId,
  type InitStepReport,
  type SetupSummary,
} from './state.js';
import {
  classifyApprovedProfile,
  classifyConfig,
  classifyDirectories,
  classifyExtract,
  classifyFilters,
  classifyMigrations,
  classifyOpenAiKey,
  classifyPaths,
  classifySearch,
  classifySources,
} from './classify.js';

/**
 * Carries every dependency the orchestrator needs. The orchestrator
 * NEVER reaches into prerequisite services' internals — it only knows
 * about their public APIs (via the barrels).
 *
 * Prerequisite-prompt seams (`searchPrompts`, `filterPrompts`,
 * `approvalPrompts`, `rejectionPrompts`) are OPTIONAL. The CLI handler
 * (Task 9) wires them to the production inquirer adapters; tests inject
 * scripted or failing adapters (Finding 2). When a prerequisite seam is
 * omitted, the orchestrator uses a small in-file "scripted silent"
 * default (returns success for `approve_now`-style choices) so unit
 * tests that only exercise one step do not have to wire the whole
 * surface. The `importLogger` / `extractionLogger` defaults match the
 * existing `noopProfileImportLogger` / `noopProfileExtractionLogger`
 * shapes used in TASK-007/008.
 */
export interface InitOrchestratorOptions {
  readonly paths: PlatformPaths;
  readonly repositories: Repositories;
  readonly fileSystem: FileSystem;
  /** Injected by `src/cli.ts`; tests may supply a scripted or failing adapter. */
  readonly prompts: InitPrompts;
  /** Injected by `src/cli.ts` (or by tests); null when `OPENAI_API_KEY` is absent (Decision 4). */
  readonly openaiClient: OpenAIClient | null;
  /** Optional. Wired by the CLI to `defaultInquirerPrompts`; tests inject scripted. */
  readonly searchPrompts?: SearchPrompts;
  /** Optional. Wired by the CLI to `defaultInquirerFilterPrompts`; tests inject scripted. */
  readonly filterPrompts?: FilterPrompts;
  /** Optional. Wired by the CLI to the inline approval-confirm prompt (mirrors `src/cli.ts:483-497`); tests inject scripted. */
  readonly approvalPrompts?: ProfileApprovalPrompts;
  /** Optional. Wired by the CLI to the inline rejection-confirm prompt (mirrors `src/cli.ts:516-526`); tests inject scripted. */
  readonly rejectionPrompts?: ProfileRejectionPrompts;
  /** Optional. Wired by the CLI to `noopProfileImportLogger` or the production adapter; tests inject scripted. */
  readonly importLogger?: ProfileImportLogger;
  /** Optional. Wired by the CLI to `noopProfileExtractionLogger` or the production adapter; tests inject scripted. */
  readonly extractionLogger?: ProfileExtractionLogger;
  /** Optional; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Optional; defaults to `noopInitLogger`. */
  readonly logger?: InitLogger;
}

export class InitOrchestrator {
  private readonly options: InitOrchestratorOptions;
  constructor(options: InitOrchestratorOptions) {
    this.options = options;
  }

  /**
   * Walk the 10 prerequisites, skipping `complete` ones, and return a
   * `SetupSummary`. The method NEVER throws for a step-level `failed`
   * outcome (those are returned as `InitStepReport` entries). The
   * method DOES throw typed `InitLifecycleError` subclasses for
   * unrecoverable conditions (FS / DB / persistence). The CLI boundary
   * maps typed errors to exit codes.
   *
   * Cancellation (any `UserCancellation` subclass + `SearchCancelledError`)
   * is ALWAYS thrown — there is no in-band cancellation return shape.
   * The orchestrator catches cancellation uniformly, logs the partial
   * step failure via `logger.stepFail`, and rethrows the typed
   * cancellation error for the CLI boundary (which maps it to exit 130).
   */
  async run(env: Readonly<Record<string, string | undefined>> = process.env): Promise<SetupSummary> { ... }
}
```

Walk semantics (mirrors Decision 3 + Decision 7 + Findings 1/2/4/5/6/8/10). The orchestrator wraps each step body in a try/catch. **Cancellation always throws** (Finding 6) — there is no in-band cancellation return shape. Per-step `failed` outcomes are returned as `SetupSummary` entries (not thrown).

1. **paths** — `classifyPaths` is pure; the orchestrator records `complete` and moves on (paths either resolve at construction or throw, which is caught at the CLI boundary as `InitPathsFailedError`).
2. **directories** — calls `ensureRuntimeDirectories(this.options.paths)`. On success, `classifyDirectories` → `complete`. On failure, throws `InitPathsFailedError` (exit 1).
3. **migrations** — the DB handle is already open by the CLI; classify from `migrationsApplied` (true). Records `complete`.
4. **config** — calls `loadConfig(paths, fileSystem)` wrapped in try/catch:
    - On `ConfigError | ValidationError | UnknownConfigError`: record `{ status: 'failed', errorCode: 'config_invalid', reason: 'config_invalid' }` for the `config` step, set `nextStep: 'config'`, log `stepFail`, and return the partial summary (SPEC §9.4 — non-fatal exit path).
    - On success with a present file: `classifyConfig` returns `complete`. Skip.
    - On success with a missing file: `classifyConfig` returns `not_started`. The orchestrator calls `updateConfig(paths, {}, { confirm: async () => true }, fileSystem)` (Decision 5: no-op patch materializes the file atomically). On `updateConfig` failure, throws `InitConfigSeedingFailedError` (exit 1). The two failure modes are distinguished: `config_invalid` is the load-failure path; `init_config_seeding_failed` is the write-failure path.
5. **openaiKey** — calls the pure `validateOpenAiApiKey(env)` and `classifyOpenAiKey`. Records `complete` regardless of presence (Decision 4). The orchestrator does NOT use `classifyOpenAiKey` to decide whether to stop — it reads the missing-key signal from `classifyExtract`'s `reason === 'openai_key_missing'` at step 8 (Finding 4a).
6. **search** — calls `classifySearch`. If `complete`, skip. Otherwise calls `runConfigureSearch({ prompts: this.options.searchPrompts ?? defaultInquirerPrompts, existing })` (Finding 2) and writes the resulting config via `updateConfig`. The orchestrator catches `SearchCancelledError` uniformly with the other cancellation paths (see step "After the walk"), logs `stepFail({ stepId: 'search', errorCode: 'search_cancelled', message: 'cancelled' })`, and rethrows for the CLI boundary (exit 130). Other typed errors from `runConfigureSearch` are caught and surfaced as `InitSearchFailedError` (exit 2).
7. **sources** — calls `classifySources`. If `complete`, skip. Otherwise calls `initPrompts.askResume({ nextStepLabel: INIT_STEP_LABELS.sources })`. On confirmation, calls `initPrompts.askSourcePaths({ existing: <previous source paths, possibly empty> })` (Finding 1). Validates the answer is 1 or 2 paths; if 0 or 3+ paths, record `{ status: 'failed', errorCode: 'invalid_source_paths' }` for the `sources` step, set `nextStep: 'sources'`, log `stepFail`, return partial summary. On valid paths, calls `ProfileImportService.importSources(rawPaths)`. Throws `InitImportFailedError` (exit 1) on storage failure.
8. **extract** — calls `classifyExtract`. If `complete`, skip. If `incomplete` with `reason: 'openai_key_missing'` (Decision 4 + Finding 4a), record the step and stop the walk (no further steps run on this invocation; the operator must set `OPENAI_API_KEY` and re-run). Otherwise runs `ProfileExtractionService.extract(usableSourceIds)`. A `kind: 'failed'` `ProfileExtractionStatus` with `errorCode` in the OpenAI runtime family surfaces `InitExtractRuntimeFailedError` (exit 5). A non-OpenAI failure (e.g. no usable sources) is recorded as `SetupSummary` step `failed` with `errorCode: status.errorCode`.
9. **approvedProfile** — calls `classifyApprovedProfile`. If `complete`, skip. If `incomplete`, calls `initPrompts.askEditHandoff(...)`. On `'approve_now'`, calls `ProfileApprovalService.approve(id, { prompts: this.options.approvalPrompts ?? defaultInlineApprovalPrompts })` (Finding 2). The orchestrator catches `BlockingConflictsUnresolvedError` (Finding 10), records `{ status: 'failed', errorCode: 'blocking_conflicts_unresolved', reason: 'blocking_conflicts_unresolved' }` for the `approvedProfile` step, sets `nextStep: 'approvedProfile'`, logs `stepFail`, and returns the partial summary. The orchestrator NEVER auto-calls `ProfileRejectionService` to resolve blocking conflicts. On `'reject'`, calls `ProfileRejectionService.reject(id, { prompts: this.options.rejectionPrompts ?? defaultInlineRejectionPrompts })`; if it throws `UserCancelledRejectionError`, the cancellation contract (Finding 6) kicks in. Otherwise the orchestrator advances to `filters` (the prior approved profile stays active — Decision 6 + Finding 10). On `'edit_then_return'`, returns partial summary with `nextStep: 'approvedProfile'`, `reason: 'edit_handoff'`. On `'exit_init'`, returns partial summary with `ready: false`, `nextStep: 'approvedProfile'`. Storage failure throws `InitApprovalFailedError` (exit 1).
10. **filters** — calls `classifyFilters`. If `complete`, skip. If `not_started`, calls `ConfigureFiltersService.run({ prompts: this.options.filterPrompts ?? defaultInquirerFilterPrompts })` (Finding 2). If `failed` (Finding 4b: `errorCode: 'invalid_filter_config'`), the orchestrator surfaces the typed step `failed` and returns the partial summary — the operator must fix the persisted config manually (init does NOT auto-overwrite `filter_configuration_versions`). Throws `InitFiltersFailedError` (exit 2) on non-cancellation failures.

**After the walk**, the orchestrator computes:
- `ready` from the 10 prerequisite statuses (every step `complete` → `true`).
- `nextStep` from the first non-`complete` step (or `null` when `ready`).
- `openAiKeyMissing` from `classifyExtract` output's `reason === 'openai_key_missing'` (Finding 4a — NOT from `classifyOpenAiKey`, which always returns `complete`).

**Soft exit gate (Finding 5):** The orchestrator calls `initPrompts.confirmSummary({ ready, nextStep })`. A `false` answer is treated as a SOFT exit: the orchestrator returns the typed `SetupSummary`; the CLI prints it; exit 0. `confirmSummary: false` is NOT cancellation. Cancellation is signalled exclusively via typed `UserCancellation` subclasses (`UserCancelledApprovalError`, `UserCancelledRejectionError`, `UserCancelledFilterConfigError`) and `SearchCancelledError` thrown by the prerequisite services.

**Cancellation contract (Finding 6, single source of truth):** Cancellation ALWAYS throws. The orchestrator catches `UserCancelledApprovalError`, `UserCancelledRejectionError`, `UserCancelledFilterConfigError`, and `SearchCancelledError` uniformly, logs the partial step failure via `logger.stepFail({ stepId, errorCode: '<name>_cancelled', message: 'cancelled' })`, and rethrows the typed cancellation error for the CLI boundary. The CLI's `try/finally handle.close()` runs; `exitWithError` renders `stderr: "<code>: <message>"`; `process.exit(130)`. No partial summary is returned to the CLI on cancellation.

**Tests (`tests/init/init-service.test.ts`):**
- Fresh `HOME` (temporary SQLite + temporary FS seam): every step walks, `ready: true`, `nextStep: null`, `openAiKeyMissing: false`.
- Resume scenario: pre-seed `config.json`, an approved profile, and an active filter config. Re-run init. Steps 1–8 are `complete` (paths / directories / migrations / config / openaiKey / search / sources / extract); step 9 (`approvedProfile`) is `complete`; step 10 (`filters`) is `complete`. `ready: true`.
- Missing API key: pre-seed everything except a usable source. Re-run init. The `extract` step returns `{ status: 'incomplete', reason: 'openai_key_missing' }`. `ready: false`, `openAiKeyMissing: true`. Exit 0.
- Draft handoff: pre-seed a draft (no approval) and a filter config. Re-run init. The orchestrator calls `askEditHandoff` with the right `draftProfileVersionId`. On `'edit_then_return'`, the summary is `ready: false`, `nextStep: 'approvedProfile'`, `artifactId: 'profile_<id>'`. On `'approve_now'`, `ProfileApprovalService.approve` is invoked and `ready: true`.
- Cancellation contract (Finding 6): a scripted search prompt returns `false` → `runConfigureSearch` throws `SearchCancelledError`. The orchestrator catches it, calls `logger.stepFail({ stepId: 'search', errorCode: 'search_cancelled', message: 'cancelled' })`, and rethrows the typed `SearchCancelledError` for the CLI boundary. The orchestrator does NOT return a partial summary on cancellation. The CLI test asserts the typed error propagates to exitWithError → exit 130.
- No-op config seeding: pre-seed an empty `HOME`. `classifyConfig` returns `not_started`. The orchestrator calls `updateConfig` with `{}` and `confirm: () => true`. After the call, `config.json` exists. `ready` depends on subsequent steps.
- Malformed `config.json` (Finding 8): pre-seed a `config.json` whose contents fail Zod validation. The orchestrator catches the thrown `ValidationError`, records `{ status: 'failed', errorCode: 'config_invalid' }` for the `config` step, sets `nextStep: 'config'`, returns the partial summary. No `updateConfig` is invoked.
- Soft-exit `confirmSummary: false` on a fully-ready init (Finding 5): pre-seed everything so `ready: true`. `ScriptedInitPrompts.confirmSummary: false`. Assert `run()` returns the typed `SetupSummary` (not throws), and the CLI test prints it + exits 0.
- Filter step without active profile (Finding 4b): pre-seed a draft (no approval), no filter config. `classifyFilters` returns `not_started` (NOT `failed`). The orchestrator calls `askEditHandoff` first (approvedProfile gate); on `'approve_now'` the approval succeeds; the orchestrator then runs `ConfigureFiltersService.run`. No `failed` filter step is reported for the missing-profile case.
- Blocking conflicts on `'approve_now'` (Finding 10): pre-seed a draft with a `BlockingConflictsUnresolvedError` row. `askEditHandoff: 'approve_now'`. The orchestrator catches the typed error, records `{ status: 'failed', errorCode: 'blocking_conflicts_unresolved' }` for the `approvedProfile` step, sets `nextStep: 'approvedProfile'`, returns the partial summary. The prior approved profile (when one exists) is unchanged.
- Source paths contract (Finding 1): pre-seed an empty `HOME`, scripted `askSourcePaths: ['/tmp/cv.pdf']`. The orchestrator calls `ProfileImportService.importSources(['/tmp/cv.pdf'])`. A scripted `askSourcePaths: []` → orchestrator records `{ status: 'failed', errorCode: 'invalid_source_paths' }` for the `sources` step and returns the partial summary.
- Init never calls `ProfileEditingService.startEdit`: the test injects a `ScriptedInitPrompts` with `editHandoff: 'edit_then_return'` and asserts the editing service is NOT instantiated.

**Boundaries test extension (`tests/init/boundaries.test.ts`):**
- Scan every `.ts` file under `src/init/**`. Assert no import of `commander`, `@inquirer/prompts`, `playwright`, `drizzle-orm`, `openai`, or `pino`, with the single carve-out: `src/init/prompts-inquirer.ts` is allowed to import `@inquirer/prompts`.
- Add a dedicated assertion for `src/init/init-service.ts` (mirrors the `src/filter/evaluate.ts` assertion in TASK-010).
- Add a dedicated assertion that `src/init/init-service.ts` does NOT import `process` directly (the orchestrator never calls `process.exit`).

**Verification:**
- `pnpm test tests/init/init-service.test.ts tests/init/boundaries.test.ts tests/init/log.test.ts tests/init/state.test.ts tests/init/errors.test.ts tests/init/classify.test.ts tests/init/prompts.test.ts tests/init/prompts-inquirer.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 8: `index.ts` — public barrel

**Files:**
- Create: `src/init/index.ts`

**Goal:** Re-export every public symbol from `src/init/`. The CLI's `cli.ts` re-exports the public surface through this barrel (the `createProgram` function accepts an optional `initPrompts` parameter for tests).

**`index.ts`:**

```ts
export {
  INIT_STEPS,
  INIT_SCHEMA_VERSION,
  INIT_STEP_LABELS,
  type InitSchemaVersion,
  type InitStepId,
  type InitStepReport,
  type InitStepStatus,
  type SetupSummary,
} from './state.js';

export {
  InitLifecycleError,
  InitPathsFailedError,
  InitConfigSeedingFailedError,
  InitMigrationsFailedError,
  InitSearchFailedError,
  InitImportFailedError,
  InitExtractRuntimeFailedError,
  InitApprovalFailedError,
  InitFiltersFailedError,
  InitSummaryFailedError,
} from './errors.js';

export {
  classifyPaths,
  classifyDirectories,
  classifyConfig,
  classifyMigrations,
  classifyOpenAiKey,
  classifySearch,
  classifySources,
  classifyExtract,
  classifyApprovedProfile,
  classifyFilters,
  type ClassifyPathsInput,
  type ClassifyConfigInput,
  type ClassifyMigrationsInput,
  type ClassifyOpenAiKeyInput,
  type ClassifySearchInput,
  type ClassifySourcesInput,
  type ClassifyExtractInput,
  type ClassifyApprovedProfileInput,
  type ClassifyFiltersInput,
} from './classify.js';

export {
  createFailingInitPrompts,
  ScriptedInitPrompts,
  type InitPrompts,
} from './prompts.js';

export { defaultInquirerInitPrompts } from './prompts-inquirer.js';

export {
  noopInitLogger,
  pinoInitLogger,
  type InitLogger,
} from './log.js';

export {
  InitOrchestrator,
  type InitOrchestratorOptions,
} from './init-service.js';
```

**Verification:**
- `pnpm test tests/init/` — all green (consumers of the barrel are covered by the CLI test in Task 9).
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 9: `src/cli.ts` — extend `createProgram` + add `init` subcommand

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli/init.test.ts`

**Goal:** Add a single top-level `init` subcommand. The handler opens the database, constructs `InitOrchestrator` with `defaultInquirerInitPrompts` (the default Inquirer adapter), calls `run()`, and prints the typed `SetupSummary`. The `createProgram` factory gains an optional `initPrompts: InitPrompts` parameter as a backward-compatible extension to its existing `{ prompts?, openaiClient?, filterPrompts? }` shape; no existing caller breaks because the parameter is optional. The CLI test in `tests/cli/init.test.ts` also asserts that omitting the parameter falls back to `defaultInquirerInitPrompts` cleanly.

**Subcommand:**

```text
jobhunter init
```

The handler (mirrors the existing `configure filters` handler in `src/cli.ts:671-706`):

1. Resolves platform paths (existing helper).
2. Calls `initializeDatabase` + `createRepositories` (inside a `try/finally` that closes the handle — `src/cli.ts:225-227`).
3. Resolves the OpenAI client: reads `OPENAI_API_KEY`; if absent, sets `openaiClient = null` (Decision 4 — the orchestrator treats the key absence as a skip, NOT a failure). When present, calls `createDefaultOpenAIClient({ apiKey })`. The `testHooks` extension accepts `options.openaiClient` for tests.
4. Constructs `new InitOrchestrator({ paths, repositories, fileSystem: cliFileSystem, prompts: initPrompts ?? defaultInquirerInitPrompts, openaiClient, searchPrompts: prompts, filterPrompts, approvalPrompts: { confirmApprovalWithWarnings: inquirerConfirmApprovalWithWarnings }, rejectionPrompts: { confirmRejection: inquirerConfirmRejection }, importLogger: profileImportLogger, extractionLogger: profileExtractionLogger, logger: pinoInitLogger(rootLogger) })` (Finding 2 — the CLI wires all six prerequisite seams; the orchestrator uses scripted-silent defaults when any are absent, but production always supplies them).
5. Calls `service.run()`.
6. Renders the typed `SetupSummary`:
   - On `ready === true`: prints `ready: yes` then every step's `status: complete`.
   - On `ready === false` and `openAiKeyMissing === true`: prints `ready: no`, `next: <label>`, `openai_key: missing — set OPENAI_API_KEY and re-run init.`
   - On `ready === false` for other reasons: prints `ready: no`, `next: <label>` (or `next: <stepId> artifact=<id>`), and every step's status.
7. Error mapping: typed `ApplicationError` instances are mapped to their declared `exitCode` via the existing `exitWithError` helper (`src/cli.ts:93-105`). `InitApprovalFailedError` → `ExitCode.MissingRequired` (3), `InitExtractRuntimeFailedError` → `ExitCode.OpenAIFailure` (5), `InitSearchFailedError` / `InitFiltersFailedError` → `ExitCode.InvalidUsage` (2), the rest → `ExitCode.Fatal` (1). User cancellation → `ExitCode.UserCancellation` (130).

**`createProgram` extension (`src/cli.ts:563-568`):**

```ts
export function createProgram(
  options: {
    prompts?: SearchPrompts;
    openaiClient?: OpenAIClient;
    filterPrompts?: FilterPrompts;
    initPrompts?: InitPrompts;
  } = {},
): Command {
  // ... existing setup ...
  const initPrompts: InitPrompts | undefined = options.initPrompts;
  // ... existing commands ...
  program
    .command('init')
    .description('Interactively initialize JobHunter (paths, config, profile, filters). Resumable.')
    .action(async () => {
      try {
        const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
        const handle = await initializeDatabase(paths, {
          migrationsFolder: resolveRepoRootForMigrations(),
        });
        try {
          const repositories = createRepositories(handle);
          // OpenAI key gate (Decision 4): null when absent.
          const openaiClient = testHooks.openaiClient ?? resolveOpenAiClientOrNull();
          const orchestrator = new InitOrchestrator({
            paths,
            repositories,
            fileSystem: cliFileSystem,
            prompts: initPrompts ?? defaultInquirerInitPrompts,
            searchPrompts: prompts,
            filterPrompts: filterPrompts ?? defaultInquirerFilterPrompts,
            approvalPrompts: {
              confirmApprovalWithWarnings: async (input) => {
                process.stderr.write(`Approving profile ${input.profileVersionId} with ${input.remainingWarnings.length} warning(s):\n`);
                for (const warning of input.remainingWarnings) {
                  process.stderr.write(`  - ${warning}\n`);
                }
                return inquirerConfirm({
                  message: 'Proceed with approval?',
                  default: false,
                });
              },
            },
            rejectionPrompts: {
              confirmRejection: async (input) => {
                return inquirerConfirm({
                  message: `Reject profile ${input.profileVersionId}? (prior approved profile stays active)`,
                  default: false,
                });
              },
            },
            importLogger: profileImportLogger,
            extractionLogger: profileExtractionLogger,
            openaiClient,
            logger: pinoInitLogger(rootLogger),
          });
          const summary = await orchestrator.run();
          process.stdout.write(`${formatInitSummary(summary)}\n`);
        } finally {
          handle.close();
        }
      } catch (error) {
        exitWithError(error);
      }
    });
  return program;
}
```

### Implementing-agent note — identifier definitions

The `createProgram` code block above references the following identifiers that the implementing agent must introduce or import. None of them exist in `src/cli.ts` today; all are introduced as part of TASK-011.

1. **`profileImportLogger`** — a `ProfileImportLogger` instance (the seam interface is exported from `src/profile/index.js`, defined in `src/profile/importer.ts:72-76` as `info / warn / error` over a structured context). The CLI handler constructs it via `pinoProfileImportLogger(rootLogger)` — a small adapter that wraps a Pino `Logger` and delegates `info` / `warn` / `error` to the corresponding Pino level. Mirrors `pinoInitLogger` (Task 6). The default fallback when the root logger is absent is `noopLogger` (exported from `src/profile/index.js`).

2. **`profileExtractionLogger`** — a `ProfileExtractionLogger` instance (also from `src/profile/index.js`, exported alongside `noopProfileExtractionLogger`). Same wrapping pattern via `pinoProfileExtractionLogger(rootLogger)`. The implementing agent may add the adapter to `src/profile/log/` (or to a new `src/init/log-extensions.ts`) — either is acceptable.

3. **`resolveOpenAiClientOrNull`** — a small file-local helper in `src/cli.ts` (placed above `createProgram`). Reads `OPENAI_API_KEY` from `process.env`; returns `null` when absent (Decision 4 — `InitOrchestrator.openaiClient === null` means skip the extract step); otherwise constructs an `OpenAIClient` via `createDefaultOpenAIClient({ apiKey })` (already exported from `src/profile/openai/client.js`). Tests inject via `createProgram({ openaiClient })` — the helper is bypassed by the `testHooks.openaiClient ?? resolveOpenAiClientOrNull()` short-circuit.

4. **`formatInitSummary`** — a pure formatter that renders a typed `SetupSummary` to a human-readable multi-line string. Lives in the NEW file `src/init/format.ts` (mirrors `formatSummary` / `formatExtractSummary` in `src/cli.ts:150-275`). The function signature is `export function formatInitSummary(summary: SetupSummary): string`. The CLI handler appends `\n` and writes the result to stdout. The format covers every documented `SetupSummary` shape (see the test bullet below).

5. **`inquirerConfirmApprovalWithWarnings`** — closure body shown inline in the code block. Conforms to `ProfileApprovalPrompts.confirmApprovalWithWarnings` (defined in `src/profile/approval-service.ts:42-47`; the type is re-exported from `src/profile/index.js`). Renders remaining warnings to stderr then asks for confirmation via `inquirerConfirm` (already imported at `src/cli.ts:8`).

6. **`inquirerConfirmRejection`** — closure body shown inline. Conforms to `ProfileRejectionPrompts.confirmRejection` (defined in `src/profile/rejection-service.ts:28-31`; re-exported from `src/profile/index.js`).

The implementing agent must:

- **Reuse the existing `inquirerConfirm` import** at `src/cli.ts:8` (do not add a duplicate import).
- **Import the types** `ProfileApprovalPrompts` and `ProfileRejectionPrompts` from `src/profile/index.js` (used only as type annotations on the closure literals — `import type { ProfileApprovalPrompts, ProfileRejectionPrompts } from './profile/index.js';`).
- **Construct `profileImportLogger` and `profileExtractionLogger`** via small Pino adapters. If the existing `src/profile/log/` directory does not yet contain `pinoProfileImportLogger` / `pinoProfileExtractionLogger`, the implementing agent adds them — each is a 5-line function that wraps a Pino `Logger` and forwards `info` / `warn` / `error` calls to the matching level with a `component` field (`'profile_import'` / `'profile_extraction'`).
- **Add `resolveOpenAiClientOrNull`** as a file-local helper in `src/cli.ts` (above `createProgram`). The helper is ~10 lines: read `process.env['OPENAI_API_KEY']`, return `null` on absence, otherwise return `createDefaultOpenAIClient({ apiKey })`. No new module needed.
- **Add `src/init/format.ts`** with `formatInitSummary(summary: SetupSummary): string`. The implementation mirrors the existing human-readable formatters (`formatSummary`, `formatExtractSummary` in `src/cli.ts:150-275`). The function is deterministic (same input → same output), pure (no I/O), and covers the five documented `SetupSummary` shapes (see test bullet in `tests/init/format.test.ts`).

**Re-exports at the bottom of `src/cli.ts`:**

```ts
export {
  InitOrchestrator,
  defaultInquirerInitPrompts,
  createFailingInitPrompts,
  ScriptedInitPrompts,
  type InitOrchestratorOptions,
  type InitPrompts,
  type InitStepReport,
  type SetupSummary,
} from './init/index.js';
```

**Tests (`tests/cli/init.test.ts`, mirror TASK-009 `tests/cli/profile-list.test.ts` pattern):**
- `beforeEach` captures `process.stdout.write`, `process.stderr.write`, `process.exit`.
- `HOME=/tmp/jh-task011-...` boots a fresh SQLite database via the existing test helper.
- Scenarios:
  1. **Fresh init, no OpenAI key, no pre-seeded config** → exit 0, stdout includes `ready: no` and `openai_key: missing`. The orchestrator records every step; the `search` step is `incomplete` because `queryCount === 0` and `locationCount === 0` (no config exists yet — `classifySearch` does not depend on the OpenAI key). The `extract` step is `incomplete` with `reason: 'openai_key_missing'`. Sources / approved-profile / filters are all `not_started` (because the walk stops at `extract`). (Minor a — `search` is `incomplete` because no queries/locations exist yet, NOT because the key is absent.)
  1a. **Resume after pre-seeded config with valid queries + locations, no OpenAI key** → exit 0, stdout includes `ready: no`. The `search` step is now `complete` (config has queries/locations); `extract` is `incomplete` with `reason: 'openai_key_missing'`; the walk stops there.
  2. **Resume after pre-seeded config + search + approved profile + filter config** → exit 0, stdout includes `ready: yes`. Every step is `complete`.
  3. **Draft handoff with `editHandoff: 'edit_then_return'`** → exit 0, stdout includes `ready: no` and `next: approvedProfile artifact=profile_<id>`. The `ProfileEditingService.startEdit` is NEVER called (asserted via a stub that throws if instantiated).
  4. **`initPrompts: createFailingInitPrompts('boom')`** → the orchestrator's `askResume` throws a plain `Error('boom')`, which propagates through `run()` unchanged; the CLI's `exitWithError` (`src/cli.ts:103-104`) renders `stderr: 'fatal: boom'` and exits with code 1. The orchestrator does NOT wrap the prompt failure in `InitSummaryFailedError`. (Finding 7 — `askResume` is a plain `Error`, not a typed `ApplicationError`.)
  5. **Missing filter config after a successful profile approval** → exit 3 (`ExitCode.MissingRequired`), per Decision 13. The orchestrator's `classifyFilters` returns `not_started` (no active filter config), then `ConfigureFiltersService.run` throws `NoActiveProfileError` (because no approved profile exists, since the test pre-seeded only a draft). The CLI maps the typed error to exit 3 — NOT 1 or 2. (Finding 13.)

**Verification:**
- `pnpm test tests/cli/init.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm build` — exit 0, `dist/cli.js` produced.

---

### Task 10: `tests/init/boundaries.test.ts` — full tree-walk guard

**Files:**
- Modify: `tests/init/boundaries.test.ts` (skeleton added in Task 1, extended in Task 2 and Task 7, finalised here)

**Goal:** Mirror `tests/filter/boundaries.test.ts`. The full tree scan asserts every `.ts` file under `src/init/**` avoids the banned runtime imports (with the single carve-out for `src/init/prompts-inquirer.ts`). Type-only `import type` statements are permitted (the regex matches the import clause but ignores `import type { ... }`).

**Final test file structure:**

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const INIT_DIR = join(process.cwd(), 'src', 'init');

const BANNED_IMPORTS = [
  'commander',
  '@inquirer/prompts',
  'playwright',
  'drizzle-orm',
  'openai',
  'pino',
] as const;

const INQUIRER_ALLOW_LIST: ReadonlySet<string> = new Set(['src/init/prompts-inquirer.ts']);

/**
 * Literal regex that distinguishes runtime `pino` imports from type-only
 * imports (Finding 14). The negative lookahead `(?!type\s)` rejects
 * `import type { Logger } from 'pino'` while matching both:
 *   - `import { foo } from 'pino'`                ← banned
 *   - `import pino from 'pino'`                   ← banned
 *   - `import * as pino from 'pino'`              ← banned
 *   - `import 'pino'`                              ← banned
 *   - `import type { Logger } from 'pino'`        ← permitted
 *   - `import type pino from 'pino'`              ← permitted
 */
const RUNTIME_IMPORT_RE = /^\s*import\s+(?!type\s)[^;]*['"]pino['"]/m;

// ... listInitSourceFiles / importMatches / relativeFromCwd (mirror tests/filter/boundaries.test.ts) ...

describe('src/init domain-boundary guard', () => {
  it('exists as a directory (or stays green when empty)');
  it('every .ts file under src/init/ avoids the banned imports (with carve-out)');
  it('encodes the inquirer allow-list so prompts-inquirer.ts remains legal');
  it('explicitly scans src/init/init-service.ts (Task 7) for banned imports');
  it('explicitly asserts src/init/init-service.ts does NOT call process.exit');
  it('allows type-only `import type { ... } from "pino"` in src/init/log.ts');
  it('RUNTIME_IMPORT_RE accepts `import type` and rejects runtime `pino` imports', () => {
    expect(RUNTIME_IMPORT_RE.test("import type { Logger } from 'pino'")).toBe(false);
    expect(RUNTIME_IMPORT_RE.test("import type pino from 'pino'")).toBe(false);
    expect(RUNTIME_IMPORT_RE.test("import { foo } from 'pino'")).toBe(true);
    expect(RUNTIME_IMPORT_RE.test("import 'pino'")).toBe(true);
  });
});
```

**Verification:**
- `pnpm test tests/init/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 11: Final integration, documentation alignment, and verification

**Files:**
- Modify: `docs/tasks/TASK-011-guided-initialization.md` (mark Implemented, record results)
- Modify: `docs/tasks/INDEX.md` (one-line status update)

**Goal:** No public surface or barrel changes. The CLI consumes `InitOrchestrator` via the existing barrel (`src/init/index.js`) — no further edits. The task document records implementation results (commit hashes, verification output, test inventory, deviations, known limitations) and `INDEX.md` flips TASK-011 from `Planned` to `Implemented` with a one-line summary.

**Documentation updates:**
- Append an "Implementation results" section to `docs/tasks/TASK-011-guided-initialization.md` (commit hashes, verification output, test inventory, deviations, known limitations).
- Add a row to `docs/tasks/INDEX.md` updating TASK-011 from `Planned` to `Implemented` with a one-line summary.

> Note: SPEC §9 wording is the source of truth — we do NOT modify SPEC.md. README is NOT updated because init has no user-visible behaviour change in this task (init is internal; SPEC §9 is the public contract).

**Verification (final, runs in CI):**
- `pnpm install --frozen-lockfile` → `Already up to date` (no new deps).
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm format:check` → exit 0 (run `pnpm format` first if any new files need reformatting).
- `pnpm build` → exit 0, `dist/cli.js` produced.
- `pnpm test` → all tests pass (existing baseline + new TASK-011 tests).
- `pnpm test:live` → empty live suite (correct — TASK-011 has no live LinkedIn surface).
- **Targeted boundary grep** (the implementing agent runs this in the shell, mirrors the `tests/init/boundaries.test.ts` guarantee):
  ```bash
  rg -n --type ts "from 'commander'|@inquirer/prompts|playwright|drizzle-orm|from 'openai'|from 'pino'" src/init/
  ```
  Expected output: at most two matches — (1) `src/init/prompts-inquirer.ts` importing `@inquirer/prompts` (the documented carve-out) and (2) `src/init/log.ts` `import type { Logger } from 'pino'` (which the regex's literal `from 'pino'` will match, but the agent confirms it is a type-only import). No `process.exit(` matches. If the boundary violation surfaces any unexpected match the implementing agent must stop and re-architect.

---

## Test strategy

The 7 expected test categories in `docs/tasks/TASK-011-guided-initialization.md` §Expected tests map to the following files (the test categories themselves are mandated by SPEC §9 + §42 acceptance 1–20). Each file name mentions the category it covers.

| # | Expected test category (from TASK-011 §Expected tests) | Test file |
|---|---|---|
| 1 | Run initialization from an empty home and verify the prescribed step order and final readiness | `tests/init/init-service.test.ts` (scenario: "fresh HOME, no OpenAI key") + `tests/cli/init.test.ts` (scenario 1: "Fresh init, no OpenAI key") |
| 2 | Resume after each supported incomplete / failed / cancelled step without duplicating state | `tests/init/init-service.test.ts` (scenario: "resume after pre-seeded config + search + approved profile + filter config"; sub-scenarios for each non-complete state) + `tests/cli/init.test.ts` (scenario 2) |
| 3 | Verify missing API key stops before OpenAI while preserving prior work | `tests/init/init-service.test.ts` (scenario: "missing API key, pre-seeded everything except usable source") + `tests/cli/init.test.ts` (scenario 1: "openai_key: missing") |
| 4 | Verify existing config / database / profile / filter / source records are never silently overwritten | `tests/init/init-service.test.ts` (assertion: `config.json` content unchanged after resume when `complete`; pre-seeded `profile_versions` row is not touched when re-running init after approval) |
| 5 | Verify rejected profiles and unresolved conflicts leave setup incomplete without replacing the active profile | `tests/init/init-service.test.ts` (sub-scenario a: "draft with blocking conflict + `askEditHandoff` returns `'reject'` → `ProfileRejectionService.reject` runs → prior approved profile stays active → `ready: false`, `nextStep: 'approvedProfile'`". Sub-scenario b: "draft with blocking conflict + `askEditHandoff` returns `'approve_now'` → `ProfileApprovalService.approve` throws `BlockingConflictsUnresolvedError` → orchestrator surfaces step `failed` with `errorCode: 'blocking_conflicts_unresolved'`, `nextStep: 'approvedProfile'`, prior approved profile unchanged." — Minor g.) |
| 6 | Verify partial initialization can be rerun safely and step statuses are accurate | `tests/init/init-service.test.ts` (scenario: "first run aborts at search step (cancellation) → second run resumes at search → `ready: true` after completion") |
| 7 | Verify cancellation closes resources and preserves completed work | `tests/init/init-service.test.ts` (scenario: "scripted search prompt returns `false` → `runConfigureSearch` throws `SearchCancelledError` → orchestrator catches, logs `stepFail({ stepId: 'search', errorCode: 'search_cancelled' })`, rethrows the typed error for the CLI boundary (Finding 6 — NO partial summary return on cancellation). The CLI test asserts `handle.close()` was called by intercepting the `DatabaseHandle.close` method") + `tests/cli/init.test.ts` (sub-scenario: cancellation path → exit 130) |

The dedicated "no `process.exit` inside `src/init/`" assertion lives in `tests/init/boundaries.test.ts` (final tree walk + dedicated `init-service.ts` assertion).

The domain-discipline boundary tests are:
- **(a) no OpenAI import in the init orchestrator** — `tests/init/boundaries.test.ts` (full tree scan + dedicated `init-service.ts` assertion).
- **(b) no Commander / Inquirer (outside `prompts-inquirer.ts`) / Playwright / Drizzle / Pino (runtime) in `src/init/`** — same file, plus the runtime separation of `prompts.ts` (interface only) from `prompts-inquirer.ts` (the only module allowed to import `@inquirer/prompts`).
- **(c) no `process.exit` inside `src/init/`** — same file (regex matches `process.exit(` and `process\.exitCode` — the latter is permitted because `process.exitCode` is a soft suggestion).
- **(d) profile editing is never inlined** — `tests/init/init-service.test.ts` (assertion: when `askEditHandoff` returns `'edit_then_return'`, the test injects a stubbed `ProfileEditingService` that throws on construction and asserts the stub is never instantiated).

## Verification commands

All commands from `AGENTS.md` §15 adapted to this task:

- `pnpm install --frozen-lockfile` → `Already up to date` (no new deps).
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm format:check` → exit 0 (run `pnpm format` first if any new files need reformatting).
- `pnpm build` → exit 0, `dist/cli.js` produced.
- `pnpm test` → all tests pass (existing baseline + new TASK-011 tests).
- `pnpm test:live` → empty live suite (correct — TASK-011 has no live LinkedIn surface).
- **Targeted boundary grep** — the implementing agent MUST run this in the shell:
  ```bash
  rg -n --type ts "from 'commander'|@inquirer/prompts|playwright|drizzle-orm|from 'openai'|from 'pino'|process\.exit\(" src/init/
  ```
  Expected output: at most two matches — `src/init/prompts-inquirer.ts` importing `@inquirer/prompts` (the documented carve-out) and `src/init/log.ts`'s `import type { Logger } from 'pino'` (which the regex's literal `from 'pino'` will match, but the agent confirms it is a type-only import). No `process.exit(` matches. If the boundary violation surfaces any unexpected match the implementing agent must stop and re-architect.

## Completion criteria

Mirror SPEC.md §9 + §42 acceptance calls and TASK-011 §Completion criteria. The implementing agent confirms each item before reporting the task complete.

1. **Idempotent + resumable** — `InitOrchestrator.run()` walks the 10 prerequisites; on resume, every `complete` step is skipped; the first non-complete step is run. `tests/init/init-service.test.ts` covers both first-run and resume-from-each-step scenarios.
2. **Completion reported only when valid configuration + ≥1 query + ≥1 location + active approved profile + active filter config + migrated DB all exist** — `SetupSummary.ready` is derived from the 10 prerequisite statuses; verified by `tests/cli/init.test.ts` scenario 2.
3. **No initialization step silently resets persisted user state** — verified by `tests/init/init-service.test.ts` assertions that pre-seeded `config.json` content is unchanged after resume; pre-seeded approved profile is not touched; pre-seeded filter configuration is not invalidated.
4. **OpenAI key gate is skip-not-fail** — verified by `tests/cli/init.test.ts` scenario 1 (exit 0 with `openai_key: missing` and `ready: no`) and `tests/init/init-service.test.ts` scenario "missing API key".
5. **Profile editing is NOT inlined** — verified by `tests/init/init-service.test.ts` (assertion: `ProfileEditingService` stub throws on construction, the stub is never instantiated when `askEditHandoff` returns `'edit_then_return'`).
6. **Cancellation closes the DB handle and preserves completed work** — verified by `tests/cli/init.test.ts` sub-scenario for cancellation (exit 130; the `try/finally handle.close()` pattern holds).
7. **Typed errors map to documented exit codes** — verified by `tests/cli/init.test.ts` scenario 4 (fatal path → exit 1; typed `ApplicationError` instances map to their declared `exitCode` per Decision 13).
8. **No new schema / migration / new direct dependency** — `package.json` is unchanged; `drizzle/` is unchanged; CI migrates against the existing schema. Verified by `pnpm install --frozen-lockfile` (no diff) + the targeted grep.
9. **Domain boundaries** — `tests/init/boundaries.test.ts` (full tree scan) + the targeted grep.
10. **Strict TypeScript** — `pnpm typecheck` is exit 0; no `any` in `src/init/`. The orchestrator's typed-error catch (`catch (error)`) narrows via `error instanceof ApplicationError` or `error instanceof UserCancellation` — never `any`.
11. **Public surface + barrel** — `src/init/index.ts` re-exports every public symbol. The CLI consumes them via the barrel.
12. **CLI subcommand** — `jobhunter init` runs, walks the 10 steps, prints the typed `SetupSummary`, exits 0 on success / clean-partial, exits 130 on cancellation. `tests/cli/init.test.ts` covers all five scenarios.
13. **Documentation** — `docs/tasks/TASK-011-guided-initialization.md` has an "Implementation results" section; `docs/tasks/INDEX.md` lists TASK-011 as `Implemented`. SPEC.md and README.md are unchanged.

## Known limitations / follow-ups for downstream tasks

1. **`--json` for `init` is deferred to TASK-016.** Decision 8 keeps init human-readable in TASK-011. The typed `SetupSummary` is the eventual JSON payload; no work is added here.
2. **No score-result invalidation by profile version is added.** TASK-010 added `filterResults.invalidateByFilterConfigVersion`; TASK-014 (scoring) will own `scoreResults.invalidateByProfileVersion` if it adds a `profile_version_id` column. The init orchestrator never calls into `scoreResults` directly — it only checks the active approved profile (`profileVersions.findActiveApproved()`).
3. **No `applicationMetadata` init markers.** Completion is DERIVED from existing tables (Decision 11). A future task that wants to record init-start / init-complete timestamps must add a new column via a fresh migration (AGENTS.md §12 — schema changes require approval).
4. **`validateOpenAiApiKey` does not validate the key with the server.** The orchestrator only checks presence. Real validation happens implicitly when `ProfileExtractionService.extract` runs; a missing / invalid key surfaces as `OpenAIAuthenticationError` (exit 5). Adding an explicit pre-flight ping is out of scope for TASK-011.
5. **Profile editing handoff is intentionally a textual message.** The orchestrator prints "Run `jobhunter profile edit <id>`, then re-run init." and exits 0 with a partial summary. A future task could re-enter the editing loop automatically, but that would violate Decision 6 (the editor is an interactive shell that traps the user).
6. **Search configuration and filter configuration reuse the existing service.** The orchestrator does NOT add new prompts to those services — it delegates to the existing `SearchPrompts` and `FilterPrompts` seams. The `InitPrompts` interface is intentionally small (Decision 10).
7. **No live `pnpm test:live` coverage.** Init is local-only and unit-tested; the live tests target LinkedIn scraper behavior in TASK-012 and beyond. The implementing agent confirms `pnpm test:live` is empty and exits 0.
8. **`InitOrchestrator` does not own a `runId` or a `pipelineRuns` row.** Init is a setup wizard, not a pipeline run. The pipeline-run lifecycle is TASK-015's responsibility. The orchestrator's `logger` events are NOT associated with a `pipelineRuns` row.
9. **`InitOrchestrator.run()` does not retry a failed step automatically.** Per Decision 7, cancellation rethrows for the CLI boundary; per-step `failed` outcomes are surfaced as `SetupSummary` entries and the user re-runs `init` to retry. The orchestrator does NOT call any prerequisite service's `run*` method twice for the same step in a single invocation.
10. **Concurrent `init` invocations are safe by construction** (Finding 15). SQLite's serialized write lock + the orchestrator's idempotent classifier-on-existing-state pattern (Finding 11: completion is derived from existing tables) means two `init` invocations on the same `HOME` cannot corrupt the DB. The second invocation's classifier sees the first's writes and treats the matching steps as `complete`. `updateConfig`'s atomic temp-file + rename is also concurrent-safe (POSIX rename atomicity on the same filesystem). **No explicit concurrent-init test is added** — the property is structural (SQLite + atomic rename + idempotent classify) and a concurrent test would be flaky and SQLite-internal. The implementing agent confirms this property by reading `loadConfig`, `updateConfig`, and `initializeDatabase` rather than by writing a test.

## Anti-patterns to call out explicitly

- **Do NOT inline `ProfileEditingService.startEdit` in the orchestrator.** Its interactive `for(;;)` shell will trap the user. Use `initPrompts.askEditHandoff` and return a partial summary with the handoff message.
- **Do NOT call `process.exit` inside `src/init/`.** The CLI boundary owns exit codes via the existing `exitWithError` helper.
- **Do NOT add a `initStarted` / `initCompleted` row to `applicationMetadata`.** Completion is derived from existing tables (Decision 11). Any future addition requires explicit approval per AGENTS.md §12.
- **Do NOT touch the `pino` logger directly from `src/init/init-service.ts`.** Use the `InitLogger` adapter (Task 7). The only `pino` import allowed in `src/init/` is the type-only `import type { Logger } from 'pino'` in `src/init/log.ts`.
- **Do NOT silently overwrite config.** `loadConfig` returns the default when missing; init MUST materialize via `updateConfig` with a no-op owned-section patch (Decision 5). When `config.json` exists, init never writes it.
- **Do NOT throw exit 5 for `OPENAI_API_KEY` absence.** Exit 5 is for runtime failures (Decision 4 + 13). Missing key → exit 0 with a partial summary.
- **Do NOT re-implement prerequisite service logic inside the orchestrator.** The orchestrator composes the existing services through their public APIs (via the barrels). Re-implementing search, profile, or filter logic violates AGENTS.md §5.
- **Do NOT add a `--json` flag for `init` in this task.** It is deferred to TASK-016 (Decision 8).
- **Do NOT batch multiple OpenAI calls in init.** One extract request per init invocation. The orchestrator calls `ProfileExtractionService.extract` exactly once per resume cycle.

(End of plan — total sub-tasks: 11; total new source files: 9 (8 in `src/init/` — `state`, `errors`, `classify`, `prompts`, `prompts-inquirer`, `log`, `init-service`, `format` — and 1 modification in `src/cli.ts`); total new test files: 9 (8 in `tests/init/` — `state`, `errors`, `classify`, `prompts`, `prompts-inquirer`, `log`, `init-service`, `format` — plus 1 in `tests/cli/`: `init.test.ts`); total modified test files: 0; total modified source files: 1 (`src/cli.ts`).)
