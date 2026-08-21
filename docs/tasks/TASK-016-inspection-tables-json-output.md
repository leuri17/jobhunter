# TASK-016 — Job/Run Inspection, Adaptive Tables, JSON Output, and Exit Codes

**Status:** ✅ Implemented (5 wave commits on `feat/task-016-inspection-tables-json-output`, see "Implementation results" below)
**Order:** 016
**Dependencies:** TASK-004, TASK-014, TASK-015
**Implementation plan:** `docs/superpowers/plans/2026-08-20-task-016-inspection-tables-json-output.md`

## Scope

Implement read-only inspection and presentation commands:

- Implement `jobs list` state flags, mutual exclusivity, default `--scored` behavior, refinement filters, stable sorting, limits, and adaptive columns.
- Implement `jobs show <job-id>` with complete job, extraction, discovery, current filter, current score, explanations, history availability, and timestamps.
- Implement `runs list` and `runs show` with required run/search/count/error/cancellation/configuration details.
- Resolve user-facing identifiers and source IDs using TASK-004 contracts.
- Read terminal width, truncate only rendered fields with ellipses, preserve essential columns, and expose full values through show commands.
- Implement `--json` for the documented read-only commands with `schemaVersion`, complete untruncated values, ISO dates, and exactly one JSON document on stdout.
- Route logs and human-readable errors away from JSON stdout.
- Map typed application errors to the documented exit codes at the CLI boundary.

Interactive configuration, profile editing, scraping, filtering, scoring, and reevaluation behavior are not reimplemented here.

## Dependencies and handoffs

- Uses repository query contracts from TASK-004.
- Consumes current score/ranking projections from TASK-014.
- Consumes finalized run lifecycle data from TASK-015.
- Produces presentation services and JSON schemas used by TASK-017 and TASK-018.

## Referenced specification sections

- `SPEC.md` §31 CLI command surface and validation rules
- `SPEC.md` §32 CLI identifiers and resolution
- `SPEC.md` §34.1–34.6 job listing flags, definitions, sorting, columns, and width behavior
- `SPEC.md` §35 job/run inspection
- `SPEC.md` §36 machine-readable output
- `SPEC.md` §37 exit codes
- `SPEC.md` §41.1 CLI/table/JSON/exit-code unit expectations

## Expected tests

- Test every state flag and mutual exclusion rule, default state, refinement validation, normalized company/location matching, and run scoping.
- Test each documented state sort and canonical tie-breaker.
- Test adaptive column selection and deterministic width fallback without mutating stored values.
- Test full-value `jobs show` output and required run summaries.
- Validate every supported JSON response schema, top-level version, ISO dates, and complete values.
- Verify `--json` stdout contains no tables, prompts, progress, logs, or partial error JSON.
- Verify invalid usage, missing dependencies, access blocking, OpenAI account failures, cancellation, and unexpected failures map to exact exit codes.

## Verification requirements

- Run presentation unit tests with fixed terminal widths and fixture data.
- Run CLI integration tests capturing stdout, stderr, and exit status separately.
- Run JSON parsing checks on every supported command shape.
- Run typecheck, build, and focused CLI tests.

## Completion criteria

- Users can inspect jobs and runs in human-readable terminal output with documented states and columns.
- Supported read-only commands produce stable versioned JSON with clean stdout.
- Exit-code mapping is centralized at the CLI boundary and verified for all documented categories.

## Implementation results

Delivered across 5 wave commits on `feat/task-016-inspection-tables-json-output`:

### Wave A — Pure helpers (commit `e7a0788`)

7 new files under `src/inspection/` (no existing files modified):
- `state.ts` (407 lines): `INSPECTION_SCHEMA_VERSION`, `JobListState` (9-variant union), `JobListRow` discriminated union (9 variants), `JobListResult`, `JobShowPayload`, `RunListRow`, `RunShowPayload`, `ColumnSpec`, `PipelineRunSearchExecutionRow`, `JOB_LIST_STATES`.
- `errors.ts` (94 lines): `InspectionError` + 3 subclasses (`InspectionValidationError` = exit 2, `InspectionNotFoundError` = exit 2, `InspectionResourceNotFoundError` = exit 1).
- `columns.ts` (220 lines): `selectColumns(state, terminalWidth)` with priority-based drop logic; `DEFAULT_TERMINAL_WIDTH = 120`.
- `truncate.ts` (47 lines): `truncateWithEllipsis(text, maxWidth)` (U+2026); preserves stored values.
- `format.ts` (487 lines): `formatJobListTable`, `formatJobShow`, `formatRunListTable`, `formatRunShow`; no I/O, no banned deps.
- `json-schemas.ts` (518 lines): Zod schemas with `schemaVersion: 1` + `.strict()` + ISO 8601 timestamps.
- `index.ts` (74 lines): public barrel.

### Wave B — Services (commit `97f9f47`)

4 read-only repository additions + 4 new service files + barrel update:
- `src/persistence/repositories/jobs.ts`: `JobListRowFilter`, `listByState(filter)`, `findBySourceJobIdOrId(identifier)`, `discoveryErrorCountByRun(runId)`.
- `src/persistence/repositories/pipeline-runs.ts`: `listRecent(limit)`, `findWithDetails(id)`, `PipelineRunDetails` interface.
- `src/persistence/repositories/score-results.ts`: `listActiveByRun(pipelineRunId)`.
- `src/inspection/services/jobs-list-service.ts` (682 lines): `JobsListService.list(input)` with state validation, refinements, --run scope, per-state mappers, `sortJobListRows` per SPEC §34.4.
- `src/inspection/services/jobs-show-service.ts` (225 lines): `JobsShowService.show(identifier)` resolving `job_<int>` or numeric LinkedIn sourceJobId, full payload assembly.
- `src/inspection/services/runs-list-service.ts` (95 lines): `RunsListService.list(opts)` with `summariseSearchErrors`.
- `src/inspection/services/runs-show-service.ts` (260 lines): `RunsShowService.show(identifier)` with parallel reads, 11 documented sections.

### Wave C — CLI integration (commit `91189aa`)

`src/cli.ts` (+378 lines):
- 4 new subcommands: `jobs list`, `jobs show <job-id>`, `runs list`, `runs show <run-id>` — all support `--json`.
- Existing `paths` subcommand gains `--json` flag.
- State-flag mutex + default-to-`scored` logic at the CLI boundary.
- All handlers reuse the existing `exitWithError` helper for typed-error → exit-code mapping.
- Side effect: `tests/foundation.test.ts` snapshot updated 6 → 8 commands.

Smoke-verified exit codes (all match SPEC §37):
- `jobs list --all --scored` → exit 2 + `jobs_list_state_conflict`
- `jobs list --limit 0` → exit 2 + `jobs_list_invalid_limit`
- `jobs list --min-score 150` → exit 2 + `jobs_list_invalid_min_score`
- `jobs list --run foo` → exit 2 + `jobs_list_invalid_run_id`
- `jobs show not_a_valid_id` → exit 2 + `jobs_show_invalid_identifier`
- `jobs show job_9999` → exit 2 + `jobs_show_not_found`
- `runs show run_9999` → exit 2 + `runs_show_not_found`
- `runs show not_a_valid_id` → exit 2 + `runs_show_invalid_identifier`
- `paths --json` → valid single JSON document
- `jobs list --json` (empty DB) → valid single JSON document

### Wave D — Tests (commit `4d3c99c`)

14 new test files + 1 hermetic harness + 1-line source fix:
- **Pure-helper tests** (5 files, 111 tests): `columns.test.ts`, `truncate.test.ts`, `format.test.ts`, `json-schemas.test.ts`, `boundaries.test.ts`.
- **Service tests** (4 files + 1 harness, 35 tests): `helpers/inspection-harness.ts`, `jobs-list-service.test.ts`, `jobs-show-service.test.ts`, `runs-list-service.test.ts`, `runs-show-service.test.ts`.
- **CLI integration tests** (5 files, 23 tests): `jobs-list.test.ts`, `jobs-show.test.ts`, `runs-list.test.ts`, `runs-show.test.ts`, `paths-json.test.ts`.
- **Source fix** (src/cli.ts): `jobsShowCommand` + `runsShowCommand` JSON output now wraps with `{ schemaVersion: 1, ...payload }` per SPEC §36. The other commands already had this; show was missed in Wave C. Locked by `expect(parsed.schemaVersion).toBe(1)` assertions in both CLI tests.

### Final test results

| Suite | Files | Pass | Skip |
| --- | --- | --- | --- |
| `tests/inspection/` (pure helpers) | 5 | 111 | 0 |
| `tests/inspection/services/` (services) | 4 | 35 | 0 |
| `tests/cli/{jobs-list,jobs-show,runs-list,runs-show,paths-json}.test.ts` | 5 | 23 | 0 |
| **TASK-016 added** | **14** | **169** | **0** |
| Full project suite | 167 (169) | 1618 | 5 |
| Pre-existing (TASK-001 through TASK-015) | 152 | 1449 | 5 |
| **Delta from TASK-015** | **+15** | **+169** | **0** |

### Verification commands (all pass)

```bash
pnpm typecheck    # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json
pnpm lint         # eslint .
pnpm format:check # prettier --check .
pnpm test         # vitest run (1618 pass / 5 skip)
pnpm build        # tsc -p tsconfig.json (emits dist/cli.js + dist/inspection/**/*.js)
```

### Commits (5 wave + squash)

- Wave A: `feat(inspection): add pure helpers + state vocabulary (TASK-016 W1)` — `e7a0788`
- Wave B: `feat(inspection): add jobs list/show + runs list/show services (TASK-016 W2)` — `97f9f47`
- Wave C: `feat(cli): add jobs/runs inspection subcommands + paths --json (TASK-016 W3)` — `91189aa`
- Wave D: `test(inspection): add boundaries, pure-helper, service, CLI tests (TASK-016 W4)` — `4d3c99c`
- Wave E: `chore(tasks): mark TASK-016 implemented + docs (TASK-016 W5)` (this commit)
- Squash to `main`: 6th commit summarizing the 5 wave commits.

## Known limitations

1. **`--failed` state requires `--run`**: A `jobs list --failed` invocation without `--run` returns an empty list (the `discoveryErrors` table is indexed by `pipelineRunId`, so no global scan is possible without one). The CLI handler does not warn about this; it just shows `(no jobs)` or `jobs: []` in JSON. Users wanting to enumerate ALL discovery errors across all runs must provide the run id. This is acceptable per SPEC §34.1 (which scopes the `failed` state to a particular run) and per the no-future-task-work rule (no cross-run scan is added).

2. **`JobListRowFilterErrors.errorCode` synthesized**: The persisted `filter_results` table has no per-rule `errorCode` column (only `overallOutcome: 'accepted' | 'rejected' | 'error'`). The service synthesises the literal string `'filter_error'` for every filter-errors row. The plan does not request adding such a column. The OpenAI scoring error codes are persisted on `score_results.errorCode` and surface correctly.

3. **`JobListRowUnscored` has no `firstDiscoveredAt`**: The `JobListRowUnscored` shape per SPEC §34.5 omits the `firstDiscoveredAt` field (only `lastAttemptAt` is documented). The `sortJobListRows('unscored', ...)` therefore falls back to `sourceJobId ASC` as the only tie-breaker.

4. **No new schema / no new migration**: All tables used (`pipelineRuns`, `searchExecutions`, `jobs`, `discoveryEvents`, `discoveryErrors`, `extractionAttempts`, `filterResults`, `scoreResults`, `diagnosticArtifacts`) already exist (TASK-003). The 6 repository additions are read-only.

5. **No new direct dependency**: `package.json` dependencies are unchanged. New code uses the existing `zod`, `drizzle-orm`, `better-sqlite3`, `commander`, `@inquirer/prompts`, `pino`, `vitest` stack.
