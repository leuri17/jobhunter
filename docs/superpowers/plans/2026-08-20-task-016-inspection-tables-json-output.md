# TASK-016 Implementation Plan — Job/Run Inspection, Adaptive Tables, JSON Output, and Exit Codes

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implement the read-only inspection commands (`jobs list`, `jobs show <job-id>`, `runs list`, `runs show <run-id>`) plus `paths --json`, with adaptive human-readable tables, machine-readable `--json` output, and centralized CLI exit-code mapping (SPEC §31, §32, §34.1–34.6, §35, §36, §37, §41.1). The pipeline orchestrator, scoring service, filter service, and LinkedIn services are NOT reimplemented — TASK-016 only CONSUMES their persisted state via the existing repositories.

**Architecture:** A new `src/inspection/` sibling of `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/`, `src/profile/`, `src/pipeline/` houses the read-only presentation layer. The pure layer (`src/inspection/{state,errors,columns,truncate,format,json-schemas}.ts`) has no I/O — it operates on plain row shapes returned by the service layer. The service layer (`src/inspection/services/{jobs-list,jobs-show,runs-list,runs-show}-service.ts`) composes the existing repositories (`JobRepository`, `PipelineRunRepository`, `FilterResultRepository`, `ScoreResultRepository`, `DiagnosticArtifactRepository`, `ApplicationMetadataRepository`) into the four documented inspection payloads. The CLI handler in `src/cli.ts` owns the `--json` flag, terminal-width detection, and exit-code mapping; the existing `exitWithError` function (already used by every other subcommand) is reused unchanged. No new schema, no new migration, no new direct dependency, no new LLM provider, no new scraping. The orchestrator NEVER calls `process.exit`; the CLI handler does.

**Tech Stack:** No new dependencies. Reuses the foundation wired by TASK-001/002/003/004/005/006/007/008/009/010/011/012/013/014/015: `commander`, `@inquirer/prompts`, `drizzle-orm@0.45.2`, `better-sqlite3@13.0.3`, `zod`, `pino@10.3.1`, `vitest`. The terminal-width detection uses `process.stdout.columns ?? 120` (the same fallback the existing `formatTopNTable` uses at `src/pipeline/format.ts:60`). Identifier resolution reuses `resolveJobIdentifier` (`src/persistence/identifiers.ts:134-152`) and `parsePrefixedId` (`src/persistence/identifiers.ts:105-127`).

## Open decisions confirmed before implementation

These map to SPEC §31 + §32 + §34 + §35 + §36 + §37 + §41.1. The implementing agent must stop and ask the user to confirm all 14 resolutions before any file in `src/inspection/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Module location | New `src/inspection/` (sibling of `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/`, `src/profile/`, `src/pipeline/`). Layout: `state.ts`, `errors.ts`, `columns.ts`, `truncate.ts`, `format.ts`, `json-schemas.ts`, `index.ts`, plus `services/{jobs-list,jobs-show,runs-list,runs-show}-service.ts`. The existing `formatTopNTable` (`src/pipeline/format.ts:40-68`) is REUSED unchanged for the post-run top-N output; the new `format.ts` houses the per-state adaptive table formatters. | §5, AGENTS.md §5 |
| 2 | State vocabulary | `INSPECTION_SCHEMA_VERSION = 1`. `JobListState` is the union `'all' \| 'scored' \| 'accepted' \| 'rejected' \| 'unscored' \| 'partial' \| 'failed' \| 'filter-errors' \| 'scoring-errors'` (matches SPEC §34.1). `JobListRow` is the discriminated union per state (the column shape differs per state per SPEC §34.5). `JobShowPayload` is the full job + history + current filter + current score + explanations + timestamps. `RunListRow` / `RunShowPayload` mirror the same pattern. NO new vocabulary outside this module. | §31, §34, §35 |
| 3 | `--json` schema version | `schemaVersion: 1` (matches `PIPELINE_SCHEMA_VERSION` and `LINKEDIN_SCORING_SCHEMA_VERSION`). Every top-level JSON response carries `schemaVersion` as the first key (SPEC §36). | §36 |
| 4 | Default state | `jobs list` with no state flag is equivalent to `--scored` (SPEC §34.1). The CLI handler maps `state === undefined` → `'scored'` BEFORE calling the service. | §34.1 |
| 5 | State flag mutex | Commander parses flags as boolean; the CLI handler asserts `Object.entries({...}).filter(([, v]) => v).length <= 1` BEFORE calling the service. Multiple state flags → `ValidationError('jobs_list_state_conflict', 'Only one state flag may be supplied.', {}, InvalidUsage = exit 2)`. | §34.1 |
| 6 | Refinement validation | `--limit` (positive integer, default 50) → invalid → `ValidationError('jobs_list_invalid_limit', ..., InvalidUsage)`. `--min-score` (0-100 number) → invalid → `ValidationError('jobs_list_invalid_min_score', ..., InvalidUsage)`. `--min-score` only applies to states containing successful scores (`'all'`, `'scored'`, `'accepted'`, `'rejected'`); for others it's silently ignored. `--company` / `--location` are normalized case-insensitive substring matches (use `String.prototype.toLowerCase().includes(...)`). `--run` accepts `run_<int>` and rejects numeric-only input (runs use the prefixed form). | §34.3, §32 |
| 7 | Sort rules | The pure helper `sortJobListRows(state, rows)` implements SPEC §34.4 exactly: `--scored` → `overallScore DESC` then `sourceJobId ASC`; `--accepted` / `--rejected` → `filteredAt DESC` then `sourceJobId ASC`; `--unscored` → `firstDiscoveredAt DESC` then `sourceJobId ASC`; `--partial` → `firstDiscoveredAt DESC` then `sourceJobId ASC`; `--failed` → `discoveryErrorTimestamp DESC` then `discoveryErrorId ASC`; `--filter-errors` → `lastFilterAttempt DESC` then `sourceJobId ASC`; `--scoring-errors` → `lastScoringAttempt DESC` then `sourceJobId ASC`; `--all` → `firstDiscoveredAt DESC` then `sourceJobId ASC`. Full-precision `overallScore` (NOT the display-rounded value) drives the sort. | §34.4 |
| 8 | Adaptive columns | The pure helper `selectColumns(state, terminalWidth): readonly ColumnSpec[]` implements SPEC §34.5 + §34.6. Fixed headers per state (the documented column order). For each column, a `maxWidth` derived from `terminalWidth` minus the sum of the other columns' minimum widths. When a column's max width < header length + 1 → drop the column (lowest priority first). The `First discovered` / `Discovered` / `Last attempt` / `Filtered at` columns share the same ISO-timestamp truncation strategy (24 chars max). The `Title` / `Company` / `Location` columns truncate with ellipsis. The `ID` / `Score` columns are NEVER truncated (essential per §34.6). | §34.5, §34.6 |
| 9 | Truncation | The pure helper `truncateWithEllipsis(text, maxWidth)` returns `text` unchanged when `text.length <= maxWidth`; otherwise `text.slice(0, maxWidth - 1) + '…'`. The stored value is NEVER mutated (SPEC §34.6 "preserve full stored values"). `jobs show` always prints the FULL value via `formatJobShow` (no width budget). | §34.6 |
| 10 | `--json` output | `jobs list --json` emits `{ schemaVersion: 1, state, filters: { minimumScore, company, location, runId }, limit, returned, jobs: [...] }` (SPEC §36 example). Every `jobs[i]` entry includes `id`, `internalId`, `sourceJobId`, the per-state fields (e.g. `overallScore` + `displayScore` for `--scored`), and `firstDiscoveredAt` as ISO 8601. The full value is included — no truncation in `--json`. The CLI handler writes the JSON via `JSON.stringify(payload, null, 2) + '\n'` — exactly one document. | §36 |
| 11 | Error handling for `--json` | When a `--json` command fails with a typed `ApplicationError`, the CLI handler (a) writes `<code>: <message>` to stderr (mirrors `exitWithError` at `src/cli.ts:152-164`), (b) exits with the typed error's exit code, (c) writes NOTHING to stdout. No partial JSON is ever written. The handler does NOT pre-validate JSON payload shape against the Zod schema (the schema is for tests + consumers; the producer trusts the service output). | §36, §37, AGENTS.md §10 |
| 12 | Exit codes | Reuses the existing `ExitCode` enum (`src/errors/application-error.ts:1-9`): `Success: 0`, `Fatal: 1`, `InvalidUsage: 2`, `MissingRequired: 3`, `LinkedInBlocked: 4`, `OpenAIFailure: 5`, `UserCancellation: 130`. New typed errors: `InspectionValidationError` (InvalidUsage), `InspectionNotFoundError` (InvalidUsage — used for unknown job-id / run-id), `InspectionResourceNotFoundError` (Fatal — used when a referenced row's dependent row is missing; mirrors TASK-009's pattern). NO new exit codes. | §37 |
| 13 | CLI integration | The CLI handler in `src/cli.ts` adds four subcommands: `jobs list` (state flags, refinement flags, `--json`), `jobs show <job-id>` (`--json`), `runs list` (`--limit`, `--json`), `runs show <run-id>` (`--json`). The existing `paths` subcommand gains a `--json` flag (SPEC §36). All four reuse the existing `exitWithError` helper. The CLI handler is the ONLY place that calls `process.stdout.columns`. | §31, §36 |
| 14 | Tests | `tests/inspection/{boundaries,columns,truncate,format,json-schemas}.test.ts` (pure helpers). `tests/inspection/services/{jobs-list,jobs-show,runs-list,runs-show}-service.test.ts` (services with real DB via the existing `:memory:` SQLite + migrations pattern from `tests/helpers/run-harness.ts:73-191`). `tests/cli/{jobs-list,jobs-show,runs-list,runs-show,paths-json}.test.ts` (CLI wiring using the existing `createProgram()` pattern from `tests/cli/profile-list.test.ts:57-72`). NO live LinkedIn, NO live OpenAI. | §41.1 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system. `package.json` dependencies are unchanged.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/inspection/` — with **no carve-outs needed** (the module has no interactive prompts, no browser session, no OpenAI client) — **must not** import Commander, Inquirer, Playwright, Drizzle directly, the `openai` SDK, or Pino directly. The pure layer (`src/inspection/{state,errors,columns,truncate,format,json-schemas}.ts`) operates on plain row shapes (the boundary between the service layer and the formatter). The service layer (`src/inspection/services/*.ts`) is the ONLY module under `src/inspection/` that imports `src/persistence/repositories/`. The CLI handler in `src/cli.ts` is the ONLY module that imports both `src/inspection/` AND `commander` / `@inquirer/prompts`.
- **Validation:** Zod at the JSON boundary. `INSPECTION_JSON_SCHEMA` (a `z.object` shape per `src/inspection/json-schemas.ts`) is the schema for the JSON output. The JSON contracts are validated in tests via `INSPECTION_JSON_SCHEMA.safeParse(payload)`.
- **Errors:** Typed errors extending `ApplicationError`. New error codes live in `src/inspection/errors.ts`. Exit-code mapping follows Decision 12.
- **History preservation (AGENTS.md §6):** All inspection commands are READ-ONLY — no row is ever INSERTed, UPDATEd, or DELETEd by `src/inspection/`. The CLI handler's `--json` flag and the service layer never call `process.exit`; the CLI boundary does.
- **Determinism:** The pure helpers are pure functions of their inputs. The `sortJobListRows` sort is stable (Node's `Array.prototype.sort` is stable per ECMA-262). The terminal-width fallback is `120` (mirrors `src/pipeline/format.ts:60`).
- **Tests:** Vitest. Pure-helper tests are deterministic and unit-style. Service tests use `:memory:` SQLite + migrations (mirrors `tests/helpers/run-harness.ts:78-81`). CLI smoke tests use `process.exit` / `stdout` / `stderr` capture as in TASK-009 / TASK-010 / TASK-011.
- **JSON output discipline (AGENTS.md §10):** `--json` emits exactly ONE valid JSON document to stdout; logs + human-readable errors go to stderr; values are never truncated. The JSON shape is documented in Decision 10 + the test fixtures.
- **No new schema/migration:** All tables used (`pipelineRuns`, `searchExecutions`, `jobs`, `discoveryEvents`, `discoveryErrors`, `extractionAttempts`, `filterResults`, `scoreResults`, `diagnosticArtifacts`, `applicationMetadata`) already exist (TASK-003). The plan MUST NOT add DDL.
- **No new CLI subcommand surface:** `jobs list`, `jobs show <job-id>`, `runs list`, `runs show <run-id>` are the only new subcommands. The `paths --json` flag is the only new flag on an existing command. NO new aliases.

## Reconciler facts (from existing code review)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and are not re-litigated in this plan.

- **`JobRepository.findById(id)`** returns a `JobRow | null` (`src/persistence/repositories/jobs.ts:261-265`).
- **`JobRepository.findBySourceJobId(sourceJobId)`** returns a `JobRow | null` (`src/persistence/repositories/jobs.ts:255-259`).
- **`JobRepository.listDiscoveryEventsByJob(jobId)`** returns `readonly DiscoveryEventRow[]` (`src/persistence/repositories/jobs.ts:381-388`).
- **`JobRepository.listExtractionAttemptsByJob(jobId)`** returns `readonly ExtractionAttemptRow[]` (`src/persistence/repositories/jobs.ts:469-476`).
- **`JobRepository.listDiscoveryErrorsByRun(runId)`** returns `readonly DiscoveryErrorRow[]` (`src/persistence/repositories/jobs.ts:439-446`).
- **`PipelineRunRepository.findRunById(id)`** returns `PipelineRunRow | null` (`src/persistence/repositories/pipeline-runs.ts:227-231`).
- **`PipelineRunRepository.listRuns(opts?: { status? })`** returns `readonly PipelineRunRow[]` (`src/persistence/repositories/pipeline-runs.ts:233-238`).
- **`PipelineRunRepository.listSearchesByRun(pipelineRunId)`** returns `readonly SearchExecutionRow[]` (`src/persistence/repositories/pipeline-runs.ts:284-291`).
- **`FilterResultRepository.findActiveByJob(jobId, fingerprint)`** returns `FilterResultRow | null` (`src/persistence/repositories/filter-results.ts:111-125`).
- **`ScoreResultRepository.findActiveByJob(jobId, fingerprint)`** returns `ScoreResultRow | null` (`src/persistence/repositories/score-results.ts:141-155`).
- **`ScoreResultRepository.listByRun(pipelineRunId)`** returns `readonly ScoreResultRow[]` (`src/persistence/repositories/score-results.ts:168-175`).
- **`DiagnosticArtifactRepository.listByRun(pipelineRunId)`** returns `readonly DiagnosticArtifactRow[]` (`src/persistence/repositories/diagnostics.ts:99-103`).
- **`resolveJobIdentifier(raw)`** returns `{ jobId?: number, sourceJobId?: string }` (`src/persistence/identifiers.ts:134-152`).
- **`parsePrefixedId(raw, expectedKind)`** returns `number` (`src/persistence/identifiers.ts:105-127`).
- **`NUMERIC_JOB_PATTERN = /^[0-9]+$/`** (`src/persistence/identifiers.ts:29`) — used to distinguish `job_<int>` from `numeric sourceJobId`.
- **`IDENTIFIER_PREFIXES.job = 'job_'`** and **`IDENTIFIER_PREFIXES.run = 'run_'`** (`src/persistence/identifiers.ts:16-26`).
- **`ExitCode` enum** is stable at `src/errors/application-error.ts:1-9`. `InvalidUsage = 2`, `MissingRequired = 3`, `Fatal = 1`, `Success = 0`.
- **`formatTopNTable(rows, terminalWidth)`** is reused unchanged for the post-run top-N output (`src/pipeline/format.ts:40-68`). The new `format.ts` does NOT duplicate this logic.
- **`PIPELINE_SCHEMA_VERSION = 1`** (`src/pipeline/state.ts:9`) — the inspection module's `INSPECTION_SCHEMA_VERSION = 1` follows the same convention.
- **`applicationVersion`** is read from `package.json` via `getApplicationVersion()` (`src/pipeline/version.ts`) — the inspection module does NOT need this field.
- **`OperationalConfigSchema`** is `.strict()`. No new config fields. The `--limit` default `50` is hardcoded in the inspection module (matches SPEC §34.3) and does NOT read from config.
- **`process.exit` / `process.stdout` / `process.stderr`** are only called from the CLI handler in `src/cli.ts`. Tests stub them via the pattern in `tests/cli/profile-list.test.ts:31-43`.

## File Structure

```text
src/inspection/
  state.ts                              # NEW: INSPECTION_SCHEMA_VERSION + JobListState + JobListRow union + JobShowPayload + RunListRow + RunShowPayload + ColumnSpec + sort key types (Task 1)
  errors.ts                             # NEW: InspectionError + InspectionValidationError + InspectionNotFoundError + InspectionResourceNotFoundError (Task 2)
  columns.ts                            # NEW: selectColumns(state, terminalWidth) + per-state header arrays + priority lists (Task 3)
  truncate.ts                           # NEW: truncateWithEllipsis(text, maxWidth) (Task 4)
  format.ts                             # NEW: formatJobListTable + formatJobShow + formatRunListTable + formatRunShow (Task 5)
  json-schemas.ts                       # NEW: Zod schemas for --json output (Task 6)
  index.ts                              # NEW: public barrel (Task 7)
  services/
    jobs-list-service.ts                # NEW: JobsListService.list(state, refinements) + .listByRun + identifier resolution (Task 8)
    jobs-show-service.ts                # NEW: JobsShowService.show(identifier) — full payload (Task 9)
    runs-list-service.ts                # NEW: RunsListService.list(opts) (Task 10)
    runs-show-service.ts                # NEW: RunsShowService.show(identifier) (Task 11)
src/cli.ts                              # MODIFIED: add jobs list / jobs show / runs list / runs show subcommands + paths --json flag (Tasks 12-13)
src/persistence/repositories/jobs.ts    # MODIFIED: add listByState + findWithDetails + discoveryErrorCount (Task 8)
src/persistence/repositories/pipeline-runs.ts  # MODIFIED: add listRecent + findWithDetails + countByRun (Task 10-11)
src/persistence/repositories/score-results.ts  # MODIFIED: add listActiveByRun (Task 10)
tests/inspection/
  boundaries.test.ts                    # NEW: bans on commander/inquirer/playwright/drizzle/openai/pino (Task 14)
  columns.test.ts                       # NEW: selectColumns + priority drop logic (Task 14)
  truncate.test.ts                      # NEW: truncateWithEllipsis boundary cases (Task 14)
  format.test.ts                        # NEW: format*Table + format*Show assertions (Task 14)
  json-schemas.test.ts                  # NEW: Zod schema accepts every documented fixture shape (Task 14)
  services/
    jobs-list-service.test.ts           # NEW: state discriminator + refinement filter + sort + run scoping (Task 14)
    jobs-show-service.test.ts           # NEW: identifier resolution + full payload assembly (Task 14)
    runs-list-service.test.ts           # NEW: listRuns with denormalized counts (Task 14)
    runs-show-service.test.ts           # NEW: full run payload + searches + diagnostics (Task 14)
tests/cli/
  jobs-list.test.ts                     # NEW: state flags, refinements, --json, exit codes (Task 15)
  jobs-show.test.ts                     # NEW: identifier, --json, exit codes (Task 15)
  runs-list.test.ts                     # NEW: --limit, --json, exit codes (Task 15)
  runs-show.test.ts                     # NEW: identifier, --json, exit codes (Task 15)
  paths-json.test.ts                    # NEW: paths --json single document (Task 15)
```

## Tasks

### Task 1 — `src/inspection/state.ts` — state vocabulary

- [ ] Create `src/inspection/state.ts` exporting:
  - `INSPECTION_SCHEMA_VERSION = 1 as const` (the JSON schema version).
  - `type JobListState = 'all' | 'scored' | 'accepted' | 'rejected' | 'unscored' | 'partial' | 'failed' | 'filter-errors' | 'scoring-errors'`.
  - `interface JobListRow` — discriminated union per state. Each variant has the documented SPEC §34.5 fields (the column set). The `--scored` variant has `id`, `internalId`, `sourceJobId`, `title`, `company`, `location`, `overallScore`, `displayScore`, `firstDiscoveredAt`. The `--accepted` variant has `id`, `title`, `company`, `location`, `scoreStatus` (`'complete' | 'reused' | 'failed' | 'skipped' | 'cancelled' | '—'`), `filteredAt`. The `--rejected` variant adds `rejectionReason`. The `--unscored` variant adds `scoringStatus` + `lastAttemptAt`. The `--partial` variant has `id`, `linkedinJobId`, `availableTitle`, `missingFields`, `errorCode`, `discoveredAt`. The `--failed` variant has `errorId`, `searchQuery`, `locationName`, `cardIndex`, `errorCode`, `discoveredAt`. The `--filter-errors` variant has `id`, `title`, `company`, `errorCode`, `lastAttemptAt`. The `--scoring-errors` variant has `id`, `title`, `company`, `errorCode`, `attempts`, `lastAttemptAt`. The `--all` variant has `id`, `extraction`, `filter`, `scoreStatus`, `score`, `title`, `company`, `location`.
  - `interface JobListResult { readonly state: JobListState; readonly rows: readonly JobListRow[]; readonly refinements: { readonly minimumScore: number | null; readonly company: string | null; readonly location: string | null; readonly runId: number | null }; readonly limit: number; readonly returned: number; }`.
  - `interface JobShowPayload { readonly id: string; readonly internalId: number; readonly sourceJobId: string; readonly linkedinUrl: string; readonly title: string | null; readonly company: string | null; readonly location: string | null; readonly description: string | null; readonly extractionStatus: 'complete' | 'partial' | 'failed'; readonly successfulMethod: 'search_detail_panel' | 'dedicated_job_page' | null; readonly discoveryHistory: readonly { readonly runId: number; readonly searchExecutionId: number; readonly timestamp: string; readonly isNew: boolean }[]; readonly currentFilter: { readonly outcome: 'accepted' | 'rejected' | 'error' | null; readonly fingerprint: string | null; readonly rejectionReasons: readonly string[]; readonly filteredAt: string | null; readonly hasHistory: boolean }; readonly currentScore: { readonly overallScore: number | null; readonly displayScore: string | null; readonly categoryScores: readonly { readonly category: string; readonly score: number; readonly explanation: string }[]; readonly explanation: string | null; readonly matches: readonly string[]; readonly gaps: readonly string[]; readonly concerns: readonly string[]; readonly inferredSeniority: string | null; readonly recommendationSummary: string | null; readonly timestamp: string | null; readonly hasHistory: boolean }; readonly timestamps: { readonly firstDiscoveredAt: string; readonly lastRediscoveryAt: string; readonly lastExtractionAttemptAt: string | null; readonly createdAt: string; readonly updatedAt: string } }`.
  - `interface RunListRow { readonly id: string; readonly internalId: number; readonly startTimestamp: string; readonly endTimestamp: string | null; readonly status: 'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'; readonly searchesAttempted: number; readonly jobsDiscovered: number; readonly jobsScored: number; readonly errorSummary: string }`.
  - `interface RunShowPayload { readonly id: string; readonly internalId: number; readonly status: PipelineRunStatus; readonly startTimestamp: string; readonly endTimestamp: string | null; readonly configuration: { readonly snapshotJson: unknown; readonly schemaVersion: number; readonly hash: string; readonly applicationVersion: string }; readonly profileVersionId: number | null; readonly filterConfigVersionId: number | null; readonly searchExecutions: readonly SearchExecutionRow[]; readonly jobCounts: { readonly complete: number; readonly partial: number; readonly failed: number; readonly total: number }; readonly filterCounts: { readonly accepted: number; readonly rejected: number; readonly errors: number }; readonly scoreCounts: { readonly scored: number; readonly reused: number; readonly errors: number }; readonly reusedResults: { readonly jobsReused: number }; readonly errors: { readonly searchErrors: readonly { readonly code: string; readonly message: string }[]; readonly extractionFailures: number; readonly filterErrors: number; readonly scoringErrors: number }; readonly cancellationState: { readonly isCancelled: boolean; readonly reason: string | null }; readonly diagnosticReferences: readonly { readonly id: number; readonly artifactType: string; readonly relativePath: string; readonly createdAt: string }[] }`.
  - `interface ColumnSpec { readonly header: string; readonly priority: number; readonly minWidth: number; readonly maxWidth: number; readonly truncate: boolean }`.
- [ ] No runtime imports. Pure types + constants.
- [ ] Verify: `pnpm typecheck` succeeds.

### Task 2 — `src/inspection/errors.ts` — typed errors

- [ ] Create `src/inspection/errors.ts` exporting:
  - `class InspectionError extends ApplicationError` (base class, exit code defaults to `Fatal`).
  - `class InspectionValidationError extends InspectionError` (exit code `InvalidUsage`).
  - `class InspectionNotFoundError extends InspectionError` (exit code `InvalidUsage` — matches `InvalidIdentifierError` pattern from `src/persistence/identifier-errors.ts`).
  - `class InspectionResourceNotFoundError extends InspectionError` (exit code `Fatal` — used when a referenced row's dependent row is missing).
- [ ] Constructor pattern matches `ApplicationError` (code, message, exitCode, metadata, cause).
- [ ] Tests: `tests/inspection/errors.test.ts` (smoke test only — assertions on `code`, `message`, `exitCode`, `metadata`).

### Task 3 — `src/inspection/columns.ts` — adaptive column selection

- [ ] Create `src/inspection/columns.ts` exporting:
  - `const DEFAULT_TERMINAL_WIDTH = 120` (matches `src/pipeline/format.ts:60`).
  - `const HEADERS_BY_STATE: Record<JobListState, readonly string[]>` — the documented SPEC §34.5 header arrays.
  - `const PRIORITY_BY_STATE: Record<JobListState, readonly number[]>` — priority index per header (lower = more essential; never dropped). The `ID` column is always priority `0`. The `Score` column is priority `1`. The `Title` column is priority `2`. Etc.
  - `function selectColumns(state: JobListState, terminalWidth: number): readonly ColumnSpec[]`:
    - Start with `HEADERS_BY_STATE[state]` mapped to `ColumnSpec` with `minWidth = header.length`, `priority = PRIORITY_BY_STATE[state][i]`, `maxWidth = Math.min(header.length + 24, terminalWidth)`, `truncate = true` for text columns.
    - If `sum(minWidth) > terminalWidth`: drop the lowest-priority column until `sum(minWidth) <= terminalWidth`. If dropping all but the ID + Score still exceeds the budget: throw `InspectionValidationError('terminal_width_too_small', ..., { terminalWidth })`.
    - Recompute `maxWidth` for the kept columns: each column gets `Math.min(originalMaxWidth, floor(terminalWidth / keptColumns.length))`.
    - Return the kept columns.
- [ ] Tests: `tests/inspection/columns.test.ts`:
  - Asserts `selectColumns('scored', 120)` returns the 6 documented columns with sensible widths.
  - Asserts priority drop: `selectColumns('scored', 60)` drops `Location` and `First discovered` (lowest priorities) before `Title` / `Company`.
  - Asserts `selectColumns('scored', 30)` throws (only ID + Score fit).

### Task 4 — `src/inspection/truncate.ts` — width-aware truncation

- [ ] Create `src/inspection/truncate.ts` exporting:
  - `function truncateWithEllipsis(text: string, maxWidth: number): string`:
    - Returns `text` when `text.length <= maxWidth`.
    - Returns `''` when `maxWidth <= 0`.
    - Returns `text.slice(0, maxWidth - 1) + '…'` when `maxWidth > 0 && text.length > maxWidth` (the ellipsis is U+2026 HORIZONTAL ELLIPSIS).
    - Throws `InspectionValidationError('truncate_invalid_max_width', ..., { maxWidth })` when `maxWidth` is not a non-negative integer.
- [ ] Tests: `tests/inspection/truncate.test.ts`:
  - Boundary cases: `text.length === maxWidth` (no truncation), `text.length === maxWidth + 1` (1-char truncation + `…`).
  - Negative / non-integer `maxWidth` → throw.
  - Empty string + positive `maxWidth` → empty string (no truncation).

### Task 5 — `src/inspection/format.ts` — adaptive table + show formatters

- [ ] Create `src/inspection/format.ts` exporting:
  - `function formatJobListTable(state: JobListState, rows: readonly JobListRow[], terminalWidth: number): string`:
    - Call `selectColumns(state, terminalWidth)` to get the column specs.
    - For each row, project the row's fields to the column values in order.
    - Apply `truncateWithEllipsis` to each text cell according to `column.maxWidth`.
    - Pad each cell to the column width (`' '.repeat(maxWidth - cell.length)` for left-aligned text; right-aligned for numbers + IDs).
    - Return the header + rows joined by `\n`.
  - `function formatJobShow(payload: JobShowPayload, terminalWidth: number): string`:
    - Multi-line block: `ID: <id>`, `Source job ID: <sourceJobId>`, `LinkedIn URL: <linkedinUrl>`, `Title: <title>`, `Company: <company>`, `Location: <location>`, `Extraction status: <status>`, `Extraction method: <method>`, `Description:` followed by the full description (NO truncation per SPEC §34.6).
    - `Discovery history:` followed by `  run_<n>  search_<m>  <ISO>  new|existing` lines.
    - `Current filter result: <outcome>` + `Rejection reasons: <reasons>` + `Filtered at: <ISO>`.
    - `Current score: <score> (display: <display>)` + `Category scores:` followed by `  <category>: <score> — <explanation>` lines + `Matches:` / `Gaps:` / `Concerns:` lists + `Inferred seniority: <seniority>` + `Recommendation: <summary>`.
    - `Timestamps: first discovered: <ISO>, last rediscovered: <ISO>, ...`.
    - `Historical results available: yes|no` for filter + score.
  - `function formatRunListTable(rows: readonly RunListRow[], terminalWidth: number): string`:
    - Columns: `ID | Start | End | Status | Searches | Jobs | Scored | Errors`.
    - Adaptive width per column with the same priority + drop logic as `formatJobListTable`.
  - `function formatRunShow(payload: RunShowPayload, terminalWidth: number): string`:
    - Multi-line block: `Run ID: run_<n>`, `Status: <status>`, `Started: <ISO>`, `Ended: <ISO>`, `Configuration: <hash> (schema v<n>)`, `Application version: <version>`, `Active profile: profile_<n> | —`, `Active filter: filters_<n> | —`.
    - `Search executions:` followed by `  search_<m>  <query> @ <location>  <status>` lines.
    - `Job counts: complete=<n> partial=<n> failed=<n> total=<n>`.
    - `Filter counts: accepted=<n> rejected=<n> errors=<n>`.
    - `Score counts: scored=<n> reused=<n> errors=<n>`.
    - `Reused results: jobs reused=<n>`.
    - `Errors: search errors=<n>, extraction failures=<n>, filter errors=<n>, scoring errors=<n>`.
    - `Cancellation: <reason> | none`.
    - `Diagnostic references:` followed by `  artifact_<n>  <type>  <path>` lines (truncate `path` to the terminal width budget).
- [ ] NO imports from `src/persistence/`, `src/pipeline/`, `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/`, `src/profile/`. Pure formatting.
- [ ] Tests: `tests/inspection/format.test.ts`:
  - Snapshot-style assertions for each documented state + payload shape (using `expect(actual).toBe(expected)` on the full string).
  - Adaptive truncation: `formatJobListTable('scored', rows, 60)` truncates the `Location` column.

### Task 6 — `src/inspection/json-schemas.ts` — Zod schemas for `--json` output

- [ ] Create `src/inspection/json-schemas.ts` exporting:
  - `const JobListRowJsonSchema = z.discriminatedUnion('state', [...])` — one variant per `JobListState`. The `--scored` variant: `{ state: z.literal('scored'), id, internalId, sourceJobId, title, company, location, overallScore, displayScore, firstDiscoveredAt }`. Etc.
  - `const JobListJsonSchema = z.object({ schemaVersion: z.literal(1), state, filters: z.object({ minimumScore, company, location, runId }), limit, returned, jobs: z.array(JobListRowJsonSchema) })`.
  - `const JobShowJsonSchema = z.object({ schemaVersion: z.literal(1), ...payload fields... })`.
  - `const RunListJsonSchema = z.object({ schemaVersion: z.literal(1), limit, returned, runs: z.array(RunListRowJsonSchema) })`.
  - `const RunShowJsonSchema = z.object({ schemaVersion: z.literal(1), ...payload fields... })`.
- [ ] All ISO 8601 timestamp fields use `z.string().datetime({ offset: true })` or `z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)`.
- [ ] Tests: `tests/inspection/json-schemas.test.ts`:
  - Build a representative fixture per schema, assert `INSPECTION_JSON_SCHEMA.safeParse(fixture).success === true`.
  - Assert missing `schemaVersion` → `safeParse(...).success === false`.
  - Assert `schemaVersion: 2` → rejected.
  - Assert truncation markers (e.g. `'…'`) are NEVER present in the JSON output.

### Task 7 — `src/inspection/index.ts` — public barrel

- [ ] Create `src/inspection/index.ts` re-exporting:
  - All types from `state.ts`.
  - All error classes from `errors.ts`.
  - All pure helpers from `columns.ts`, `truncate.ts`, `format.ts`, `json-schemas.ts`.
  - All services from `services/*.ts`.
- [ ] No runtime side effects. No I/O.

### Task 8 — `src/inspection/services/jobs-list-service.ts` + repository additions

- [ ] MODIFY `src/persistence/repositories/jobs.ts`:
  - Add `interface JobListRowFilter { readonly state: JobListState; readonly limit: number; readonly minScore?: number; readonly company?: string; readonly location?: string; readonly runId?: number }`.
  - Add `async listByState(filter: JobListRowFilter): Promise<readonly JobRow[]>` — runs the documented SQL query for the requested state. For `--scored` / `--accepted` / `--rejected` / `--unscored` / `--filter-errors` / `--scoring-errors` / `--all` the query joins `jobs` + the relevant `filterResults` + `scoreResults`. For `--partial` / `--failed` the query joins `jobs` + `discoveryEvents` / `discoveryErrors`. The implementation lives in the repository so the service layer stays thin.
  - Add `async findBySourceJobIdOrId(identifier: string): Promise<JobRow | null>` — resolves `job_<int>` via `findById` and numeric `sourceJobId` via `findBySourceJobId`.
  - Add `async discoveryErrorCountByRun(runId: number): Promise<number>` — count of `discoveryErrors` for the run (used by `--failed` state for `--all` queries).
- [ ] CREATE `src/inspection/services/jobs-list-service.ts` exporting:
  - `interface JobsListServiceOptions { readonly repositories: Repositories }`.
  - `class JobsListService` with `constructor(options: JobsListServiceOptions)` and `async list(input: { state: JobListState; limit?: number; minScore?: number; company?: string; location?: string; runId?: number }): Promise<JobListResult>`:
    - Validates `limit` is a positive integer (default `50`); throws `InspectionValidationError('jobs_list_invalid_limit', ..., { limit })` when invalid.
    - Validates `minScore` is between 0 and 100; throws `InspectionValidationError('jobs_list_invalid_min_score', ..., { minScore })` when invalid.
    - Resolves `--run` via `parsePrefixedId(raw, 'run')`; throws `InspectionValidationError('jobs_list_invalid_run_id', ...)` when malformed.
    - Calls `repositories.jobs.listByState({ state, limit, minScore, company: company?.toLowerCase(), location: location?.toLowerCase(), runId })`.
    - Maps each `JobRow` to the discriminated `JobListRow` union per state (the per-state mapping is encapsulated in the service to keep the SQL column selection in the repository).
    - Calls `sortJobListRows(state, rows)` to apply the documented sort.
    - Truncates to `limit` rows.
    - Returns `JobListResult`.
- [ ] Tests: `tests/inspection/services/jobs-list-service.test.ts`:
  - Insert fixture rows: 5 jobs (2 complete + scored, 1 complete + unfiltered, 1 partial, 1 failed-extraction).
  - Assert `list({ state: 'scored' })` returns the 2 scored jobs in score-desc order.
  - Assert `list({ state: 'unscored' })` returns the 1 unfiltered complete job.
  - Assert `list({ state: 'partial' })` returns the 1 partial job.
  - Assert `list({ state: 'all', minScore: 50 })` returns the 1 scored job with score >= 50.
  - Assert `list({ state: 'scored', company: 'example' })` returns the scored job whose company contains 'example' (case-insensitive).
  - Assert `list({ state: 'scored', limit: 1 })` returns 1 row.
  - Assert `list({ state: 'scored', limit: 0 })` throws `InspectionValidationError`.
  - Assert `list({ state: 'scored', runId: <id> })` returns only jobs discovered in that run.

### Task 9 — `src/inspection/services/jobs-show-service.ts`

- [ ] CREATE `src/inspection/services/jobs-show-service.ts` exporting:
  - `interface JobsShowServiceOptions { readonly repositories: Repositories }`.
  - `class JobsShowService` with `constructor(options: JobsShowServiceOptions)` and `async show(identifier: string): Promise<JobShowPayload>`:
    - Resolves the identifier via `resolveJobIdentifier(identifier)` from `src/persistence/identifiers.ts`. Throws `InspectionNotFoundError('jobs_show_invalid_identifier', ..., { identifier })` when invalid (maps to exit 2 via the existing `InvalidIdentifierError` constructor pattern — but the inspection module wraps it in its own typed error).
    - Calls `repositories.jobs.findByIdOrSourceJobId(identifier)` to fetch the `JobRow`. Throws `InspectionNotFoundError('jobs_show_not_found', ..., { identifier })` when null.
    - Fetches the discovery history (`listDiscoveryEventsByJob`), extraction attempts (`listExtractionAttemptsByJob`), active filter result (latest `filterResults.findActiveByJob` regardless of fingerprint — used for display only; the fingerprint comparison is for cache reuse, not display), and active score result (latest `scoreResults.findActiveByJob` regardless of fingerprint).
    - Fetches the current filter + current score by joining the latest active rows. Returns the assembled `JobShowPayload`.
    - Constructs the LinkedIn URL from `sourceJobId` via a pure helper `linkedinJobUrl(sourceJobId): string` returning `https://www.linkedin.com/jobs/view/${sourceJobId}`.
- [ ] Tests: `tests/inspection/services/jobs-show-service.test.ts`:
  - Insert fixture: 1 job + 1 active filter result + 1 active score result + 2 discovery events.
  - Assert `show('job_1')` returns the full payload with all 5 documented sections.
  - Assert `show('123456789')` (numeric LinkedIn ID) resolves correctly.
  - Assert `show('not_a_valid_id')` throws `InspectionNotFoundError`.
  - Assert `show('job_9999')` (unknown ID) throws `InspectionNotFoundError`.
  - Assert `show('job_1')` returns `linkedinUrl === 'https://www.linkedin.com/jobs/view/<sourceJobId>'`.

### Task 10 — `src/inspection/services/runs-list-service.ts` + repository additions

- [ ] MODIFY `src/persistence/repositories/pipeline-runs.ts`:
  - Add `async listRecent(limit: number): Promise<readonly PipelineRunRow[]>` — equivalent to `listRuns()` but `ORDER BY id DESC LIMIT limit`.
  - Add `async findWithDetails(id: number): Promise<PipelineRunDetails | null>` — returns the row + the searches + the discovery error count + the diagnostic artifact count + the active score count + the active filter count. Used by `runs show`.
  - Add `interface PipelineRunDetails { readonly row: PipelineRunRow; readonly searches: readonly SearchExecutionRow[]; readonly discoveryErrorCount: number; readonly diagnosticArtifactCount: number; readonly activeFilterResultCount: number; readonly activeScoreResultCount: number }`.
- [ ] MODIFY `src/persistence/repositories/score-results.ts`:
  - Add `async listActiveByRun(pipelineRunId: number): Promise<readonly ScoreResultRow[]>` — equivalent to `listByRun` but with `active = true` and `success = true` (the rows that contribute to the top-N + summary).
- [ ] CREATE `src/inspection/services/runs-list-service.ts` exporting:
  - `interface RunsListServiceOptions { readonly repositories: Repositories }`.
  - `class RunsListService` with `constructor(options: RunsListServiceOptions)` and `async list(opts: { limit?: number } = {}): Promise<readonly RunListRow[]>`:
    - Default limit `20` (matches `runTopN` default per SPEC §33.1).
    - Calls `repositories.pipelineRuns.listRecent(limit)`.
    - For each run, computes the `errorSummary` (the first search error code + count, OR `'none'` when no errors).
    - Returns `RunListRow[]`.
- [ ] Tests: `tests/inspection/services/runs-list-service.test.ts`:
  - Insert fixture: 3 runs with varying statuses + error counts.
  - Assert `list({ limit: 2 })` returns the 2 most recent runs (id DESC).
  - Assert the `errorSummary` column is populated correctly.
  - Assert `list()` defaults to limit `20`.

### Task 11 — `src/inspection/services/runs-show-service.ts`

- [ ] CREATE `src/inspection/services/runs-show-service.ts` exporting:
  - `interface RunsShowServiceOptions { readonly repositories: Repositories }`.
  - `class RunsShowService` with `constructor(options: RunsShowServiceOptions)` and `async show(identifier: string): Promise<RunShowPayload>`:
    - Resolves the identifier via `parsePrefixedId(identifier, 'run')`. Throws `InspectionNotFoundError('runs_show_invalid_identifier', ..., { identifier })` when invalid.
    - Calls `repositories.pipelineRuns.findWithDetails(runId)` to fetch the row + searches + counts.
    - Throws `InspectionNotFoundError('runs_show_not_found', ..., { runId })` when null.
    - Fetches the score rows (`scoreResults.listActiveByRun`) + diagnostic artifacts (`diagnostics.listByRun`).
    - Computes the `jobCounts` (complete / partial / failed / total) by joining `discoveryEvents` + `jobs` for the run.
    - Computes the `filterCounts` (accepted / rejected / errors) by joining `filterResults` for the run.
    - Computes the `scoreCounts` (scored / reused / errors) from the `pipelineRuns` row (the denormalized counts).
    - Returns the assembled `RunShowPayload`.
- [ ] Tests: `tests/inspection/services/runs-show-service.test.ts`:
  - Insert fixture: 1 run + 2 searches + 5 jobs (3 complete + 2 partial) + 2 filter results + 2 score results + 1 diagnostic artifact.
  - Assert `show('run_1')` returns the full payload with all 11 documented sections.
  - Assert `show('run_9999')` throws `InspectionNotFoundError`.
  - Assert `show('not_a_valid_id')` throws `InspectionNotFoundError`.

### Task 12 — `src/cli.ts` — subcommands (jobs + runs)

- [ ] MODIFY `src/cli.ts`:
  - Import the four services from `src/inspection/index.js`.
  - Add four new subcommands inside `createProgram()`:
    - `program.command('jobs').description('Inspect discovered jobs.')`
      - `.command('list').description('List jobs filtered by state and refinements.').option('--all', 'all canonical jobs and applicable diagnostic records').option('--scored', 'complete jobs with a current successful score (default)').option('--accepted', 'complete jobs with current accepted filter result').option('--rejected', 'complete jobs with current rejected filter result').option('--unscored', 'complete accepted jobs without a current successful score').option('--partial', 'partial extraction records').option('--failed', 'failed extraction or discovery records').option('--filter-errors', 'complete jobs with current filter error').option('--scoring-errors', 'eligible jobs with current scoring error').option('--limit <n>', 'positive integer limit (default 50)').option('--min-score <n>', 'minimum score 0-100').option('--company <text>', 'normalized case-insensitive substring match').option('--location <text>', 'normalized case-insensitive substring match').option('--run <run-id>', 'limit to jobs discovered in this run').option('--json', 'emit a single JSON document to stdout', false).action(async (options) => { ... })`
      - `.command('show').description('Print the full payload for a single job.').argument('<job-id>', 'local job_<int> or numeric LinkedIn sourceJobId').option('--json', 'emit a single JSON document to stdout', false).action(async (jobId, options) => { ... })`
    - `program.command('runs').description('Inspect pipeline runs.')`
      - `.command('list').description('List recent pipeline runs.').option('--limit <n>', 'positive integer limit (default 20)').option('--json', 'emit a single JSON document to stdout', false).action(async (options) => { ... })`
      - `.command('show').description('Print the full payload for a single run.').argument('<run-id>', 'run_<int>').option('--json', 'emit a single JSON document to stdout', false).action(async (runId, options) => { ... })`
  - For each subcommand:
    - Construct the service via `new XService({ repositories })` inside the `try` block (the same pattern as the existing `profileListCommand` / `profileShowCommand` at `src/cli.ts:456-531`).
    - On success, branch on `options.json`:
      - `true` → `process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)`.
      - `false` → `process.stdout.write(`${formatX(payload, process.stdout.columns ?? 120)}\n`)`.
    - On error, the `catch (error) { exitWithError(error); }` wrapper handles the typed error → exit code mapping.
- [ ] For `jobs list`: BEFORE calling the service, assert state flag mutex:
  ```ts
  const stateFlags = ['all', 'scored', 'accepted', 'rejected', 'unscored', 'partial', 'failed', 'filter-errors', 'scoring-errors'] as const;
  const set = stateFlags.filter((f) => options[f] === true);
  if (set.length > 1) {
    throw new InspectionValidationError('jobs_list_state_conflict', 'Only one state flag may be supplied.', { flags: set });
  }
  const state: JobListState = (set[0] ?? 'scored') as JobListState;
  ```
- [ ] Tests: `tests/cli/{jobs-list,jobs-show,runs-list,runs-show}.test.ts` use the existing `createProgram()` + stdout/stderr/exitCode capture pattern from `tests/cli/profile-list.test.ts:57-72`.
  - `jobs-list.test.ts`:
    - Asserts the subcommand is registered.
    - Asserts the documented `--scored` flag defaults apply.
    - Asserts two state flags → exit 2 with `jobs_list_state_conflict` on stderr.
    - Asserts `--limit 0` → exit 2 with `jobs_list_invalid_limit`.
    - Asserts `--min-score 150` → exit 2 with `jobs_list_invalid_min_score`.
    - Asserts `--json` produces a valid single JSON document with `schemaVersion: 1`.
  - `jobs-show.test.ts`:
    - Asserts `not_a_valid_id` → exit 2.
    - Asserts `job_9999` → exit 2 with `jobs_show_not_found`.
    - Asserts `job_1` (after fixture insert) → exit 0 + non-JSON multi-line block.
    - Asserts `job_1 --json` → exit 0 + valid single JSON document.
  - `runs-list.test.ts`:
    - Asserts `runs list` → exit 0 + table with the documented columns.
    - Asserts `runs list --json` → exit 0 + valid single JSON document.
    - Asserts `--limit 1` → exactly 1 row.
  - `runs-show.test.ts`:
    - Asserts `not_a_valid_id` → exit 2.
    - Asserts `run_9999` → exit 2 with `runs_show_not_found`.
    - Asserts `run_1 --json` → exit 0 + valid single JSON document.

### Task 13 — `src/cli.ts` — `paths --json` flag

- [ ] MODIFY `src/cli.ts`:
  - Update the existing `paths` subcommand at `src/cli.ts:787-796` to add an `.option('--json', 'emit a single JSON document to stdout', false)` flag.
  - In the `action`, branch on `options.json`:
    - `true` → emit `{ schemaVersion: 1, paths: { config, data, logs, diagnostics, cache, profileSources } }` with each value being the directory string.
    - `false` → existing human-readable output (unchanged).
- [ ] Tests: `tests/cli/paths-json.test.ts`:
  - Asserts `paths --json` → exit 0 + valid single JSON document with `schemaVersion: 1` + the 6 documented keys.
  - Asserts `paths --json` stdout contains exactly one document (no leading/trailing prose).

### Task 14 — Tests: pure helpers, services, boundaries

- [ ] CREATE `tests/inspection/boundaries.test.ts`:
  - Mirrors the pattern from `tests/scoring/boundaries.test.ts` + `tests/pipeline/boundaries.test.ts`.
  - Bans: `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`, runtime `pino`, `process.exit`.
  - Allow-list: cross-module imports from `src/persistence/repositories/`, `src/persistence/identifiers.ts`, `src/errors/`, `src/pipeline/state.ts` (for `PipelineRunStatus`).
- [ ] CREATE `tests/inspection/columns.test.ts` (already detailed in Task 3).
- [ ] CREATE `tests/inspection/truncate.test.ts` (already detailed in Task 4).
- [ ] CREATE `tests/inspection/format.test.ts` (already detailed in Task 5).
- [ ] CREATE `tests/inspection/json-schemas.test.ts` (already detailed in Task 6).
- [ ] CREATE `tests/inspection/services/jobs-list-service.test.ts` (already detailed in Task 8).
- [ ] CREATE `tests/inspection/services/jobs-show-service.test.ts` (already detailed in Task 9).
- [ ] CREATE `tests/inspection/services/runs-list-service.test.ts` (already detailed in Task 10).
- [ ] CREATE `tests/inspection/services/runs-show-service.test.ts` (already detailed in Task 11).

### Task 15 — Tests: CLI integration + final docs

- [ ] CREATE `tests/cli/{jobs-list,jobs-show,runs-list,runs-show,paths-json}.test.ts` (already detailed in Tasks 12 + 13).
- [ ] UPDATE `docs/tasks/TASK-016-inspection-tables-json-output.md`:
  - Mark `Status: ✅ Implemented` after all 14 tasks pass.
  - Add an "Implementation results" section listing per-wave commit hashes + per-wave verification commands.
  - Add a "Known limitations" section if any (mirrors TASK-014 + TASK-015).
- [ ] Run the verification commands in "Success Criteria" below.

## Success Criteria

1. `pnpm typecheck` passes.
2. `pnpm lint` passes.
3. `pnpm format:check` passes.
4. `pnpm test` passes with zero failures.
5. `pnpm build` produces `dist/cli.js` + `dist/inspection/*.js`.
6. `node dist/cli.js jobs list --json` produces a single valid JSON document on stdout; logs go to stderr; no partial JSON on failure.
7. `node dist/cli.js jobs show job_1` prints the full payload (no truncation); `jobs show job_1 --json` prints the full un-truncated JSON.
8. `node dist/cli.js runs list --json` produces a single valid JSON document; `runs show run_1 --json` prints the full un-truncated JSON.
9. `node dist/cli.js paths --json` produces a single valid JSON document with `schemaVersion: 1`.
10. Invalid usage (`jobs list --all --scored`, `jobs list --limit 0`, `jobs show not_a_valid_id`, `runs show not_a_valid_id`) exits with code 2 and the documented error code on stderr.
11. Missing dependencies (`jobs show job_9999`, `runs show run_9999`) exits with code 2 and `jobs_show_not_found` / `runs_show_not_found` on stderr.
12. No `node_modules/`, `dist/`, `drizzle/`, or generated output files are committed (mirrors `tests/foundation.test.ts`).
13. No new schema, no new migration, no new direct dependency.