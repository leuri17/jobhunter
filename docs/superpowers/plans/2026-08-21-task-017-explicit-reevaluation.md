# TASK-017 Implementation Plan — Explicit Job Reevaluation and Scope Handling

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implement `jobhunter jobs reevaluate` — a focused, read-or-rerun command separate from `jobhunter run` — that reuses the existing filter and scoring services (TASK-010 + TASK-014) to reevaluate complete jobs whose filter or score results are stale or missing (SPEC §28, §30, §32, §36, §37, §40, §41.2, §42 acceptance criterion 37). The plan covers five invocation modes: default scope, `--filters-only`, `--scores-only`, `--job <job-id>`, and `--dry-run`, with `--yes` confirmation semantics that bypass only the OpenAI confirmation.

**Architecture:** A new `src/reevaluation/` sibling of `src/pipeline/`, `src/inspection/`, `src/filter/`, `src/scoring/`, `src/init/` houses the reevaluation domain. The pure layer (`src/reevaluation/{state,errors,plan,format,json-schemas}.ts`) has no I/O — it operates on plain row shapes returned by the service layer. The service layer (`src/reevaluation/service.ts`) composes the existing `FilterApplyService` (TASK-010), `ScoringService` (TASK-014), `JobRepository`, `FilterResultRepository`, and `ScoreResultRepository`, plus the existing `PipelinePrompts.askScoringConfirmation` adapter (TASK-015). The CLI handler in `src/cli.ts` owns flag validation, identifier resolution, `--json` flag, terminal-width detection, and exit-code mapping; the existing `exitWithError` function (already used by every other subcommand) is reused unchanged. No new schema, no new migration, no new direct dependency, no new LLM provider, no new scraping. The reevaluation service NEVER calls `process.exit`; the CLI handler does. The pipeline orchestrator is NOT reimplemented; TASK-017 only consumes its persisted state.

**Tech Stack:** No new dependencies. Reuses the foundation wired by TASK-001/002/003/004/005/006/007/008/009/010/011/012/013/014/015/016: `commander`, `@inquirer/prompts`, `drizzle-orm@0.45.2`, `better-sqlite3@13.0.3`, `zod`, `pino@10.3.1`, `vitest`. The `--json` flag reuses `JSON.stringify(payload, null, 2) + '\n'` (mirrors `jobs list --json` at `src/cli.ts`). Identifier resolution reuses `resolveJobIdentifier` (`src/persistence/identifiers.ts:134-152`). Confirmation reuses `PipelinePrompts.askScoringConfirmation` (`src/pipeline/prompts.ts:7`) — the same adapter TASK-015 uses for `jobhunter run`. Terminal-width detection uses `process.stdout.columns ?? 120` (mirrors `src/pipeline/format.ts:60` and `src/inspection/columns.ts`).

## Open decisions confirmed before implementation

These map to SPEC §28 + §30 + §32 + §36 + §37 + §40. The implementing agent must stop and ask the user to confirm all 18 resolutions before any file in `src/reevaluation/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Module location | New `src/reevaluation/` (sibling of `src/pipeline/`, `src/inspection/`, `src/filter/`, `src/scoring/`, `src/linkedin/`, `src/profile/`, `src/init/`). Layout: `state.ts`, `errors.ts`, `plan.ts`, `format.ts`, `json-schemas.ts`, `index.ts`, plus `service.ts`. No new subdirectory under `services/` — the reevaluation service is a single file. | §5, AGENTS.md §5 |
| 2 | Schema version | `REEVALUATION_SCHEMA_VERSION = 1 as const` (mirrors `INSPECTION_SCHEMA_VERSION`, `PIPELINE_SCHEMA_VERSION`, `LINKEDIN_SCORING_SCHEMA_VERSION`). Every top-level `--json` response carries `schemaVersion: 1` as the first key (SPEC §36). | §36 |
| 3 | Scope vocabulary | `type ReevaluationScope = 'default' \| 'filters-only' \| 'scores-only' \| 'job'`. `ReevaluationPlan` and the JSON `--json` output both carry the scope verbatim so consumers can branch. The CLI handler maps the flag set to the scope BEFORE calling the service. | §28.1–28.4 |
| 4 | Selection semantics — default | Default scope selects all complete jobs (`extractionStatus === 'complete'`) that have EITHER (a) no active filter result for the current fingerprint, OR (b) no active score result for the current fingerprint WHEN the current active filter outcome is `'accepted'`. A job with a current accepted filter + a current successful score is NOT selected. | §28.1, §27.4 |
| 5 | Selection semantics — `--filters-only` | Selects all complete jobs whose current fingerprint does NOT match an active `filter_results` row. (Equivalent to: the filter result is stale OR missing.) `--filters-only` also marks the dependent `score_results` active rows as inactive after the filter rerun when the new filter fingerprint differs from the old one — see Decision 11. | §28.2 |
| 6 | Selection semantics — `--scores-only` | Selects all complete jobs that (a) have a current active filter result whose fingerprint matches the active filter config + active profile, AND (b) have a current fingerprint that does NOT match an active successful `score_results` row. Jobs whose filter is stale OR missing are SKIPPED with reason `filter_update_required` and no OpenAI call is made. | §28.3 |
| 7 | Selection semantics — `--job` | Resolves the supplied identifier via `resolveJobIdentifier(raw)` (returns `{ jobId? , sourceJobId? }`). The service must reject non-complete jobs with `ReevaluationJobNotCompleteError` (exit code 2). The job must be combined with EITHER no other scope flag OR `--dry-run` OR `--filters-only` OR `--scores-only` (the documented combinations per SPEC §28.4). | §28.4, §32.1 |
| 8 | `--dry-run` semantics | Performs selection + fingerprint checks via `findActiveByJob(jobId, fingerprint)` (read-only). For every selected job the service computes the planned filter + score actions. **No** DB writes. **No** OpenAI calls. Returns a `ReevaluationPlan` with `dryRun: true` and the per-job plan entries. The JSON shape is identical to the live-mode output except `dryRun: true` is set and per-job actions are recorded as `"would-rerun"` rather than `"reran"`. | §28.5 |
| 9 | Flag compatibility validation | CLI handler asserts the mutex BEFORE calling the service. `--filters-only` + `--scores-only` → `ReevaluationValidationError('reevaluate_scope_conflict', ..., InvalidUsage)`. `--job` + nothing is valid. `--job` + `--filters-only` is valid. `--job` + `--scores-only` is valid. `--job` + `--dry-run` is valid. `--job` + `--filters-only` + `--dry-run` is valid (the documented matrix). `--job` + `--filters-only` + `--scores-only` is invalid. `--job` with both `--yes` and `--dry-run` is valid (but `--yes` has no effect — see Decision 13). | §28.4, §28.6 |
| 10 | Confirmation | When the plan requires at least one new OpenAI scoring request AND `--dry-run` is NOT set AND `--filters-only` is NOT set, the service shows the `ScoringPlan` via the existing `PipelinePrompts.askScoringConfirmation` adapter (TASK-015 §30). If the user declines: the scoring batch is skipped (no OpenAI calls), the filter reruns are still applied, and the run summary records `scoringDeclinedByUser: true`. `--yes` bypasses the OpenAI confirmation. `--yes` has NO effect for `--filters-only` or `--dry-run` (no OpenAI requests in those scopes). | §28.7, §30 |
| 11 | Filter→score invalidation | After `FilterApplyService.apply()` returns a non-reused filter result (the new fingerprint differs from the prior active fingerprint), the service calls `scoreResults.invalidateActiveByJob(jobId)` to flip every active `score_results` row for that job to `active = false`. New repository method on `ScoreResultRepository` (mirror of `FilterResultRepository.invalidateByFilterConfigVersion` at `src/persistence/repositories/filter-results.ts:213-237`). The method is idempotent (returns the count of rows flipped). When `--filters-only` runs, every rerun that produces a new fingerprint invalidates the dependent score; a fresh fingerprint that matches the prior active row is treated as a no-op (no invalidation). | §28.2, §27.4 |
| 12 | Filter→score invalidation audit | The `ReevaluationPlan` records for each selected job whether the rerun invalidated the prior score (`scoreInvalidated: boolean`). The `--json` output exposes this per-job for visibility. The aggregate count `scoresInvalidated: number` is included in the top-level summary. | §28.5, §36 |
| 13 | `--yes` semantics | `--yes` (Commander `--yes`, default `false`) bypasses ONLY the OpenAI scoring confirmation. The CLI handler passes `confirmScoring: !options.yes` to the service. For `--filters-only` and `--dry-run` scopes the service sets `confirmScoring: false` unconditionally because no OpenAI requests are produced. `--yes` does NOT bypass any other confirmation (there are no other confirmations in TASK-017). | §28.7 |
| 14 | `--json` output shape | The `--json` payload follows the documented shape (mirrors `jobs list --json` at SPEC §36 example): `{ schemaVersion: 1, scope, dryRun, jobId?: string (when --job), filtersToReevaluate: ReevaluationPlanEntry[], jobsToScore: ReevaluationPlanEntry[], skipped: ReevaluationSkippedEntry[], scoringPlan: ScoringPlan (omitted when newOpenAIRequests === 0 and dryRun), totals: { filtersRerun: number, scoresRerun: number, scoresInvalidated: number, skipped: number, scoringDeclinedByUser: boolean } }`. `ReevaluationPlanEntry` is `{ jobId: string, internalId: number, sourceJobId: string, action: 'would-rerun' | 'reran' | 'reused', fingerprint: string }`. `ReevaluationSkippedEntry` is `{ jobId: string, internalId: number, sourceJobId: string, reason: 'filter_update_required' | 'job_not_complete' | 'job_not_found' }`. The CLI handler writes `JSON.stringify(payload, null, 2) + '\n'` — exactly one document. | §36 |
| 15 | Exit codes | Reuses the existing `ExitCode` enum (`src/errors/application-error.ts:1-9`): `Success: 0`, `Fatal: 1`, `InvalidUsage: 2`, `MissingRequired: 3`, `LinkedInBlocked: 4`, `OpenAIFailure: 5`, `UserCancellation: 130`. New typed errors: `ReevaluationValidationError` (InvalidUsage — scope conflict, invalid job-id, job not complete, job not found), `ReevaluationPrerequisiteError` (MissingRequired — no active profile, no active filter config, missing OPENAI_API_KEY). NO new exit codes. The existing `PipelinePrerequisiteError` from TASK-015 (MissingRequired, code `no_active_filter` / `no_active_profile`) is REUSED for the missing-profile and missing-filter cases (Decision 16). | §37 |
| 16 | Prerequisite validation | The service rejects runs with `PipelinePrerequisiteError` (MissingRequired = 3) when (a) no active approved profile exists (the OpenAI-required scopes only), (b) no active filter config exists, OR (c) `OPENAI_API_KEY` is missing (the OpenAI-required scopes only — `--filters-only` and `--dry-run` may run without it). The check runs at the START of `execute()` BEFORE any selection work. | §3, §33 |
| 17 | CLI integration | The CLI handler in `src/cli.ts` adds ONE new subcommand: `jobs reevaluate` (with `--filters-only`, `--scores-only`, `--job <job-id>`, `--dry-run`, `--yes`, `--json`). The `jobs` Commander object already exists (TASK-016) — only the new subcommand is added. The handler reuses `exitWithError`. The `--yes` flag is local to this subcommand (no global flag). | §31, §36 |
| 18 | Tests | `tests/reevaluation/{boundaries,plan,format,json-schemas}.test.ts` (pure helpers). `tests/reevaluation/service.test.ts` (service with `:memory:` SQLite + migrations + fakes for `FilterApplyService` + `ScoringService` + OpenAI; mirrors `tests/pipeline/orchestrator.test.ts` Wave D). `tests/cli/jobs-reevaluate.test.ts` (CLI wiring using the `createProgram()` pattern from `tests/cli/jobs-list.test.ts`). NO live LinkedIn, NO live OpenAI. | §41.1, §41.2 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system. `package.json` dependencies are unchanged.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/reevaluation/` — with **no carve-outs needed** (the module has no interactive prompts, no browser session, no OpenAI client) — **must not** import Commander, Inquirer, Playwright, the `openai` SDK, or Pino directly. The pure layer (`src/reevaluation/{state,errors,plan,format,json-schemas}.ts`) operates on plain row shapes. The service layer (`src/reevaluation/service.ts`) is the ONLY module under `src/reevaluation/` that imports `src/persistence/repositories/`, `src/filter/service.js`, `src/scoring/service.js`, and `src/pipeline/{errors,prompts}.js`. The CLI handler in `src/cli.ts` is the ONLY module that imports both `src/reevaluation/` AND `commander`. The boundaries test mirrors `tests/inspection/boundaries.test.ts` and allows imports from the documented `src/{filter,scoring,pipeline,persistence}` modules.
- **Validation:** Zod at the JSON boundary. `REEVALUATION_JSON_SCHEMA` (a `z.object` shape per `src/reevaluation/json-schemas.ts`) is the schema for the JSON output. The JSON contracts are validated in tests via `REEVALUATION_JSON_SCHEMA.safeParse(payload)`.
- **Errors:** Typed errors extending `ApplicationError`. New error codes live in `src/reevaluation/errors.ts`. Exit-code mapping follows Decision 15. The `PipelinePrerequisiteError` from `src/pipeline/errors.ts` is reused for the missing-profile / missing-filter / missing-key cases (Decision 16) — it is the established pattern from TASK-015 and the CLI handler already maps its `exitCode === 3` correctly via `exitWithError`.
- **History preservation (AGENTS.md §6):** All reevaluation actions preserve history: filter reruns append a new `filter_results` row and flip the prior active row to `active = false` (the existing `FilterApplyService.apply()` contract). Score invalidation flips prior active score rows to `active = false` and does NOT delete them. The new score reruns append new `score_results` rows and flip the prior active row to `active = false` (the existing `ScoringService.scoreOne()` contract). `--dry-run` writes NOTHING. The CLI handler's `--json` flag and the service layer never call `process.exit`; the CLI boundary does.
- **Determinism:** The pure helpers are pure functions of their inputs. The plan builder's selection order is `jobId ASC` (mirrors the tie-breaker in SPEC §34.4). The `--json` shape is fully deterministic — the same inputs always produce the same output.
- **Tests:** Vitest. Pure-helper tests are deterministic and unit-style. Service tests use `:memory:` SQLite + migrations + fakes (mirrors `tests/helpers/run-harness.ts:78-81`). CLI smoke tests use `process.exit` / `stdout` / `stderr` capture as in TASK-016.
- **JSON output discipline (AGENTS.md §10):** `--json` emits exactly ONE valid JSON document to stdout; logs + human-readable errors go to stderr; values are never truncated. The JSON shape is documented in Decision 14 + the test fixtures.
- **No new schema/migration:** All tables used (`jobs`, `filterResults`, `scoreResults`, `filterConfigurations`, `profileVersions`) already exist (TASK-003). The plan MUST NOT add DDL.
- **No new CLI subcommand surface:** `jobs reevaluate` is the ONLY new subcommand. The `jobs` Commander object already exists (TASK-016). NO new aliases.

## Reconciler facts (from existing code review)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and are not re-litigated in this plan.

- **`JobRepository.findById(id)`** returns a `JobRow | null` (`src/persistence/repositories/jobs.ts:270-274`).
- **`JobRepository.findBySourceJobId(sourceJobId)`** returns a `JobRow | null` (`src/persistence/repositories/jobs.ts:264-269`).
- **`JobRepository.listByState({ extractionStatus, ... })`** returns `readonly JobRow[]` (`src/persistence/repositories/jobs.ts:510-575`). Used by TASK-016's `JobsListService`. The new `listComplete()` method on the same repository is added in Task 1.
- **`FilterApplyService.apply({ jobId, job, pipelineRunId })`** returns a `FilterApplyResult` (`src/filter/service.ts:94-161`). Fields: `outcome` (`'accepted' | 'rejected' | 'error'`), `filterResultId`, `fingerprint`, `ruleEvaluations`, `rejectionReasons`, `reused`.
- **`ScoringService.scoreOne({ run, searchExecution, job, profileVersion, effectiveDerivedValues, filterResult, activeFilterFingerprint, signal })`** returns a `ScoringOutcome` (`src/scoring/service.ts:146-464`). Fields: `kind` (`'reused' | 'complete' | 'failed' | 'skipped' | 'cancelled'`), `overallScore`, `fingerprint`, `errorCode`.
- **`ScoringService.buildScoringPlan({ run, searchExecution, jobs, eligibleFlags, scoreKinds, scoringConcurrency })`** returns a `ScoringPlan` (`src/scoring/plan.ts:41-71`). Used unchanged.
- **`FilterResultRepository.findActiveByJob(jobId, fingerprint)`** returns `FilterResultRow | null` (`src/persistence/repositories/filter-results.ts:111-125`).
- **`ScoreResultRepository.findActiveByJob(jobId, fingerprint)`** returns `ScoreResultRow | null` (`src/persistence/repositories/score-results.ts:141-155`).
- **`ScoreResultRepository.listByJob(jobId)`** returns `readonly ScoreResultRow[]` (`src/persistence/repositories/score-results.ts:163-167`).
- **`PipelinePrompts.askScoringConfirmation({ plan })`** returns `Promise<boolean>` (`src/pipeline/prompts.ts:7`).
- **`PipelinePrerequisiteError`** is exported from `src/pipeline/errors.ts`. Exit code 3 (MissingRequired). Subcodes: `'no_active_profile'`, `'no_active_filter'`. The CLI's `exitWithError` already maps it to exit code 3.
- **`resolveJobIdentifier(raw)`** returns `{ jobId?: number, sourceJobId?: string }` (`src/persistence/identifiers.ts:134-152`).
- **`ExitCode` enum** is stable at `src/errors/application-error.ts:1-9`. `InvalidUsage = 2`, `MissingRequired = 3`, `Fatal = 1`, `Success = 0`.
- **`REEVALUATION_SCHEMA_VERSION = 1`** follows the convention from `INSPECTION_SCHEMA_VERSION = 1` (`src/inspection/state.ts`), `PIPELINE_SCHEMA_VERSION = 1` (`src/pipeline/state.ts`), `LINKEDIN_SCORING_SCHEMA_VERSION = 1` (`src/scoring/state.ts`).
- **`applicationVersion`** is read from `package.json` via `getApplicationVersion()` (`src/pipeline/version.ts`) — the reevaluation module does NOT need this field.
- **`OperationalConfigSchema`** is `.strict()`. No new config fields.
- **`process.exit` / `process.stdout` / `process.stderr`** are only called from the CLI handler in `src/cli.ts`. Tests stub them via the pattern in `tests/cli/jobs-list.test.ts:31-43`.
- **`calculateFilterFingerprint`** is exported from `src/filter/fingerprint.ts` (TASK-010). Used inside `FilterApplyService.apply()`. The reevaluation service does NOT need to call it directly — the service computes fingerprints via `FilterApplyService.apply()` for filter reruns.
- **`computeScoreFingerprint`** is exported from `src/scoring/fingerprint.ts` (TASK-014). Used inside `ScoringService.scoreOne()`. The reevaluation service does NOT need to call it directly.

## File Structure

```text
src/reevaluation/
  state.ts                                # NEW: REEVALUATION_SCHEMA_VERSION + ReevaluationScope + ReevaluationPlan + ReevaluationPlanEntry + ReevaluationSkippedEntry + ReevaluationOutcome + totals types (Task 1)
  errors.ts                               # NEW: ReevaluationError + ReevaluationValidationError + ReevaluationPrerequisiteError (re-exported from pipeline) (Task 2)
  plan.ts                                 # NEW: buildReevaluationPlan(selection, scoringPlan, skipped) — pure aggregation (Task 3)
  format.ts                               # NEW: formatReevaluationSummary + formatReevaluationTable — pure formatters (Task 4)
  json-schemas.ts                         # NEW: Zod schemas for --json output (Task 5)
  index.ts                                # NEW: public barrel (Task 6)
  service.ts                              # NEW: ReevaluationService.execute(input) — composes filter + score services (Task 7)
src/cli.ts                                # MODIFIED: add jobs reevaluate subcommand (Task 8)
src/persistence/repositories/jobs.ts      # MODIFIED: add listComplete() method (Task 9)
src/persistence/repositories/score-results.ts  # MODIFIED: add invalidateActiveByJob(jobId) method (Task 10)
tests/reevaluation/
  boundaries.test.ts                      # NEW: bans on commander/inquirer/playwright/openai/pino (Task 11)
  plan.test.ts                            # NEW: buildReevaluationPlan aggregation cases (Task 11)
  format.test.ts                          # NEW: formatReevaluationSummary + formatReevaluationTable snapshots (Task 11)
  json-schemas.test.ts                    # NEW: Zod schema accepts every documented fixture shape (Task 11)
  service.test.ts                         # NEW: every scope + flag combo + dry-run + confirmation (Task 11)
tests/cli/
  jobs-reevaluate.test.ts                 # NEW: CLI wiring for jobs reevaluate (Task 12)
```

## Tasks

### Task 1 — `src/reevaluation/state.ts` — state vocabulary

- [ ] Create `src/reevaluation/state.ts` exporting:
  - `REEVALUATION_SCHEMA_VERSION = 1 as const` (the JSON schema version).
  - `type ReevaluationScope = 'default' | 'filters-only' | 'scores-only' | 'job'`.
  - `type ReevaluationPlanAction = 'would-rerun' | 'reran' | 'reused'` (the action label per job entry).
  - `type ReevaluationSkipReason = 'filter_update_required' | 'job_not_complete' | 'job_not_found'` (the skip reasons from SPEC §28.3 + Decision 7 + Decision 9).
  - `interface ReevaluationPlanEntry { readonly jobId: string; readonly internalId: number; readonly sourceJobId: string; readonly action: ReevaluationPlanAction; readonly fingerprint: string; readonly scoreInvalidated: boolean }`.
  - `interface ReevaluationSkippedEntry { readonly jobId: string; readonly internalId: number; readonly sourceJobId: string; readonly reason: ReevaluationSkipReason }`.
  - `interface ReevaluationPlan { readonly schemaVersion: typeof REEVALUATION_SCHEMA_VERSION; readonly scope: ReevaluationScope; readonly dryRun: boolean; readonly jobId: string | null; readonly filtersToReevaluate: readonly ReevaluationPlanEntry[]; readonly jobsToScore: readonly ReevaluationPlanEntry[]; readonly skipped: readonly ReevaluationSkippedEntry[]; readonly scoringPlan: ScoringPlan | null; readonly totals: { readonly filtersRerun: number; readonly scoresRerun: number; readonly scoresInvalidated: number; readonly skipped: number; readonly scoringDeclinedByUser: boolean } }`.
  - `interface ReevaluationOutcome { readonly plan: ReevaluationPlan }` (the service return type — wraps the plan for forward-compat).
  - `interface ReevaluationExecuteInput { readonly scope: ReevaluationScope; readonly dryRun: boolean; readonly confirmScoring: boolean; readonly env: Readonly<Record<string, string | undefined>>; readonly now?: () => Date; readonly runId?: number | null }` (the service input).
  - Re-export `ScoringPlan` from `../scoring/state.js` for convenience.
- [ ] No runtime imports. Pure types + constants.
- [ ] Verify: `pnpm typecheck` succeeds.

### Task 2 — `src/reevaluation/errors.ts` — typed errors

- [ ] Create `src/reevaluation/errors.ts` exporting:
  - `class ReevaluationError extends ApplicationError` (base class, exit code defaults to `Fatal`).
  - `class ReevaluationValidationError extends ReevaluationError` (exit code `InvalidUsage` — used for scope conflict, invalid job-id, job not complete, job not found).
- [ ] Re-export `PipelinePrerequisiteError` from `../pipeline/errors.js` (Decision 16 — the missing-profile / missing-filter / missing-key cases reuse the existing class).
- [ ] Constructor pattern matches `ApplicationError` (code, message, exitCode, metadata, cause).
- [ ] Tests: `tests/reevaluation/errors.test.ts` (smoke test only — assertions on `code`, `message`, `exitCode`, `metadata`).

### Task 3 — `src/reevaluation/plan.ts` — pure plan aggregation

- [ ] Create `src/reevaluation/plan.ts` exporting:
  - `interface BuildReevaluationPlanInput { readonly scope: ReevaluationScope; readonly dryRun: boolean; readonly jobId: string | null; readonly filterEntries: readonly ReevaluationPlanEntry[]; readonly scoreEntries: readonly ReevaluationPlanEntry[]; readonly skipped: readonly ReevaluationSkippedEntry[]; readonly scoringPlan: ScoringPlan | null; readonly scoringDeclinedByUser: boolean }`.
  - `function buildReevaluationPlan(input: BuildReevaluationPlanInput): ReevaluationPlan`:
    - Returns a `ReevaluationPlan` with:
      - `schemaVersion: REEVALUATION_SCHEMA_VERSION`.
      - `scope`, `dryRun`, `jobId` carried through unchanged.
      - `filtersToReevaluate: input.filterEntries` (the rerun list).
      - `jobsToScore: input.scoreEntries` (the OpenAI-required list).
      - `skipped: input.skipped`.
      - `scoringPlan: input.scoringPlan` (omitted → `null`).
      - `totals`: `filtersRerun = filterEntries.length`, `scoresRerun = scoreEntries.filter(e => e.action !== 'reused').length`, `scoresInvalidated = sum(filterEntries.map(e => e.scoreInvalidated ? 1 : 0)) + sum(scoreEntries.map(e => e.scoreInvalidated ? 1 : 0))`, `skipped = input.skipped.length`, `scoringDeclinedByUser: input.scoringDeclinedByUser`.
- [ ] NO imports from `src/persistence/`, `src/cli/`, `src/linkedin/`, `src/profile/`, `src/pipeline/`. Pure aggregation.
- [ ] Tests: `tests/reevaluation/plan.test.ts`:
  - Default scope + 2 filter reruns + 1 score rerun + 1 skip → totals `{ filtersRerun: 2, scoresRerun: 1, scoresInvalidated: 0, skipped: 1, scoringDeclinedByUser: false }`.
  - `--dry-run` scope + 2 filter reruns → `dryRun: true`, action labels are `'would-rerun'`.
  - `--scores-only` scope + scoring plan passed → `scoringPlan !== null`.
  - Empty inputs → `totals: { filtersRerun: 0, scoresRerun: 0, scoresInvalidated: 0, skipped: 0, scoringDeclinedByUser: false }`.

### Task 4 — `src/reevaluation/format.ts` — human-readable formatters

- [ ] Create `src/reevaluation/format.ts` exporting:
  - `function formatReevaluationSummary(plan: ReevaluationPlan, terminalWidth: number): string`:
    - Multi-line block: `Scope: <scope>`, `Dry run: yes|no`, `Job ID: <jobId>|—`.
    - `Filters to reevaluate: <n>` followed by `  job_<n>  <sourceJobId>  <action>  fingerprint=<8 chars>` lines.
    - `Jobs to score: <n>` followed by the same line shape.
    - `Skipped: <n>` followed by `  job_<n>  <sourceJobId>  reason=<reason>` lines.
    - `Totals: filtersRerun=<n> scoresRerun=<n> scoresInvalidated=<n> skipped=<n>`.
    - `Scoring declined by user: yes|no`.
  - `function formatReevaluationTable(plan: ReevaluationPlan, terminalWidth: number): string`:
    - Single summary table when `totals.skipped === 0` (just the totals + counts).
    - Two tables when `totals.skipped > 0` (one for `Action | Job | Source ID | Fingerprint`, one for `Reason | Job | Source ID`).
  - `function formatScoringPlanForReevaluation(plan: ScoringPlan, terminalWidth: number): string`:
    - Reuses the existing `formatScoringPlan` from `src/pipeline/format.ts` unchanged. The function exists here only to document the import boundary — re-export it.
- [ ] NO imports from `src/persistence/`, `src/cli/`, `src/linkedin/`, `src/profile/`. Pure formatting (the `formatScoringPlan` re-export is the one allowed `src/pipeline/` import — it is a pure formatter).
- [ ] Tests: `tests/reevaluation/format.test.ts`:
  - Snapshot-style assertions for each scope + dry-run + skip shape (using `expect(actual).toBe(expected)` on the full string).
  - Adaptive truncation: long `sourceJobId` values are truncated with ellipsis.

### Task 5 — `src/reevaluation/json-schemas.ts` — Zod schemas for `--json` output

- [ ] Create `src/reevaluation/json-schemas.ts` exporting:
  - `const REEVALUATION_SCHEMA_VERSION_LITERAL = z.literal(1)`.
  - `const ReevaluationPlanEntryJsonSchema = z.object({ jobId: z.string(), internalId: z.number().int(), sourceJobId: z.string(), action: z.union([z.literal('would-rerun'), z.literal('reran'), z.literal('reused')]), fingerprint: z.string(), scoreInvalidated: z.boolean() }).strict()`.
  - `const ReevaluationSkippedEntryJsonSchema = z.object({ jobId: z.string(), internalId: z.number().int(), sourceJobId: z.string(), reason: z.union([z.literal('filter_update_required'), z.literal('job_not_complete'), z.literal('job_not_found')]) }).strict()`.
  - `const ReevaluationTotalsJsonSchema = z.object({ filtersRerun: z.number().int().nonnegative(), scoresRerun: z.number().int().nonnegative(), scoresInvalidated: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), scoringDeclinedByUser: z.boolean() }).strict()`.
  - `const REEVALUATION_JSON_SCHEMA = z.object({ schemaVersion: REEVALUATION_SCHEMA_VERSION_LITERAL, scope: z.union([z.literal('default'), z.literal('filters-only'), z.literal('scores-only'), z.literal('job')]), dryRun: z.boolean(), jobId: z.string().nullable(), filtersToReevaluate: z.array(ReevaluationPlanEntryJsonSchema), jobsToScore: z.array(ReevaluationPlanEntryJsonSchema), skipped: z.array(ReevaluationSkippedEntryJsonSchema), scoringPlan: ScoringPlanJsonSchema.nullable(), totals: ReevaluationTotalsJsonSchema }).strict()`.
  - Re-export `ScoringPlanJsonSchema` from `../scoring/json-schemas.js` if it exists; otherwise inline the minimal shape `{ schemaVersion, runId, searchExecutionId, jobsDiscovered, jobsAccepted, scoresReused, newOpenAIRequests, skippedScoringCategories, scoringConcurrency, perJob }`. **NOTE:** TASK-014 did not extract `ScoringPlan` to a JSON Zod schema because the plan is internal-only. The reevaluation task adds the minimal Zod shape inline.
- [ ] All string fields use plain `z.string()` (no ISO 8601 regex needed for the plan entries — only `ScoringPlan` uses ISO timestamps, and those are inside the `scoringPlan` block which uses the same convention as TASK-014).
- [ ] Tests: `tests/reevaluation/json-schemas.test.ts`:
  - Build a representative fixture per scope (`default`, `filters-only`, `scores-only`, `job`, plus `--dry-run` variants), assert `REEVALUATION_JSON_SCHEMA.safeParse(fixture).success === true`.
  - Assert missing `schemaVersion` → `safeParse(...).success === false`.
  - Assert `schemaVersion: 2` → rejected.
  - Assert `dryRun: 'yes'` → rejected (boolean required).
  - Assert `action: 'unknown'` → rejected.
  - Assert `reason: 'unknown'` → rejected.

### Task 6 — `src/reevaluation/index.ts` — public barrel

- [ ] Create `src/reevaluation/index.ts` exporting:
  - All public types + constants from `state.ts`, `errors.ts`, `plan.ts`, `format.ts`, `json-schemas.ts`.
  - `ReevaluationService` + `ReevaluationServiceOptions` + `ReevaluationExecuteInput` from `service.ts`.
- [ ] No new business logic.

### Task 7 — `src/reevaluation/service.ts` — reevaluation service

- [ ] Create `src/reevaluation/service.ts` exporting:
  - `class ReevaluationService` with:
    - Constructor: `constructor(options: { readonly repositories: Repositories; readonly filterApplyService: FilterApplyService; readonly scoringService: ScoringService; readonly prompts: PipelinePrompts; readonly scoringConcurrency: number; readonly now?: () => Date; readonly logger?: ReevaluationLogger })`.
    - `async execute(input: ReevaluationExecuteInput): Promise<ReevaluationOutcome>`:
      - **(a) Prerequisite validation.** If the scope requires OpenAI (i.e. NOT `--filters-only` and NOT `--dry-run`), require `OPENAI_API_KEY`. Throw `PipelinePrerequisiteError('openai_api_key_missing', ..., MissingRequired)` when missing. Always require active filter config (`PipelinePrerequisiteError('no_active_filter', ..., MissingRequired)`).
      - **(b) Selection.** Call the new `jobs.listComplete()` (Task 9). For each complete job:
        - Compute the current filter fingerprint via the `FilterApplyService.apply()` lookup pattern (the service calls `filterApplyService.apply({ jobId, job, pipelineRunId: null })` which internally computes the fingerprint — Task 7 does NOT compute fingerprints directly). If `apply()` returns `reused: true` → the filter is current. If `reused: false` → the filter is stale or missing.
        - Compute the current score fingerprint by calling `scoringService.scoreOne()` only as a read (the service uses `findActiveByJob(jobId, fingerprint)` for the cache check, so calling `scoreOne()` is wasteful for the dry-run path). **Use a read-only fingerprint check:** call `repositories.filterResults.findActiveByJob(jobId, fingerprint)` for filter staleness (the fingerprint is exposed via `FilterApplyService`'s internal helper, but we add a new pure helper `computeFilterFingerprintForJob(jobRow, filterConfigJson, profileJson)` that mirrors `calculateFilterFingerprint`'s input shape and returns the fingerprint string WITHOUT any DB writes — the service reuses this for both dry-run and live-mode cache checks). For score staleness, call `repositories.scoreResults.findActiveByJob(jobId, fingerprint)` after the score fingerprint is computed by `scoringService.buildScoringPlan`'s helper (the score fingerprint formula is re-implemented as a pure helper `computeScoreFingerprintForJob(jobRow, profileVersion, effectiveDerivedValues, config)` in `src/reevaluation/fingerprint.ts` — new file, mirrors `src/scoring/fingerprint.ts:computeScoreFingerprint`).
        - Apply the scope rules (Decisions 4, 5, 6, 7).
      - **(c) Plan building.** Build the `ScoringPlan` via `scoringService.buildScoringPlan(...)` when at least one score rerun is planned (mirrors TASK-015's `PipelineOrchestrator.buildScoringPlan` at `src/pipeline/orchestrator.ts:426-452`).
      - **(d) Confirmation.** When `!dryRun && scope !== 'filters-only' && plan.scoringPlan?.newOpenAIRequests > 0 && input.confirmScoring`: call `prompts.askScoringConfirmation({ plan })`. If `false`, set `scoringDeclinedByUser = true` and skip the score batch.
      - **(e) Execution.** For each `filtersToReevaluate` entry (non-dry-run only):
        - Call `filterApplyService.apply({ jobId, job, pipelineRunId: null })`. The returned `FilterApplyResult` carries the new fingerprint.
        - If the prior active filter fingerprint differs from the new one AND a prior active score exists, call `scoreResults.invalidateActiveByJob(jobId)` (Task 10). Increment `scoresInvalidated` by the returned count.
      - **(f) Scoring batch.** For each `jobsToScore` entry (non-dry-run AND not declined):
        - Call `scoringService.scoreOne({ ... })` per job (the service uses the same per-job pattern as TASK-015's `PipelineOrchestrator.runScoring` at `src/pipeline/orchestrator.ts:462-530`). The `run` object is synthesized from `runId ?? 0` (a sentinel value — TASK-015's `finalizeRunStats` is NOT called because this is not a pipeline run).
        - Aggregate `totals.complete`, `totals.reused`, `totals.failed` from the `ScoringOutcome`.
      - **(g) Plan return.** Call `buildReevaluationPlan(...)` (Task 3) and return `{ plan }`.
- [ ] Files `src/reevaluation/service.ts` + `src/reevaluation/fingerprint.ts` (Task 7 + helper) import only from `src/{persistence,filter,scoring,pipeline,profile}/`. NO imports from `src/cli/`, `src/linkedin/`, `src/init/`, `src/search/`. The `FilterApplyService`, `ScoringService`, `Repositories`, and `PipelinePrompts` are injected via the constructor.
- [ ] Add `ReevaluationLogger` interface (mirrors `ScoringLogger` from `src/scoring/log.ts`): events `reevaluationStart({ scope, dryRun })`, `reevaluationSelection({ jobCount, skippedCount })`, `reevaluationFilterRerun({ jobId, fingerprint, reused })`, `reevaluationFilterInvalidatedScores({ jobId, count })`, `reevaluationScoreReuse({ jobId, fingerprint })`, `reevaluationScoreComplete({ jobId, overallScore })`, `reevaluationScoreFail({ jobId, errorCode })`, `reevaluationDecline({ scope })`, `reevaluationComplete({ totals })`. Default implementation is `noopReevaluationLogger()`. The service uses the logger in `execute()` for every step. A `PinoReevaluationLogger` adapter is added to `src/logging/reevaluation-logger.ts` and wired through the CLI handler in Task 8 (mirrors the `PipelineLogger` + `PinoPipelineLogger` pattern from TASK-015).

### Task 8 — `src/cli.ts` — `jobs reevaluate` subcommand

- [ ] In `src/cli.ts` (the `jobs` Commander object created at `src/cli.ts:1353`):
  - Add a new `jobs.command('reevaluate')` subcommand (between `jobs show` and the `runs` block at `src/cli.ts:1394`):
    - `.description('Reevaluate stored jobs. Defaults to all complete jobs with stale or missing filter/score results. Supports --filters-only, --scores-only, --job <job-id>, --dry-run, and --yes.')`.
    - `.option('--filters-only', 'Reevaluate only stale or missing filters (no OpenAI calls). Mark dependent scores stale.', false)`.
    - `.option('--scores-only', 'Reevaluate only stale scores; skip jobs whose filter is stale or missing with reason filter_update_required.', false)`.
    - `.option('--job <job-id>', 'Target a single complete job (job_<int> or numeric LinkedIn sourceJobId). May combine with --filters-only, --scores-only, --dry-run.')`.
    - `.option('--dry-run', 'Show the would-be plan with filtering count, scoring count, and skipped reasons. No DB writes, no OpenAI calls.', false)`.
    - `.option('--yes', 'Bypass only the OpenAI scoring confirmation (no effect for --filters-only or --dry-run).', false)`.
    - `.option('--json', 'Emit a single JSON document to stdout.', false)`.
    - `.action(async (options: { filtersOnly: boolean; scoresOnly: boolean; job?: string; dryRun: boolean; yes: boolean; json: boolean }) => { ... })`.
- [ ] Implement the handler `async function jobsReevaluateCommand(options: ...)`:
  - **(a) Flag validation.** If `options.filtersOnly && options.scoresOnly` → throw `ReevaluationValidationError('reevaluate_scope_conflict', 'Cannot combine --filters-only with --scores-only.', { scope: 'conflict' }, InvalidUsage)`. Otherwise `scope = options.filtersOnly ? 'filters-only' : options.scoresOnly ? 'scores-only' : options.job !== undefined ? 'job' : 'default'`.
  - **(b) Identifier resolution.** If `options.job !== undefined`:
    - Call `resolveJobIdentifier(options.job)`.
    - Look up the job via the new `jobsReevaluateLookupJob(repositories, resolution)` helper (added in Task 8; uses `jobs.findById` or `jobs.findBySourceJobId`).
    - If not found → throw `ReevaluationValidationError('job_not_found', ..., { input: options.job }, InvalidUsage)`.
    - If found AND `extractionStatus !== 'complete'` → throw `ReevaluationValidationError('job_not_complete', ..., { jobId: ..., status: ... }, InvalidUsage)`.
  - **(c) Service construction.** Construct the `ReevaluationService` with the same fakes/adapters the run command uses (mirror `runCommand` at `src/cli.ts:666`). The `PinoReevaluationLogger` is wired here.
  - **(d) Execute.** Call `service.execute({ scope, dryRun: options.dryRun, confirmScoring: !options.yes, env: process.env })`. Catch typed errors via `exitWithError`.
  - **(e) Render.** If `options.json` → `JSON.stringify(outcome.plan, null, 2) + '\n'`. Else → `formatReevaluationSummary(plan, process.stdout.columns ?? 120)` + (when `plan.scoringPlan !== null && plan.scoringPlan.newOpenAIRequests > 0`) `formatScoringPlanForReevaluation(plan.scoringPlan, ...)`.
- [ ] The CLI handler is the ONLY place that calls `process.exit` / `process.stdout` / `process.stderr`. The service layer throws typed errors; the handler maps them via `exitWithError`.
- [ ] Verify: `pnpm typecheck` and `pnpm test` succeed. The snapshot in `tests/foundation.test.ts` (which counts subcommands) is updated from `8` → `9`.

### Task 9 — `src/persistence/repositories/jobs.ts` — `listComplete()` method

- [ ] Add `async listComplete(): Promise<readonly JobRow[]>` to `JobRepository` (mirrors `listByState` at `src/persistence/repositories/jobs.ts:510-575`). Implementation: `SELECT * FROM jobs WHERE extraction_status = 'complete' ORDER BY id ASC`.
- [ ] No schema change. No migration.
- [ ] Tests: add 2 cases to `tests/persistence/repositories/jobs.test.ts`:
  - `listComplete()` returns only rows with `extractionStatus === 'complete'`, sorted by `id ASC`.
  - `listComplete()` returns an empty array when no rows exist.

### Task 10 — `src/persistence/repositories/score-results.ts` — `invalidateActiveByJob()` method

- [ ] Add `async invalidateActiveByJob(jobId: number): Promise<number>` to `ScoreResultRepository` (mirrors `FilterResultRepository.invalidateByFilterConfigVersion` at `src/persistence/repositories/filter-results.ts:213-237`). Implementation: in one transaction, count active rows for `jobId`, flip them to `active = false`, return the count. Idempotent.
- [ ] No schema change. No migration.
- [ ] Tests: add 2 cases to `tests/persistence/repositories/score-results.test.ts`:
  - `invalidateActiveByJob(7)` with 3 active rows returns 3 and flips all 3 to `active = false`.
  - Re-running `invalidateActiveByJob(7)` returns 0 (idempotent).
  - Inserting an active row for a different job, then `invalidateActiveByJob(7)` does NOT touch it.

### Task 11 — Tests — boundaries + pure helpers + service + CLI

- [ ] `tests/reevaluation/boundaries.test.ts` (mirrors `tests/inspection/boundaries.test.ts`):
  - Assert no source file under `src/reevaluation/` imports `commander`, `@inquirer/prompts`, `playwright`, the `openai` SDK, or `pino` directly (the boundaries guard mirrors `tests/inspection/boundaries.test.ts`).
  - Allowed imports: `src/persistence/repositories/`, `src/filter/service.js`, `src/scoring/service.js`, `src/scoring/state.js`, `src/scoring/plan.js`, `src/scoring/fingerprint.js`, `src/pipeline/errors.js`, `src/pipeline/prompts.js`, `src/profile/schema.js`, `src/errors/application-error.js`.
  - The `src/reevaluation/service.ts` is the only file that imports `src/filter/service.js` + `src/scoring/service.js` + `src/persistence/repositories/index.js`.
  - The pure layer (`state.ts`, `errors.ts`, `plan.ts`, `format.ts`, `json-schemas.ts`) imports ZERO modules from `src/{filter,scoring,pipeline,persistence}` (the `formatScoringPlan` re-export from `format.ts` is the one allowed `src/pipeline/format.js` import — adjust the guard regex accordingly).
- [ ] `tests/reevaluation/service.test.ts` (mirrors `tests/pipeline/orchestrator.test.ts`):
  - **T1:** Default scope with 2 stale filters + 1 fresh filter + 1 stale score on the third job → plan has `filtersToReevaluate.length === 2`, `jobsToScore.length === 1`, `skipped.length === 0`, `totals.filtersRerun === 2`, `totals.scoresRerun === 1`.
  - **T2:** `--filters-only` with 2 stale filters → plan has `filtersToReevaluate.length === 2`, `jobsToScore.length === 0`, `scoringPlan === null`, no OpenAI calls.
  - **T3:** `--filters-only` with a stale filter AND a prior active score → after the run, the prior score row is flipped to `active = false`, `scoresInvalidated === 1`.
  - **T4:** `--scores-only` with a job whose filter is stale → the job is in `skipped` with `reason: 'filter_update_required'`, `jobsToScore.length === 0`, no OpenAI calls.
  - **T5:** `--scores-only` with a job whose filter is fresh+accepted and score is stale → the job is in `jobsToScore`, OpenAI is called once.
  - **T6:** `--job job_42` where `job_42` is partial → throws `ReevaluationValidationError('job_not_complete', ..., InvalidUsage)`.
  - **T7:** `--job 99999999` (numeric LinkedIn ID) where the job is partial → throws `ReevaluationValidationError('job_not_complete', ..., InvalidUsage)`.
  - **T8:** `--job job_9999` (does not exist) → throws `ReevaluationValidationError('job_not_found', ..., InvalidUsage)`.
  - **T9:** `--job job_42` where `job_42` is complete and stale filter → plan has 1 filter entry, 0 score entries.
  - **T10:** `--job job_42 --filters-only` → valid; runs only filter rerun.
  - **T11:** `--job job_42 --scores-only` → valid; runs only score rerun.
  - **T12:** `--job job_42 --dry-run` → `dryRun: true`, all actions are `'would-rerun'`, no DB writes, no OpenAI calls.
  - **T13:** `--dry-run` (no `--job`) → `dryRun: true`, every action is `'would-rerun'`, no DB writes, no OpenAI calls.
  - **T14:** Default scope with 1 stale score (no filter stale) → plan has 0 filter entries, 1 score entry. `scoringPlan !== null`.
  - **T15:** Default scope + scoring confirmation declined → `totals.scoringDeclinedByUser === true`, `totals.scoresRerun === 0`, no OpenAI calls were made beyond the plan check.
  - **T16:** Default scope + `--yes` → `confirmScoring: false`, no prompt call, scoring proceeds.
  - **T17:** `--filters-only` + `--yes` → `confirmScoring: false` (no OpenAI required), scoring proceeds trivially.
  - **T18:** `--filters-only` + `--scores-only` (CLI handler scope-conflict test) → throws `ReevaluationValidationError('reevaluate_scope_conflict', ..., InvalidUsage)`.
  - **T19:** Missing active filter config → throws `PipelinePrerequisiteError('no_active_filter', ..., MissingRequired)` (exit 3).
  - **T20:** Missing active approved profile (OpenAI-required scope) → throws `PipelinePrerequisiteError('no_active_profile', ..., MissingRequired)` (exit 3).
  - **T21:** Missing `OPENAI_API_KEY` (OpenAI-required scope) → throws `PipelinePrerequisiteError('openai_api_key_missing', ..., MissingRequired)` (exit 3).
  - **T22:** Missing `OPENAI_API_KEY` (filters-only scope) → executes successfully (no OpenAI needed).
  - **T23:** Missing `OPENAI_API_KEY` (dry-run scope) → executes successfully (no OpenAI needed).
- [ ] `tests/cli/jobs-reevaluate.test.ts` (mirrors `tests/cli/jobs-list.test.ts`):
  - `jobs reevaluate --dry-run --json` (empty DB) → valid single JSON document, `schemaVersion === 1`, `scope === 'default'`, `dryRun === true`, `totals.filtersRerun === 0`.
  - `jobs reevaluate --filters-only --scores-only` → exit 2 + stderr contains `reevaluate_scope_conflict`.
  - `jobs reevaluate --job not_a_valid_id` → exit 2 + stderr contains `invalid_identifier`.
  - `jobs reevaluate --job job_9999` → exit 2 + stderr contains `job_not_found`.
  - `jobs reevaluate --json` with 1 stale filter + 1 stale score → valid single JSON document, schema matches the Zod fixture, `totals.filtersRerun === 1`, `totals.scoresRerun === 1`.
  - `jobs reevaluate` (human-readable) → stdout contains `Scope: default`, `Filters to reevaluate: <n>`, `Jobs to score: <n>`, no JSON markers.

### Task 12 — Documentation + commit

- [ ] Update `docs/tasks/TASK-017-explicit-reevaluation.md`:
  - Change `**Status:** Planned; not approved for implementation` → `**Status:** ✅ Implemented (N wave commits on feat/task-017-explicit-reevaluation, see "Implementation results" below)`.
  - Add `**Implementation plan:** docs/superpowers/plans/2026-08-21-task-017-explicit-reevaluation.md`.
  - Append the implementation results section (mirrors TASK-016's Wave A → Wave E summary).
- [ ] Update `README.md` to mention `jobhunter jobs reevaluate` in the command surface list.
- [ ] Commit using the per-wave commit pattern (5 wave commits + 1 squash → main):
  - Wave A: `feat(reevaluation): add reevaluation pure helpers + boundaries guard (TASK-017 W1)` — state.ts, errors.ts, plan.ts, format.ts, json-schemas.ts, index.ts, boundaries.test.ts, plan.test.ts, format.test.ts, json-schemas.test.ts.
  - Wave B: `feat(persistence): add listComplete + invalidateActiveByJob (TASK-017 W2)` — jobs.ts, score-results.ts + their repo unit tests.
  - Wave C: `feat(reevaluation): add reevaluation service (TASK-017 W3)` — service.ts, fingerprint.ts, log.ts, pino-logger.ts, service.test.ts (T1-T23).
  - Wave D: `feat(cli): add jobs reevaluate subcommand (TASK-017 W4)` — cli.ts + jobs-reevaluate.test.ts.
  - Wave E: `chore(tasks): mark TASK-017 implemented + docs (TASK-017 W5)`.
  - Squash to `main`: 6th commit summarizing the 5 wave commits.

## Verification commands

Run after every wave; all must succeed before the next wave starts.

```bash
pnpm typecheck       # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json
pnpm lint            # eslint .
pnpm format:check    # prettier --check .
pnpm test            # vitest run
pnpm build           # tsc -p tsconfig.json (emits dist/cli.js + dist/reevaluation/**/*.js + updated jobs.ts/score-results.ts)
```

## Expected test counts (Wave E final)

| Suite | Files | Pass | Skip |
| --- | --- | --- | --- |
| `tests/reevaluation/` (boundaries + pure helpers) | 5 | ~50 | 0 |
| `tests/reevaluation/service.test.ts` | 1 | 23 | 0 |
| `tests/cli/jobs-reevaluate.test.ts` | 1 | 6 | 0 |
| `tests/persistence/repositories/jobs.test.ts` (incremental) | +1 file | +2 | 0 |
| `tests/persistence/repositories/score-results.test.ts` (incremental) | +1 file | +2 | 0 |
| **TASK-017 added** | **~9** | **~83** | **0** |

## Completion criteria

- `jobs reevaluate` matches the documented default and scope behavior for every supported flag combination (T1–T18 in `service.test.ts`).
- The dry-run preview is a faithful, non-mutating plan of the would-be operations (T12 + T13 + CLI smoke test).
- Scoring confirmation and `--yes` semantics are correct and limited to OpenAI operations (T15, T16, T17).
- `filter_update_required` is reported for `--scores-only` with a stale filter (T4).
- Dependent scores are marked stale after filter reevaluation (T3).
- Exit codes and JSON output (`--dry-run`) conform to TASK-016's contracts (T19–T23 + CLI smoke tests).
- The full project test suite (≥1731 pass) passes with `pnpm test`.

## Known limitations

1. **`ScoringPlan` JSON schema inline.** The reevaluation JSON schema inlines the minimal `ScoringPlan` Zod shape rather than reusing a TASK-014 extraction (TASK-014 kept `ScoringPlan` as an internal-only TypeScript type). This is acceptable because (a) the shape is small, (b) `ScoringPlan` is documented in `src/scoring/state.ts` so the inline definition is unambiguous, and (c) TASK-018 may extract it to `src/scoring/json-schemas.ts` if it surfaces other consumers.

2. **No `runId` synthesis for the reevaluation service.** The reevaluation service accepts `runId?: number | null` and passes `0` as a sentinel to `ScoringService.scoreOne()` when null. The reevaluation is NOT a pipeline run and does NOT call `pipelineRuns.finalizeRunStats`. The persisted `score_results.pipelineRunId` is therefore `0` for reevaluation-scored jobs. This is acceptable because (a) the MVP's pipeline-run-centric model assumes all scoring happens inside a run, (b) the score's `pipelineRunId` is for audit grouping only, (c) `jobs show` + `runs show` already cope with `null`/`0` values (TASK-016), and (d) consumers that need the reevaluation lineage can query `score_results.filterResultId` → `filter_results.id` to find the rerun timestamp. A future task that adds "reevaluation runs" (a `reevaluationRuns` table) can resolve this if needed.

3. **`--job` with a numeric LinkedIn `sourceJobId`** uses `resolveJobIdentifier` → `findBySourceJobId`. The job's `sourceJobId` is the LinkedIn integer, NOT the local integer ID. The `--json` output includes `internalId` (the local primary key) so consumers can correlate.

4. **No new migration, no new schema, no new dependency.** All tables used (`jobs`, `filterResults`, `scoreResults`, `filterConfigurations`, `profileVersions`) already exist (TASK-003). The 2 new repository methods are read+write only for the `score_results` table — no DDL change. `package.json` dependencies are unchanged.

## Open question for approval

Before implementation begins, the user must confirm the plan above (especially Decisions 1, 2, 3, 5, 6, 7, 9, 11, 13, 14, 15, 16, 17). If any decision needs to change, the plan is updated BEFORE the first file is edited.

Per AGENTS.md §2: "Ask for approval. After approval: 1. Implement only that task. 2. Run its tests and verification. 3. Update the task document. 4. Stop before starting another task."

Per AGENTS.md §12: "Ask before: Adding or removing a direct dependency, Changing a public command or JSON contract, Changing a database schema or migration, Expanding the selected task, Deleting tracked non-generated code, Changing approved product behavior." — none of these apply (no new dependency, no schema change, no destructive change). The CLI command `jobs reevaluate` IS a new public command — the SPEC explicitly requires it (§31), so it is in-scope for TASK-017. The JSON shape for `jobs reevaluate --dry-run` IS a new JSON contract — the SPEC explicitly requires it (§36), so it is in-scope.

Approval is requested for the plan as written.
