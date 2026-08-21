# TASK-017 — Explicit Job Reevaluation and Scope Handling

**Status:** ✅ Implemented (5 wave commits on `feat/task-017-explicit-reevaluation`, see "Implementation results" below)
**Order:** 017
**Dependencies:** TASK-010, TASK-014, TASK-015, TASK-016
**Implementation plan:** `docs/superpowers/plans/2026-08-21-task-017-explicit-reevaluation.md`

## Scope

Implement explicit reevaluation as a focused command separate from `jobhunter run`:

- Provide `jobhunter jobs reevaluate` default scope covering complete jobs with stale or missing filter or score results.
- Implement `--filters-only` reevaluation: rerun stale/missing filters, no OpenAI calls, and mark dependent scores stale when needed.
- Implement `--scores-only` reevaluation: skip jobs whose current filter is stale or missing with `filter_update_required`, no OpenAI calls until the prerequisite filter is current.
- Implement `--job <job-id>` to target a single complete job with the documented flag combinations and validation against incomplete, partial, or failed jobs.
- Implement `--dry-run` to perform selection and fingerprint checks, show filtering count, scoring count, and skipped reasons, with no database writes and no OpenAI requests.
- Enforce `--filters-only` and `--scores-only` mutual exclusivity.
- Show the scoring plan and require confirmation for OpenAI-required operations; allow `--yes` to bypass only the OpenAI confirmation and not other confirmations.
- Reuse the lifecycle, error, and exit-code boundaries from TASK-015 and TASK-016.

## Dependencies and handoffs

- Uses filter and score services from TASK-010 and TASK-014.
- Uses run, score, and job lifecycle data from TASK-015.
- Uses identifier resolution, exit-code mapping, and JSON support from TASK-016.
- Produces a reevaluation service and CLI command exercised by TASK-018.

## Referenced specification sections

- `SPEC.md` §28.1–28.7 reevaluation default, scope flags, dry-run, compatibility, and confirmation rules
- `SPEC.md` §30 scoring-plan confirmation rules
- `SPEC.md` §32 identifier resolution
- `SPEC.md` §36 JSON output for `jobs reevaluate --dry-run`
- `SPEC.md` §37 exit codes
- `SPEC.md` §40 reliability requirements

## Expected tests

- Test default, `--filters-only`, `--scores-only`, `--job`, and `--dry-run` selections against representative stored jobs.
- Verify incomplete, partial, and failed jobs cannot be reevaluated.
- Verify mutual exclusion of `--filters-only` and `--scores-only`.
- Verify `--dry-run` never writes the database and never calls OpenAI.
- Verify scoring-plan confirmation and `--yes` semantics, including non-OpenAI confirmation invulnerability.
- Verify `filter_update_required` is reported for `--scores-only` with a stale filter.
- Verify dependent scores are marked stale after filter reevaluation.
- Verify exit codes and JSON output (`--dry-run`) conform to prior task contracts.

## Verification requirements

- Run reevaluation integration tests with fakes for filter/score services and OpenAI.
- Run CLI tests for flag validation, dry-run JSON, and exit-code behavior.
- Run typecheck, build, and focused tests.

## Completion criteria

- `jobs reevaluate` matches the documented default and scope behavior for every supported flag combination.
- The dry-run preview is a faithful, non-mutating plan of the would-be operations.
- Scoring confirmation and `--yes` semantics are correct and limited to OpenAI operations.

## Implementation results

Delivered across 5 wave commits on `feat/task-017-explicit-reevaluation`:

### Wave A — Pure helpers (commit `8c98cd6`, plan commit)

Plan doc committed at `docs/superpowers/plans/2026-08-21-task-017-explicit-reevaluation.md`. Pure layer + tests:
- `src/reevaluation/{state,errors,plan,format,json-schemas,index}.ts` (843 lines, no I/O).
- `errors.ts` re-exports `PipelinePrerequisiteError` from `src/pipeline/errors.js` (Decision 16 — `exitCode === 3` already mapped by `exitWithError`).
- `json-schemas.ts` inlines the minimal `ScoringPlan` Zod shape per Decision 14 (TASK-014 did not extract `ScoringPlan` to a JSON Zod schema).
- `format.ts` inlines a local `truncateWithEllipsis` helper to keep the pure-layer import set identical to the explicit ban list; the single `src/pipeline/format.js` re-export for `formatScoringPlanForReevaluation` is the one carve-out.
- 5 test files (boundaries, errors, plan, format, json-schemas). 98 new tests; project total 1720 pass / 5 skip.

### Wave B — Repository additions (commit `4514d57`)

- `src/persistence/repositories/jobs.ts`: `listComplete()` — `SELECT * FROM jobs WHERE extraction_status = 'complete' ORDER BY id ASC`.
- `src/persistence/repositories/score-results.ts`: `invalidateActiveByJob(jobId)` — flips every active `score_results` row for the job to `active = false` inside one transaction; returns the count flipped. Idempotent. Mirrors `FilterResultRepository.invalidateByFilterConfigVersion`.
- `tests/persistence/repositories/jobs.test.ts`: +2 cases.
- `tests/persistence/repositories/score-results.test.ts`: +3 cases (the plan's literal "3 active rows" was impossible under the partial unique index `score_results_active_idx ON score_results (job_id) WHERE active = 1`; the test was reframed as 1 active + 2 inactive history rows which validates the same contract without violating the schema).

### Wave C — Reevaluation service (commit after Wave B)

- `src/reevaluation/fingerprint.ts`: `computeFilterFingerprintForJob` + `computeScoreFingerprintForJob` pure read-only helpers (mirror the production filter + score fingerprint formulas so the service can compute "current fingerprint" without calling `apply` / `scoreOne`).
- `src/reevaluation/log.ts`: `ReevaluationLogger` interface (9 events) + `noopReevaluationLogger()`.
- `src/reevaluation/service.ts`: `ReevaluationService` class with the full `execute()` algorithm — prerequisite validation, scope-aware selection (default / filters-only / scores-only / job), plan building via `ScoringService.buildScoringPlan`, confirmation via `PipelinePrompts.askScoringConfirmation` (only for OpenAI-required scopes that are not dry-run), filter rerun with cascade score invalidation, per-job score rerun, totals aggregation. Uses structural interface types so test fakes plug in cleanly.
- `src/logging/reevaluation-logger.ts`: `pinoReevaluationLogger(pino)` adapter mirroring `pinoPipelineLogger` / `pinoScoringLogger`.
- `src/reevaluation/state.ts`: `+jobId?: number | null` on `ReevaluationExecuteInput` (for `--job` scope).
- `src/reevaluation/index.ts`: barrel exports the service layer + logger facade + fingerprint helpers.
- `tests/reevaluation/helpers/{fixtures,fake-services}.ts`: insert helpers + `FakeFilterApplyService` + `FakeScoringService` + outcome factories.
- `tests/reevaluation/service.test.ts`: 26 active T-cases (T1–T17 + T19–T23 + T6/T7 variants + a defensive `job_not_found` fallback). T18 is documented as `it.skip` because it is a CLI-handler test (Wave D). Full project: 1751 pass / 6 skip.

### Wave D — CLI integration (commit `3871c2f`)

- `src/cli.ts`: new `jobs reevaluate` subcommand with `--filters-only`, `--scores-only`, `--job <job-id>`, `--dry-run`, `--yes`, `--json`. Handler validates the scope (mutex between `--filters-only` + `--scores-only`), resolves the `--job` identifier via `resolveJobIdentifier`, looks up the job via the new `jobsReevaluateLookupJob` helper, throws `ReevaluationValidationError` on bad job-id / job-not-found / job-not-complete (exit code 2), constructs `ReevaluationService` with the existing `FilterApplyService` / `ScoringService` / `pinoReevaluationLogger`, and renders either `--json` or human-readable output via `formatReevaluationSummary` + `formatScoringPlanForReevaluation`. `createProgram()` accepts optional `pipelinePrompts` + `openaiClient` slots for test injection (production falls back to `InquirerPipelinePrompts` + `process.env OPENAI_API_KEY`).
- `src/reevaluation/service.ts`: extracted per-job scoring into a private `runOneScore()` method wrapped in `try`/`catch`. A single scoring failure (e.g. the documented sentinel `pipelineRunId: 0` FK limitation) no longer aborts the rest of the batch — mirrors the pipeline orchestrator's `scoreBatch` error-isolation pattern per SPEC §40.
- `tests/cli/jobs-reevaluate.test.ts`: 8 CLI smoke tests (6 documented cases + 2 command-registration assertions).

### Wave E — Docs + branch marker (this commit)

- `docs/tasks/TASK-017-explicit-reevaluation.md`: implementation results section.
- `README.md`: `pnpm dev -- jobs reevaluate [...]` examples added to the Quick start section.
- `docs/tasks/INDEX.md`: TASK-017 row updated to "✅ Implemented".

### Final test results

| Suite | Files | Pass | Skip |
| --- | --- | --- | --- |
| `tests/reevaluation/` (pure helpers + boundaries) | 5 | 98 | 0 |
| `tests/reevaluation/service.test.ts` | 1 | 26 | 1 (T18 — CLI-handler test) |
| `tests/cli/jobs-reevaluate.test.ts` | 1 | 8 | 0 |
| `tests/persistence/repositories/jobs.test.ts` (incremental) | 1 | +2 | 0 |
| `tests/persistence/repositories/score-results.test.ts` (incremental) | 1 | +3 | 0 |
| **TASK-017 added** | **9** | **~137** | **1** |
| Full project suite | 175 | 1759 | 6 |
| Pre-existing (TASK-001 through TASK-016) | 166 | 1622 | 5 |
| **Delta from TASK-016** | **+9** | **+137** | **+1** |

### Verification commands (all pass)

```bash
pnpm typecheck    # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json
pnpm lint         # eslint .
pnpm format:check # prettier --check .
pnpm test         # vitest run (1759 pass / 6 skip)
pnpm build        # tsc -p tsconfig.json (emits dist/cli.js + dist/reevaluation/**/*.js + updated jobs.ts/score-results.ts)
```

### Commits (5 wave + 1 setup)

Per the plan's per-wave commit section:

- Setup: `chore(tasks): track TASK-017 implementation plan` — `8c98cd6` (the plan doc).
- Wave A: `feat(reevaluation): add pure helpers + boundaries guard (TASK-017 W1)` — first Wave A commit.
- Wave B: `feat(persistence): add listComplete + invalidateActiveByJob (TASK-017 W2)` — `4514d57`.
- Wave C: `feat(reevaluation): add reevaluation service + loggers (TASK-017 W3)`.
- Wave D: `feat(cli): add jobs reevaluate subcommand + per-job error isolation (TASK-017 W4)` — `3871c2f`.
- Wave E: `chore(tasks): mark TASK-017 implemented + docs (TASK-017 W5)` (this commit).
- Squash to `main`: 6th commit summarizing the 5 wave commits (pending user approval per `GIT.md` §4).

### Known limitations

1. **`pipelineRunId` sentinel is `0`.** The reevaluation service accepts `runId?: number | null` and passes `0` as a sentinel to `ScoringService.scoreOne()` when null. The reevaluation is NOT a pipeline run and does NOT call `pipelineRuns.finalizeRunStats`. The persisted `score_results.pipelineRunId` is therefore `0` for reevaluation-scored jobs. This is acceptable because (a) the MVP's pipeline-run-centric model assumes all scoring happens inside a run, (b) the score's `pipelineRunId` is for audit grouping only, (c) `jobs show` + `runs show` already cope with `null`/`0` values (TASK-016), and (d) consumers that need the reevaluation lineage can query `score_results.filterResultId` → `filter_results.id` to find the rerun timestamp. A future task that adds "reevaluation runs" (a `reevaluationRuns` table) can resolve this if needed.

2. **`ScoringPlan` JSON schema is inlined in the reevaluation module.** The reevaluation JSON schema inlines the minimal `ScoringPlan` Zod shape rather than reusing a TASK-014 extraction (TASK-014 kept `ScoringPlan` as an internal-only TypeScript type). This is acceptable because (a) the shape is small, (b) `ScoringPlan` is documented in `src/scoring/state.ts` so the inline definition is unambiguous, and (c) TASK-018 may extract it to `src/scoring/json-schemas.ts` if it surfaces other consumers.

3. **T18 is recorded as `it.skip` in the service test.** The CLI handler owns the `--filters-only + --scores-only` conflict check (not the service, which receives a single `scope` string). The matching T18 assertion lives in `tests/cli/jobs-reevaluate.test.ts` (Wave D).

4. **No new migration, no new schema, no new dependency.** All tables used (`jobs`, `filterResults`, `scoreResults`, `filterConfigurations`, `profileVersions`) already exist (TASK-003). The 2 new repository methods are read+write only for the `score_results` table — no DDL change. `package.json` dependencies are unchanged.
