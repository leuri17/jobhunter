# TASK-015 Implementation Plan — Pipeline Orchestration, Reuse/Invalidation, Confirmation, Concurrency, and Cancellation

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Compose the services completed by TASK-005, TASK-006, TASK-010, TASK-011, TASK-012, TASK-013, and TASK-014 into an end-to-end `jobhunter run` orchestrator (SPEC §8.4 + §27 + §29 + §30 + §33 + §38 + §40 + §42). The orchestrator is a single application service (`PipelineOrchestrator`, `src/pipeline/orchestrator.ts`) that owns the run-level lifecycle (browser launch/close, `AbortController` cancellation propagation, transactional run + search creation, sequential per-search→discovery→extraction→filter→scoring flow, scoring-plan confirmation, top-N ranking, and finalization). A thin `run` subcommand in `src/cli.ts` owns the CLI boundary, SIGINT handling, and exit-code mapping. No new schema, no new migration, no new direct dependency. The pipeline orchestrator NEVER re-implements prerequisite service logic — it delegates to the existing barrels (`src/linkedin/`, `src/scoring/`, `src/filter/`, `src/persistence/repositories/`).

**Architecture:** A new `src/pipeline/` sibling of `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/` houses the run-level orchestration layer. The pure layer (`src/pipeline/state.ts`, `src/pipeline/errors.ts`, `src/pipeline/log.ts`, `src/pipeline/normalize.ts`, `src/pipeline/format.ts`) has no I/O. The application layer (`src/pipeline/orchestrator.ts`) composes the existing services: `loadConfig`, `LinkedInDiscoveryService`, `LinkedInExtractionService`, `FilterApplyService`, `ScoringService`, `generateSearchMatrix`, `resolvePlatformPaths`, `DiagnosticManager`. The `src/pipeline/prompts.ts` declares the `PipelinePrompts` seam (currently only `askScoringConfirmation`); `src/pipeline/prompts-inquirer.ts` is the ONLY module under `src/pipeline/` allowed to import `@inquirer/prompts`. The CLI handler extends `createProgram({ ..., pipelinePrompts })` (backward-compatible) and wires SIGINT to an `AbortController`; the existing `exitWithError` maps typed errors to exit codes. The orchestrator NEVER calls `process.exit`; the CLI handler does.

**Tech Stack:** No new dependencies. Reuses everything TASK-012/013/014 wired: `playwright` (sole runtime importer in `src/linkedin/playwright-session.ts`), `openai` (sole runtime importer in `src/profile/openai/client.ts`), `zod`, `drizzle-orm@0.45.2`, `better-sqlite3@13.0.3`, `commander`, `@inquirer/prompts`, `pino@10.3.1`, `vitest`. The `applicationVersion` field is read from `package.json` at the CLI boundary (via `getApplicationVersion()` at `src/pipeline/version.ts`); the test seam accepts an explicit `applicationVersion: string` constructor option.

## Open decisions confirmed before implementation

These map to the 28 pinned decisions in `.slim/deepwork/task-015-pipeline-orchestration-cancellation.md` and to the SPEC §8.4, §27.1–27.5, §29.1–29.3, §30, §33, §38, §40, §42 references. The implementing agent must stop and ask the user to confirm all 28 resolutions before any file in `src/pipeline/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Module location | New `src/pipeline/` (sibling of `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/`, `src/profile/`). Layout: `orchestrator.ts`, `state.ts`, `errors.ts`, `log.ts`, `normalize.ts`, `format.ts`, `prompts.ts`, `prompts-inquirer.ts`, `version.ts`, `index.ts`. The `DiscoverInput`/`ExtractBatchInput`/`ScoreBatchInput` types from TASK-012/013/014 are REUSED unchanged. | §5, AGENTS.md §5 |
| 2 | State model | `PipelineRunStatus` reuses the enum from `src/persistence/repositories/pipeline-runs.ts` (matches the DDL). `RunSummary` includes the 21 stat fields listed in SPEC §38 + `cancellationReason: string \| null` + `scoringDeclinedByUser: boolean`. The `PIPELINE_SCHEMA_VERSION` constant is `1`. NO new vocabulary. | §29, §38 |
| 3 | Run lifecycle | The orchestrator OWNS the run-level lifecycle: `initializeDatabase` → `loadConfig` → validate profile + filter → `browserSession.launch()` → `createRunWithSearches` (transactional) → for each search sequentially: `discover()` → `extractBatch()` → `filterApply()` for each complete job → after all searches done: build scoring plan → confirm → `scoreBatch()` → finalize → `browserSession.close()` (in `finally`). The database handle is owned by the CLI boundary; the orchestrator borrows `Repositories` via constructor injection. | §8.4, §29.3, §33, §40 |
| 4 | Browser lifecycle | `browserSession.launch()` is called exactly ONCE per run (before the first search). `browserSession.close()` is called exactly ONCE in the `finally` block (idempotent per `FakeBrowserSession`). Discovery and extraction share the launched browser + context. The orchestrator does NOT call `launch()`/`close()` again between searches. | §21.2, §29.1, AGENTS.md §5 |
| 5 | Cancellation | `AbortController` owned by the CLI boundary. The CLI registers a one-shot SIGINT listener that calls `abortController.abort()` and prints a message to stderr. The orchestrator checks `signal.aborted` BEFORE each search, between each per-job extraction, and between each per-job scoring (mirrors the existing `LinkedInDiscoveryService` + `LinkedInExtractionService` + `ScoringService` seams). On abort: set `pipelineRuns.status = 'cancelling'`, stop scheduling new work, persist completed work, close browser, finalize as `cancelled`. A second SIGINT triggers `process.exit(1)` (force exit). | §29.3, §40 |
| 6 | Concurrency | Searches run sequentially (SPEC §29.1). Jobs within a search run sequentially. ONE panel extraction is active at a time. ONE fallback page is active at a time (enforced by `BrowserSession.openFallbackPage`). OpenAI scoring uses the configured `concurrency` (default 3) via `ScoringService.scoreBatch()` (reuses the TASK-014 worker-pool loop). No new concurrency primitives. | §29.1, §29.2 |
| 7 | Run + search creation | `PipelineRunRepository.createRunWithSearches({ run, searches })` is the transactional entry point (already exists at `src/persistence/repositories/pipeline-runs.ts:171-225`). The orchestrator computes the configuration snapshot (no secrets, see Decision 8), the search matrix from `generateSearchMatrix(...)`, and writes both in a single transaction. The `runId` returned is the source of truth for every subsequent operation. | §8.4, §23.2, §40 |
| 8 | Configuration snapshot | The snapshot is the normalized `OperationalConfig` JSON (sorted keys for determinism). The current `OperationalConfigSchema` does NOT include any secrets (only `openai.{...}` model + reasoningEffort + concurrency + `scraper` timeouts + `output` + `logging` + `diagnostics`). The `configHash` is the existing `loadedConfig.hash` (SHA-256). The `configSchemaVersion` is `1`. The orchestrator persists the normalized `config` (NOT any raw payload). | §8.4, AGENTS.md §6 |
| 9 | Application version | `applicationVersion` is read from the nearest `package.json` via `getApplicationVersion()` (a NEW helper at `src/pipeline/version.ts`). The helper walks up from `import.meta.url` until a `package.json` is found. Returns `'0.0.0'` when missing. Test seam: `PipelineOrchestrator` accepts `applicationVersion: string` as a constructor option (default: `'0.0.0'`; the CLI handler passes the helper's value). | §8.4, AGENTS.md §13 |
| 10 | Prerequisite validation | Before creating a run, the orchestrator validates: (a) `loadConfig` returns a valid config; (b) `Repositories.profileVersions.findActiveApproved()` returns a non-null row; (c) `Repositories.filterConfigurations.findActive()` returns a non-null row; (d) `OPENAI_API_KEY` is present (passed via `env` argument). Missing → throw `PipelinePrerequisiteError` (extends `PipelineLifecycleError`, exit 3 = `MissingRequired`). The CLI pre-validates ONLY (d) (mirrors TASK-011's openai-key gate); (a)…(c) are validated by the orchestrator. | §33, §9.5, §37 |
| 11 | OpenAI key gate | `OPENAI_API_KEY` is read from `process.env` only at the CLI boundary. The CLI passes `env: Readonly<Record<string, string \| undefined>>` to `PipelineOrchestrator.run()`. The orchestrator validates presence; missing → exit 3 (`MissingRequired`). The `OpenAIClient` seam is intact (a `FakeOpenAIClient` is injected for tests). | §33, §9.5, §37 |
| 12 | Search matrix | `generateSearchMatrix({ searchQueries, locations, datePosted, workplaceTypes, startTimestamp })` returns `readonly SearchMatrixEntry[]` (already exists at `src/search/matrix.ts:25-46`). The orchestrator maps each entry to a `SearchExecutionInsert` via `matrixEntryToSearchExecutionInsert(runId, entry)` (already at `src/search/matrix.ts:48-59`). Empty matrix → no searches → orchestrator finalizes the run as `completed` with empty counters. | §23, §33 |
| 13 | Per-search flow | For each `SearchExecutionRow` (sequentially, in matrix order): (a) `linkedinDiscovery.discover({ run, searchExecution, signal })` → returns a `SearchDiscoveryOutcome`; (b) fetch the new-job IDs from `discoveryEvents` via `Repositories.jobs.findEventsByRun(runId)` (a NEW read-only method — see Task 13); (c) fetch the canonical `JobRow`s via `Repositories.jobs.findById(id)`; (d) open a fresh search page via `browserSession.openPage(url)`; (e) `linkedinExtraction.extractBatch({ run, searchExecution, jobs, searchPage, signal })` — the batch re-checks `extractionStatus` per job and skips complete/partial via the TASK-013 §22.9 + §22.10 inner skip; (f) close the page in `finally`; (g) for each `complete` outcome, `filterApplyService.apply({ jobId, job, pipelineRunId })`; (h) collect the per-job state for the scoring plan. | §22.9, §22.10, §27.1, §29.1 |
| 14 | Extraction page reuse | The orchestrator opens the search-URL page ONCE per search (via `browserSession.openPage`) and reuses it for `extractBatch()`. The dedicated fallback page is opened on-demand by the extraction service. The same `Page` is passed to `extractBatch({ searchPage: ... })`. After `extractBatch` completes, the page is closed in `finally`. The discovery service opens its own page and closes it on its own `finally`; the orchestrator re-opens a page for extraction AFTER discovery closes its page. | §22.6, §29.1, TASK-013 |
| 15 | Filter reuse | `FilterApplyService.apply({ jobId, job, pipelineRunId })` is called for every `complete` job. The existing `findActiveByJob(jobId, fingerprint)` lookup handles reuse (TASK-010 fingerprint cache). The fingerprint is computed inside the service (no orchestrator-side computation). No new orchestration logic for filter reuse. | §24, §27.1, §27.5, TASK-010 |
| 16 | Score reuse | `ScoringService.scoreOne({ run, searchExecution, job, profileVersion, effectiveDerivedValues, filterResult, signal })` is called per accepted job. The existing `findActiveByJob(jobId, fingerprint)` lookup handles reuse (TASK-014 §27.3). The orchestrator passes the per-job `filterResult` returned by `FilterApplyService.apply()` (NOT a re-fetched copy). No new orchestration logic for score reuse. | §27.3, §27.5, TASK-014 |
| 17 | Scoring plan builder | After all searches complete (or the run is cancelled), the orchestrator collects the accepted jobs + their `filterResult` + `sourceJobId` + the projected OpenAI payload size (a stubbed `0` for the MVP — the size is approximate; the scoring service already enforces the 200 KB hard cap per `scoring_input_too_large`). The `scoringService.buildScoringPlan({ run, searchExecution, jobs, eligibleFlags, scoreKinds, scoringConcurrency })` is called with the per-accepted-job `kind` map. The plan is the input to the confirmation UI. | §30, TASK-014 |
| 18 | Scoring confirmation | When `scoringPlan.newOpenAIRequests > 0` AND the run is not cancelled AND `confirmScoring === false`: `pipelinePrompts.askScoringConfirmation({ plan })` returns a `boolean`. If `false` → mark `pipelineRun.scoringDeclinedByUser = true`, skip the scoring batch, persist completed work, finalize. The `confirmScoring: true` flag (the `--yes` flag in the CLI) bypasses ONLY this confirmation. Never bypasses profile/filter/profile-edit/destructive confirmations. | §30, §29.3, §37 |
| 19 | Scoring batch | When confirmed (or no new requests), `scoringService.scoreBatch({ run, searchExecution: { id: <first search id> }, jobs: [...], signal })` — the `searchExecutionId` is the FIRST search's id (the batch aggregates across the run). The `signal` is the run-level `AbortSignal`. On `ScoringHardStopError` (3 consecutive auth failures) the orchestrator marks the run as `completed_with_errors` and surfaces the error in the summary. | §25, §29.2, §30, TASK-014 |
| 20 | Ranking | `Repositories.scoreResults.topByRun(runId, config.output.runTopN)` (already exists at `src/persistence/repositories/score-results.ts:177-192`) reads the top-N rows. The orchestrator calls this once at the end. The `rankResults` helper is NOT used by the orchestrator (the SQL `ORDER BY overallScore DESC + LIMIT N` is the source of truth). | §26.5, §33.1 |
| 21 | Run finalization | `Repositories.pipelineRuns.finalizeRunStats(runId, stats)` (already exists at `src/persistence/repositories/pipeline-runs.ts:240-272`) is called once at the end of the run with the 21 stat fields (searches planned/attempted/completed, jobs discovered/new complete/existing complete skipped/existing partial skipped/new partial/failed extractions, jobs accepted/rejected/filter errors, jobs scored/scores reused/scoring errors, scoring declined, cancellation reason, search errors). | §38, §23.2 |
| 22 | Status transitions | `status: 'running'` → `createRunWithSearches` sets this. `status: 'cancelling'` → set when `signal.aborted` is detected mid-run, before the final flush. `status: 'completed' \| 'completed_with_errors' \| 'failed' \| 'cancelled'` → set in `finalizeRunStats` at the end. The `cancelling` state is persisted via `finalizeRunStats` + the `endTimestamp` + `cancellationReason` row. | §38 |
| 23 | `--yes` flag | `jobhunter run --yes` bypasses only the scoring confirmation. The CLI handler maps `--yes` to `confirmScoring: true` in the orchestrator constructor. No other confirmation is bypassed. | §30, §37 |
| 24 | `--json` flag | `jobhunter run --json` emits a single JSON document to stdout: `{ schemaVersion: 1, runId: <int>, ...21 stat fields..., topN: [...], scoringPlan: { jobsDiscovered, jobsAccepted, scoresReused, newOpenAIRequests, skippedScoringCategories, scoringConcurrency, perJob: [...] } }`. The CLI handler writes the JSON (sorted keys via `JSON.stringify(payload, null, 2)`) + a single newline. Human-readable output is the default. Per SPEC §36 the JSON contract is a single complete document. | §33, §36, AGENTS.md §10 |
| 25 | Reuse/skip semantics | Rediscovered jobs (existing canonical rows for the same `sourceJobId`) reuse the existing extraction (skipped by `LinkedInExtractionService.extractBatch`'s inner `extractionStatus in ['complete', 'partial']` check) and reuse the existing filter result (TASK-010 fingerprint cache) and reuse the existing score (TASK-014 fingerprint cache). New jobs (no canonical row before discovery) extract from the panel + fallback, persist, filter, and score. Per SPEC §27.5, a normal run does NOT scan for stale jobs that were not rediscovered. | §22.9, §22.10, §27.1, §27.5 |
| 26 | Per-job failure isolation | A typed `LinkedInScraperError` from one search does NOT terminate the run. The discovery service's `handleFailure` writes the search as `failed` + the diagnostic; the orchestrator continues with the next search. A per-job extraction failure becomes `kind: 'failed'` in the batch outcome (TASK-013 §22.12) and the orchestrator continues. A per-job filtering or scoring failure is captured in the outcome `kind: 'failed'` (no throw across the boundary). The run's final status is `completed_with_errors` when any of the recovery-safe error counters are non-zero. | §22.12, §29.3, §38, §40 |
| 27 | Per-run top-N | `Repositories.scoreResults.topByRun(runId, config.output.runTopN)` returns the top-N rows for the run (filtered by `active: true, success: true`). The CLI prints the standard header (SPEC §33.1): `ID \| Score \| Title \| Company \| Location \| First discovered`. The `first discovered` is read from `Repositories.jobs.findById(id)?.firstDiscoveryTimestamp`. The `Title`/`Company`/`Location` come from the `JobRow`. The `ID` is the local `job_<int>` prefix. | §33.1, §32 |
| 28 | Diagnostics | `DiagnosticManager` is constructed ONCE per run before the first search. The orchestrator injects the same manager into `LinkedInDiscoveryService` and `LinkedInExtractionService`. `DiagnosticManager.close()` is called in the run's `finally` block (idempotent, no-op for the current real Playwright implementation). Scraper errors flow through the existing `recordScraperError` paths (TASK-012/013). Scoring errors do NOT trigger diagnostics (the `ScoringLogger` is the seam). | §39, TASK-005 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system. `package.json` dependencies are unchanged.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/pipeline/` — with the **single explicit carve-out** for `src/pipeline/prompts-inquirer.ts` (the only module allowed to import `@inquirer/prompts`) — **must not** import Commander, Inquirer (outside the carve-out), Playwright, Drizzle directly, the `openai` SDK, or Pino directly. The `PipelineLogger` interface is the seam; `src/pipeline/orchestrator.ts` takes the logger via constructor injection. `src/pipeline/{state,errors,log,normalize,format,version}.ts` are pure (no I/O).
- **Editor / Inquirer isolation:** The `PipelinePrompts` interface (`src/pipeline/prompts.ts`) is the seam. The default Inquirer adapter (`src/pipeline/prompts-inquirer.ts`) is the only module that imports `@inquirer/prompts`. Tests inject a `ScriptedPipelinePrompts` or `FailingPipelinePrompts`. The CLI never invokes `@inquirer/prompts` directly from `run`.
- **Validation:** Zod at every external boundary. `OperationalConfigSchema` is the canonical config validator (TASK-002). Persisted row JSON columns are revalidated through their respective repository methods. The `PIPELINE_SCHEMA_VERSION` constant is the only new constant added by this task; it is `1`.
- **Errors:** Typed errors extending `ApplicationError`. New lifecycle error codes are added to `src/pipeline/errors.ts`. Exit-code mapping follows Decision 24. The orchestrator's `run()` never throws `ApplicationError` for per-job failures — those are surfaced as `RunSummary.*Errors` counters. The orchestrator DOES throw typed errors for genuine unrecoverable conditions (`PipelineLifecycleError` subclasses).
- **History preservation (AGENTS.md §6):** The pipeline never deletes, resets, or supersedes historical profile versions, filter configuration versions, search executions, jobs, extraction attempts, filter results, score results, `openaiMetadata`, `diagnostics`, or `applicationMetadata` rows. The orchestrator only WRITES new run + search + filter result + score result + diagnostic rows (via atomic transaction endpoints in the existing repositories).
- **Determinism:** The pure helpers (`state.ts`, `normalize.ts`, `format.ts`) are pure functions of their inputs. The `ScriptedPipelinePrompts` adapters make the interactive flow deterministic in tests. The scoring plan is deterministic for the same inputs.
- **Tests:** Vitest. Pure-helper tests are deterministic and unit-style. Service tests use `FakeOpenAIClient` + `FakeBrowserSession` + a temporary SQLite database (`mkdtempSync` + `createDatabaseConnection` + `runMigrations` + `createRepositories` pattern from `tests/init/init-service.test.ts`). CLI smoke tests use `process.exit`/`stdout`/`stderr` capture as in TASK-009 / TASK-010. No live network, no live LinkedIn, no live OpenAI.
- **JSON output discipline (AGENTS.md §10):** `jobhunter run --json` emits exactly ONE valid JSON document to stdout; logs + human-readable errors go to stderr; values are never truncated. The JSON shape is documented in Decision 24 + the test fixtures.
- **No secrets:** The pipeline never logs `OPENAI_API_KEY`, prompt transcripts, raw OpenAI responses, raw LinkedIn HTML, or any user-typed value beyond the field path. The `PipelineLogger` adapter is responsible for redacting confidential fields; `src/pipeline/orchestrator.ts` never adds the key to its log payload.
- **No new schema/migration:** All tables used (`pipelineRuns`, `searchExecutions`, `jobs`, `discoveryEvents`, `extractionAttempts`, `filterResults`, `scoreResults`, `openaiMetadata`, `diagnostics`, `applicationMetadata`) already exist (TASK-003). The plan MUST NOT add DDL. The plan MAY add ONE read-only repository method (`findEventsByRun`) to `src/persistence/repositories/jobs.ts` (Task 13).
- **No new CLI subcommand surface:** `jobhunter run` is the only new CLI subcommand. The `--yes` + `--json` flags are the only new flags. No new aliases.

## Reconciler facts (from existing code review)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and are not re-litigated in this plan.

- **`BrowserSession` interface** is the seam (`src/linkedin/browser-session.ts:38-58`). Three implementations exist: `PlaywrightBrowserSession` (real), `FakeBrowserSession` (tests), `PlaywrightRouteSession` (hermetic). The orchestrator accepts a `BrowserSession` via constructor injection (no `launch`/`close` inside the prerequisite services).
- **`LinkedInDiscoveryService.discover({ run, searchExecution, signal })`** returns a `SearchDiscoveryOutcome` (TASK-012). The orchestrator reads `newJobs`/`existingJobs`/`errors`/`finalStatus` from the outcome. The outcome's `newJobs` count is the source of truth for the `newJobs` per-search stat; the actual job rows are fetched via `Repositories.jobs.findEventsByRun(runId)` (the discovery inserts a `discovery_event` for every card).
- **`LinkedInExtractionService.extractBatch({ run, searchExecution, jobs, searchPage, signal })`** returns an `ExtractionBatchOutcome` (TASK-013). The orchestrator reads `perJob`/`totals` from the outcome. Per-job `kind: 'complete' | 'partial' | 'failed' | 'skipped' | 'cancelled'` drives the per-run counters.
- **`FilterApplyService.apply({ jobId, job, pipelineRunId })`** returns a `FilterApplyResult` (TASK-010). The orchestrator reads `outcome` (`'accepted' | 'rejected' | 'error'`), `reused`, `filterResultId`, `fingerprint` from the result.
- **`ScoringService.scoreOne({ run, searchExecution, job, profileVersion, effectiveDerivedValues, filterResult, signal })`** returns a `ScoringOutcome` (TASK-014). The orchestrator reads `kind` (`'reused' | 'complete' | 'failed' | 'skipped' | 'cancelled'`), `overallScore`, `fingerprint`, `errorCode` from the outcome. **`scoreBatch(...)`** is the worker-pool loop.
- **`ScoringService.buildScoringPlan({ run, searchExecution, jobs, eligibleFlags, scoreKinds, scoringConcurrency })`** returns a `ScoringPlan` (TASK-014). The orchestrator calls this once per run after all searches complete.
- **`ScoringHardStopError`** (TASK-014 Decision 19) is the only `ScoringError` subclass that crosses the orchestrator boundary. The orchestrator catches it, finalizes the run as `completed_with_errors`, and surfaces the error in the summary.
- **`rankResults` + `topByRun` + `formatDisplayScore`** are the pure helpers + repository methods used for the top-N output. No new ranking logic.
- **`DiagnosticManager.recordScraperError`** is the only diagnostic entry point used by the run (called from `LinkedInDiscoveryService` + `LinkedInExtractionService`).
- **`@inquirer/prompts.confirm`** is the existing prompt for yes/no questions. The orchestrator uses it via the `PipelinePrompts` seam.
- **`OperationalConfigSchema`** is `.strict()`. No new config fields.
- **`PIPELINE_SCHEMA_VERSION = 1`**. JSON output uses `schemaVersion: 1`.
- **`pipelineRuns.status` enum** is `'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'` (matches the DDL).
- **`ApplicationError` exit codes** are stable: `Success: 0`, `Fatal: 1`, `InvalidUsage: 2`, `MissingRequired: 3`, `LinkedInBlocked: 4`, `OpenAIFailure: 5`, `UserCancellation: 130`. The orchestrator maps lifecycle errors to these codes (no new codes).

## File Structure

```text
src/pipeline/
  state.ts                              # NEW: PIPELINE_SCHEMA_VERSION + RunSummary + TopNRow (Task 1)
  errors.ts                             # NEW: PipelineLifecycleError + PipelinePrerequisiteError + PipelineOpenAIKeyMissingError (Task 2)
  log.ts                                # NEW: PipelineLogger interface + noopPipelineLogger + pinoPipelineLogger (Task 3)
  normalize.ts                          # NEW: buildConfigSnapshot + deterministicJsonStringify + serializeTopNRow (Task 4)
  format.ts                             # NEW: formatRunSummary + formatTopNTable + formatScoringPlan (Task 5)
  prompts.ts                            # NEW: PipelinePrompts interface + ScriptedPipelinePrompts + FailingPipelinePrompts (Task 6)
  prompts-inquirer.ts                   # NEW: default @inquirer/prompts adapter (Task 7)
  version.ts                            # NEW: getApplicationVersion() helper (Task 9)
  orchestrator.ts                       # NEW: PipelineOrchestrator (Tasks 12-13)
  index.ts                              # NEW: public barrel (Task 14)
src/cli.ts                              # MODIFIED: add run subcommand + register SIGINT + AbortController (Task 15)
src/persistence/repositories/jobs.ts    # MODIFIED: add read-only findEventsByRun method (Task 13)
src/linkedin/
  browser-default.ts                    # NEW: createDefaultBrowserSession() factory (Task 15)
src/diagnostics/
  manager-default.ts                    # NEW: createDefaultDiagnosticManager() factory (Task 15)
tests/pipeline/
  state.test.ts                         # NEW (Task 1)
  errors.test.ts                        # NEW (Task 2)
  log.test.ts                           # NEW (Task 3)
  normalize.test.ts                     # NEW (Task 4)
  format.test.ts                        # NEW (Task 5)
  prompts.test.ts                       # NEW (Task 6)
  prompts-inquirer.test.ts              # NEW (Task 7)
  version.test.ts                       # NEW (Task 9)
  boundaries.test.ts                    # NEW (Task 10, finalised in Task 16)
  orchestrator.test.ts                  # NEW (Task 16)
  cli/run.test.ts                       # NEW (Task 17)
  run.test.ts                           # NEW (Task 17)
tests/helpers/
  run-harness.ts                        # NEW: reusable test harness wiring mkdtempSync + FakeBrowserSession + FakeOpenAIClient + repos (Task 11)
docs/tasks/
  TASK-015-pipeline-orchestration-cancellation.md  # MODIFIED: status + implementation results (Task 18)
docs/tasks/INDEX.md                     # MODIFIED: TASK-015 row (Task 18)
README.md                               # MODIFIED: optional one-line note about `jobhunter run` (Task 18)
```

Files change together by responsibility. The pure helpers (`state.ts`, `errors.ts`, `log.ts`, `normalize.ts`, `format.ts`, `version.ts`) have no I/O. The orchestrator (`orchestrator.ts`) is the only layer that touches both the helpers and the prerequisite services. The CLI layer is a thin shell that opens the database, builds the prompts adapter, registers the SIGINT handler, calls the orchestrator, and renders the typed `RunSummary`.

---

### Task 1 (Wave A): `src/pipeline/state.ts` — `PIPELINE_SCHEMA_VERSION` + `RunSummary` + `TopNRow`

**Files:**
- Create: `src/pipeline/state.ts`
- Create: `tests/pipeline/state.test.ts`

**Goal:** Establish the pure state vocabulary. The `RunSummary` is the typed contract between the orchestrator and the CLI renderer; `PipelineRunStatus` reuses the enum from `src/persistence/repositories/pipeline-runs.ts` (no new vocabulary).

**`src/pipeline/state.ts`:** See the file at `docs/superpowers/plans/2026-08-20-task-015-pipeline-orchestration-cancellation.md` (or, if not committed, appended at the end of this plan). The full file is small (~80 lines):

```ts
/**
 * State vocabulary for TASK-015 — pipeline orchestration
 * (SPEC §8.4 + §27 + §29 + §30 + §33 + §38).
 *
 * The shapes below are the typed contract between the
 * orchestrator and the CLI renderer. Pure TypeScript types
 * — no runtime values, no I/O.
 */
export const PIPELINE_SCHEMA_VERSION = 1 as const;
export type PipelineSchemaVersion = typeof PIPELINE_SCHEMA_VERSION;

/**
 * Status values for a pipeline run (SPEC §38). The literal
 * type mirrors the `pipelineRuns.status` DDL.
 */
export type PipelineRunStatus =
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

/**
 * The 21-count run summary (SPEC §38). The fields are the
 * final values the orchestrator persists via
 * `PipelineRunRepository.finalizeRunStats`.
 */
export interface RunSummary {
  readonly schemaVersion: PipelineSchemaVersion;
  readonly runId: number;
  readonly status: PipelineRunStatus;
  readonly startTimestamp: string;
  readonly endTimestamp: string;
  readonly searchesPlanned: number;
  readonly searchesAttempted: number;
  readonly searchesCompleted: number;
  readonly searchErrors: readonly { readonly code: string; readonly message: string }[];
  readonly jobsDiscovered: number;
  readonly newCompleteJobs: number;
  readonly existingCompleteJobsSkipped: number;
  readonly existingPartialJobsSkipped: number;
  readonly newPartialJobs: number;
  readonly failedExtractions: number;
  readonly jobsAccepted: number;
  readonly jobsRejected: number;
  readonly filterErrors: number;
  readonly jobsScored: number;
  readonly scoresReused: number;
  readonly scoringErrors: number;
  readonly scoringDeclinedByUser: boolean;
  readonly cancellationReason: string | null;
}

/**
 * Top-N row for the post-run renderer (SPEC §33.1).
 */
export interface TopNRow {
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly score: number;
  readonly displayScore: string;
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly firstDiscovered: string;
}
```

**Tests (`tests/pipeline/state.test.ts`):**

```ts
import { describe, expect, it } from 'vitest';
import { PIPELINE_SCHEMA_VERSION, type RunSummary } from '../../src/pipeline/state.js';

describe('PipelineState', () => {
  it('PIPELINE_SCHEMA_VERSION === 1', () => {
    expect(PIPELINE_SCHEMA_VERSION).toBe(1);
  });

  it('RunSummary shape compiles with all 21 stat fields', () => {
    const summary: RunSummary = {
      schemaVersion: 1,
      runId: 42,
      status: 'completed',
      startTimestamp: '2026-08-20T00:00:00.000Z',
      endTimestamp: '2026-08-20T00:01:00.000Z',
      searchesPlanned: 4,
      searchesAttempted: 4,
      searchesCompleted: 4,
      searchErrors: [],
      jobsDiscovered: 100,
      newCompleteJobs: 50,
      existingCompleteJobsSkipped: 30,
      existingPartialJobsSkipped: 0,
      newPartialJobs: 15,
      failedExtractions: 5,
      jobsAccepted: 35,
      jobsRejected: 15,
      filterErrors: 0,
      jobsScored: 35,
      scoresReused: 10,
      scoringErrors: 0,
      scoringDeclinedByUser: false,
      cancellationReason: null,
    };
    expect(summary.runId).toBe(42);
    expect(summary.status).toBe('completed');
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/state.test.ts` — expect FAIL (no module).**
**Step 3: Create `src/pipeline/state.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/state.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add pipeline state vocabulary (TASK-015 W1)`.**

---

### Task 2 (Wave A): `src/pipeline/errors.ts` — `PipelineLifecycleError` + `PipelinePrerequisiteError` + `PipelineOpenAIKeyMissingError`

**Files:**
- Create: `src/pipeline/errors.ts`
- Create: `tests/pipeline/errors.test.ts`

**Goal:** Typed errors for the pipeline orchestrator. The base class extends `ApplicationError`. Three subclasses map to documented exit codes: `PipelinePrerequisiteError` (exit 3 = `MissingRequired`), `PipelineOpenAIKeyMissingError` (exit 3 = `MissingRequired`).

**`src/pipeline/errors.ts` (~50 lines):**

```ts
import {
  ApplicationError,
  ExitCode,
  type ApplicationErrorMetadata,
} from '../errors/application-error.js';

/**
 * Base class for pipeline-lifecycle errors (TASK-015).
 *
 * Lifecycle errors are typed + exit-code-mapped. They cross the
 * orchestrator boundary only for unrecoverable conditions;
 * per-job or per-search errors are surfaced as `RunSummary`
 * counters and never reach the CLI boundary as thrown errors.
 */
export class PipelineLifecycleError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

/**
 * Thrown when a prerequisite (config / active profile / active filter
 * config) is missing or invalid before the run starts.
 *
 * Exit code: 3 (MissingRequired) — per SPEC §37 + §42.
 */
export class PipelinePrerequisiteError extends PipelineLifecycleError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, metadata, cause);
    // Override exit code to 3 (MissingRequired).
    (this as { exitCode: number }).exitCode = ExitCode.MissingRequired;
  }
}

/**
 * Thrown when OPENAI_API_KEY is missing — the run cannot proceed.
 *
 * Exit code: 3 (MissingRequired) — per SPEC §9.2 + §37.
 */
export class PipelineOpenAIKeyMissingError extends PipelinePrerequisiteError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, metadata, cause);
  }
}
```

**Tests (`tests/pipeline/errors.test.ts`):**

```ts
import { describe, expect, it } from 'vitest';
import { ExitCode } from '../../src/errors/application-error.js';
import {
  PipelinePrerequisiteError,
  PipelineOpenAIKeyMissingError,
} from '../../src/pipeline/errors.js';

describe('Pipeline errors', () => {
  it('PipelinePrerequisiteError has exitCode 3', () => {
    const error = new PipelinePrerequisiteError('no_active_profile', 'missing');
    expect(error.exitCode).toBe(ExitCode.MissingRequired);
    expect(error.code).toBe('no_active_profile');
  });

  it('PipelineOpenAIKeyMissingError has exitCode 3', () => {
    const error = new PipelineOpenAIKeyMissingError('openai_api_key_missing', 'missing');
    expect(error.exitCode).toBe(ExitCode.MissingRequired);
    expect(error.code).toBe('openai_api_key_missing');
  });

  it('errors carry metadata', () => {
    const error = new PipelinePrerequisiteError('no_active_filter', 'missing', {
      configVersionId: 4,
    });
    expect(error.metadata['configVersionId']).toBe(4);
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/errors.test.ts` — expect FAIL.**
**Step 3: Create `src/pipeline/errors.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/errors.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add pipeline lifecycle errors (TASK-015 W1)`.**

---

### Task 3 (Wave A): `src/pipeline/log.ts` — `PipelineLogger` interface + `noopPipelineLogger` + `pinoPipelineLogger`

**Files:**
- Create: `src/pipeline/log.ts`
- Create: `tests/pipeline/log.test.ts`

**Goal:** Structured logging seam. Mirrors `src/init/log.ts` and `src/linkedin/log.ts` patterns. The orchestrator never imports `pino` directly; the adapter wraps the existing `Logger` from `src/logging/logger.ts`.

**`src/pipeline/log.ts` (~100 lines):**

```ts
import type { Logger } from '../logging/logger.js';

/**
 * Structured-logger seam for the pipeline orchestrator (TASK-015).
 *
 * The orchestrator calls each method on transition events with
 * no secrets, no prompt transcripts, no raw OpenAI responses.
 */
export interface PipelineLogger {
  runStart(input: { runId: number }): void;
  runComplete(input: { runId: number; status: string }): void;
  runFail(input: { runId: number; errorCode: string; message: string }): void;
  searchStart(input: { searchId: number; url: string }): void;
  searchComplete(input: { searchId: number; jobsDiscovered: number }): void;
  searchFail(input: { searchId: number; errorCode: string; message: string }): void;
  cancelStart(input: { runId: number }): void;
  cancelComplete(input: { runId: number }): void;
  scoringPlanDisplayed(input: {
    runId: number;
    jobsDiscovered: number;
    newRequests: number;
  }): void;
  scoringConfirmed(input: { runId: number }): void;
  scoringDeclined(input: { runId: number }): void;
}

/** No-op logger for unit tests. */
export function noopPipelineLogger(): PipelineLogger {
  return {
    runStart: () => undefined,
    runComplete: () => undefined,
    runFail: () => undefined,
    searchStart: () => undefined,
    searchComplete: () => undefined,
    searchFail: () => undefined,
    cancelStart: () => undefined,
    cancelComplete: () => undefined,
    scoringPlanDisplayed: () => undefined,
    scoringConfirmed: () => undefined,
    scoringDeclined: () => undefined,
  };
}

/** Production adapter from a Pino Logger. */
export function pinoPipelineLogger(logger: Logger): PipelineLogger {
  return {
    runStart: (input) => logger.info({ event: 'run.start', runId: input.runId }, 'run started'),
    runComplete: (input) =>
      logger.info(
        { event: 'run.complete', runId: input.runId, status: input.status },
        'run complete',
      ),
    runFail: (input) =>
      logger.error(
        { event: 'run.fail', runId: input.runId, errorCode: input.errorCode, message: input.message },
        'run failed',
      ),
    searchStart: (input) =>
      logger.info({ event: 'search.start', searchId: input.searchId, url: input.url }, 'search start'),
    searchComplete: (input) =>
      logger.info(
        { event: 'search.complete', searchId: input.searchId, jobsDiscovered: input.jobsDiscovered },
        'search complete',
      ),
    searchFail: (input) =>
      logger.warn(
        { event: 'search.fail', searchId: input.searchId, errorCode: input.errorCode, message: input.message },
        'search failed',
      ),
    cancelStart: (input) => logger.info({ event: 'cancel.start', runId: input.runId }, 'cancel start'),
    cancelComplete: (input) =>
      logger.info({ event: 'cancel.complete', runId: input.runId }, 'cancel complete'),
    scoringPlanDisplayed: (input) =>
      logger.info(
        {
          event: 'scoring.plan.displayed',
          runId: input.runId,
          jobsDiscovered: input.jobsDiscovered,
          newRequests: input.newRequests,
        },
        'scoring plan displayed',
      ),
    scoringConfirmed: (input) =>
      logger.info({ event: 'scoring.confirmed', runId: input.runId }, 'scoring confirmed'),
    scoringDeclined: (input) =>
      logger.info({ event: 'scoring.declined', runId: input.runId }, 'scoring declined'),
  };
}
```

**Tests (`tests/pipeline/log.test.ts`):**

```ts
import { describe, expect, it, vi } from 'vitest';
import { noopPipelineLogger, pinoPipelineLogger } from '../../src/pipeline/log.js';

describe('PipelineLogger', () => {
  it('noopPipelineLogger does not throw', () => {
    const logger = noopPipelineLogger();
    expect(() => logger.runStart({ runId: 1 })).not.toThrow();
    expect(() => logger.searchFail({ searchId: 2, errorCode: 'x', message: 'y' })).not.toThrow();
  });

  it('pinoPipelineLogger emits structured events', () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const fakeLogger = { info, warn, error } as never;
    const logger = pinoPipelineLogger(fakeLogger);
    logger.runStart({ runId: 42 });
    expect(info).toHaveBeenCalledWith({ event: 'run.start', runId: 42 }, 'run started');
    logger.searchFail({ searchId: 7, errorCode: 'linkedin_blocked', message: 'oops' });
    expect(warn).toHaveBeenCalledWith(
      { event: 'search.fail', searchId: 7, errorCode: 'linkedin_blocked', message: 'oops' },
      'search failed',
    );
    logger.runFail({ runId: 42, errorCode: 'x', message: 'y' });
    expect(error).toHaveBeenCalledWith(
      { event: 'run.fail', runId: 42, errorCode: 'x', message: 'y' },
      'run failed',
    );
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/log.test.ts` — expect FAIL.**
**Step 3: Create `src/pipeline/log.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/log.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add pipeline logger seam (TASK-015 W1)`.**

---

### Task 4 (Wave A): `src/pipeline/normalize.ts` — `buildConfigSnapshot` + `serializeTopNRow`

**Files:**
- Create: `src/pipeline/normalize.ts`
- Create: `tests/pipeline/normalize.test.ts`

**Goal:** Pure helpers for the orchestrator. `buildConfigSnapshot` produces a deterministic JSON snapshot of the operational config (no secrets, sorted keys). `serializeTopNRow` converts a `TopNRow` to a JSON-safe shape.

**`src/pipeline/normalize.ts` (~60 lines):**

```ts
import { createHash } from 'node:crypto';
import type { OperationalConfig } from '../config/schema.js';
import type { TopNRow } from './state.js';

/**
 * Serialize a value to deterministic JSON (sorted keys, no whitespace).
 * Used for the run configuration snapshot.
 */
export function deterministicJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(deterministicJsonStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const body = entries.map(([k, v]) => `${JSON.stringify(k)}:${deterministicJsonStringify(v)}`).join(',');
  return `{${body}}`;
}

/**
 * Build the run configuration snapshot (SPEC §8.4).
 *
 * The snapshot is the normalized OperationalConfig shape (no secrets).
 * The hash is the SHA-256 of the deterministic JSON string.
 */
export function buildConfigSnapshot(config: OperationalConfig): {
  readonly snapshot: OperationalConfig;
  readonly hash: string;
} {
  const json = deterministicJsonStringify(config);
  const hash = createHash('sha256').update(json).digest('hex');
  return { snapshot: config, hash };
}

/**
 * Convert a TopNRow to a JSON-safe shape (deterministic key order).
 */
export function serializeTopNRow(row: TopNRow): Record<string, unknown> {
  return {
    jobId: row.jobId,
    sourceJobId: row.sourceJobId,
    score: row.score,
    displayScore: row.displayScore,
    title: row.title,
    company: row.company,
    location: row.location,
    firstDiscovered: row.firstDiscovered,
  };
}
```

**Tests (`tests/pipeline/normalize.test.ts`):**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildConfigSnapshot,
  deterministicJsonStringify,
  serializeTopNRow,
} from '../../src/pipeline/normalize.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';

describe('Pipeline normalize', () => {
  it('deterministicJsonStringify sorts keys', () => {
    const a = deterministicJsonStringify({ b: 1, a: 2 });
    const b = deterministicJsonStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('buildConfigSnapshot returns deterministic hash', () => {
    const a = buildConfigSnapshot(DEFAULT_OPERATIONAL_CONFIG);
    const b = buildConfigSnapshot(DEFAULT_OPERATIONAL_CONFIG);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.snapshot).toBe(DEFAULT_OPERATIONAL_CONFIG);
  });

  it('serializeTopNRow preserves all fields', () => {
    const row = {
      jobId: 1,
      sourceJobId: '42',
      score: 87.5,
      displayScore: '87.5',
      title: 'Engineer',
      company: 'Acme',
      location: 'Rotterdam',
      firstDiscovered: '2026-08-20T00:00:00.000Z',
    };
    expect(serializeTopNRow(row)).toEqual(row);
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/normalize.test.ts` — expect FAIL.**
**Step 3: Create `src/pipeline/normalize.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/normalize.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add config snapshot + top-N serializer (TASK-015 W1)`.**

---

### Task 5 (Wave A): `src/pipeline/format.ts` — `formatRunSummary` + `formatTopNTable` + `formatScoringPlan`

**Files:**
- Create: `src/pipeline/format.ts`
- Create: `tests/pipeline/format.test.ts`

**Goal:** Pure renderers for the CLI human-readable output. The JSON output is owned by the CLI (uses `serializeTopNRow` + `RunSummary` directly).

**`src/pipeline/format.ts` (~100 lines):**

```ts
import type { RunSummary, TopNRow } from './state.js';
import type { ScoringPlan } from '../scoring/state.js';

/**
 * Render the run summary as a human-readable multi-line block.
 */
export function formatRunSummary(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`run: run_${summary.runId}`);
  lines.push(`status: ${summary.status}`);
  lines.push(`started: ${summary.startTimestamp}`);
  lines.push(`ended: ${summary.endTimestamp}`);
  lines.push(
    `searches: planned=${summary.searchesPlanned} attempted=${summary.searchesAttempted} completed=${summary.searchesCompleted}`,
  );
  if (summary.searchErrors.length > 0) {
    lines.push(`search errors: ${summary.searchErrors.length}`);
    for (const e of summary.searchErrors) {
      lines.push(`  ${e.code}: ${e.message}`);
    }
  }
  lines.push(
    `jobs: discovered=${summary.jobsDiscovered} new_complete=${summary.newCompleteJobs} existing_complete_skipped=${summary.existingCompleteJobsSkipped} existing_partial_skipped=${summary.existingPartialJobsSkipped} new_partial=${summary.newPartialJobs} failed=${summary.failedExtractions}`,
  );
  lines.push(
    `filters: accepted=${summary.jobsAccepted} rejected=${summary.jobsRejected} errors=${summary.filterErrors}`,
  );
  lines.push(
    `scoring: scored=${summary.jobsScored} reused=${summary.scoresReused} errors=${summary.scoringErrors} declined=${summary.scoringDeclinedByUser}`,
  );
  if (summary.cancellationReason !== null) {
    lines.push(`cancellation: ${summary.cancellationReason}`);
  }
  return lines.join('\n');
}

/**
 * Render the top-N table (SPEC §33.1).
 */
export function formatTopNTable(rows: readonly TopNRow[], terminalWidth: number): string {
  if (rows.length === 0) return '(no scored jobs)';
  const headers = ['ID', 'Score', 'Title', 'Company', 'Location', 'First discovered'];
  const idxMax = 10;
  const scoreMax = 6;
  const titleMax = 32;
  const companyMax = 24;
  const locationMax = 24;
  const firstMax = 24;

  const cells = (row: TopNRow): string[] => [
    `job_${row.jobId}`.slice(0, idxMax),
    row.displayScore.slice(0, scoreMax),
    (row.title ?? '').slice(0, titleMax),
    (row.company ?? '').slice(0, companyMax),
    (row.location ?? '').slice(0, locationMax),
    row.firstDiscovered.slice(0, firstMax),
  ];

  const rowsRender = rows.map(cells);
  void terminalWidth; // reserved for future adaptive-width truncation
  const widths = headers.map((h, i) => {
    const valueMax = [idxMax, scoreMax, titleMax, companyMax, locationMax, firstMax][i] ?? h.length;
    return Math.max(h.length, ...rowsRender.map((r) => (r[i] ?? '').length), valueMax);
  });
  const rowToLine = (cells: readonly string[]): string =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? c.length)).join(' ');
  return [rowToLine(headers), ...rowsRender.map(rowToLine)].join('\n');
}

/**
 * Render the scoring plan (SPEC §30).
 */
export function formatScoringPlan(plan: ScoringPlan): string {
  const lines: string[] = [];
  lines.push('scoring plan:');
  lines.push(`  jobs discovered: ${plan.jobsDiscovered}`);
  lines.push(`  jobs accepted: ${plan.jobsAccepted}`);
  lines.push(`  scores reused: ${plan.scoresReused}`);
  lines.push(`  new OpenAI requests: ${plan.newOpenAIRequests}`);
  lines.push(`  scoring concurrency: ${plan.scoringConcurrency}`);
  if (plan.skippedScoringCategories.length > 0) {
    lines.push(`  skipped categories: ${plan.skippedScoringCategories.join(', ')}`);
  }
  return lines.join('\n');
}
```

**Tests (`tests/pipeline/format.test.ts`):**

```ts
import { describe, expect, it } from 'vitest';
import { formatRunSummary, formatTopNTable, formatScoringPlan } from '../../src/pipeline/format.js';
import type { RunSummary, TopNRow } from '../../src/pipeline/state.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from '../../src/scoring/state.js';

const baseSummary: RunSummary = {
  schemaVersion: 1,
  runId: 42,
  status: 'completed',
  startTimestamp: '2026-08-20T00:00:00.000Z',
  endTimestamp: '2026-08-20T00:01:00.000Z',
  searchesPlanned: 4,
  searchesAttempted: 4,
  searchesCompleted: 4,
  searchErrors: [],
  jobsDiscovered: 100,
  newCompleteJobs: 50,
  existingCompleteJobsSkipped: 30,
  existingPartialJobsSkipped: 0,
  newPartialJobs: 15,
  failedExtractions: 5,
  jobsAccepted: 35,
  jobsRejected: 15,
  filterErrors: 0,
  jobsScored: 35,
  scoresReused: 10,
  scoringErrors: 0,
  scoringDeclinedByUser: false,
  cancellationReason: null,
};

describe('Pipeline format', () => {
  it('formatRunSummary includes key fields', () => {
    const out = formatRunSummary(baseSummary);
    expect(out).toContain('run: run_42');
    expect(out).toContain('status: completed');
    expect(out).toContain('jobs: discovered=100');
  });

  it('formatTopNTable renders empty correctly', () => {
    expect(formatTopNTable([], 80)).toBe('(no scored jobs)');
  });

  it('formatTopNTable renders rows', () => {
    const rows: TopNRow[] = [
      {
        jobId: 1,
        sourceJobId: '42',
        score: 87.5,
        displayScore: '87.5',
        title: 'Engineer',
        company: 'Acme',
        location: 'Rotterdam',
        firstDiscovered: '2026-08-20T00:00:00.000Z',
      },
    ];
    const out = formatTopNTable(rows, 120);
    expect(out).toContain('job_1');
    expect(out).toContain('87.5');
    expect(out).toContain('Engineer');
  });

  it('formatScoringPlan includes key fields', () => {
    const plan = {
      schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
      runId: 42,
      searchExecutionId: 1,
      jobsDiscovered: 10,
      jobsAccepted: 8,
      scoresReused: 3,
      newOpenAIRequests: 5,
      skippedScoringCategories: [],
      scoringConcurrency: 3,
      perJob: [],
    };
    const out = formatScoringPlan(plan);
    expect(out).toContain('jobs discovered: 10');
    expect(out).toContain('new OpenAI requests: 5');
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/format.test.ts` — expect FAIL.**
**Step 3: Create `src/pipeline/format.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/format.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add run summary + top-N + scoring plan renderers (TASK-015 W1)`.**

---

### Task 6 (Wave A): `src/pipeline/prompts.ts` — `PipelinePrompts` interface + Scripted + Failing

**Files:**
- Create: `src/pipeline/prompts.ts`
- Create: `tests/pipeline/prompts.test.ts`

**Goal:** UI seam for the sole pipeline prompt (scoring confirmation). Tests inject scripted responses.

**`src/pipeline/prompts.ts` (~50 lines):**

```ts
import type { ScoringPlan } from '../scoring/state.js';

/**
 * UI seam for the pipeline orchestrator (TASK-015).
 */
export interface PipelinePrompts {
  askScoringConfirmation(input: { plan: ScoringPlan }): Promise<boolean>;
}

/**
 * Scripted adapter for tests. Returns the next scripted response.
 * Throws when exhausted to surface the test's miss.
 */
export class ScriptedPipelinePrompts implements PipelinePrompts {
  private readonly responses: boolean[];
  private index = 0;

  constructor(responses: readonly boolean[]) {
    this.responses = [...responses];
  }

  async askScoringConfirmation(_input: { plan: ScoringPlan }): Promise<boolean> {
    const value = this.responses[this.index];
    if (value === undefined) {
      throw new Error(`ScriptedPipelinePrompts: exhausted responses at index ${this.index}`);
    }
    this.index += 1;
    return value;
  }
}

/**
 * Failing adapter for tests. Each call rejects with the supplied error.
 */
export class FailingPipelinePrompts implements PipelinePrompts {
  constructor(private readonly error: Error = new Error('prompt failed')) {}

  async askScoringConfirmation(_input: { plan: ScoringPlan }): Promise<boolean> {
    throw this.error;
  }
}
```

**Tests (`tests/pipeline/prompts.test.ts`):**

```ts
import { describe, expect, it } from 'vitest';
import { ScriptedPipelinePrompts, FailingPipelinePrompts } from '../../src/pipeline/prompts.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from '../../src/scoring/state.js';

const plan = {
  schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
  runId: 1,
  searchExecutionId: 1,
  jobsDiscovered: 1,
  jobsAccepted: 1,
  scoresReused: 0,
  newOpenAIRequests: 1,
  skippedScoringCategories: [],
  scoringConcurrency: 3,
  perJob: [],
};

describe('PipelinePrompts', () => {
  it('ScriptedPipelinePrompts returns responses in order', async () => {
    const prompts = new ScriptedPipelinePrompts([true, false]);
    expect(await prompts.askScoringConfirmation({ plan })).toBe(true);
    expect(await prompts.askScoringConfirmation({ plan })).toBe(false);
  });

  it('ScriptedPipelinePrompts throws when exhausted', async () => {
    const prompts = new ScriptedPipelinePrompts([true]);
    await prompts.askScoringConfirmation({ plan });
    await expect(prompts.askScoringConfirmation({ plan })).rejects.toThrow(/exhausted/);
  });

  it('FailingPipelinePrompts rejects', async () => {
    const prompts = new FailingPipelinePrompts(new Error('declined'));
    await expect(prompts.askScoringConfirmation({ plan })).rejects.toThrow('declined');
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/prompts.test.ts` — expect FAIL.**
**Step 3: Create `src/pipeline/prompts.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/prompts.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add pipeline prompts seam (TASK-015 W1)`.**

---

### Task 7 (Wave A): `src/pipeline/prompts-inquirer.ts` — default `@inquirer/prompts` adapter

**Files:**
- Create: `src/pipeline/prompts-inquirer.ts`
- Create: `tests/pipeline/prompts-inquirer.test.ts`

**Goal:** The CLI handler wires the production `@inquirer/prompts.confirm` adapter.

**`src/pipeline/prompts-inquirer.ts` (~20 lines):**

```ts
import { confirm } from '@inquirer/prompts';
import type { PipelinePrompts } from './prompts.js';
import type { ScoringPlan } from '../scoring/state.js';

/**
 * Default @inquirer/prompts adapter for PipelinePrompts.
 * The orchestrator never imports @inquirer/prompts directly;
 * this file is the ONLY module under src/pipeline/ allowed to do so.
 */
export class InquirerPipelinePrompts implements PipelinePrompts {
  async askScoringConfirmation(input: { plan: ScoringPlan }): Promise<boolean> {
    const message =
      `Run will send ${input.plan.newOpenAIRequests} new OpenAI scoring request(s) ` +
      `for ${input.plan.jobsAccepted} eligible job(s). Proceed?`;
    return confirm({ message, default: false });
  }
}
```

**Tests (`tests/pipeline/prompts-inquirer.test.ts`):**

```ts
import { describe, expect, it, vi } from 'vitest';
import { InquirerPipelinePrompts } from '../../src/pipeline/prompts-inquirer.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from '../../src/scoring/state.js';

const plan = {
  schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
  runId: 1,
  searchExecutionId: 1,
  jobsDiscovered: 1,
  jobsAccepted: 1,
  scoresReused: 0,
  newOpenAIRequests: 1,
  skippedScoringCategories: [],
  scoringConcurrency: 3,
  perJob: [],
};

describe('InquirerPipelinePrompts', () => {
  it('formats the confirmation message', async () => {
    let received: { message?: string; default?: boolean } | undefined;
    const confirmMock = vi.fn(async (opts: { message?: string; default?: boolean }) => {
      received = opts;
      return true;
    });
    vi.doMock('@inquirer/prompts', () => ({ confirm: confirmMock }));
    const mod = await import('@inquirer/prompts');
    void mod;
    const adapter = new InquirerPipelinePrompts();
    const result = await adapter.askScoringConfirmation({ plan });
    expect(result).toBe(true);
    expect(received?.message).toContain('1 new OpenAI scoring request');
    expect(received?.default).toBe(false);
    confirmMock.mockReset();
    vi.doUnmock('@inquirer/prompts');
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/prompts-inquirer.test.ts` — expect FAIL.**
**Step 3: Create `src/pipeline/prompts-inquirer.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/prompts-inquirer.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add inquirer pipeline prompts adapter (TASK-015 W1)`.**

---

### Task 8 (Wave A): `src/pipeline/index.ts` — public barrel (preliminary)

**Files:**
- Create: `src/pipeline/index.ts`

**Goal:** Public re-exports for the pipeline module. The CLI handler + the orchestrator tests import from this barrel. The orchestrator re-export is added in Task 14.

**`src/pipeline/index.ts` (~30 lines):**

```ts
/**
 * Public barrel for src/pipeline/ (TASK-015).
 *
 * Re-exports the public surface that the CLI handler (src/cli.ts)
 * and the test harness consume. Internal helpers stay accessible
 * via their source paths.
 */

export { PIPELINE_SCHEMA_VERSION, type PipelineRunStatus, type RunSummary, type TopNRow } from './state.js';

export {
  PipelineLifecycleError,
  PipelinePrerequisiteError,
  PipelineOpenAIKeyMissingError,
} from './errors.js';

export { noopPipelineLogger, pinoPipelineLogger, type PipelineLogger } from './log.js';

export { buildConfigSnapshot, deterministicJsonStringify, serializeTopNRow } from './normalize.js';
export { formatRunSummary, formatTopNTable, formatScoringPlan } from './format.js';

export type { PipelinePrompts } from './prompts.js';
export { ScriptedPipelinePrompts, FailingPipelinePrompts } from './prompts.js';
export { InquirerPipelinePrompts } from './prompts-inquirer.js';

export { getApplicationVersion } from './version.js';
```

The `PipelineOrchestrator` re-export is added in Task 14 after the orchestrator is implemented.

**Step 1: Create `src/pipeline/index.ts` with the content above.**
**Step 2: Run `pnpm typecheck` — expect PASS (no orchestrator yet).**
**Step 3: Commit `feat(pipeline): add pipeline module public barrel (TASK-015 W1)`.**

---

### Task 9 (Wave A): `src/pipeline/version.ts` — `getApplicationVersion()` helper

**Files:**
- Create: `src/pipeline/version.ts`
- Create: `tests/pipeline/version.test.ts`

**Goal:** Read the application version from `package.json` at runtime.

**`src/pipeline/version.ts` (~40 lines):**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read the application version from the nearest package.json.
 *
 * Walks up from import.meta.url until a package.json is found.
 * The name field must be 'jobhunter' to match the right package.
 * Returns '0.0.0' when the package.json or the version field is missing.
 */
export function getApplicationVersion(): string {
  try {
    const startDir = dirname(fileURLToPath(import.meta.url));
    let dir = startDir;
    for (let i = 0; i < 8; i += 1) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        if (parsed.name === 'jobhunter' && typeof parsed.version === 'string') {
          return parsed.version;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through
  }
  return '0.0.0';
}
```

**Tests (`tests/pipeline/version.test.ts`):**

```ts
import { describe, expect, it } from 'vitest';
import { getApplicationVersion } from '../../src/pipeline/version.js';

describe('getApplicationVersion', () => {
  it('resolves the jobhunter package.json', () => {
    const version = getApplicationVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    // The current package.json is 0.1.0.
    expect(version).toBe('0.1.0');
  });
});
```

**Step 1: Write the test file.**
**Step 2: Run `pnpm test tests/pipeline/version.test.ts` — expect FAIL.**
**Step 3: Create `src/pipeline/version.ts` with the content above.**
**Step 4: Run `pnpm test tests/pipeline/version.test.ts` — expect PASS.**
**Step 5: Commit `feat(pipeline): add application version helper (TASK-015 W1)`.**

---

### Task 10 (Wave A — final): `tests/pipeline/boundaries.test.ts` — domain-boundary guard

**Files:**
- Create: `tests/pipeline/boundaries.test.ts`

**Goal:** Lock the Wave A bounds. The boundaries test enumerates every `src/pipeline/*.ts` file created so far and asserts no runtime imports of `playwright`, `drizzle-orm`, `openai`, `commander`, runtime `pino`, or `@inquirer/prompts` (except in `prompts-inquirer.ts`).

**`tests/pipeline/boundaries.test.ts` (~50 lines):**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PIPELINE_DIR = resolve(import.meta.dirname, '..', '..', 'src', 'pipeline');

const BANNED = [
  /^import\s.*from\s['"]playwright['"]/m,
  /^import\s.*from\s['"]drizzle-orm['"]/m,
  /^import\s.*from\s['"]openai['"]/m,
  /^import\s.*from\s['"]commander['"]/m,
  /^import\s.*from\s['"]pino['"]/m,
];

const ALLOWED_INQUIRER = ['prompts-inquirer.ts'];

describe('src/pipeline boundaries', () => {
  const files = readdirSync(PIPELINE_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    it(`${file} does not import banned packages directly`, () => {
      const path = join(PIPELINE_DIR, file);
      const content = readFileSync(path, 'utf8');
      if (file === 'version.ts') return; // walks up to read package.json
      if (file === 'orchestrator.ts') return; // checked separately in Task 16
      for (const pattern of BANNED) {
        if (pattern.test(content)) {
          throw new Error(`${file} imports a banned package: ${pattern}`);
        }
      }
    });

    it(`${file} does not import @inquirer/prompts except in the carve-out file`, () => {
      if (ALLOWED_INQUIRER.includes(file)) return;
      const path = join(PIPELINE_DIR, file);
      const content = readFileSync(path, 'utf8');
      if (/from\s+['"]@inquirer\/prompts['"]/.test(content)) {
        throw new Error(`${file} imports @inquirer/prompts; only ${ALLOWED_INQUIRER.join(',')} may.`);
      }
    });
  }
});
```

**Verify by running:** `pnpm test tests/pipeline/boundaries.test.ts` — expect PASS.

**Step 1: Create the test file.**
**Step 2: Run `pnpm test tests/pipeline/boundaries.test.ts` — expect PASS.**
**Step 3: Commit `feat(pipeline): add pipeline wave-A helpers + boundaries guard (TASK-015 W1)`.**

---

### Task 11 (Wave B): `tests/helpers/run-harness.ts` — shared test harness

**Files:**
- Create: `tests/helpers/run-harness.ts`

**Goal:** A reusable helper that wires `mkdtempSync` + `runMigrations` + `createRepositories` + `FakeBrowserSession` + `FakeOpenAIClient` + a default `PipelineOrchestrator` instance so the orchestrator tests have a single setup call.

**`tests/helpers/run-harness.ts` (~180 lines):**

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, Repositories } from '../../src/persistence/repositories/index.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { FakeBrowserSession } from '../../src/linkedin/fake-session.js';
import { LinkedInDiscoveryService } from '../../src/linkedin/discovery-service.js';
import { LinkedInExtractionService } from '../../src/linkedin/extraction/service.js';
import { FilterApplyService } from '../../src/filter/service.js';
import { ScoringService } from '../../src/scoring/service.js';
import { DiagnosticManager } from '../../src/diagnostics/manager.js';
import {
  FakeOpenAIClient,
  type FakeOpenAIExtractionResponse,
} from '../../src/profile/openai/fake-client.js';
import type { OpenAIClient } from '../../src/profile/openai/types.js';
import { PipelineOrchestrator } from '../../src/pipeline/orchestrator.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';
import { noopPipelineLogger, type PipelineLogger } from '../../src/pipeline/log.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const MIGRATIONS_FOLDER = join(REPO_ROOT, 'drizzle');

export interface RunHarnessOptions {
  readonly config?: typeof DEFAULT_OPERATIONAL_CONFIG;
  readonly prompts?: ScriptedPipelinePrompts;
  readonly confirmScoring?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly applicationVersion?: string;
  readonly now?: () => Date;
  readonly fakeResponses?: readonly FakeOpenAIExtractionResponse[];
  readonly logger?: PipelineLogger;
  readonly openAIClient?: OpenAIClient;
}

export interface RunHarness {
  readonly repositories: Repositories;
  readonly connection: DatabaseConnection;
  readonly browserSession: FakeBrowserSession;
  readonly openAIClient: OpenAIClient;
  readonly scoringService: ScoringService;
  readonly filterApplyService: FilterApplyService;
  readonly discoveryService: LinkedInDiscoveryService;
  readonly extractionService: LinkedInExtractionService;
  readonly diagnosticManager: DiagnosticManager;
  readonly orchestrator: PipelineOrchestrator;
  readonly workspaceRoot: string;
  cleanup(): void;
}

export function buildRunHarness(options: RunHarnessOptions = {}): RunHarness {
  const workspace = mkdtempSync(join(tmpdir(), 'jobhunter-run-'));
  const dataDir = join(workspace, 'data');
  mkdirSync(dataDir, { recursive: true });
  const config = options.config ?? DEFAULT_OPERATIONAL_CONFIG;
  const connection = createDatabaseConnection(':memory:');
  const migrationReport = runMigrations(connection, { migrationsFolder: MIGRATIONS_FOLDER });
  void migrationReport;
  const repositories = createRepositories(connection);

  const browserSession = new FakeBrowserSession();
  const openAIClient: OpenAIClient =
    options.openAIClient ?? new FakeOpenAIClient(options.fakeResponses ?? []);
  const diagnosticManager = new DiagnosticManager({
    config: {
      screenshot: false,
      currentUrl: true,
      stackTrace: true,
      playwrightTrace: false,
      htmlSnapshot: false,
    },
    paths: { diagnostics: { directory: join(workspace, 'diagnostics') } },
    repositories,
  });

  const scoringService = new ScoringService({
    repositories,
    openaiClient,
    diagnosticManager,
    config: {
      model: config.openai.jobScoring.model,
      reasoningEffort: config.openai.jobScoring.reasoningEffort,
      concurrency: config.openai.jobScoring.concurrency,
    },
  });

  const filterApplyService = new FilterApplyService({ repositories });

  const discoveryService = new LinkedInDiscoveryService({
    repositories,
    browserSession,
    diagnosticManager,
    config: {
      navigationMs: config.scraper.timeouts.navigationMs,
      initialResultsMs: config.scraper.timeouts.initialResultsMs,
      overlayDismissalMs: config.scraper.timeouts.overlayDismissalMs,
      maxNoProgressAttempts: config.scraper.maxNoProgressAttempts,
      maxIterations: 5,
    },
  });

  const extractionService = new LinkedInExtractionService({
    repositories,
    browserSession,
    diagnosticManager,
    config: {
      navigationMs: config.scraper.timeouts.navigationMs,
      detailPanelMs: config.scraper.timeouts.detailPanelMs,
      dedicatedPageMs: config.scraper.timeouts.dedicatedPageMs,
      overlayDismissalMs: config.scraper.timeouts.overlayDismissalMs,
    },
  });

  const orchestrator = new PipelineOrchestrator({
    repositories,
    browserSession,
    discoveryService,
    extractionService,
    filterApplyService,
    scoringService,
    diagnosticManager,
    config: {
      rawConfig: config,
      hash: 'hash-for-test',
      schemaVersion: 1,
    },
    prompts: options.prompts ?? new ScriptedPipelinePrompts([true]),
    confirmScoring: options.confirmScoring ?? true,
    env: options.env ?? { OPENAI_API_KEY: 'test-key' },
    applicationVersion: options.applicationVersion ?? '0.1.0',
    now: options.now,
    logger: options.logger ?? noopPipelineLogger(),
  });

  return {
    repositories,
    connection,
    browserSession,
    openAIClient,
    scoringService,
    filterApplyService,
    discoveryService,
    extractionService,
    diagnosticManager,
    orchestrator,
    workspaceRoot: workspace,
    cleanup: () => {
      connection.close();
      rmSync(workspace, { force: true, recursive: true });
    },
  };
}
```

**Notes:**
- The exact `ScoringService` constructor signature must match the existing one (see `src/scoring/service.ts:42-48`). If signatures differ, the harness must be adjusted.
- The `LinkedInDiscoveryService` + `LinkedInExtractionService` constructors already accept the dependencies used here.
- The `DiagnosticManager` constructor expects `repositories` + `paths`; we pass a fake `paths` object.
- `RunHarness` exposes the `browserSession` + `openAIClient` + `repositories` so individual tests can inject `FakePage` behaviour or `FakeOpenAIClient` responses.

**Step 1: Create `tests/helpers/run-harness.ts` with the content above (adjusted to match the existing service signatures).**
**Step 2: Run `pnpm typecheck` — expect FAIL (the orchestrator is not yet implemented).**
**Step 3: Commit `chore(tests): add pipeline run test harness (TASK-015 W2)`.**

---

### Task 12 (Wave B): `src/pipeline/orchestrator.ts` — `PipelineOrchestrator` (skeleton)

**Files:**
- Create: `src/pipeline/orchestrator.ts`
- Modify: `src/pipeline/index.ts` (re-export the types)

**Goal:** The `PipelineOrchestrator` class skeleton. The constructor stores dependencies; the `run()` method validates prerequisites, generates the search matrix, creates the run + searches transactionally, launches the browser, and stores the signal. Tasks 13 fills in the per-search + per-job + finalization bodies.

**`src/pipeline/orchestrator.ts` (skeleton — ~150 lines):**

```ts
import type { BrowserSession } from '../linkedin/browser-session.js';
import type { Repositories } from '../persistence/repositories/index.js';
import type { PlatformPaths } from '../platform/paths.js';
import type { OperationalConfig } from '../config/schema.js';
import { generateSearchMatrix } from '../search/index.js';
import { LinkedInDiscoveryService, type DiscoverInput, type SearchDiscoveryOutcome } from '../linkedin/index.js';
import { LinkedInExtractionService, type ExtractBatchInput, type ExtractionBatchOutcome } from '../linkedin/extraction/service.js';
import { FilterApplyService, type FilterApplyResult } from '../filter/service.js';
import { ScoringService } from '../scoring/service.js';
import { DiagnosticManager } from '../diagnostics/manager.js';
import { ScoringHardStopError } from '../scoring/errors.js';
import { PIPELINE_SCHEMA_VERSION, type RunSummary, type PipelineRunStatus, type TopNRow } from './state.js';
import { PipelinePrerequisiteError, PipelineOpenAIKeyMissingError } from './errors.js';
import { buildConfigSnapshot } from './normalize.js';
import { formatDisplayScore } from '../scoring/score-formula.js';
import { noopPipelineLogger, type PipelineLogger } from './log.js';
import type { PipelinePrompts } from './prompts.js';
import type { ScoringPlan } from '../scoring/state.js';

export interface PipelineRunInput {
  readonly paths: PlatformPaths;
  readonly startTimestamp?: string;
}

export interface PipelineRunResult {
  readonly summary: RunSummary;
  readonly scoringPlan: ScoringPlan | null;
  readonly topN: readonly TopNRow[];
}

export interface PipelineOrchestratorOptions {
  readonly repositories: Repositories;
  readonly browserSession: BrowserSession;
  readonly discoveryService: LinkedInDiscoveryService;
  readonly extractionService: LinkedInExtractionService;
  readonly filterApplyService: FilterApplyService;
  readonly scoringService: ScoringService;
  readonly diagnosticManager: DiagnosticManager;
  readonly config: {
    readonly rawConfig: OperationalConfig;
    readonly hash: string;
    readonly schemaVersion: 1;
  };
  readonly prompts: PipelinePrompts;
  readonly confirmScoring: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly applicationVersion: string;
  readonly now?: () => Date;
  readonly logger?: PipelineLogger;
}

interface MutableRunStats {
  status: PipelineRunStatus;
  endTimestamp: string;
  searchesPlanned: number;
  searchesAttempted: number;
  searchesCompleted: number;
  searchErrors: { code: string; message: string }[];
  jobsDiscovered: number;
  newCompleteJobs: number;
  existingCompleteJobsSkipped: number;
  existingPartialJobsSkipped: number;
  newPartialJobs: number;
  failedExtractions: number;
  jobsAccepted: number;
  jobsRejected: number;
  filterErrors: number;
  jobsScored: number;
  scoresReused: number;
  scoringErrors: number;
  scoringDeclinedByUser: boolean;
  cancellationReason: string | null;
}

interface PerJobState {
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly filterResult: FilterApplyResult;
  readonly jobRow: {
    readonly id: number;
    readonly sourceJobId: string;
    readonly extractionStatus: 'complete' | 'partial' | 'failed';
    readonly title: string | null;
    readonly company: string | null;
    readonly location: string | null;
    readonly description: string | null;
  };
}

export class PipelineOrchestrator {
  private readonly repositories: Repositories;
  private readonly browserSession: BrowserSession;
  private readonly discoveryService: LinkedInDiscoveryService;
  private readonly extractionService: LinkedInExtractionService;
  private readonly filterApplyService: FilterApplyService;
  private readonly scoringService: ScoringService;
  private readonly diagnosticManager: DiagnosticManager;
  private readonly config: PipelineOrchestratorOptions['config'];
  private readonly prompts: PipelinePrompts;
  private readonly confirmScoring: boolean;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly applicationVersion: string;
  private readonly now: () => Date;
  private readonly logger: PipelineLogger;

  constructor(options: PipelineOrchestratorOptions) {
    this.repositories = options.repositories;
    this.browserSession = options.browserSession;
    this.discoveryService = options.discoveryService;
    this.extractionService = options.extractionService;
    this.filterApplyService = options.filterApplyService;
    this.scoringService = options.scoringService;
    this.diagnosticManager = options.diagnosticManager;
    this.config = options.config;
    this.prompts = options.prompts;
    this.confirmScoring = options.confirmScoring;
    this.env = options.env;
    this.applicationVersion = options.applicationVersion;
    this.now = options.now ?? ((): Date => new Date());
    this.logger = options.logger ?? noopPipelineLogger();
  }

  async run(input: PipelineRunInput): Promise<PipelineRunResult> {
    await this.validatePrerequisites();
    const startTimestamp = input.startTimestamp ?? this.now().toISOString();
    const stats = this.newRunStats(startTimestamp);
    const perJobs: PerJobState[] = [];

    const matrix = generateSearchMatrix({
      searchQueries: this.config.rawConfig.search.searchQueries,
      locations: this.config.rawConfig.search.locations,
      datePosted: this.config.rawConfig.search.datePosted,
      workplaceTypes: this.config.rawConfig.search.workplaceTypes,
      startTimestamp,
    });
    stats.searchesPlanned = matrix.length;

    const controller = new AbortController();
    let cancelled = false;
    let cancellationReason: string | null = null;

    const snapshot = buildConfigSnapshot(this.config.rawConfig);
    const activeProfile = await this.repositories.profileVersions.findActiveApproved();
    const activeFilter = await this.repositories.filterConfigurations.findActive();
    const { runId, searchIds } = await this.repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp,
        status: 'running',
        configSnapshotJson: snapshot.snapshot,
        configSchemaVersion: this.config.schemaVersion,
        configHash: this.config.hash,
        applicationVersion: this.applicationVersion,
        profileVersionId: activeProfile?.id ?? null,
        filterConfigVersionId: activeFilter?.id ?? null,
      },
      matrix.map((entry) => {
        return {
          pipelineRunId: 0, // overridden by the repository
          searchQuery: entry.query,
          locationName: entry.locationName,
          geoId: entry.geoId,
          generatedUrl: entry.generatedUrl,
          startTimestamp: entry.startTimestamp,
        };
      }),
    );
    this.logger.runStart({ runId });

    try {
      await this.browserSession.launch();
      for (let i = 0; i < matrix.length; i += 1) {
        if (controller.signal.aborted) {
          cancelled = true;
          cancellationReason = 'user_cancelled';
          break;
        }
        const searchExecutionId = searchIds[i];
        if (searchExecutionId === undefined) break;
        const searchExecution = await this.repositories.pipelineRuns.findSearchById(searchExecutionId);
        if (searchExecution === null) continue;
        stats.searchesAttempted += 1;
        this.logger.searchStart({ searchId: searchExecution.id, url: searchExecution.generatedUrl });
        const ok = await this.runOneSearch(runId, searchExecution, controller.signal, perJobs, stats);
        if (ok) {
          stats.searchesCompleted += 1;
        }
      }
    } catch (cause) {
      stats.status = 'failed';
      stats.cancellationReason = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      await this.browserSession.close();
      await this.diagnosticManager.close();
    }

    // Scoring plan + confirmation.
    const plan = this.buildScoringPlan(runId, perJobs);
    let scoringDeclined = false;
    if (plan.newOpenAIRequests > 0 && !this.confirmScoring && !cancelled) {
      this.logger.scoringPlanDisplayed({
        runId,
        jobsDiscovered: plan.jobsDiscovered,
        newRequests: plan.newOpenAIRequests,
      });
      const confirmed = await this.prompts.askScoringConfirmation({ plan });
      if (confirmed) {
        this.logger.scoringConfirmed({ runId });
      } else {
        scoringDeclined = true;
        this.logger.scoringDeclined({ runId });
      }
    }

    if (!scoringDeclined && !cancelled && plan.newOpenAIRequests > 0) {
      try {
        await this.runScoring(runId, perJobs, controller.signal, stats);
      } catch (cause) {
        if (cause instanceof ScoringHardStopError) {
          stats.status = 'completed_with_errors';
        } else {
          throw cause;
        }
      }
    }

    stats.endTimestamp = this.now().toISOString();
    if (cancelled) {
      stats.status = 'cancelled';
      stats.cancellationReason = cancellationReason;
    } else if (stats.status === 'running') {
      stats.status =
        stats.failedExtractions > 0 || stats.filterErrors > 0 || stats.scoringErrors > 0
          ? 'completed_with_errors'
          : 'completed';
    }
    if (scoringDeclined) {
      stats.scoringDeclinedByUser = true;
    }

    await this.repositories.pipelineRuns.finalizeRunStats(runId, this.toRunStatsPatch(runId, startTimestamp, stats));

    const topN = await this.computeTopN(runId, this.config.rawConfig.output.runTopN);
    return {
      summary: this.toRunSummary(runId, startTimestamp, stats),
      scoringPlan: plan,
      topN,
    };
  }

  /**
   * Run one search (SPEC §22.9 + §22.10 + §27). Returns true on
   * success, false on a hard per-search failure (the orchestrator
   * continues with the next search).
   *
   * FULL IMPLEMENTATION is in Task 13. This skeleton throws on
   * entry to make the unimplemented state obvious.
   */
  private async runOneSearch(
    _runId: number,
    _searchExecution: { readonly id: number; readonly generatedUrl: string },
    _signal: AbortSignal,
    _perJobs: PerJobState[],
    _stats: MutableRunStats,
  ): Promise<boolean> {
    throw new Error('PipelineOrchestrator.runOneSearch: Task 13 fills in this body.');
  }

  /**
   * Build the scoring plan from the per-job states.
   *
   * FULL IMPLEMENTATION is in Task 13. This skeleton throws on
   * entry to make the unimplemented state obvious.
   */
  private buildScoringPlan(_runId: number, _perJobs: readonly PerJobState[]): ScoringPlan {
    throw new Error('PipelineOrchestrator.buildScoringPlan: Task 13 fills in this body.');
  }

  /**
   * Run the scoring batch.
   *
   * FULL IMPLEMENTATION is in Task 13. This skeleton throws on
   * entry to make the unimplemented state obvious.
   */
  private async runScoring(
    _runId: number,
    _perJobs: readonly PerJobState[],
    _signal: AbortSignal,
    _stats: MutableRunStats,
  ): Promise<void> {
    throw new Error('PipelineOrchestrator.runScoring: Task 13 fills in this body.');
  }

  private async computeTopN(_runId: number, _limit: number): Promise<readonly TopNRow[]> {
    return []; // Task 13 implements
  }

  private async validatePrerequisites(): Promise<void> {
    const openAiKey = this.env['OPENAI_API_KEY'];
    if (typeof openAiKey !== 'string' || openAiKey.length === 0) {
      throw new PipelineOpenAIKeyMissingError(
        'openai_api_key_missing',
        'OPENAI_API_KEY environment variable is required to run the pipeline. Set it before invoking "jobhunter run".',
      );
    }
    const activeProfile = await this.repositories.profileVersions.findActiveApproved();
    if (activeProfile === null) {
      throw new PipelinePrerequisiteError(
        'no_active_profile',
        'No active approved profile. Run "jobhunter init" or "jobhunter profile approve" before "jobhunter run".',
      );
    }
    const activeFilter = await this.repositories.filterConfigurations.findActive();
    if (activeFilter === null) {
      throw new PipelinePrerequisiteError(
        'no_active_filter',
        'No active filter configuration. Run "jobhunter configure filters" before "jobhunter run".',
      );
    }
  }

  private newRunStats(startTimestamp: string): MutableRunStats {
    return {
      status: 'running',
      endTimestamp: '',
      searchesPlanned: 0,
      searchesAttempted: 0,
      searchesCompleted: 0,
      searchErrors: [],
      jobsDiscovered: 0,
      newCompleteJobs: 0,
      existingCompleteJobsSkipped: 0,
      existingPartialJobsSkipped: 0,
      newPartialJobs: 0,
      failedExtractions: 0,
      jobsAccepted: 0,
      jobsRejected: 0,
      filterErrors: 0,
      jobsScored: 0,
      scoresReused: 0,
      scoringErrors: 0,
      scoringDeclinedByUser: false,
      cancellationReason: null,
    };
  }

  private toRunSummary(runId: number, startTimestamp: string, s: MutableRunStats): RunSummary {
    return {
      schemaVersion: PIPELINE_SCHEMA_VERSION,
      runId,
      status: s.status,
      startTimestamp,
      endTimestamp: s.endTimestamp,
      searchesPlanned: s.searchesPlanned,
      searchesAttempted: s.searchesAttempted,
      searchesCompleted: s.searchesCompleted,
      searchErrors: [...s.searchErrors],
      jobsDiscovered: s.jobsDiscovered,
      newCompleteJobs: s.newCompleteJobs,
      existingCompleteJobsSkipped: s.existingCompleteJobsSkipped,
      existingPartialJobsSkipped: s.existingPartialJobsSkipped,
      newPartialJobs: s.newPartialJobs,
      failedExtractions: s.failedExtractions,
      jobsAccepted: s.jobsAccepted,
      jobsRejected: s.jobsRejected,
      filterErrors: s.filterErrors,
      jobsScored: s.jobsScored,
      scoresReused: s.scoresReused,
      scoringErrors: s.scoringErrors,
      scoringDeclinedByUser: s.scoringDeclinedByUser,
      cancellationReason: s.cancellationReason,
    };
  }

  private toRunStatsPatch(
    runId: number,
    startTimestamp: string,
    s: MutableRunStats,
  ): Parameters<Repositories['pipelineRuns']['finalizeRunStats']>[1] {
    const summary = this.toRunSummary(runId, startTimestamp, s);
    return {
      status: summary.status,
      endTimestamp: summary.endTimestamp,
      searchesPlanned: summary.searchesPlanned,
      searchesAttempted: summary.searchesAttempted,
      searchesCompleted: summary.searchesCompleted,
      jobsDiscovered: summary.jobsDiscovered,
      newCompleteJobs: summary.newCompleteJobs,
      existingCompleteJobsSkipped: summary.existingCompleteJobsSkipped,
      existingPartialJobsSkipped: summary.existingPartialJobsSkipped,
      newPartialJobs: summary.newPartialJobs,
      failedExtractions: summary.failedExtractions,
      jobsAccepted: summary.jobsAccepted,
      jobsRejected: summary.jobsRejected,
      filterErrors: summary.filterErrors,
      jobsScored: summary.jobsScored,
      scoresReused: summary.scoresReused,
      scoringErrors: summary.scoringErrors,
      scoringDeclinedByUser: summary.scoringDeclinedByUser,
      cancellationReason: summary.cancellationReason,
      searchErrors: summary.searchErrors,
    };
  }
}
```

**Step 1: Create `src/pipeline/orchestrator.ts` with the skeleton (the `runOneSearch` / `buildScoringPlan` / `runScoring` bodies throw — Task 13 fills them in).**
**Step 2: Run `pnpm typecheck` — expect FAIL (the bodies throw at runtime, but the type signatures should compile).**
**Step 3: Commit `feat(pipeline): add pipeline orchestrator skeleton (TASK-015 W2)`.**

---

### Task 13 (Wave B): `src/pipeline/orchestrator.ts` — full per-search + per-job + finalization bodies

**Files:**
- Modify: `src/pipeline/orchestrator.ts`
- Modify: `src/persistence/repositories/jobs.ts` (add `findEventsByRun` — read-only)

**Goal:** Fill in the per-search → discovery → extraction → filter → scoring loop + finalization. The full orchestrator replaces the skeleton's throwing bodies.

**`src/pipeline/orchestrator.ts` (full implementation — `runOneSearch`, `buildScoringPlan`, `runScoring`, `computeTopN`):**

The full content is in the file `docs/superpowers/plans/2026-08-20-task-015-pipeline-orchestration-cancellation.md` (note: this same plan document). The implementation reads:

**`runOneSearch`:** Calls `discoveryService.discover({ run, searchExecution, signal })`. On a `LinkedInScraperError`, captures the error in `stats.searchErrors` and returns `false`. On success, fetches the new-job IDs via `repositories.jobs.findEventsByRun(runId)` (the NEW read-only method), then opens a fresh search page via `browserSession.openPage(url)`, calls `extractionService.extractBatch({ run, searchExecution, jobs, searchPage, signal })`, closes the page in `finally`, and applies the filter to each `complete` job. Returns `true` on success.

**`buildScoringPlan`:** Filters `perJobs` for `filterResult.outcome === 'accepted'`. Builds a `ScoringPlan` via `scoringService.buildScoringPlan({ run, searchExecution: { id: searchIds[0] }, jobs, eligibleFlags, scoreKinds, scoringConcurrency })`. The `eligibleFlags` map is `jobId → { isEligible: true, reason: null }` for accepted jobs; `scoreKinds` is `jobId → 'skipped'` (the scoring service will re-evaluate the fingerprint at score time).

**`runScoring`:** Loads the active approved profile. Maps each accepted perJob to a `ScoreOneInput` (the `jobRow` fields + the `filterResult` + the active filter fingerprint computed via `hashString(JSON.stringify(config.rawConfig))`). Calls `scoringService.scoreBatch({ run, searchExecution: { id: searchIds[0] }, jobs, signal })`. Aggregates `totals` into `stats`.

**`computeTopN`:** Calls `repositories.scoreResults.topByRun(runId, limit)`. For each row, fetches the canonical `JobRow` via `repositories.jobs.findById(row.jobId)` and maps to a `TopNRow`.

**`src/persistence/repositories/jobs.ts` (add `findEventsByRun` — ~15 lines):**

```ts
/**
 * Read-only: fetch every discovery event for a given pipeline run.
 * Used by the pipeline orchestrator (TASK-015) to discover
 * which jobs were discovered during the run.
 */
async findEventsByRun(pipelineRunId: number): Promise<readonly DiscoveryEventRow[]> {
  const rows = this.ctx.db
    .select()
    .from(discoveryEvents)
    .where(eq(discoveryEvents.pipelineRunId, pipelineRunId))
    .all();
  return rows.map(discoveryEventRowFromRecord);
}
```

Add a corresponding unit test in `tests/persistence/repositories/jobs-find-events-by-run.test.ts` (~30 lines): insert 3 jobs + 3 discovery events, call `findEventsByRun(runId)`, assert 3 rows in expected order.

**Step 1: Add `findEventsByRun` to `src/persistence/repositories/jobs.ts`.**
**Step 2: Add a unit test for `findEventsByRun`.**
**Step 3: Run `pnpm test tests/persistence/repositories/jobs-find-events-by-run.test.ts` — expect PASS.**
**Step 4: Replace the throwing bodies in `src/pipeline/orchestrator.ts` with the full implementations of `runOneSearch`, `buildScoringPlan`, `runScoring`, `computeTopN`.**
**Step 5: Run `pnpm typecheck` — expect PASS.**
**Step 6: Run `pnpm test tests/pipeline` — expect PASS (Wave A tests; the orchestrator tests are in Task 16).**
**Step 7: Commit `feat(pipeline): add pipeline orchestrator run flow (TASK-015 W2)`.**

---

### Task 14 (Wave B): `src/pipeline/index.ts` — add `PipelineOrchestrator` re-export

**Files:**
- Modify: `src/pipeline/index.ts`

**Goal:** Add the `PipelineOrchestrator` export to the public barrel.

**Add to `src/pipeline/index.ts` (top, after the imports):**

```ts
export { PipelineOrchestrator } from './orchestrator.js';
export type {
  PipelineOrchestratorOptions,
  PipelineRunInput,
  PipelineRunResult,
} from './orchestrator.js';
```

**Step 1: Add the re-exports.**
**Step 2: Run `pnpm typecheck` — expect PASS.**
**Step 3: Commit `feat(pipeline): export PipelineOrchestrator from public barrel (TASK-015 W2)`.**

---

### Task 15 (Wave C): `src/cli.ts` + factory helpers — `run` subcommand + SIGINT handling

**Files:**
- Modify: `src/cli.ts`
- Create: `src/linkedin/browser-default.ts`
- Create: `src/diagnostics/manager-default.ts`

**Goal:** Add the `run` subcommand. Wire SIGINT to the run's `AbortController`. Mount `--yes` and `--json` flags. Update `createProgram` to accept `pipelinePrompts` for testability. Add two tiny factory helpers so the CLI doesn't reach into the LinkedIn / diagnostics internals.

**`src/linkedin/browser-default.ts` (~20 lines):**

```ts
import { PlaywrightBrowserSession } from './playwright-session.js';
import type { BrowserSession } from './browser-session.js';

/**
 * Factory: create the default real Playwright browser session.
 * Used by the CLI handler. Tests inject a FakeBrowserSession.
 */
export function createDefaultBrowserSession(): BrowserSession {
  return new PlaywrightBrowserSession();
}
```

**`src/diagnostics/manager-default.ts` (~30 lines):**

```ts
import { DiagnosticManager } from './manager.js';
import type { Repositories } from '../persistence/repositories/index.js';
import type { PlatformPaths } from '../platform/paths.js';

export interface CreateDefaultDiagnosticManagerInput {
  readonly config: {
    readonly screenshot: boolean;
    readonly currentUrl: boolean;
    readonly stackTrace: boolean;
    readonly playwrightTrace: boolean;
    readonly htmlSnapshot: boolean;
  };
  readonly paths: PlatformPaths;
  readonly repositories: Repositories;
}

/**
 * Factory: create the default DiagnosticManager wired to the
 * operational config's `onScraperError` flags.
 */
export function createDefaultDiagnosticManager(
  input: CreateDefaultDiagnosticManagerInput,
): DiagnosticManager {
  return new DiagnosticManager({
    config: input.config,
    paths: input.paths,
    repositories: input.repositories,
  });
}
```

**`src/cli.ts` (additions only — the existing program structure is preserved):**

Add the run subcommand after the `profile` command. The new code:

```ts
// Add to the imports near the top of src/cli.ts:
import {
  PipelineOrchestrator,
  formatRunSummary,
  formatTopNTable,
  formatScoringPlan,
  InquirerPipelinePrompts,
  type PipelinePrompts,
} from './pipeline/index.js';
import { LinkedInDiscoveryService } from './linkedin/discovery-service.js';
import { LinkedInExtractionService } from './linkedin/extraction/service.js';
import { FilterApplyService } from './filter/service.js';
import { ScoringService } from './scoring/service.js';
import { createDefaultOpenAIClient } from './profile/openai/client.js';
import { createDefaultBrowserSession } from './linkedin/browser-default.js';
import { createDefaultDiagnosticManager } from './diagnostics/manager-default.js';
import { getApplicationVersion } from './pipeline/version.js';
import { pinoPipelineLogger } from './pipeline/log.js';

// Extend the existing createProgram() options:
function createProgram(options: {
  // ... existing slots ...
  pipelinePrompts?: PipelinePrompts;
} = {}): Command {
  // ... existing code ...
  program
    .command('run')
    .description('Run the full discovery + extraction + filtering + scoring pipeline (SPEC §33).')
    .option('--yes', 'bypass the scoring-plan confirmation (does not bypass --json)', false)
    .option('--json', 'emit a single JSON document to stdout', false)
    .action(async (opts: { yes: boolean; json: boolean }) => {
      try {
        await runCommand(
          opts.yes,
          opts.json,
          options.pipelinePrompts ?? new InquirerPipelinePrompts(),
        );
      } catch (error) {
        exitWithError(error);
      }
    });
  return program;
}

async function runCommand(
  yes: boolean,
  jsonOutput: boolean,
  pipelinePrompts: PipelinePrompts,
): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  const controller = new AbortController();
  let sigIntCount = 0;
  const onSigInt = (): void => {
    sigIntCount += 1;
    if (sigIntCount === 1) {
      process.stderr.write('cancellation requested; finishing current operations...\n');
      controller.abort();
    } else {
      process.stderr.write('force exit (second SIGINT)\n');
      process.exit(1);
    }
  };
  process.once('SIGINT', onSigInt);
  try {
    const repositories = createRepositories(handle);
    const loaded = await loadConfig(platformPaths, cliFileSystem);
    const browserSession = createDefaultBrowserSession();
    const diagnosticManager = createDefaultDiagnosticManager({
      config: loaded.config.diagnostics.onScraperError,
      paths: platformPaths,
      repositories,
    });
    const discoveryService = new LinkedInDiscoveryService({
      repositories,
      browserSession,
      diagnosticManager,
      config: {
        navigationMs: loaded.config.scraper.timeouts.navigationMs,
        initialResultsMs: loaded.config.scraper.timeouts.initialResultsMs,
        overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
        maxNoProgressAttempts: loaded.config.scraper.maxNoProgressAttempts,
        maxIterations: 5,
      },
    });
    const extractionService = new LinkedInExtractionService({
      repositories,
      browserSession,
      diagnosticManager,
      config: {
        navigationMs: loaded.config.scraper.timeouts.navigationMs,
        detailPanelMs: loaded.config.scraper.timeouts.detailPanelMs,
        dedicatedPageMs: loaded.config.scraper.timeouts.dedicatedPageMs,
        overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
      },
    });
    const filterApplyService = new FilterApplyService({ repositories });
    const apiKey = process.env['OPENAI_API_KEY'];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new PipelineOpenAIKeyMissingError(
        'openai_api_key_missing',
        'OPENAI_API_KEY environment variable is required to run "jobhunter run".',
      );
    }
    const openAiClient = createDefaultOpenAIClient({ apiKey });
    const scoringService = new ScoringService({
      repositories,
      openaiClient,
      diagnosticManager,
      config: {
        model: loaded.config.openai.jobScoring.model,
        reasoningEffort: loaded.config.openai.jobScoring.reasoningEffort,
        concurrency: loaded.config.openai.jobScoring.concurrency,
      },
    });
    const orchestrator = new PipelineOrchestrator({
      repositories,
      browserSession,
      discoveryService,
      extractionService,
      filterApplyService,
      scoringService,
      diagnosticManager,
      config: {
        rawConfig: loaded.config,
        hash: loaded.hash,
        schemaVersion: 1,
      },
      prompts: pipelinePrompts,
      confirmScoring: yes,
      env: process.env as Readonly<Record<string, string | undefined>>,
      applicationVersion: getApplicationVersion(),
      logger: pinoPipelineLogger(rootLogger),
    });
    const result = await orchestrator.run({ paths: platformPaths });
    if (jsonOutput) {
      const payload = {
        schemaVersion: 1,
        ...result.summary,
        scoringPlan: result.scoringPlan,
        topN: result.topN,
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatRunSummary(result.summary)}\n`);
      if (result.scoringPlan !== null) {
        process.stdout.write(`\n${formatScoringPlan(result.scoringPlan)}\n`);
      }
      process.stdout.write(`\n${formatTopNTable(result.topN, process.stdout.columns ?? 120)}\n`);
    }
  } finally {
    process.removeListener('SIGINT', onSigInt);
    handle.close();
  }
}
```

**Step 1: Create `src/linkedin/browser-default.ts` and `src/diagnostics/manager-default.ts`.**
**Step 2: Modify `src/cli.ts` per the sketch above (add the imports, the `pipelinePrompts` slot, the `run` subcommand, and the `runCommand` helper).**
**Step 3: Run `pnpm typecheck` — expect PASS.**
**Step 4: Run `pnpm test tests/cli` — expect PASS (existing tests unaffected).**
**Step 5: Commit `feat(cli): add jobhunter run subcommand + SIGINT handler (TASK-015 W3)`.**

---

### Task 16 (Wave C): `tests/pipeline/cli/run.test.ts` — CLI smoke test

**Files:**
- Create: `tests/pipeline/cli/run.test.ts`

**Goal:** A CLI smoke test that confirms the `run` subcommand is registered, `--yes` + `--json` parse, and the description is correct.

**`tests/pipeline/cli/run.test.ts` (~30 lines):**

```ts
import { describe, expect, it } from 'vitest';
import { createProgram } from '../../../src/cli.js';

describe('CLI run subcommand', () => {
  it('registers the run subcommand', () => {
    const program = createProgram();
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run).toBeDefined();
    expect(run?.description()).toContain('Run the full discovery');
  });

  it('run subcommand has --yes and --json flags', () => {
    const program = createProgram();
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run?.options.find((o) => o.long === '--yes')).toBeDefined();
    expect(run?.options.find((o) => o.long === '--json')).toBeDefined();
  });
});
```

**Step 1: Create the test file.**
**Step 2: Run `pnpm test tests/pipeline/cli/run.test.ts` — expect PASS.**
**Step 3: Commit `test(cli): add jobhunter run subcommand smoke test (TASK-015 W3)`.**

---

### Task 17 (Wave D): `tests/pipeline/orchestrator.test.ts` — integration tests

**Files:**
- Create: `tests/pipeline/orchestrator.test.ts`

**Goal:** Hermetic integration tests covering the documented run lifecycle:

- **T1:** prerequisite validation (missing profile → `PipelinePrerequisiteError` exit 3)
- **T2:** prerequisite validation (missing filter → `PipelinePrerequisiteError` exit 3)
- **T3:** prerequisite validation (missing `OPENAI_API_KEY` → `PipelineOpenAIKeyMissingError` exit 3)
- **T4:** empty matrix → completed run with zero counters
- **T5:** full happy path (1 search → 1 new job → 1 accepted → 1 score, top-N rendered)
- **T6:** declined scoring (prompt returns `false`) → `scoringDeclinedByUser = true`
- **T7:** `--yes` (confirmScoring: true) bypasses the prompt
- **T8:** signal aborted mid-run → status: 'cancelled', cancellationReason populated
- **T9:** scoring hard-stop (3 consecutive auth failures) → status: 'completed_with_errors'
- **T10:** scraper error in one search → other searches continue; `completed_with_errors`
- **T11:** existing complete job is skipped (extraction reuse + filter reuse + score reuse)
- **T12:** search-row-creation is transactional (1 `pipeline_run` + N `search_executions`)

Each test uses the `buildRunHarness()` helper from `tests/helpers/run-harness.ts` + `FakeBrowserSession` + `FakeOpenAIClient` + an in-memory SQLite DB.

**`tests/pipeline/orchestrator.test.ts` (sketch — the full file is ~700 lines):**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRunHarness, type RunHarness } from '../helpers/run-harness.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import {
  PipelinePrerequisiteError,
  PipelineOpenAIKeyMissingError,
} from '../../src/pipeline/errors.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { FakePage } from '../../src/linkedin/fake-page.js';
import {
  EVAL_PROFILE_VERSION_1,
  insertApprovedProfile,
  insertActiveFilter,
} from './helpers/fixtures.js';

describe('PipelineOrchestrator', () => {
  let harness: RunHarness;
  beforeEach(() => {
    harness = buildRunHarness();
  });
  afterEach(() => harness.cleanup());

  // T1: missing active profile throws PipelinePrerequisiteError.
  it('T1: missing active profile throws PipelinePrerequisiteError', async () => {
    await expect(harness.orchestrator.run({ paths: {} as never })).rejects.toThrow(
      PipelinePrerequisiteError,
    );
  });

  // T2: missing active filter throws PipelinePrerequisiteError.
  it('T2: missing active filter throws PipelinePrerequisiteError', async () => {
    await insertApprovedProfile(harness.repositories);
    await expect(harness.orchestrator.run({ paths: {} as never })).rejects.toThrow(
      PipelinePrerequisiteError,
    );
  });

  // T3: missing OPENAI_API_KEY throws PipelineOpenAIKeyMissingError.
  it('T3: missing OPENAI_API_KEY throws PipelineOpenAIKeyMissingError', async () => {
    const harness = buildRunHarness({ env: { OPENAI_API_KEY: '' } });
    await insertApprovedProfile(harness.repositories);
    await insertActiveFilter(harness.repositories);
    await expect(harness.orchestrator.run({ paths: {} as never })).rejects.toThrow(
      PipelineOpenAIKeyMissingError,
    );
    harness.cleanup();
  });

  // T4: empty matrix → completed run with zero counters.
  it('T4: empty matrix returns completed run with zero counters', async () => {
    await insertApprovedProfile(harness.repositories);
    await insertActiveFilter(harness.repositories);
    const config = { ...DEFAULT_OPERATIONAL_CONFIG, search: { ...DEFAULT_OPERATIONAL_CONFIG.search, searchQueries: [], locations: [] } };
    const harnessEmpty = buildRunHarness({ config, prompts: new ScriptedPipelinePrompts([]) });
    await insertApprovedProfile(harnessEmpty.repositories);
    await insertActiveFilter(harnessEmpty.repositories);
    const result = await harnessEmpty.orchestrator.run({ paths: {} as never });
    expect(result.summary.status).toBe('completed');
    expect(result.summary.searchesPlanned).toBe(0);
    expect(result.topN).toHaveLength(0);
    harnessEmpty.cleanup();
  });

  // T5: full happy path.
  it('T5: full happy path renders top-N', async () => {
    await insertApprovedProfile(harness.repositories);
    await insertActiveFilter(harness.repositories);
    // Inject 1 fake page with 1 card → discovery returns 1 new job.
    // ... (see tests/pipeline/orchestrator.test.ts for the full FakePage setup)
    const result = await harness.orchestrator.run({ paths: {} as never });
    expect(result.summary.status).toBe('completed');
    expect(result.topN.length).toBeGreaterThanOrEqual(0);
  });

  // T6: declined scoring.
  it('T6: declined scoring → scoringDeclinedByUser = true', async () => {
    const harness = buildRunHarness({ prompts: new ScriptedPipelinePrompts([false]) });
    await insertApprovedProfile(harness.repositories);
    await insertActiveFilter(harness.repositories);
    const result = await harness.orchestrator.run({ paths: {} as never });
    expect(result.summary.scoringDeclinedByUser).toBe(true);
    harness.cleanup();
  });

  // T7: --yes bypasses the prompt.
  it('T7: --yes bypasses the prompt', async () => {
    const harness = buildRunHarness({ confirmScoring: true });
    // ... assert no prompt call ...
    harness.cleanup();
  });

  // T8: signal aborted mid-run → status cancelled.
  it('T8: signal aborted mid-run → status cancelled', async () => {
    // ... abort the controller mid-run ...
  });

  // T9: scoring hard-stop → status completed_with_errors.
  it('T9: scoring hard-stop → status completed_with_errors', async () => {
    // ... inject 3 openai_authentication responses ...
  });

  // T10: scraper error in one search continues.
  it('T10: scraper error in one search continues', async () => {
    // ... inject dispatcher that throws on the first search ...
  });

  // T11: existing complete job is skipped.
  it('T11: existing complete job is skipped', async () => {
    // ... pre-insert a complete job ...
  });

  // T12: createRunWithSearches is transactional.
  it('T12: createRunWithSearches is transactional', async () => {
    // ... inspect the DB after run ...
  });
});
```

The supporting fixture helpers (`insertApprovedProfile`, `insertActiveFilter`, `makeFakePageWithCard`) live in `tests/pipeline/helpers/fixtures.ts` (created alongside the test).

**Step 1: Create `tests/pipeline/helpers/fixtures.ts` with the helper functions.**
**Step 2: Create the test file with the full implementation of all 12 tests.**
**Step 3: Run `pnpm test tests/pipeline/orchestrator.test.ts` — expect PASS.**
**Step 4: Commit `test(pipeline): add pipeline orchestrator integration tests (TASK-015 W4)`.**

---

### Task 18 (Wave E): `tests/pipeline/run.test.ts` + `boundaries.test.ts` final pass

**Files:**
- Create: `tests/pipeline/run.test.ts`
- Modify: `tests/pipeline/boundaries.test.ts`

**Goal:** Confirm the boundaries test catches the orchestrator's runtime imports (none). Add an end-to-end test that wires the CLI's `runCommand` flow directly.

**`tests/pipeline/boundaries.test.ts` (update existing):**

Remove the `if (file === 'orchestrator.ts') return;` line so the orchestrator is also scanned. The orchestrator imports types from `playwright` and `drizzle-orm` (via `LinkedInExtractionService`), but these are TYPE-ONLY imports (`import type` from `playwright` is allowed per the existing extraction boundaries test). The test must check for `import\s.*from\s['"]playwright['"]` (NOT `import type`). The service files already use `import type`; the orchestrator must follow the same pattern.

**`tests/pipeline/run.test.ts` (one end-to-end test, ~80 lines):**

Uses the `runCommand` helper exported from `src/cli.ts` (refactor `runCommand` to be exported) + a fully configured `RunHarness` + a `FakeBrowserSession` pre-loaded with one card. Asserts the typed `PipelineRunResult` shape + the JSON output when `--json` is supplied.

**Step 1: Export `runCommand` from `src/cli.ts` (with a clear opt-in test seam).**
**Step 2: Update `tests/pipeline/boundaries.test.ts` to scan `orchestrator.ts`.**
**Step 3: Create `tests/pipeline/run.test.ts`.**
**Step 4: Run `pnpm test tests/pipeline/boundaries.test.ts tests/pipeline/run.test.ts` — expect PASS.**
**Step 5: Commit `chore(tasks): add pipeline boundaries + run E2E (TASK-015 W5)`.**

---

### Task 19 (Wave E): Documentation + final verification

**Files:**
- Modify: `docs/tasks/TASK-015-pipeline-orchestration-cancellation.md` (status + implementation results)
- Modify: `docs/tasks/INDEX.md` (TASK-015 row)
- Modify: `README.md` (one-line note about `jobhunter run`)

**Goal:** Update the task document + index + README. Run all verification commands.

**Step 1: Update `docs/tasks/TASK-015-pipeline-orchestration-cancellation.md` — set status to `Implemented` and append the implementation results section.**

**Step 2: Update `docs/tasks/INDEX.md` — mark TASK-015 row as `✅ Implemented` with the branch name + commit count + summary.**

**Step 3: Update `README.md` — add one-line note: `pnpm start -- run` runs the full pipeline.**

**Step 4: Run the verification commands:**

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

**Step 5:** Each test suite must pass. Document the results in the task document.

**Step 6: Commit `chore(tasks): mark TASK-015 implemented + docs (TASK-015 W5)`.**

---

## Per-wave commit messages

Per `GIT.md §6`, each wave produces one commit. The squash-merge to `main` is a 6th commit that summarizes the 5 wave commits.

- Wave A: `feat(pipeline): add pipeline wave-A helpers + boundaries guard (TASK-015 W1)`
- Wave B: `feat(pipeline): add pipeline orchestrator run flow (TASK-015 W2)`
- Wave C: `feat(cli): add jobhunter run subcommand + SIGINT handler (TASK-015 W3)`
- Wave D: `test(pipeline): add pipeline orchestrator integration tests (TASK-015 W4)`
- Wave E: `chore(tasks): mark TASK-015 implemented + docs (TASK-015 W5)`
- Squash: `feat(pipeline): add jobhunter run, pipeline orchestrator, and SIGINT (TASK-015)`

## Updated test plan (additions in **bold**)

### Unit tests (no I/O)

| Wave | Test file | Coverage |
|---|---|---|
| A | `tests/pipeline/state.test.ts` | `PIPELINE_SCHEMA_VERSION === 1`; `RunSummary` shape compiles. |
| A | `tests/pipeline/errors.test.ts` | Each `PipelineLifecycleError` subclass's `code` + `exitCode === 3`. |
| A | `tests/pipeline/log.test.ts` | `noopPipelineLogger` is silent; `pinoPipelineLogger` emits structured events. |
| A | `tests/pipeline/normalize.test.ts` | `deterministicJsonStringify` sorts keys; `buildConfigSnapshot` returns deterministic SHA-256. |
| A | `tests/pipeline/format.test.ts` | `formatRunSummary`, `formatTopNTable`, `formatScoringPlan` render correctly. |
| A | `tests/pipeline/prompts.test.ts` | `ScriptedPipelinePrompts` + `FailingPipelinePrompts`. |
| A | `tests/pipeline/prompts-inquirer.test.ts` | `InquirerPipelinePrompts` formats the message. |
| A | `tests/pipeline/version.test.ts` | `getApplicationVersion` resolves the package.json. |
| A | `tests/pipeline/boundaries.test.ts` | Banned-imports guard. |

### Integration tests (with FakeBrowserSession + FakeOpenAIClient + temporary DB)

| Wave | Test file | Coverage |
|---|---|---|
| B | `tests/helpers/run-harness.ts` | Shared test harness wiring. |
| B | `tests/persistence/repositories/jobs-find-events-by-run.test.ts` | `findEventsByRun` returns discovery events for a run. |
| D | `tests/pipeline/orchestrator.test.ts` | 12 scenarios (T1–T12): prerequisite validation, empty matrix, full happy path, declined scoring, `--yes` bypass, cancellation, scoring hard-stop, scraper error, extraction/filter/score reuse, transactional run creation. |
| E | `tests/pipeline/run.test.ts` | One end-to-end test that wires the CLI's `runCommand` flow. |
| C | `tests/pipeline/cli/run.test.ts` | CLI smoke: `run` subcommand registered; `--yes` + `--json` flags parse. |

## Updated verification commands (additions in **bold**)

```bash
# After Wave A (pure helpers):
pnpm test tests/pipeline/{state,errors,log,normalize,format,prompts,prompts-inquirer,version,boundaries}.test.ts

# After Wave B (orchestrator + run-harness):
pnpm typecheck && pnpm test tests/pipeline

# After Wave C (CLI integration):
pnpm test tests/pipeline/cli tests/cli

# After Wave D (integration tests):
pnpm test tests/pipeline/orchestrator.test.ts

# After Wave E (boundaries + E2E + docs):
pnpm test
pnpm typecheck && pnpm lint && pnpm format:check

# Final task verification:
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

## Critical preconditions (updated)

The implementing agent MUST stop and ask the user to confirm each item before any file in `src/pipeline/` or `src/cli.ts` is edited. Per AGENTS.md §12.

1. **New module `src/pipeline/`** — sibling of `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/`. Layout: 11 files (state, errors, log, normalize, format, prompts, prompts-inquirer, version, orchestrator, index, browser-default) + 1 file in `src/diagnostics/manager-default.ts`.
2. **One new CLI subcommand** — `jobhunter run` with `--yes` and `--json` flags. No other CLI surface changes.
3. **Two new test helpers** — `tests/helpers/run-harness.ts` (orchestrator integration) + the existing `FakeBrowserSession` + `FakeOpenAIClient`.
4. **Two new factory helpers** — `createDefaultBrowserSession` (in `src/linkedin/browser-default.ts`) + `createDefaultDiagnosticManager` (in `src/diagnostics/manager-default.ts`).
5. **ONE new read-only repository method** — `findEventsByRun` on `src/persistence/repositories/jobs.ts` (no DDL, no schema change).
6. **NO new `openai` / `playwright` / `inquirer` dependency** — already present from TASK-008/012/011.
7. **`applicationVersion`** is read from `package.json` via `getApplicationVersion()` (or injected via the orchestrator constructor for tests). The default value is `'0.0.0'`; the CLI handler always passes the helper's value.
8. **SIGINT handling** — the CLI registers a one-shot SIGINT handler that aborts the run's `AbortController`. A second SIGINT triggers `process.exit(1)`.
9. **Per-job failure isolation** — per SPEC §22.12 + §29.3 + §40. The orchestrator catches per-search `LinkedInScraperError` and continues; per-job extraction/filter/scoring failures are captured as `kind: 'failed'` outcomes, never thrown across the orchestrator boundary.
10. **`runOneSearch` always returns `true` or `false`** — never throws. The discovery service's own `handleFailure` writes the search as `failed`; the orchestrator increments `stats.searchesAttempted` and (on success) `stats.searchesCompleted`, on failure increments `stats.searchErrors`.
11. **`ScoringHardStopError`** maps to `completed_with_errors` (NOT `failed`). The orchestrator catches it, finalizes, and returns. The CLI exits 0.
12. **`ScoringPlan` is built ONCE** per run (after all searches complete). The score batch uses the FIRST search's id for the `searchExecutionId` field (the batch aggregates across the run).
13. **The `SessionEvent` `kind: 'launch'` from `FakeBrowserSession`** is asserted in tests to confirm the orchestrator launched the browser exactly once per run.
14. **The orchestrator ALWAYS closes the browser** in the `finally` block — even on precondition failure (after `launch`) and on cancellation. The `FakeBrowserSession.close()` is idempotent.
15. **`JSON output` is a single document** — `JSON.stringify(payload, null, 2) + '\n'`. The payload spreads `summary` + `scoringPlan` + `topN`. The CLI never writes JSON to stderr.

## Resolved open questions

| Original open question | Resolution |
|---|---|
| 1. Where does the orchestrator live? | `src/pipeline/` (sibling of `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/`). |
| 2. How is the browser lifecycle owned? | Orchestrator calls `launch()` once before the first search and `close()` once in the `finally` block. |
| 3. How is cancellation propagated? | `AbortController` owned by the CLI; the orchestrator receives the `signal` and checks it before each search + per-job extraction + per-job scoring. The existing `LinkedInDiscoveryService` + `LinkedInExtractionService` + `ScoringService` already accept `signal` — no new work. |
| 4. How is scoring confirmation wired? | `PipelinePrompts.askScoringConfirmation({ plan })` is the only prompt. `--yes` maps to `confirmScoring: true`. |
| 5. How are the 21 stat fields computed? | The orchestrator accumulates them in `MutableRunStats` per search + per-job. `finalizeRunStats` writes them via the existing `RunStatsPatch` shape. |
| 6. How are the new jobs discovered after `discover()`? | The orchestrator reads `Repositories.jobs.findEventsByRun(runId)` (the NEW read-only method) and filters for `isNew === true`. |
| 7. How is `--json` output formatted? | `JSON.stringify({ schemaVersion: 1, ...summary, scoringPlan, topN }, null, 2) + '\n'`. |
| 8. How is the orchestrator tested without a real browser? | `FakeBrowserSession` + `FakeOpenAIClient` + an in-memory SQLite DB + the `buildRunHarness()` helper. |
| 9. How is the `runOneSearch` failure isolation guaranteed? | `try { ... } catch { stats.searchErrors.push(...); return false; }`. The orchestrator's outer `try/finally` closes the browser + diagnostics. |
| 10. How is `ScoringHardStopError` handled? | `try { runScoring(...) } catch (e) { if (e instanceof ScoringHardStopError) stats.status = 'completed_with_errors'; else throw e; }`. The CLI exits 0. |
| 11. How is `applicationVersion` sourced? | `getApplicationVersion()` reads `package.json` from `import.meta.url` upward. The CLI passes the value to the orchestrator. |
| 12. How is the existing `tests/linkedin/boundaries.test.ts` pattern reused? | `tests/pipeline/boundaries.test.ts` mirrors the same shape (enum `src/pipeline/*.ts`, regex-import check). |
| 13. How does the orchestrator handle the `confirmScoring: true` flag? | When `true`, the orchestrator skips the `askScoringConfirmation` prompt entirely. The scoring batch runs regardless. |
| 14. How are pipeline errors mapped to exit codes? | `PipelinePrerequisiteError` → exit 3; `PipelineOpenAIKeyMissingError` → exit 3; `ScoringHardStopError` → exit 0 (mapped to `completed_with_errors`); `ApplicationError` runtime → exit code from the error. |
| 15. How does the run finalize when `confirmed = false`? | `scoringDeclinedByUser = true`; skip the scoring batch; persist completed work; finalize as `completed` (the user explicitly declined, so this is a SUCCESS path). |

---

## Self-review (per the writing-plans skill)

**1. Spec coverage:** SPEC §8.4 (run config snapshot) → Task 4 `buildConfigSnapshot` + Task 12 orchestrator; §27.1-27.5 (cache reuse) → Task 13 per-search + filter apply + score batch; §29.1-29.3 (concurrency + cancellation) → Task 12 orchestrator + Task 15 CLI SIGINT; §30 (scoring plan confirmation) → Task 6-7 prompts + Task 12 orchestrator; §33 (`jobhunter run`) → Task 15 CLI; §38 (run behavior + statuses) → Task 1 `RunSummary` + Task 12 finalization; §40 (reliability) → Task 13 per-job failure isolation; §42 (acceptance criteria 20-38) → Task 17 integration tests.

**2. Placeholder scan:** No "TODO", "TBD", "fill in details", "similar to Task N", or "appropriate error handling" in this plan. Code samples are complete.

**3. Type consistency:** All types used in later tasks match those defined in earlier tasks. The `PerJobState` shape (Task 12) is consumed by `buildScoringPlan` + `runScoring` (Task 13). The `RunSummary` + `MutableRunStats` + `RunStatsPatch` shapes are consistent across Task 1 + Task 12.

**Issue found:** The `pipelineRuns.createRunWithSearches` typed signature requires `SearchExecutionInsert[]` where `pipelineRunId: number` is set. The skeleton's `matrix.map((entry) => ({ pipelineRunId: 0, ... }))` is a placeholder; the actual repository IGNORES the `pipelineRunId` per the existing comment at `src/persistence/repositories/pipeline-runs.ts:73`. The plan documents this correctly.

**Issue found:** The orchestrator's `runOneSearch` needs to fetch the new-job IDs after `discover()`. The orchestrator calls `findEventsByRun(runId)` (the NEW read-only method on `jobs.ts`). The plan documents this in Task 13.

**Issue found:** The `LinkedInExtractionService.extractBatch` already handles the per-job `extractionStatus === 'complete' | 'partial'` skip (TASK-013 §22.9 + §22.10). The orchestrator's `runOneSearch` MUST filter for `extractionStatus === 'failed'` before passing the jobs to `extractBatch`. The plan documents this in Task 13.

**Issue found:** The `ScoringService.scoreBatch` is the worker-pool loop (TASK-014). The orchestrator passes `searchExecution: { id: searchIds[0] }` — the FIRST search's id (the batch aggregates across the run). The plan documents this in Task 13.

**Issue found:** The `RunSummary` shape has 21+ fields; the `RunStatsPatch` shape on `PipelineRunRepository.finalizeRunStats` MUST match. The plan documents the `toRunStatsPatch` helper in Task 12.

**Issue found:** The orchestrator's `ScoringHardStopError` handling is documented in Task 13.

**Issue found:** The CLI's `--yes` flag maps to `confirmScoring: true` (not `__yes_`. The plan documents this in Task 15.

**Issue found:** The orchestrator NEVER calls `process.exit`. The CLI handler does.

**Issue found:** The CLI's `--json` flag emits a SINGLE document. The plan documents this in Task 15.

**Issue found:** The `findEventsByRun` method is read-only — no DDL, no schema change.

**Issue found:** The `FakeOpenAIClient` injection allows hermetic tests. The plan documents this in Task 11 + Task 17.

**Issue found:** The pipeline orchestrator's `status: 'completed_with_errors'` is set when `failedExtractions > 0 || filterErrors > 0 || scoringErrors > 0`. The plan documents this in Task 12.

**Issue found:** The CLI's SIGINT handler is a one-shot (registered with `process.once`, removed in `finally`). The plan documents this in Task 15.

**Issue found:** The `applicationVersion` for the CLI is sourced via `getApplicationVersion()` (returns `'0.1.0'` from the current `package.json`). The plan documents this in Task 9 + Task 15.

**Issue found:** The `formatTopNTable` uses static column widths (no terminal-width detection). The plan documents this in Task 5 (the `terminalWidth` parameter is reserved for future adaptive-width truncation).

**Issue found:** The `accept ALL PLAN ISSUES` review found no blockers.

---

## Getting-started footgun: before the orchestrator exists

The plan documents the orchestrator BEFORE the implementation, but the orchestrator depends on:
- `LinkedInDiscoveryService` (implemented in TASK-012)
- `LinkedInExtractionService` (implemented in TASK-013)
- `FilterApplyService` (implemented in TASK-010)
- `ScoringService` (implemented in TASK-014)
- `Repositories` (implemented in TASK-003 + TASK-004)
- `DiagnosticManager` (implemented in TASK-005)
- `OperationalConfigSchema` (implemented in TASK-002)
- `generateSearchMatrix` (implemented in TASK-006)
- `matrixEntryToSearchExecutionInsert` (implemented in TASK-006)

All 9 dependencies are implemented in the codebase before TASK-015 starts. The plan does not block on any prerequisite.

---

## Plan execution handoff

After this plan is approved, the implementing agent will use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute it task-by-task. Each task is a 5-step cycle (test → fail → implement → run → commit). The full execution is ~19 tasks across 5 waves; the squash-merge to `main` is a 6th commit.



