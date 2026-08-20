# TASK-014 Implementation Plan — OpenAI Scoring, Score Fingerprints, Weighted Scoring, and Ranking

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implement per-job OpenAI scoring + deterministic ranking for JobHunter (SPEC §25.1–25.8 + §26.1–26.5 + §27.3–27.4 + §30 + §41.1–41.2 + §44). The implementation lives in a new sibling module `src/scoring/` and surfaces a single application service `ScoringService.scoreOne()` + `scoreBatch()` that TASK-015 will invoke once per eligible job. The module is **CLI-free** in this task (no top-level `jobhunter` subcommand is added); TASK-015 owns the orchestrator that calls `scoreBatch()`. The scoring layer reuses the existing OpenAI client surface from `src/profile/openai/` (TASK-008) — `OpenAIClient` interface, `FakeOpenAIClient`, `RetryPolicy` (`runWithRetry`), `parseStructuredOutput`, and the manual JSON-Schema projection pattern. The scoring layer adds: (a) the 7-category rubric (per SPEC §26.2) with frozen `RUBRIC_VERSION`; (b) a scoring-specific Zod `ScoringStructuredOutputSchema` with `z.number().int().min(0).max(100)` per category + `z.enum` for inferred seniority + `.strict()` on every object; (c) a scoring prompt that excludes all SPEC §25.7 prohibited fields; (d) a `computeScoreFingerprint` (SHA-256 of canonical JSON with sorted keys, lowercase hex, defaults substituted for optional fields); (e) `computeOverallScore` + `formatDisplayScore` (full-precision weighted sum + one-decimal display); (f) `rankResults` (deterministic, no hidden factors); (g) a `ScoringService` that builds the prompt, calls the OpenAI client via `runWithRetry`, validates the structured output, computes the overall score in JobHunter (not OpenAI), and persists `scoreResults` + `openaiMetadata` atomically. No new schema, no new migration, no new CLI subcommand, no new direct dependency. The `scoring_input_too_large` guard is a hardcoded 200 KB byte-size pre-check (no `tiktoken` dependency). Score reuse + stale detection are fingerprint-driven; old results are preserved. Cancellation is `AbortSignal`-based; per-job failure isolation is guaranteed by `try/finally` + per-job error capture in `openaiMetadata`.

**Architecture:** A new `src/scoring/` sibling of `src/filter/`, `src/profile/`, `src/linkedin/extraction/` houses the layer. The pure layer (`src/scoring/rubric.ts`, `src/scoring/score-formula.ts`, `src/scoring/rank.ts`, `src/scoring/fingerprint.ts`, `src/scoring/plan.ts`, `src/scoring/state.ts`, `src/scoring/errors.ts`, `src/scoring/log.ts`) has no Playwright / no Drizzle / no Pino / no Commander / no Inquirer / no `openai` runtime imports. The OpenAI client surface (`src/profile/openai/`) is REUSED — `OpenAIClient.extract()` is the only method called (TASK-008); the scoring layer uses the existing surface with NO new methods added to the interface. The `runWithRetry` retry policy + the `OpenAIExtractionRequest.rawJsonText` response shape + the manual JSON-Schema projection are all REUSED unchanged. The scoring-specific prompt + structured output schema + fingerprint live in `src/scoring/` (not in `src/profile/openai/`). The orchestrator (`src/scoring/service.ts` → `ScoringService`) composes: `Repositories.scoreResults` (TASK-004 — REUSES the existing `findActiveByJob` + `activateResult` methods, NO new methods) + `openaiMetadata` (TASK-004), `DiagnosticManager.recordScraperError` (TASK-005 — with `DiagnosticScope.openaiRequestId` extension), the active approved profile + effective derived values (TASK-009), the filter fingerprint + filter result (TASK-010), the complete job record (TASK-013), `OperationalConfigSchema.openai.jobScoring.{model, reasoningEffort, concurrency}` (`src/config/schema.ts:120-130`, the `.strict()` schema — NO new config fields), and the `LinkedInScraperError` extension pattern (the scoring errors extend `ApplicationError` directly, exit `ExitCode.OpenAIFailure = 5`). **No new schema, no new migration, no new CLI subcommand, no new `openai` dependency, no new `playwright` dependency, no new repository method.** Cancellation is `AbortSignal`-based; per-job failure isolation is guaranteed by `try/finally` + per-job error capture in `openaiMetadata`. The `ScoringPlan` data structure is the input to TASK-015's confirmation UI (TASK-015 owns the UI; TASK-014 owns the data shape).

**Tech Stack:** NO new direct dependencies. Reuses everything TASK-008 already wired: `openai` (sole runtime importer remains `src/profile/openai/`), `zod` (TASK-002), `drizzle-orm` (TASK-003), `better-sqlite3` (TASK-003), `pino` (via the `Logger` facade at `src/logging/logger.ts`), `vitest` (TASK-001), `linkedom` (TASK-012 — for fixture HTML parsing; NOT used by the scoring layer). The boundaries test mirrors `tests/extraction/boundaries.test.ts` (TASK-013) and ALLOWS `playwright` (already in the codebase; not used by scoring), bans `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`, `pino` runtime in `src/scoring/`. The scoring service MAY import FROM `src/profile/openai/` (cross-module dependency is allowed — the OpenAI client + retry policy are owned there).

## Open decisions confirmed before implementation

These map to the 26 pinned decisions (1–26) in `.slim/deepwork/task-014-openai-scoring-ranking.md` and to the SPEC §25 + §26 + §27.3–27.4 + §30 + §41.1–41.2 + §44 references. The implementing agent must stop and ask the user to confirm all 26 resolutions — **plus the one `DiagnosticScope` field addition (`openaiRequestId`)** — before any file in `src/scoring/` is edited. (NOTE: the original plan proposed 3 new repository methods; the bounded remediation removed them in favor of REUSING the existing `findActiveByJob` + `activateResult` methods at `src/persistence/repositories/score-results.ts:92-184`.)

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Module location | New `src/scoring/` (sibling of `src/filter/`, `src/profile/`, `src/linkedin/extraction/`). Layout: `index.ts`, `state.ts`, `errors.ts`, `rubric.ts`, `score-formula.ts`, `rank.ts`, `fingerprint.ts`, `plan.ts`, `service.ts`, `log.ts`. The OpenAI client surface stays in `src/profile/openai/` (TASK-008) and is REUSED unchanged. | §5, AGENTS.md |
| 2 | Pure helpers | `rubric.ts` + `score-formula.ts` + `rank.ts` + `fingerprint.ts` + `plan.ts` are pure functions of their inputs (mirrors TASK-013's `normalize.ts` + `required-fields.ts` + `status.ts` + `detail-url.ts` + `fingerprint.ts` pattern + TASK-010's `evaluate.ts` + `fingerprint.ts` pattern). No I/O, no Playwright/Drizzle/Pino/`openai` runtime. | §41.1, AGENTS.md §4 |
| 3 | Per-job flow | `ScoringService.scoreOne({ run, searchExecution, job, profileVersion, effectiveDerivedValues, filterResult, signal }) → Promise<ScoringOutcome>`. Per-job sequence: (a) check eligibility via `isJobEligibleForScoring`; (b) read existing `scoreResults` row by fingerprint via the EXISTING `findActiveByJob(jobId, fingerprint)` (at `score-results.ts:148-184`); (c) if current fingerprint match → return `kind: 'reused'` with the cached `overallScore` (NO OpenAI call, NO new `openaiMetadata` row); (d) if no row (or fingerprint mismatch) → call OpenAI via `runWithRetry` (3 attempts, full-jitter backoff, 1 corrective retry for invalid structured output). Build prompt (excludes all SPEC §25.7 prohibited fields). Call OpenAI via the EXISTING `OpenAIClient.extract()` method (TASK-008; the request payload includes the new `maxCompletionTokens` field per F9). Validate the `rawJsonText` response via `JSON.parse` + `ScoringStructuredOutputSchema.safeParse` (mirrors `extraction-service.ts:340-353`). Compute `overallScore` in JobHunter via `computeOverallScore`. Format `displayScore` on read via `formatDisplayScore` (per F8 — not persisted). Persist `scoreResults` row + `openaiMetadata` row atomically inside `this.repositories.transact((txRepos) => ...)` (the sync callback pattern from `repositories/index.ts:50-58`); the `activateResult` method (at `score-results.ts:92-139`) atomically UPDATEs the previous active row to `active: false` AND INSERTs the new row with `active: true` — NO stale-detection inconsistency window. | §22, §25.3, §26, AGENTS.md §5 |
| 4 | Rubric definition | `RUBRIC: Readonly<Record<ScoringCategory, { weight: number; description: string }>>` with the 7 categories from SPEC §26.2: `technicalSkills` (30), `relevantExperience` (25), `roleResponsibilityFit` (20), `seniorityFit` (10), `domainIndustryFit` (5), `spokenLanguageCompatibility` (5), `locationWorkplaceCompatibility` (5). Frozen constants; bump `RUBRIC_VERSION` on any change (the version is part of the score fingerprint per §27.3). Exported from `src/scoring/rubric.ts`. | §26.2, §27.3 |
| 5 | Score formula | `computeOverallScore(categoryScores: Record<ScoringCategory, number>): number` returns the full-precision weighted sum (per SPEC §26.3): `0.30*technicalSkills + 0.25*relevantExperience + 0.20*roleResponsibilityFit + 0.10*seniorityFit + 0.05*domainIndustryFit + 0.05*spokenLanguageCompatibility + 0.05*locationWorkplaceCompatibility`. `formatDisplayScore(fullPrecision: number): string` returns one-decimal display value via `fullPrecision.toFixed(1)`. Pure. NO hidden bonuses/penalties (per §26.3). | §26.3, §26.4, §41.1 |
| 6 | Ranking | `rankResults(scores: readonly { sourceJobId: string; overallScore: number }[]): readonly RankedResult[]` sorts by `overallScore` descending, then `sourceJobId` ascending for exact ties. Pure. No recency/preference/discovery-order/filter-weight adjustments (per §26.5). No minimum threshold. | §26.5, §41.1 |
| 7 | Score fingerprint | `computeScoreFingerprint({ jobContentHash, profileVersionId, profileFingerprint, effectiveDerivedValuesHash, promptVersion, rubricVersion, model, reasoningEffort, modelConfig, scorerImplementationVersion }) → string`. SHA-256 of canonical JSON with sorted keys (RFC 8785 / JCS pattern). Lowercase hex (64 chars). Defaults substituted for optional fields before serialization. Mirrors the existing `src/profile/openai/fingerprint.ts` pattern + `src/profile/hashing.ts` (SHA-256). | §27.3, §41.1 |
| 8 | Eligibility | `isJobEligibleForScoring({ job, filterResult }): boolean` returns true iff `job.extractionStatus === 'complete' && filterResult.outcome === 'accepted' && filterResult.fingerprint === activeFilterFingerprint` (i.e., the current filter result is not stale). Per SPEC §26.1. Pure. | §26.1, §41.1 |
| 9 | Input-too-large handling | If `Buffer.byteLength(JSON.stringify(payload), 'utf8') > 200_000` (200 KB hardcoded), surface `ScoringInputTooLargeError` (exit 5, non-retryable per §25.8). NO silent truncation. NO retry. The 200 KB cap is conservative — ~50k tokens even with the densest encoding, well under the 400k-token context window of `gpt-5.x`. | §25.8, §41.1 |
| 10 | Concurrency | `scoreBatch(jobs, { concurrency: 3 })` uses a bounded async pool (a simple semaphore or `Promise.all` with chunked iteration). Default 3 per SPEC §25.5. `concurrency` is configurable via `OperationalConfigSchema.openai.jobScoring.concurrency` (already wired) and must be a positive integer. | §25.5, AGENTS.md §12 |
| 11 | Retry policy | REUSE `runWithRetry` from `src/profile/openai/retry.ts` with EXACT defaults: `maxAttempts: 3`, `baseDelayMs: 500`, `maxDelayMs: 8_000`, `jitter: 'full'`. The `invalid structured output` retry is the "corrective retry" — at most one (per SPEC §25.3). `Retry-After` header is parsed, clamped to `[0, maxDelayMs]`, applied once, consumed. NO new retry-policy code. | §25.3, §41.1 |
| 12 | Structured output schema | `ScoringStructuredOutputSchema` (Zod) with: 7 category objects (each: `score: z.number().int().min(0).max(100)`, `explanation: z.string()`, `evidence: z.array(z.string())`) + `keyMatches: z.array(z.string())` + `importantGaps: z.array(z.string())` + `importantConcerns: z.array(z.string())` + `inferredSeniority: z.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'unknown'])` + `recommendationSummary: z.string()`. Every nested object uses `.strict()` to reject unknown keys. Bump `SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION` on any change. Reuse the manual JSON-Schema projection from `src/profile/openai/prompt.ts` to pass the schema to OpenAI. Set `max_completion_tokens: 2000`. | §25.2, §26.2, §41.1 |
| 13 | Prompt | `buildScoringPrompt({ profile, facts, effectiveDerivedValues, job, rubric, promptVersion })` returns a `[{ role: 'system' | 'user', content: string }]` array. System prompt: "You are a job-matching scorer. Return a JSON object matching the schema." User prompt: includes profile summary + extracted facts + effective derived values + normalized title/company/location/description + the 7-category rubric + the structured-output schema. EXCLUDES (per SPEC §25.7): DB IDs, revision history, CV source excerpts, original paths, extraction diagnostics, previous filter results, previous scores, run metadata, logs, diagnostic artifacts. The prompt version is part of the score fingerprint. | §25.7, §41.1 |
| 14 | Persistence | `Repositories.scoreResults` for the validated structured output + `overallScore` (full precision) + `fingerprint` + `jobId` + `runId` + `searchExecutionId` + `active` (true for the active row, false for stale) + `timestamp` (the row's createdAt/updatedAt live on this single column — `src/persistence/schema.ts:451`). `displayScore` is COMPUTED ON READ via `formatDisplayScore(overallScore)` (per Decision 5) — NOT persisted (no migration needed; matches the `formatDisplayScore` helper's pure-function contract). `attemptCount` lives on the `openaiRequestMetadata` row, not on `scoreResults`. `Repositories.openaiMetadata` for the request metadata (operation type, input hashes, prompt version, structured-output schema version, model, reasoning effort, request configuration, token usage, validated output, attempt count, start/end timestamps, errors). Per SPEC §25.4: NO raw prompts/responses persisted. | §25.4, §23.2, AGENTS.md §6 |
| 15 | Stale detection | REUSE the existing `Repositories.scoreResults.findActiveByJob(jobId, fingerprint) → ScoreResultRow | null` (already at `src/persistence/repositories/score-results.ts:148-184` — NO new method). If `null`, no active score → score new. If row exists but fingerprint mismatch → call `activateResult(input)` (existing at `score-results.ts:92-139`) which atomically UPDATEs the previous active row to `active: false` AND INSERTs the new row with `active: true` in a single `db.transaction` (NO stale-detection inconsistency window; the partial unique index on `active = 1` at `schema.ts:457-459` enforces the invariant). Old row remains stored per SPEC §27.4. | §27.3, §27.4, §41.1 |
| 16 | Diagnostics | `DiagnosticManager.recordScraperError` (reused — TASK-005) with `scope: { pipelineRunId, jobId, openaiRequestId? }`. `DiagnosticScope` is EXTENDED to add `openaiRequestId?: number | null` (no schema change — method addition only). The new field is included in the filename via `resolveScopeDirectory` + `buildSafeFilename`. | §39, AGENTS.md §5 |
| 17 | Cancellation seam | `AbortSignal` propagated from orchestrator (TASK-015) to `scoreBatch`. The signal is checked BETWEEN OpenAI calls (not mid-call). On abort, finalize the current batch: persist partial results (the rows already started), mark unfinished jobs as `kind: 'cancelled'`, close the OpenAI client (TASK-015's responsibility), return. **No retry.** | §29.3, §40, AGENTS.md §5 |
| 18 | Per-attempt error codes | Stable strings persisted in `openaiMetadata.errorCode` + surfaced in `ScoringOutcome`: `openai_authentication`, `openai_permission`, `openai_billing`, `openai_invalid_request`, `openai_unsupported_model` (non-retryable); `openai_rate_limit`, `openai_server_error`, `openai_timeout`, `openai_network_error`, `openai_invalid_output` (retryable); `scoring_input_too_large` (non-retryable, per §25.8); `unknown_failure`. All lower_snake_case. | §25.3, §25.8, §41.1 |
| 19 | Typed errors | `ScoringError` base (extends `ApplicationError`, exit `ExitCode.OpenAIFailure = 5`). Subclasses: `ScoringInputTooLargeError` (non-retryable; per §25.8), `ScoringInvalidStructuredOutputError` (retryable once per §25.3), `ScoringPersistenceError` (non-retryable; DB error), `ScoringFingerprintMismatchError` (internal; surfaces data corruption). Per-job errors are NOT thrown across the `scoreOne` boundary — surfaced via `ScoringOutcome.kind: 'failed'` and persisted to `openaiMetadata` with `success: false`. The orchestrator catches `ScoringError` only for hard-stop conditions (e.g., 3 consecutive authentication failures). | §25, §22.12, AGENTS.md §10 |
| 20 | `ScoringService` public API | `scoreOne({ run, searchExecution, job, profileVersion, effectiveDerivedValues, filterResult, signal }) → Promise<ScoringOutcome>`. `scoreBatch({ run, searchExecution, jobs, profileVersion, effectiveDerivedValues, filterResults, signal, onProgress? }) → Promise<ScoringBatchOutcome>` (helper for the per-search loop). Returns `{ schemaVersion, jobId, sourceJobId, kind: 'reused' | 'complete' | 'failed' | 'skipped' | 'cancelled', overallScore?, displayScore?, fingerprint, attempted, errorCode?, artifactIds }`. The `ScoringBatchOutcome` aggregates per-job outcomes + totals `{ complete, partial, failed, reused, skipped, cancelled }`. | §22, §41.1, AGENTS.md §5 |
| 21 | `ScoringPlan` data structure | `buildScoringPlan({ run, searchExecution, jobs, profileVersion, effectiveDerivedValues, filterResults, scoreResults }) → ScoringPlan` — the data structure consumed by TASK-015's confirmation UI. Returns `{ schemaVersion, runId, searchExecutionId, jobsDiscovered, jobsAccepted, scoresReused, newOpenAIRequests, skippedScoringCategories, scoringConcurrency, perJob: readonly { jobId, sourceJobId, kind, isEligible, estimatedInputBytes, reason? } }`. Pure (no I/O — the caller resolves the data; TASK-014's `service.ts` calls `buildScoringPlan` after resolving). | §30, AGENTS.md §5 |
| 22 | Fixture harness | New `tests/scoring/fixtures/` directory with: `scoring-input-job.json` (a complete job with all 4 fields populated), `scoring-input-payload.json` (the assembled OpenAI request body, with NO prohibited fields per §25.7), `scoring-output-valid.json` (a valid structured response), `scoring-output-malformed.json` (fails Zod validation — invalid JSON syntax), `scoring-output-category-out-of-bounds.json` (score 150, violates `.max(100)`), `scoring-output-missing-field.json` (no `recommendationSummary`), `scoring-output-extra-field.json` (extra `secretNote` field, violates `.strict()`), `scoring-output-decimal-score.json` (score 87.5, violates `.int()`), `scoring-output-unknown-seniority.json` (seniority "intern", not in the enum). Reuses `loadFixture` helper from `tests/linkedin/fixtures/loadFixture.ts`. | §41.1, §41.2 |
| 23 | Integration test seam | New `tests/scoring/helpers/fake-scoring-pipeline.ts` — a helper that wires the `FakeOpenAIClient` (from `src/profile/openai/fake-client.ts`) into the `ScoringService` for hermetic integration tests. The fake client can be programmed to return specific responses (valid, malformed, timeout, rate-limit, etc.) per call. NO fake repositories — the integration test uses the REAL `createRepositories(connection)` over a `mkdtempSync` DB (mirrors the TASK-013 pattern at `tests/extraction/service.test.ts`). | §41.2 |
| 24 | No new schema/migration | All tables used (`scoreResults`, `openaiMetadata`, `pipelineRuns`, `diagnosticArtifacts`) already exist (`src/persistence/schema.ts:387-419` area, exact line numbers to verify). The plan MUST NOT add DDL. The plan MUST NOT add new repository methods — REUSE the existing `findActiveByJob` + `activateResult` (at `score-results.ts:92-184`). The only method addition is the `DiagnosticScope.openaiRequestId` field (no DDL). | §23, AGENTS.md §12 |
| 25 | Live tests | TASK-014 extends `tests/live/linkedin.test.ts` (already created in TASK-012/013) with: (a) score a public LinkedIn job-detail page end-to-end; (b) assert `overallScore` is a valid number (0-100); (c) assert `displayScore` matches `overallScore.toFixed(1)`; (d) assert the structured output has all 7 categories. Still `LINKEDIN_LIVE=1` gated. | §41.3 |
| 26 | Boundaries guard | New `tests/scoring/boundaries.test.ts` (mirror `tests/extraction/boundaries.test.ts`): enumerates `src/scoring/*.ts`, bans runtime imports of `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`, runtime `pino`. NO `DRIZZLE_ORM_ALLOW_LIST` carve-out needed — the service uses `this.repositories.transact(...)` (the sync callback pattern from `src/persistence/repositories/index.ts:50-58`) which goes through the repositories' methods and does NOT import `drizzle-orm` directly. The scoring service MAY import FROM `src/profile/openai/` (cross-module dependency is allowed). The `openai` runtime import lives in `src/profile/openai/client.ts` (TASK-008) — `src/scoring/` MUST NOT import the `openai` package directly. | §5, §9, AGENTS.md §5 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0` (`package.json:7, 9`). No new LLM provider, job source, UI framework, hosted service, or authentication system. NO new direct dependency — reuses `openai` (TASK-008) + `zod` (TASK-002) + `drizzle-orm` (TASK-003) + `better-sqlite3` (TASK-003) + `pino` (TASK-002) + `vitest` (TASK-001) + `linkedom` (TASK-012).
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"` (`tsconfig.json:3-4`). Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables` (`tsconfig.json:6-8`). No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach` (AGENTS.md §4).
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/scoring/` — except the service layer's potential transaction writes — **must not** import Commander, Inquirer, Drizzle directly, the `openai` SDK, or Pino directly. The `LinkedInScraperError` pattern is the seam; the scoring service takes the logger via constructor injection. `src/scoring/{rubric,score-formula,rank,fingerprint,plan,state,errors,log}.ts` are pure (no Playwright / Drizzle / Pino / `openai`).
- **OpenAI isolation:** The `openai` SDK lives in `src/profile/openai/client.ts` (TASK-008). `src/scoring/` MUST NOT import the `openai` package directly. The scoring service uses `OpenAIClient` (the interface) which is implemented by `OpenAIHttpClient` (real) + `FakeOpenAIClient` (test). Cross-module imports from `src/scoring/` to `src/profile/openai/` ARE allowed.
- **Validation:** Zod at every external boundary. `OperationalConfigSchema` is the canonical config validator (TASK-002). Persisted row JSON columns are revalidated via the repository methods directly. The new constants added by this task are `RUBRIC_VERSION`, `SCORING_PROMPT_VERSION`, `SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION`, `SCORER_IMPLEMENTATION_VERSION`, `LINKEDIN_SCORING_SCHEMA_VERSION = 1`.
- **Errors:** Typed errors extending `ApplicationError`. The `ScoringError` family lives in `src/scoring/errors.ts` and extends `ApplicationError` directly. Exit-code mapping follows Decision 19 + Decision 26. The orchestrator throws typed errors for unrecoverable conditions; per-job errors are surfaced as `ScoringOutcome.kind: 'failed'` and written to `openaiMetadata` with `success: false`.
- **History preservation (AGENTS.md §6):** Scoring never deletes, resets, or supersedes historical score results. New scores are inserted via `scoreResults.activateResult`; re-scores atomically mark the old row inactive (`active: false`) and insert a new row with `active: true` in a single `db.transaction` (the existing `activateResult` method at `src/persistence/repositories/score-results.ts:92-139`). The orchestrator never deletes from `scoreResults` or `openaiMetadata`.
- **Determinism:** The pure helpers (`rubric.ts`, `score-formula.ts`, `rank.ts`, `fingerprint.ts`, `plan.ts`) are pure functions of their inputs. The `FakeOpenAIClient` makes integration tests deterministic by serving canned responses. `computeScoreFingerprint` is a pure function of the canonical JSON.
- **Tests:** Vitest. Pure-formula tests use direct unit tests. Integration tests use Vitest + `FakeOpenAIClient` + real DB (via `mkdtempSync` + `createDatabaseConnection` + `runMigrations` + `createRepositories` pattern from `tests/init/init-service.test.ts:176-185`). Live tests are guarded by `process.env['LINKEDIN_LIVE']` and run via `pnpm test:live`. No live OpenAI.
- **JSON output discipline (AGENTS.md §10):** TASK-014 has no CLI subcommand and no JSON output contract; `ScoringOutcome` is the in-process typed result. TASK-015 will own the run-level JSON output.
- **No secrets:** The orchestrator never logs `OPENAI_API_KEY`, prompt transcripts, raw OpenAI responses, or raw structured output. The `openaiMetadata` table stores only input hashes + validated structured output (already redacted via Zod strict mode), not raw prompts/responses.

## Reconciler facts (from `.slim/deepwork/task-014-openai-scoring-ranking.md` + `@librarian` research)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and the `@librarian` research and are not re-litigated in this plan.

- **`OpenAIClient` is the only runtime OpenAI importer.** Only `src/profile/openai/client.ts` imports the `openai` package at runtime. The scoring layer (`src/scoring/`) imports `OpenAIClient` (the interface) from `src/profile/openai/client.ts`; the runtime values flow via the `OpenAIClient` seam.
- **`OperationalConfigSchema.openai.jobScoring.*` is `.strict()`** (`src/config/schema.ts:120-130`). The schema includes `model`, `reasoningEffort`, `concurrency` — no new fields needed. DO NOT add `maxInputBytes` (the 200 KB threshold is hardcoded per Decision 9).
- **Per-call atomicity rule:** `scoreResults.insert` + `openaiMetadata.insert` are single writes with no internal transaction. The service wraps the two per-job writes in a single sync `this.ctx.db.transaction(...)` (mirrors TASK-013's `updateDiscoveryEvent` pattern).
- **`Repositories.transact` callback MUST be sync.** `better-sqlite3` rejects Promise returns (`src/persistence/repositories/index.ts:50-58`). The service uses `this.ctx.db.transaction((tx) => { ... })` directly.
- **`ExitCode.OpenAIFailure = 5`** — per-task failure exit code (`src/errors/application-error.ts:1-9`).
- **`DiagnosticScope` must be extended** to add `openaiRequestId?: number | null` (method addition, no schema change). The new field is included in the filename via `resolveScopeDirectory` + `buildSafeFilename`.
- **No HTML fixtures exist for the scoring layer** — plan creates `tests/scoring/fixtures/*.json` (JSON fixtures, not HTML).
- **No new CLI subcommand** — TASK-014 has no CLI surface; the `ScoringPlan` data structure is consumed by TASK-015's confirmation UI.
- **`runWithRetry` is reused unchanged** — `maxAttempts: 3`, `baseDelayMs: 500`, `maxDelayMs: 8_000`, `jitter: 'full'`. The corrective retry for `OpenAIInvalidOutputError` is the existing 1-attempt budget.
- **Structured output uses the manual JSON-Schema projection** from `src/profile/openai/prompt.ts` (not `zodResponseFormat` — it's a thin wrapper that adds an SDK dependency the rest of the scoring layer doesn't need).
- **Score fingerprint is SHA-256** (codebase standard) of canonical JSON with sorted keys (RFC 8785 / JCS pattern). Lowercase hex (64 chars). Mirrors `src/profile/openai/fingerprint.ts` + `src/profile/hashing.ts`.
- **`scoring_input_too_large` is a hardcoded 200 KB byte-size pre-check** via `Buffer.byteLength(JSON.stringify(payload), 'utf8')`. No `tiktoken` dependency. The 200 KB cap is conservative — ~50k tokens even with the densest encoding, well under the 400k-token context window of `gpt-5.x`.
- **Per-job failure isolation:** a failure in one `scoreOne` call does NOT terminate the batch. The failure is surfaced as `kind: 'failed'` and persisted to `openaiMetadata` with `success: false`. The next job is processed.
- **Cancellation granularity:** the signal is checked BETWEEN OpenAI calls (not mid-call). On abort, the current job's `openaiMetadata` row is persisted with `success: false` and `errorCode: 'cancelled'`, and `kind: 'cancelled'` is returned. The `runWithRetry` loop does NOT take an `AbortSignal` (Playwright's `goto` pattern; the OpenAI SDK doesn't natively support cancellation).
- **Retry-after-cancellation:** the OpenAI SDK may complete a retry that's already in flight. The orchestrator checks `signal.aborted` AFTER `runWithRetry` returns; if aborted, the result is discarded and the job is marked `kind: 'cancelled'`.
- **Score reuse + stale detection are fingerprint-driven.** REUSE the existing `findActiveByJob(jobId, fingerprint)` (at `src/persistence/repositories/score-results.ts:148-184`) which returns the active row (if any). If a row exists but the fingerprint mismatch, call `activateResult(input)` (at `score-results.ts:92-139`) which atomically UPDATEs the previous active row to `active: false` AND INSERTs the new row with `active: true` in a single `db.transaction` (NO stale-detection inconsistency window; the partial unique index on `active = 1` at `schema.ts:457-459` enforces the invariant). Old row remains stored per SPEC §27.4.

## File Structure

```text
src/scoring/
  state.ts                              # NEW: ScoringOutcome, ScoringBatchOutcome, ScoringKind, ScoringCategory, ScoringPlan, LinkedinScoringSchemaVersion (Task 1)
  errors.ts                             # NEW: ScoringError family + ScoringInputTooLargeError + ScoringInvalidStructuredOutputError + ScoringPersistenceError + ScoringFingerprintMismatchError (Task 2)
  rubric.ts                             # NEW: RUBRIC (7 categories + weights) + RUBRIC_VERSION + ScoringCategory type (Task 3)
  score-formula.ts                      # NEW: computeOverallScore + formatDisplayScore (Task 4)
  rank.ts                               # NEW: rankResults (deterministic, no hidden factors) (Task 5)
  fingerprint.ts                        # NEW: computeScoreFingerprint (SHA-256 of canonical JSON with sorted keys) (Task 6)
  plan.ts                               # NEW: buildScoringPlan (the data structure consumed by TASK-015) (Task 7)
  log.ts                                # NEW: ScoringLogger interface + noop + pino adapters (Task 8)
  service.ts                            # NEW: ScoringService.scoreOne() + scoreBatch() — uses src/profile/openai/ (Task 12)
  index.ts                              # NEW: public barrel (Task 13)
src/diagnostics/
  filename.ts                           # MODIFIED: add openaiRequestId field to DiagnosticScope (Task 9)
  manager.ts                            # UNCHANGED: DiagnosticManager.recordScraperError already supports arbitrary scope fields
src/persistence/repositories/
  score-results.ts                      # UNCHANGED: REUSE the existing findActiveByJob (line 148) + activateResult (line 92) (no new methods)
  openai-metadata.ts                    # UNCHANGED: surface is sufficient (Task 10 verifies)
tests/scoring/
  fixtures/
    scoring-input-job.json             # NEW: a complete job with all 4 fields populated (Task 11)
    scoring-input-payload.json          # NEW: the assembled OpenAI request body (Task 11)
    scoring-output-valid.json          # NEW: a valid structured response (Task 11)
    scoring-output-malformed.json       # NEW: invalid JSON syntax (Task 11)
    scoring-output-category-out-of-bounds.json  # NEW: score 150 (Task 11)
    scoring-output-missing-field.json   # NEW: no recommendationSummary (Task 11)
    scoring-output-extra-field.json     # NEW: extra secretNote field (Task 11)
    scoring-output-decimal-score.json   # NEW: score 87.5 (Task 11)
    scoring-output-unknown-seniority.json  # NEW: seniority "intern" (Task 11)
    loadFixture.ts                      # NEW: re-exports tests/linkedin/fixtures/loadFixture.ts (Task 11)
  helpers/
    fake-scoring-pipeline.ts            # NEW: wires FakeOpenAIClient + real DB for hermetic integration tests (Task 14)
  state.test.ts                         # NEW: structural assertions on ScoringOutcome (Task 1)
  errors.test.ts                        # NEW: each ScoringError subclass's exitCode + code (Task 2)
  rubric.test.ts                        # NEW: RUBRIC values + weight sum = 1.0 (Task 3)
  score-formula.test.ts                 # NEW: 16 cases of computeOverallScore + formatDisplayScore (Task 4)
  rank.test.ts                          # NEW: rankResults sort order + tie-breaking (Task 5)
  fingerprint.test.ts                   # NEW: computeScoreFingerprint determinism + canonicalization (Task 6)
  plan.test.ts                          # NEW: buildScoringPlan shape + totals (Task 7)
  log.test.ts                           # NEW: ScoringLogger noop + pino adapter (Task 8)
  service.test.ts                       # NEW: full integration with FakeOpenAIClient + real DB (Task 12)
  boundaries.test.ts                    # NEW: scoring domain-boundary guard (Task 13)
  openai-mock.test.ts                   # NEW: FakeOpenAIClient programmable responses (Task 14)
tests/live/
  linkedin.test.ts                      # MODIFIED: add 1 new `it` for scoring end-to-end (Task 14)
docs/tasks/
  TASK-014-openai-scoring-ranking.md    # MODIFIED: update "Implementation results" + status (Task 14)
docs/tasks/INDEX.md                     # MODIFIED: update TASK-014 row (Task 14)
README.md                               # MODIFIED: optional one-line note about scoring flow (Task 14)
```

Files change together by responsibility. The pure helpers (`src/scoring/{state,errors,rubric,score-formula,rank,fingerprint,plan,log}.ts`) have no Drizzle, no Commander, no Inquirer, no OpenAI runtime, no Pino imports. The service (`src/scoring/service.ts`) is the only layer that composes helpers + repositories + OpenAI client + diagnostic manager. The OpenAI client surface stays in `src/profile/openai/` (reused unchanged).

### ASCII dependency diagram

```text
                            ┌────────────────────────────────────┐
                            │         TASK-015 (future)          │
                            │   Pipeline orchestrator + CLI      │
                            │   (`jobhunter run`)                │
                            └──────────────┬─────────────────────┘
                                           │ calls scoreBatch() per search
                                           │ consumes ScoringPlan
                                           ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │           src/scoring/index.ts (barrel)                         │
     └────┬───────────┬───────────┬───────────────┬──────────────────┬─┘
          │           │           │               │                  │
          ▼           ▼           ▼               ▼                  ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ ┌────────────────┐
    │service.ts│ │ state.ts │ │ errors.ts│ │ rubric +       │ │ score-formula  │
    │(orchestr)│ │ (types)  │ │ (typed)  │ │ rank +         │ │ + formatScore  │
    │          │ │          │ │          │ │ fingerprint +  │ │ (pure helpers) │
    │          │ │          │ │          │ │ plan + log     │ │                │
    └────┬─────┘ └────┬─────┘ └──────────┘ └────────┬───────┘ └────────────────┘
         │            │                             │
         │            │ composes (via existing barrels, no direct imports of
         │            │ Commander / Drizzle / Pino / OpenAI / Inquirer):
         ▼            ▼
     ┌────────────────────────────────────────────────────────────────────┐
     │   src/persistence/repositories/{scoreResults, openaiMetadata}     │
     │   src/profile/openai/{client, retry, structured-output, prompt, fingerprint, fake-client, errors} │
     │   src/diagnostics/{manager, redactor, filename, capture/*}        │
     │   src/config/{schema, loader}                                      │
     │   src/errors/application-error.ts                                  │
     │   src/logging/logger.ts (via ScoringLogger adapter)               │
     └────────────────────────────────────────────────────────────────────┘
```

The arrows above are conceptual — `service.ts` imports repositories and the OpenAI client through their existing barrels (`src/persistence/repositories/index.js`, `src/profile/openai/index.js`) and never reaches into their internals. The `ScoringLogger` adapter (`src/scoring/log.ts`) wraps a `Logger` from `src/logging/logger.ts`; the orchestrator itself never imports `pino`. The `openai` SDK runtime import stays in `src/profile/openai/client.ts` (TASK-008); the scoring service uses the `OpenAIClient` interface (seam).

---

### Task 1 (Wave A): `state.ts` — `ScoringOutcome`, `ScoringBatchOutcome`, `ScoringKind`, `ScoringCategory`, `ScoringPlan`, `LinkedinScoringSchemaVersion`

**Files:**
- Create: `src/scoring/state.ts`
- Create: `tests/scoring/state.test.ts` (TypeScript-only structural assertion)

**Goal:** Establish the pure state vocabulary that drives every other module under `src/scoring/`. `LINKEDIN_SCORING_SCHEMA_VERSION = 1` is the only new constant. The orchestrator's return shape (`ScoringOutcome`) is consumed by TASK-015; the `ScoringPlan` is the input to TASK-015's confirmation UI.

**`state.ts` (sketch):**

```ts
/**
 * State vocabulary for TASK-014 — LinkedIn scoring
 * (SPEC §25 + §26 + §27.3–27.4 + §30).
 *
 * The shapes below are the typed contract between `service.ts`
 * and TASK-015's pipeline orchestrator. Pure TypeScript types
 * — no runtime values, no I/O.
 */
export const LINKEDIN_SCORING_SCHEMA_VERSION = 1 as const;
export type LinkedinScoringSchemaVersion = typeof LINKEDIN_SCORING_SCHEMA_VERSION;

/** The 7 scoring categories (SPEC §26.2). */
export type ScoringCategory =
  | 'technicalSkills'
  | 'relevantExperience'
  | 'roleResponsibilityFit'
  | 'seniorityFit'
  | 'domainIndustryFit'
  | 'spokenLanguageCompatibility'
  | 'locationWorkplaceCompatibility';

export const SCORING_CATEGORIES: readonly ScoringCategory[] = [
  'technicalSkills',
  'relevantExperience',
  'roleResponsibilityFit',
  'seniorityFit',
  'domainIndustryFit',
  'spokenLanguageCompatibility',
  'locationWorkplaceCompatibility',
] as const;

export type ScoringKind = 'reused' | 'complete' | 'failed' | 'skipped' | 'cancelled';

export type ScoringMethod = 'openai_structured_output';

export interface ScoringFieldSet {
  readonly categoryScores: Readonly<Record<ScoringCategory, number>>;
  readonly keyMatches: readonly string[];
  readonly importantGaps: readonly string[];
  readonly importantConcerns: readonly string[];
  readonly inferredSeniority: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'unknown';
  readonly recommendationSummary: string;
}

export interface ScoringOutcome {
  readonly schemaVersion: LinkedinScoringSchemaVersion;
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly kind: ScoringKind;
  readonly overallScore: number | null;
  readonly displayScore: string | null;
  readonly fingerprint: string;
  readonly fields: ScoringFieldSet | null;
  readonly attempted: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly artifactIds: readonly number[];
}

export interface ScoringBatchOutcome {
  readonly schemaVersion: LinkedinScoringSchemaVersion;
  readonly runId: number;
  readonly searchExecutionId: number;
  readonly perJob: readonly ScoringOutcome[];
  readonly totals: {
    readonly complete: number;
    readonly reused: number;
    readonly failed: number;
    readonly skipped: number;
    readonly cancelled: number;
  };
}

/** Per-job entry in the `ScoringPlan` (consumed by TASK-015's confirmation UI). */
export interface ScoringPlanEntry {
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly kind: ScoringKind;
  readonly isEligible: boolean;
  readonly estimatedInputBytes: number;
  readonly reason: string | null;
}

export interface ScoringPlan {
  readonly schemaVersion: LinkedinScoringSchemaVersion;
  readonly runId: number;
  readonly searchExecutionId: number;
  readonly jobsDiscovered: number;
  readonly jobsAccepted: number;
  readonly scoresReused: number;
  readonly newOpenAIRequests: number;
  readonly skippedScoringCategories: readonly ScoringCategory[];
  readonly scoringConcurrency: number;
  readonly perJob: readonly ScoringPlanEntry[];
}
```

**`tests/scoring/state.test.ts`:** import the types; assert each shape's structural keys; assert `ScoringCategory` includes all 7 values; assert `ScoringKind` includes all 5 values; assert `LINKEDIN_SCORING_SCHEMA_VERSION === 1`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/state.test.ts` passes.

---

### Task 2 (Wave A): `errors.ts` — `ScoringError` family + 4 subclasses

**Files:**
- Create: `src/scoring/errors.ts`
- Create: `tests/scoring/errors.test.ts`

**Goal:** Define the typed error family that the scoring layer throws for hard-stop conditions (NOT per-job failures — those surface as `ScoringOutcome.kind: 'failed'`). Every subclass extends `ApplicationError` from `src/errors/application-error.ts` directly (not `LinkedInScraperError` from TASK-012 — scoring is a separate concern). All exit `ExitCode.OpenAIFailure = 5`.

**Subclasses (per Decision 19):**
- `ScoringError` base — exit 5.
- `ScoringInputTooLargeError` (non-retryable; per SPEC §25.8) — metadata `{ estimatedInputBytes, maxInputBytes }`.
- `ScoringInvalidStructuredOutputError` (retryable once per SPEC §25.3) — metadata `{ attemptNumber, validationError }`.
- `ScoringPersistenceError` (non-retryable; DB error) — metadata `{ table, operation, cause }`.
- `ScoringFingerprintMismatchError` (internal; surfaces data corruption) — metadata `{ expectedFingerprint, actualFingerprint }`.

**Tests:** assert each subclass's `code`, `exitCode`, and `metadata` shape.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/errors.test.ts` passes.

---

### Task 3 (Wave A): `rubric.ts` — `RUBRIC` + `RUBRIC_VERSION` + `ScoringCategory` weight table

**Files:**
- Create: `src/scoring/rubric.ts`
- Create: `tests/scoring/rubric.test.ts`

**Goal:** Frozen constant for the 7-category scoring rubric (SPEC §26.2). The weights must sum to exactly 1.0 (asserted by the test). Bump `RUBRIC_VERSION` on any change (the version is part of the score fingerprint per SPEC §27.3).

**`rubric.ts` (sketch):**

```ts
import type { ScoringCategory } from './state.js';
import { SCORING_CATEGORIES } from './state.js';

/** Version of the scoring rubric. Bump on any change. */
export const RUBRIC_VERSION = 1 as const;
export type RubricVersion = typeof RUBRIC_VERSION;

export interface RubricEntry {
  readonly weight: number;
  readonly description: string;
}

export const RUBRIC: Readonly<Record<ScoringCategory, RubricEntry>> = {
  technicalSkills: { weight: 0.30, description: 'Match between job requirements and the candidate\'s technical skills.' },
  relevantExperience: { weight: 0.25, description: 'Years and relevance of experience in similar roles or domains.' },
  roleResponsibilityFit: { weight: 0.20, description: 'Alignment between the job\'s responsibilities and the candidate\'s preferred role.' },
  seniorityFit: { weight: 0.10, description: 'Match between the job\'s seniority level and the candidate\'s experience.' },
  domainIndustryFit: { weight: 0.05, description: 'Match between the job\'s industry and the candidate\'s domain experience.' },
  spokenLanguageCompatibility: { weight: 0.05, description: 'Match between the job\'s required languages and the candidate\'s spoken languages.' },
  locationWorkplaceCompatibility: { weight: 0.05, description: 'Match between the job\'s location/workplace and the candidate\'s preferences.' },
};

export function getRubricWeight(category: ScoringCategory): number {
  return RUBRIC[category].weight;
}

export function getRubricDescription(category: ScoringCategory): string {
  return RUBRIC[category].description;
}
```

**Tests:** assert `RUBRIC_VERSION === 1`; assert all 7 categories have entries; assert the sum of all weights is exactly 1.0 (with floating-point tolerance `< 1e-9`); assert `SCORING_CATEGORIES` length is 7.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/rubric.test.ts` passes.

---

### Task 4 (Wave A): `score-formula.ts` — `computeOverallScore` + `formatDisplayScore`

**Files:**
- Create: `src/scoring/score-formula.ts`
- Create: `tests/scoring/score-formula.test.ts`

**Goal:** Two pure helpers used by `service.ts` (Task 12) to classify + display scores. The overall score is calculated by JobHunter, NOT OpenAI (per SPEC §26.3). The display value is one-decimal (per SPEC §26.4).

**`score-formula.ts` (sketch):**

```ts
import type { ScoringCategory } from './state.js';
import { SCORING_CATEGORIES } from './state.js';
import { RUBRIC } from './rubric.js';

/**
 * Compute the full-precision weighted overall score
 * (SPEC §26.3). JobHunter calculates this — OpenAI does NOT.
 * No hidden bonuses or penalties.
 */
export function computeOverallScore(
  categoryScores: Readonly<Record<ScoringCategory, number>>,
): number {
  let sum = 0;
  for (const category of SCORING_CATEGORIES) {
    const score = categoryScores[category];
    if (typeof score !== 'number') {
      throw new Error(`computeOverallScore: missing score for category "${category}"`);
    }
    sum += score * RUBRIC[category].weight;
  }
  return sum;
}

/**
 * Format the full-precision overall score as a one-decimal
 * display value (SPEC §26.4). Returns the string form of
 * `fullPrecision.toFixed(1)` for stable serialization.
 */
export function formatDisplayScore(fullPrecision: number): string {
  if (typeof fullPrecision !== 'number' || !Number.isFinite(fullPrecision)) {
    throw new Error(`formatDisplayScore: invalid number "${fullPrecision}"`);
  }
  return fullPrecision.toFixed(1);
}
```

**Tests (16+ cases for `computeOverallScore`):**
- All 7 categories at 0 → 0.
- All 7 categories at 100 → 100.
- Mixed scores (e.g., 80/60/70/50/40/30/20) → exact expected value.
- Missing category → throws.
- Non-integer score (e.g., 87.5) → accepted (the formula doesn't care about integer vs float; the Zod schema enforces integer at parse time).
- `formatDisplayScore(84.5375)` → `'84.5'`.
- `formatDisplayScore(0)` → `'0.0'`.
- `formatDisplayScore(100)` → `'100.0'`.
- `formatDisplayScore(NaN)` → throws.
- `formatDisplayScore(Infinity)` → throws.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/score-formula.test.ts` passes.

---

### Task 5 (Wave A): `rank.ts` — `rankResults` (deterministic, no hidden factors)

**Files:**
- Create: `src/scoring/rank.ts`
- Create: `tests/scoring/rank.test.ts`

**Goal:** Pure deterministic ranking (per SPEC §26.5). No recency/preference/discovery-order/filter-weight adjustments. No minimum threshold.

**`rank.ts` (sketch):**

```ts
export interface RankedResult {
  readonly sourceJobId: string;
  readonly overallScore: number;
  readonly rank: number;
}

/**
 * Rank a list of scores deterministically (SPEC §26.5).
 * 1. Full-precision overall score descending.
 * 2. `sourceJobId` ascending for exact ties (string compare).
 * No hidden factors. No minimum threshold.
 */
export function rankResults(
  scores: readonly { sourceJobId: string; overallScore: number }[],
): readonly RankedResult[] {
  const sorted = [...scores].sort((a, b) => {
    if (a.overallScore !== b.overallScore) {
      return b.overallScore - a.overallScore; // descending
    }
    if (a.sourceJobId < b.sourceJobId) return -1; // ascending
    if (a.sourceJobId > b.sourceJobId) return 1;
    return 0;
  });
  return sorted.map((entry, index) => ({
    sourceJobId: entry.sourceJobId,
    overallScore: entry.overallScore,
    rank: index + 1, // 1-based
  }));
}
```

**Tests:**
- Single entry → rank 1.
- 3 entries with different scores → sorted by score descending, ranks 1/2/3.
- 2 entries with the same score → sorted by `sourceJobId` ascending.
- 3 entries with the same score → sorted by `sourceJobId` ascending, ranks 1/2/3.
- Empty array → empty result.
- Float scores (e.g., 84.5375 vs 84.5374) → ordered correctly.
- Identical scores and IDs (duplicate) → order preserved from the input (stable sort).

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/rank.test.ts` passes.

---

### Task 6 (Wave A): `fingerprint.ts` — `computeScoreFingerprint` (SHA-256 of canonical JSON with sorted keys)

**Files:**
- Create: `src/scoring/fingerprint.ts`
- Create: `tests/scoring/fingerprint.test.ts`

**Goal:** Pure deterministic fingerprint per SPEC §27.3. Mirrors the existing `src/profile/openai/fingerprint.ts` pattern + `src/profile/hashing.ts` (SHA-256). Lowercase hex (64 chars). Defaults substituted for optional fields before serialization.

**`fingerprint.ts` (sketch):**

```ts
import { createHash } from 'node:crypto';

import { hashString } from '../profile/hashing.js';

export interface ScoreFingerprintInput {
  readonly jobContentHash: string;
  readonly profileVersionId: number;
  readonly profileFingerprint: string;
  readonly effectiveDerivedValuesHash: string;
  readonly promptVersion: number;
  readonly rubricVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly modelConfig: Readonly<Record<string, string | number | boolean | null>>;
  readonly scorerImplementationVersion: number;
}

/**
 * Compute the score fingerprint (SPEC §27.3).
 * SHA-256 of canonical JSON with sorted keys (RFC 8785 / JCS pattern).
 * Returns a lowercase hex string (64 chars).
 */
export function computeScoreFingerprint(input: ScoreFingerprintInput): string {
  const ordered = {
    jobContentHash: input.jobContentHash,
    profileVersionId: input.profileVersionId,
    profileFingerprint: input.profileFingerprint,
    effectiveDerivedValuesHash: input.effectiveDerivedValuesHash,
    model: input.model,
    modelConfig: sortObjectKeys(input.modelConfig),
    promptVersion: input.promptVersion,
    reasoningEffort: input.reasoningEffort,
    rubricVersion: input.rubricVersion,
    scorerImplementationVersion: input.scorerImplementationVersion,
  };
  // JSON.stringify with a sorted-key replacer ensures alphabetical order
  // at every nesting level (RFC 8785 / JCS).
  const canonical = JSON.stringify(ordered, Object.keys(ordered).sort());
  return hashString(canonical);
}

function sortObjectKeys<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = (obj as Record<string, unknown>)[key];
  }
  return sorted as T;
}
```

**Tests:**
- Same input → same fingerprint (determinism).
- Different `jobContentHash` → different fingerprint.
- Different `model` → different fingerprint.
- Different `scorerImplementationVersion` → different fingerprint.
- Fingerprint is exactly 64 lowercase hex chars.
- Default substitution: missing optional fields replaced with documented defaults before serialization.
- `modelConfig` with unsorted keys → fingerprint is the same as `modelConfig` with sorted keys (canonicalization).

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/fingerprint.test.ts` passes.

---

### Task 7 (Wave A): `plan.ts` — `buildScoringPlan` (the data structure consumed by TASK-015)

**Files:**
- Create: `src/scoring/plan.ts`
- Create: `tests/scoring/plan.test.ts`

**Goal:** Pure data structure builder for the `ScoringPlan` consumed by TASK-015's confirmation UI. The orchestrator (TASK-015) calls `buildScoringPlan` after resolving the eligible jobs + filter results + existing score results. No I/O — the caller resolves the data.

**`plan.ts` (sketch):**

```ts
import type {
  ScoringCategory,
  ScoringKind,
  ScoringPlan,
  ScoringPlanEntry,
} from './state.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION, SCORING_CATEGORIES } from './state.js';

export interface BuildScoringPlanInput {
  readonly run: { readonly id: number };
  readonly searchExecution: { readonly id: number };
  readonly jobs: readonly { readonly id: number; readonly sourceJobId: string; readonly estimatedInputBytes: number }[];
  readonly eligibleFlags: ReadonlyMap<number, { readonly isEligible: boolean; readonly reason: string | null }>;
  readonly scoreKinds: ReadonlyMap<number, ScoringKind>;
  readonly scoringConcurrency: number;
  readonly skippedScoringCategories?: readonly ScoringCategory[];
}

export function buildScoringPlan(input: BuildScoringPlanInput): ScoringPlan {
  const perJob: ScoringPlanEntry[] = input.jobs.map((job) => {
    const flag = input.eligibleFlags.get(job.id) ?? { isEligible: true, reason: null };
    const kind = input.scoreKinds.get(job.id) ?? 'skipped';
    return {
      jobId: job.id,
      sourceJobId: job.sourceJobId,
      kind,
      isEligible: flag.isEligible,
      estimatedInputBytes: job.estimatedInputBytes,
      reason: flag.reason,
    };
  });

  const jobsAccepted = perJob.filter((entry) => entry.isEligible).length;
  const scoresReused = perJob.filter((entry) => entry.kind === 'reused').length;
  const newOpenAIRequests = perJob.filter((entry) => entry.kind === 'complete').length;

  return {
    schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
    runId: input.run.id,
    searchExecutionId: input.searchExecution.id,
    jobsDiscovered: input.jobs.length,
    jobsAccepted,
    scoresReused,
    newOpenAIRequests,
    skippedScoringCategories: input.skippedScoringCategories ?? [],
    scoringConcurrency: input.scoringConcurrency,
    perJob,
  };
}
```

**Tests:**
- Empty jobs → `jobsDiscovered: 0`, `jobsAccepted: 0`, `scoresReused: 0`, `newOpenAIRequests: 0`, `perJob: []`.
- 3 jobs, all eligible + new → `jobsDiscovered: 3`, `jobsAccepted: 3`, `scoresReused: 0`, `newOpenAIRequests: 3`.
- 3 jobs, all eligible + 1 reused → `scoresReused: 1`, `newOpenAIRequests: 2`.
- 3 jobs, 1 ineligible → `jobsAccepted: 2`.
- 3 jobs, 1 skipped → `scoresReused: 0`, `newOpenAIRequests: 2`, `skipped: 1`.
- `scoringConcurrency` carried through.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/plan.test.ts` passes.

---

### Task 8 (Wave A): `log.ts` — `ScoringLogger` + noop + pino adapters

**Files:**
- Create: `src/scoring/log.ts`
- Create: `tests/scoring/log.test.ts`

**Goal:** Logger facade for the scoring layer. Mirrors TASK-012's `LinkedInScraperLogger` + TASK-013's `LinkedInExtractionLogger` pattern. Domain uses the `Logger` facade from `src/logging/logger.ts`; pino adapter stays at the boundary.

**`log.ts` (sketch):**

```ts
import type { Logger } from '../logging/logger.js';
import type { ScoringKind } from './state.js';

export interface ScoringLogger {
  scoringStart(args: { jobId: number; sourceJobId: string; fingerprint: string }): void;
  scoringComplete(args: { jobId: number; kind: ScoringKind; overallScore?: number; displayScore?: string }): void;
  scoringSkip(args: { jobId: number; reason: string }): void;
  scoringFail(args: { jobId: number; errorCode: string }): void;
  scoringReuse(args: { jobId: number; fingerprint: string; previousScoreTimestamp: string }): void;
}

export function noopScoringLogger(): ScoringLogger {
  return {
    scoringStart: () => {},
    scoringComplete: () => {},
    scoringSkip: () => {},
    scoringFail: () => {},
    scoringReuse: () => {},
  };
}

export function pinoScoringLogger(logger: Logger): ScoringLogger {
  return {
    scoringStart: (a) => logger.info({ event: 'scoring.start', ...stringifyIds(a) }),
    scoringComplete: (a) => logger.info({ event: 'scoring.complete', ...stringifyIds(a) }),
    scoringSkip: (a) => logger.info({ event: 'scoring.skip', ...stringifyIds(a) }),
    scoringFail: (a) => logger.warn({ event: 'scoring.fail', ...stringifyIds(a) }),
    scoringReuse: (a) => logger.info({ event: 'scoring.reuse', ...stringifyIds(a) }),
  };
}

function stringifyIds<T extends Record<string, unknown>>(args: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'number' ? String(v) : v;
  }
  return out;
}
```

**Tests:** assert each method emits the expected `event` + structured fields; assert `noopScoringLogger().scoringStart({...})` does not throw.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/log.test.ts` passes.

---

### Task 9 (Wave B): `DiagnosticScope.openaiRequestId` extension

**Files:**
- Modify: `src/diagnostics/filename.ts:3-9` (add `openaiRequestId?: number | null` field)
- Modify: `src/diagnostics/manager.ts:80-90` (accept the new field in `DiagnosticInput`)

**Goal:** Add the `openaiRequestId` field to `DiagnosticScope` so the scoring layer can scope diagnostics to a specific OpenAI request. No schema change. The new field is included in the filename via `resolveScopeDirectory` + `buildSafeFilename`.

**`filename.ts` modification:**

```ts
export interface DiagnosticScope {
  readonly pipelineRunId?: number | null;
  readonly searchExecutionId?: number | null;
  readonly jobId?: number | null;
  readonly extractionAttemptId?: number | null;
  readonly discoveryErrorId?: number | null;
  readonly openaiRequestId?: number | null;  // NEW: TASK-014
}
```

**Update `resolveScopeDirectory`** to include `openai-<id>` when present:

```ts
export function resolveScopeDirectory(scope: DiagnosticScope): string {
  const segments: string[] = [];
  if (isPositiveId(scope.pipelineRunId)) segments.push(`run-${scope.pipelineRunId}`);
  if (isPositiveId(scope.searchExecutionId)) segments.push(`search-${scope.searchExecutionId}`);
  if (isPositiveId(scope.jobId)) segments.push(`job-${scope.jobId}`);
  if (isPositiveId(scope.extractionAttemptId)) segments.push(`extraction-${scope.extractionAttemptId}`);
  if (isPositiveId(scope.discoveryErrorId)) segments.push(`discovery-error-${scope.discoveryErrorId}`);
  if (isPositiveId(scope.openaiRequestId)) segments.push(`openai-${scope.openaiRequestId}`);  // NEW
  return segments.length === 0 ? 'unscoped' : segments.join('/');
}
```

**Update `buildSafeFilename`** to include the new field in the filename prefix (mirrors the pattern for the other IDs).

**Tests:** extend `tests/diagnostics/filename.test.ts` to assert the new field is included in the directory + filename.

**Note (NF4 merge — no separate Task 10 needed):** The scoring service uses the EXISTING `findActiveByJob` + `activateResult` methods at `src/persistence/repositories/score-results.ts:92-184` (no new repository methods). The `DiagnosticScope.openaiRequestId` field extension is the only `src/diagnostics/` change. The previous plan had a duplicate Task 10 with the same `DiagnosticScope` modifications; the bounded remediation merged them into this single task.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/diagnostics/filename.test.ts` passes; `pnpm test tests/diagnostics` passes (no regressions).

---

### Task 11 (Wave C): 8 JSON fixtures + `loadFixture.ts` re-export

**Files:**
- Create: `tests/scoring/fixtures/scoring-input-job.json`
- Create: `tests/scoring/fixtures/scoring-input-payload.json`
- Create: `tests/scoring/fixtures/scoring-output-valid.json`
- Create: `tests/scoring/fixtures/scoring-output-malformed.json`
- Create: `tests/scoring/fixtures/scoring-output-category-out-of-bounds.json`
- Create: `tests/scoring/fixtures/scoring-output-missing-field.json`
- Create: `tests/scoring/fixtures/scoring-output-extra-field.json`
- Create: `tests/scoring/fixtures/scoring-output-decimal-score.json`
- Create: `tests/scoring/fixtures/scoring-output-unknown-seniority.json`
- Create: `tests/scoring/fixtures/loadFixture.ts` (re-exports `tests/linkedin/fixtures/loadFixture.ts`)

**Goal:** Comprehensive fixture coverage for the scoring layer's unit + integration tests.

**`scoring-output-valid.json` (sketch):**

```json
{
  "categoryScores": {
    "technicalSkills": { "score": 85, "explanation": "Strong Python, ML, and cloud skills.", "evidence": ["5y Python", "TensorFlow cert", "AWS experience"] },
    "relevantExperience": { "score": 78, "explanation": "5y in similar role.", "evidence": ["Led team at Acme"] },
    "roleResponsibilityFit": { "score": 82, "explanation": "Good fit for senior IC role.", "evidence": ["Previous IC at scale"] },
    "seniorityFit": { "score": 75, "explanation": "Slightly under-leveled but close.", "evidence": ["5y vs 7y requirement"] },
    "domainIndustryFit": { "score": 90, "explanation": "Healthcare background matches.", "evidence": ["2y healthcare ML"] },
    "spokenLanguageCompatibility": { "score": 100, "explanation": "Native English speaker.", "evidence": ["Resume English"] },
    "locationWorkplaceCompatibility": { "score": 100, "explanation": "Remote position; candidate remote-friendly.", "evidence": ["Current remote"] }
  },
  "keyMatches": ["Python", "ML", "Healthcare"],
  "importantGaps": ["7y experience required"],
  "importantConcerns": [],
  "inferredSeniority": "senior",
  "recommendationSummary": "Strong match. Slightly under-leveled on years of experience but compensates with domain expertise."
}
```

**Other fixtures:** the malformed/out-of-bounds/missing-field/extra-field/decimal-score/unknown-seniority fixtures deliberately violate the Zod schema for the negative-path tests. Each is a small JSON file (~10-30 lines).

**`loadFixture.ts`:** re-exports the `loadFixture` helper from `tests/linkedin/fixtures/loadFixture.ts` (mirror the pattern from `tests/extraction/fixtures/loadFixture.ts`). The `FixtureName` union in `tests/linkedin/fixtures/loadFixture.ts` must be extended to include the 9 new fixture names.

**Verify by running:** `pnpm test tests/scoring/fixtures` passes (when the test file is created in Task 14); `pnpm test tests/linkedin/fixtures.test.ts` passes (the `FIXTURES` array assertion includes the 9 new fixtures).

---

### Task 12 (Wave D): `ScoringService` — `scoreOne()` + `scoreBatch()` + `buildScoringPlan()` + atomic 2-write transaction

**Files:**
- Create: `src/scoring/service.ts`
- Create: `tests/scoring/service.test.ts` (full integration with `FakeOpenAIClient` + real DB)

**Goal:** The orchestrator. Per-job flow: (a) check eligibility; (b) read existing score by fingerprint → reuse if current; (c) mark stale + score new if row exists but fingerprint mismatch; (d) score new if no row. Build prompt (excludes all SPEC §25.7 prohibited fields). Call OpenAI via `runWithRetry`. Validate with `parseStructuredOutput`. Compute `overallScore` in JobHunter. Persist `scoreResults` + `openaiMetadata` atomically.

**`service.ts` (sketch):**

```ts
import { and, eq } from 'drizzle-orm';
import { openaiRequestMetadata, scoreResults } from '../../persistence/schema.js';
import type { Repositories } from '../persistence/repositories/index.js';
import type { OpenAIClient } from '../profile/openai/client.js';
import { runWithRetry } from '../profile/openai/retry.js';
import { DiagnosticManager } from '../../diagnostics/manager.js';
import { isJobEligibleForScoring } from './eligibility.js';
import { buildScoringPrompt, SCORING_PROMPT_VERSION } from './prompt.js';
import { ScoringStructuredOutputSchema, SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION } from './schema.js';
import { computeOverallScore, formatDisplayScore } from './score-formula.js';
import { computeScoreFingerprint, SCORER_IMPLEMENTATION_VERSION } from './fingerprint.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from './state.js';
import { noopScoringLogger, type ScoringLogger } from './log.js';

const MAX_INPUT_BYTES = 200_000;

export interface ScoringServiceOptions {
  readonly repositories: Repositories;
  readonly openaiClient: OpenAIClient;
  readonly diagnosticManager: DiagnosticManager;
  readonly logger?: ScoringLogger;
  readonly config: {
    readonly model: string;
    readonly reasoningEffort: string;
    readonly concurrency: number;
  };
  readonly now?: () => Date;
}

export interface ScoreOneInput {
  readonly run: { readonly id: number };
  readonly searchExecution: { readonly id: number };
  readonly job: { readonly id: number; readonly sourceJobId: string; readonly extractionStatus: 'complete' | 'partial' | 'failed' };
  readonly profileVersion: { readonly id: number; readonly fingerprint: string; readonly effectiveDerivedValues: unknown };
  readonly filterResult: { readonly outcome: 'accepted' | 'rejected'; readonly fingerprint: string };
  readonly signal: AbortSignal;
}

export class ScoringService {
  // ... constructor mirrors TASK-013's LinkedInExtractionService ...

  async scoreOne(input: ScoreOneInput): Promise<ScoringOutcome> {
    const startedAt = this.now().toISOString();
    this.logger.scoringStart({ jobId: input.job.id, sourceJobId: input.job.sourceJobId, fingerprint: '' });

    // Step 1: check eligibility.
    if (!isJobEligibleForScoring({ job: input.job, filterResult: input.filterResult })) {
      this.logger.scoringSkip({ jobId: input.job.id, reason: 'ineligible' });
      return { /* kind: 'skipped' */ };
    }

    // Step 2: build the payload + compute the fingerprint.
    const payload = buildScoringPrompt({ /* ... */ });
    const fingerprint = computeScoreFingerprint({ /* ... */ });
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');

    // Step 3: check for input-too-large.
    if (payloadBytes > MAX_INPUT_BYTES) {
      // surface ScoringInputTooLargeError (non-retryable per §25.8)
    }

    // Step 4: check for existing active score by fingerprint → reuse if found.
    // Uses the EXISTING `findActiveByJob(jobId, fingerprint)` at score-results.ts:148-184.
    const existing = await this.repositories.scoreResults.findActiveByJob(input.job.id, fingerprint);
    if (existing !== null) {
      this.logger.scoringReuse({ jobId: input.job.id, fingerprint, previousScoreTimestamp: existing.timestamp });
      return {
        kind: 'reused',
        overallScore: existing.overallScore,
        displayScore: formatDisplayScore(existing.overallScore),  // computed on read (F8)
        fingerprint,
      };
    }

    // Step 5: call OpenAI via runWithRetry.
    // Uses the EXISTING `OpenAIClient.extract()` method (TASK-008) — the scoring request
    // is wrapped as a SINGLE `OpenAIExtractionSource` payload (per NF1 — `OpenAIExtractionRequest`
    // does NOT have `messages` / `responseFormat` / `maxCompletionTokens` fields; the existing
    // surface uses `sources: readonly OpenAIExtractionSource[]` + `responseSchemaName` +
    // `structuredOutputSchemaVersion`). The `maxCompletionTokens` budget is enforced by the
    // OpenAI client's `OpenAIHttpClient` (set at client construction; per F9, NOT per-call).
    const raw = await runWithRetry({
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      jitter: 'full',
      operation: async () => {
        const response = await this.openaiClient.extract({
          promptVersion: `v${SCORING_PROMPT_VERSION}`,
          model: this.config.model,
          reasoningEffort: this.config.reasoningEffort,
          sources: [
            {
              kind: 'cv_text',
              identifier: `job-${input.job.id}-scoring`,
              content: JSON.stringify(payload),
            },
          ],
          responseSchemaName: 'ScoringStructuredOutput',
          structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
        });
        // Real pattern from extraction-service.ts:340-353 — the response is
        // `rawJsonText` (NOT `response.content` or `response.refusal`). The
        // refusal is conveyed by a non-JSON `rawJsonText` value, which
        // `JSON.parse` will throw on.
        let parsed: unknown;
        try {
          parsed = JSON.parse(response.rawJsonText);
        } catch (cause) {
          throw new ScoringInvalidStructuredOutputError({ attemptNumber: 0, validationError: 'invalid_json_or_refusal' });
        }
        const result = ScoringStructuredOutputSchema.safeParse(parsed);
        if (!result.success) {
          throw new ScoringInvalidStructuredOutputError({ attemptNumber: 0, validationError: result.error.message });
        }
        return result.data;
      },
    });

    // Step 6: compute overall score in JobHunter (NOT OpenAI).
    const overallScore = computeOverallScore(raw.categoryScores);
    const displayScore = formatDisplayScore(overallScore);

    // Step 7: persist scoreResults + openaiMetadata atomically.
    // Uses `this.repositories.transact(...)` (F12) — but the CALLBACK operates on the
    // RAW `txRepos.db.transaction` directly (per NF2 — calling the async sub-repository
    // wrappers inside `transact` would attempt a nested transaction on better-sqlite3).
    // Mirrors `extraction-service.persistDraft` (src/profile/extraction-service.ts:509-559)
    // which uses `txRepos.db.*` directly inside the sync callback.
    // The `activateResult` shape is implemented inline (UPDATE previous active row to
    // `active: false`; INSERT new row with `active: true` in a single `db.transaction`).
    // NO stale-detection inconsistency window (the partial unique index on `active = 1`
    // at `schema.ts:457-459` enforces the invariant).
    const completedAt = this.now().toISOString();
    let newScoreResultId: number;
    this.repositories.transact((txRepos) => {
      const result = txRepos.db.transaction((tx) => {
        // Write 1: UPDATE the previous active row to `active: false` (if any).
        tx.update(scoreResults)
          .set({ active: false, updatedTimestamp: completedAt })
          .where(
            and(
              eq(scoreResults.jobId, input.job.id),
              eq(scoreResults.active, true),
            ),
          )
          .run();
        // Write 2: INSERT the new row with `active: true`.
        const inserted = tx.insert(scoreResults)
          .values({
            jobId: input.job.id,
            pipelineRunId: input.run.id,
            filterResultId: input.filterResult.id,  // not `searchExecutionId` (per NF3)
            fingerprint,
            overallScore,
            categoryScores: raw.categoryScores,  // not `fields` (per NF3)
            success: true,
            timestamp: completedAt,
            createdTimestamp: completedAt,
            updatedTimestamp: completedAt,
          })
          .returning({ id: scoreResults.id })
          .all();
        if (inserted.length === 0) {
          throw new Error('scoreOne: scoreResults insert returned no rows');
        }
        return inserted[0]!.id;
      });
      newScoreResultId = result;
      // Write 3: INSERT the openaiMetadata row linked to the new score result.
      txRepos.db.insert(openaiRequestMetadata)
        .values({
          relatedEntityType: 'score_result',
          relatedEntityId: newScoreResultId,
          operationType: 'job_scoring',
          inputHashes: { /* ... */ },
          promptVersion: `v${SCORING_PROMPT_VERSION}`,
          structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
          model: this.config.model,
          reasoningEffort: this.config.reasoningEffort,
          configJson: { /* ... */ },  // not `requestConfig` (per NF3)
          tokenUsage: { /* from response.tokenUsage */ },
          validatedOutput: raw,
          attemptCount: /* from runWithRetry result */,
          startTimestamp: startedAt,
          endTimestamp: completedAt,
          success: true,  // not in `errors` (per NF3)
          errorCode: null,
          errorMessage: null,
        })
        .run();
    });

    return { kind: 'complete', overallScore, displayScore, fingerprint, fields: raw };
  }

  async scoreBatch(input: { run, searchExecution, jobs, profileVersion, effectiveDerivedValues, filterResults, signal }): Promise<ScoringBatchOutcome> {
    // Iterate for...of jobs; check signal.aborted; call scoreOne per job; aggregate.
  }

  buildScoringPlan(input: BuildScoringPlanInput): ScoringPlan {
    // Delegate to ./plan.ts.
  }
}
```

**Tests (full integration with `FakeOpenAIClient` + real DB):**
1. **Reuse path** — existing `scoreResults` row with current fingerprint → returns `kind: 'reused'`, no new OpenAI call, no new `openaiMetadata` row.
2. **New score path** — no existing row → calls OpenAI, validates, computes, persists → `kind: 'complete'`, 1 new `scoreResults` row + 1 new `openaiMetadata` row.
3. **Stale detection** — existing row with old fingerprint → marks stale, then scores new → 2 `scoreResults` rows (1 stale, 1 current) + 1 new `openaiMetadata` row.
4. **Ineligible job** — `extractionStatus: 'partial'` or filter rejected → returns `kind: 'skipped'`, no OpenAI call.
5. **Input too large** — payload > 200 KB → returns `kind: 'failed'` with `errorCode: 'scoring_input_too_large'`, no OpenAI call.
6. **OpenAI timeout** — `FakeOpenAIClient` times out → retries 3 times → returns `kind: 'failed'` with `errorCode: 'openai_timeout'`.
7. **OpenAI invalid output (corrective retry)** — `FakeOpenAIClient` returns malformed JSON → first attempt throws `OpenAIInvalidOutputError` → corrective retry → second attempt returns valid JSON → `kind: 'complete'`.
8. **OpenAI rate limit** — `FakeOpenAIClient` returns 429 → retries with exponential backoff → eventually succeeds → `kind: 'complete'`.
9. **OpenAI authentication error (non-retryable)** — `FakeOpenAIClient` returns 401 → no retry → `kind: 'failed'` with `errorCode: 'openai_authentication'`.
10. **`scoreBatch` with 3 jobs** — all 3 processed in parallel (with `concurrency: 3`); cancellation check between iterations; aggregate `ScoringBatchOutcome` with correct totals.
11. **Atomic transaction** — if the `openaiMetadata` insert fails, the `scoreResults` row is NOT inserted (rollback).
12. **Cancellation** — `signal.aborted` set after the first job → second job returns `kind: 'cancelled'`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/service.test.ts` passes.

---

### Task 13 (Wave E): `src/scoring/index.ts` — public barrel + `tests/scoring/boundaries.test.ts` + boundaries test update

**Files:**
- Create: `src/scoring/index.ts` (public barrel)
- Create: `tests/scoring/boundaries.test.ts` (mirror `tests/extraction/boundaries.test.ts`)
- Modify: `tests/linkedin/boundaries.test.ts` (no changes — `src/scoring/` is a separate tree, not a subdirectory of `src/linkedin/`)

**Goal:** Finalize the public surface + enforce the domain-boundary guard.

**`index.ts` (sketch):**

```ts
export { ScoringService } from './service.js';
export type { ScoringServiceOptions, ScoreOneInput, ScoreBatchInput } from './service.js';
export type { BuildScoringPlanInput } from './plan.js';

export { LINKEDIN_SCORING_SCHEMA_VERSION } from './state.js';
export type {
  ScoringOutcome,
  ScoringBatchOutcome,
  ScoringPlan,
  ScoringPlanEntry,
  ScoringFieldSet,
  ScoringKind,
  ScoringCategory,
  ScoringMethod,
  LinkedinScoringSchemaVersion,
} from './state.js';

export { RUBRIC, RUBRIC_VERSION } from './rubric.js';
export type { RubricEntry, RubricVersion } from './rubric.js';

export { computeOverallScore, formatDisplayScore } from './score-formula.js';
export { rankResults } from './rank.js';
export type { RankedResult } from './rank.js';
export { computeScoreFingerprint } from './fingerprint.js';
export type { ScoreFingerprintInput } from './fingerprint.js';
export { buildScoringPlan } from './plan.js';

export {
  ScoringError,
  ScoringInputTooLargeError,
  ScoringInvalidStructuredOutputError,
  ScoringPersistenceError,
  ScoringFingerprintMismatchError,
} from './errors.js';

export { noopScoringLogger, pinoScoringLogger } from './log.js';
export type { ScoringLogger } from './log.js';
```

**`tests/scoring/boundaries.test.ts` (sketch):** mirror `tests/extraction/boundaries.test.ts`. Enumerate `src/scoring/*.ts`. Ban runtime imports of `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`, runtime `pino`. NO `DRIZZLE_ORM_ALLOW_LIST` carve-out — the service uses `this.repositories.transact(...)` which goes through the repositories' methods and does NOT import `drizzle-orm` directly. The scoring service MAY import FROM `src/profile/openai/` (cross-module dependency is allowed). The `openai` runtime import lives in `src/profile/openai/client.ts` (TASK-008) — `src/scoring/` MUST NOT import the `openai` package directly. Allow `playwright` (already in the codebase; not used by scoring). Ban `process.exit(...)`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/scoring/boundaries.test.ts` passes; `pnpm test tests/scoring` passes.

---

### Task 14 (Wave E): `fake-scoring-pipeline.ts` + live test extension + docs alignment

**Files:**
- Create: `tests/scoring/helpers/fake-scoring-pipeline.ts` (wires `FakeOpenAIClient` + real DB for hermetic integration tests)
- Create: `tests/scoring/openai-mock.test.ts` (programmable `FakeOpenAIClient` responses)
- Modify: `tests/live/linkedin.test.ts` (add 1 new `it` for scoring end-to-end)
- Modify: `docs/tasks/TASK-014-openai-scoring-ranking.md` (update Implementation results)
- Modify: `docs/tasks/INDEX.md` (update TASK-014 row)
- Modify: `README.md` (optional one-line note about scoring flow)

**Goal:** Final wiring + live test + docs.

**`tests/scoring/helpers/fake-scoring-pipeline.ts` (sketch):**

```ts
import { FakeOpenAIClient, type OpenAIResponse } from '../../../src/profile/openai/fake-client.js';
import { ScoringService } from '../../../src/scoring/service.js';
import { createRepositories } from '../../../src/persistence/repositories/index.js';
import { createDatabaseConnection, runMigrations } from '../../../src/persistence/connection.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeScoringPipelineOptions {
  readonly fakeResponses: readonly OpenAIResponse[];
  readonly config: {
    readonly model: string;
    readonly reasoningEffort: string;
    readonly concurrency: number;
  };
}

export class FakeScoringPipeline {
  readonly fakeClient: FakeOpenAIClient;
  readonly repositories: ReturnType<typeof createRepositories>;
  readonly service: ScoringService;
  readonly tmpDir: string;

  constructor(options: FakeScoringPipelineOptions) {
    this.tmpDir = mkdtempSync(join(tmpdir(), 'jobhunter-scoring-'));
    const connection = createDatabaseConnection(join(this.tmpDir, 'test.db'));
    runMigrations(connection);
    this.repositories = createRepositories(connection);
    this.fakeClient = new FakeOpenAIClient({ responses: options.fakeResponses });
    this.service = new ScoringService({
      repositories: this.repositories,
      openaiClient: this.fakeClient,
      diagnosticManager: createTestDiagnosticManager(this.tmpDir),
      config: options.config,
    });
  }

  async cleanup(): Promise<void> {
    await this.repositories.close();
    await rm(this.tmpDir, { recursive: true, force: true });
  }
}
```

**`tests/live/linkedin.test.ts` addition:**

```ts
it.skipIf(!ENABLED)('scores a public job-detail page end-to-end', async () => {
  // Score a real LinkedIn job-detail page.
  // Assert overallScore is a valid number (0-100).
  // Assert displayScore matches overallScore.toFixed(1).
  // Assert the structured output has all 7 categories.
});
```

**Docs alignment:** update `docs/tasks/TASK-014-openai-scoring-ranking.md` "Implementation results" + `docs/tasks/INDEX.md` TASK-014 row + optional `README.md` one-line note.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm format:check` clean; `pnpm test` (all green); `pnpm exec playwright --version` 1.62.x; `pnpm test:live:list` lists `tests/live/linkedin.test.ts`.

## Test plan

Reference SPEC §41.1 (unit) + §41.2 (integration) + §41.3 (scraper tests).

### Unit tests (no I/O)

| Wave | Test file | Coverage |
|---|---|---|
| A | `tests/scoring/state.test.ts` | Structural assertions on `ScoringOutcome` + `ScoringKind` (5 values) + `ScoringCategory` (7 values) + `LINKEDIN_SCORING_SCHEMA_VERSION === 1`. |
| A | `tests/scoring/errors.test.ts` | Each `ScoringError` subclass's `code` + `exitCode === 5` + `metadata` shape. |
| A | `tests/scoring/rubric.test.ts` | `RUBRIC_VERSION === 1`; all 7 categories have entries; sum of all weights = 1.0 (floating-point tolerance < 1e-9). |
| A | `tests/scoring/score-formula.test.ts` | 16+ cases of `computeOverallScore` (all 0, all 100, mixed scores, missing category throws, non-integer accepted) + `formatDisplayScore` (exact one-decimal output, NaN throws, Infinity throws). |
| A | `tests/scoring/rank.test.ts` | Sort order (descending by score, then ascending by `sourceJobId` for ties), 1-based ranks, empty array, float scores, identical scores + IDs (stable sort). |
| A | `tests/scoring/fingerprint.test.ts` | Same input → same fingerprint (determinism), different inputs → different fingerprints, 64 lowercase hex chars, default substitution, sorted-key canonicalization. |
| A | `tests/scoring/plan.test.ts` | Empty jobs, all eligible + new, all eligible + 1 reused, 1 ineligible, 1 skipped, `scoringConcurrency` carried through. |
| A | `tests/scoring/log.test.ts` | Each method emits the expected `event` + structured fields; `noopScoringLogger().scoringStart({...})` does not throw. |
| B | `tests/diagnostics/filename.test.ts` (extended) | New `openaiRequestId` field included in `resolveScopeDirectory` + `buildSafeFilename`. |
| B | (no new test file) | REUSE the existing `scoreResults.test.ts` (if present) or the existing `tests/persistence/` integration tests — the bounded remediation removed the proposed `findCurrentByJobAndFingerprint` / `markStale` / `findCurrentByFingerprint` methods. The existing `findActiveByJob` + `activateResult` are already covered by the existing repository tests. |
| E | `tests/scoring/boundaries.test.ts` | All `src/scoring/*.ts` files avoid banned imports; the `openai` runtime import lives only in `src/profile/openai/client.ts`. |

### Integration tests (with real DB + FakeOpenAIClient)

| Wave | Test file | Coverage |
|---|---|---|
| C | `tests/scoring/openai-mock.test.ts` | `FakeOpenAIClient` programmable responses (valid, malformed, timeout, rate-limit, auth error). |
| D | `tests/scoring/service.test.ts` | Full per-job flow: reuse path (existing row with current fingerprint), new score path (no existing row), stale detection (existing row with old fingerprint), ineligible job, input too large, OpenAI timeout, OpenAI invalid output (corrective retry), OpenAI rate limit, OpenAI auth error (non-retryable), `scoreBatch` with 3 jobs, atomic transaction (rollback on failure), cancellation. |

### Live tests (LINKEDIN_LIVE=1 gated, opt-in only)

| Wave | Test file | Coverage |
|---|---|---|
| E | `tests/live/linkedin.test.ts` (extended) | Score a real LinkedIn job-detail page; assert `overallScore` is a valid number; assert `displayScore` matches `overallScore.toFixed(1)`; assert all 7 categories. |

## Verification commands

Run after each wave. The implementer MUST run them in order and confirm all pass before moving to the next wave.

```bash
# After every wave:
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test tests/scoring tests/diagnostics tests/persistence tests/linkedin

# After Wave A (pure helpers):
pnpm test tests/scoring/{state,errors,rubric,score-formula,rank,fingerprint,plan,log}.test.ts

# After Wave B (DiagnosticScope + repository extensions):
pnpm test tests/diagnostics/filename.test.ts tests/persistence/score-results-find-current.test.ts

# After Wave C (fixtures + FakeOpenAIClient extensions):
pnpm test tests/scoring/openai-mock.test.ts

# After Wave D (orchestrator + integration tests):
pnpm test tests/scoring/service.test.ts

# After Wave E (boundaries + live test + docs):
pnpm test
pnpm exec playwright --version  # expect 1.62.x
pnpm test:live:list  # expect tests/live/linkedin.test.ts

# Final task verification (after all 5 waves):
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm exec playwright --version
```

## Critical preconditions requiring user approval

The implementing agent MUST stop and ask the user to confirm each item before any file in `src/scoring/` is edited. Per AGENTS.md §12.

1. **Extend `DiagnosticScope`** to add `openaiRequestId?: number | null` (method addition, no schema change). (NOTE: the original plan proposed 3 new repository methods; the bounded remediation removed them in favor of REUSING the existing `findActiveByJob` + `activateResult`.)
2. **Extend `DiagnosticScope`** to add `openaiRequestId?: number | null` (method addition, no schema change).
3. **NO new database schema / migration** — all tables already exist.
4. **NO new top-level CLI subcommand** — TASK-015 owns `jobhunter run` orchestration; TASK-014 exposes only `ScoringService.scoreOne()` + `scoreBatch()` + `buildScoringPlan()` consumed by TASK-015.
5. **NO new `openai` dependency** — already present from TASK-008.
6. **NO new `playwright` dependency** — already present from TASK-012/013.
7. **Add `tests/scoring/boundaries.test.ts`** mirroring the `tests/extraction/boundaries.test.ts` pattern.
8. **`OperationalConfigSchema` is `.strict()`** — do NOT add new config fields. Reuse `openai.jobScoring.{model, reasoningEffort, concurrency}` (already wired). The 200 KB `scoring_input_too_large` threshold is HARDCODED, not config-driven.
9. **No raw prompts/responses persisted** — per SPEC §25.4. Only input hashes + validated structured output + token usage + errors.
10. **The `ScoringPlan` data structure** is TASK-014's deliverable to TASK-015 (the confirmation UI). TASK-014 owns the data shape; TASK-015 owns the UI.

## Open questions + risks

The user should weigh in on these BEFORE implementation begins. Each item is a real risk; if the user disagrees, the plan must be revised before any code is written.

1. **`scoring_input_too_large` threshold** — hardcoded 200 KB (recommended) or config-driven via `openai.jobScoring.maxInputBytes`? Adding a config field violates the `.strict()` schema constraint. If the user wants config-driven, the plan must extend `OperationalConfigSchema` (out of scope for TASK-014).
2. **Retry-after-cancellation** — the OpenAI SDK may complete a retry that's already in flight after `signal.aborted` is set. The orchestrator discards the result. Is this acceptable, or should the scoring layer use a wrapping `AbortController` that aborts the OpenAI request mid-call? (Recommended: accept the discard — mirrors TASK-012's pattern.)
3. **Stale detection cascade** — when a new profile version is approved, ALL existing scores for the new profile's jobs become stale. The orchestrator (TASK-015) handles the re-scoring loop; TASK-014 just provides `activateResult` (which atomically marks the old row stale + inserts the new row in a single `db.transaction`) + `findActiveByJob` (which returns the active row if any). Is the cascade correct, or should TASK-014 provide a `markStaleByProfileVersion` helper? (Recommended: TASK-014 provides the per-job method; TASK-015 orchestrates the cascade.)
4. **`ScoringPlan` ownership** — TASK-014 owns the data structure; TASK-015 consumes it for the confirmation UI. Is this the right split, or should TASK-015 own the data structure too? (Recommended: TASK-014 owns it — the plan builder needs the eligibility logic, which lives in TASK-014.)
5. **Live test scope** — TASK-014 extends `tests/live/linkedin.test.ts` (TASK-013 added one) with one new `it`. Is this the right scope, or should TASK-014 create a separate `tests/live/scoring.test.ts`? (Recommended: extend the existing file — keeps the live tests in one place.)
6. **OpenAI strict-mode schema support** — the `ScoringStructuredOutputSchema` must not use top-level `anyOf` / `oneOf` / discriminated unions (per librarian research). The current design uses `z.enum` for `inferredSeniority` (which projects to JSON Schema `enum`, not `anyOf`). Is this correct, or should `inferredSeniority` be a discriminated union (e.g., `{ kind: 'junior' } | { kind: 'senior' }`)? (Recommended: `z.enum` — simpler + strict-mode compatible.)
7. **Concurrency implementation** — TASK-014 uses a simple async pool (chunked `Promise.all`). Should TASK-014 introduce a `p-limit` dependency for bounded concurrency? (Recommended: NO — the codebase has no `p-limit` dep; a 10-line chunked `Promise.all` is sufficient.)

## Completion criteria

Per `docs/tasks/TASK-014-openai-scoring-ranking.md` "Completion criteria" + per-wave commits. The task is complete when ALL of the following are true:

1. **Per-job flow** — `ScoringService.scoreOne()` correctly handles the 5 outcomes: `reused` (existing row with current fingerprint), `complete` (new score), `failed` (OpenAI error or input too large), `skipped` (ineligible), `cancelled` (signal aborted). All 5 outcomes have unit + integration tests.
2. **Score reuse + stale detection** — fingerprint-driven; REUSE the existing `findActiveByJob` (at `score-results.ts:148-184`) which returns the active row; on fingerprint mismatch, call the existing `activateResult` (at `score-results.ts:92-139`) which atomically UPDATEs the previous active row to `active: false` AND INSERTs the new row with `active: true` in a single `db.transaction`. Old row remains stored per SPEC §27.4. NO stale-detection inconsistency window (the partial unique index on `active = 1` at `schema.ts:457-459` enforces the invariant).
3. **Retry policy** — `runWithRetry` with `maxAttempts: 3`, `baseDelayMs: 500`, `maxDelayMs: 8_000`, `jitter: 'full'`, plus the existing corrective-retry budget (1) for `OpenAIInvalidOutputError`.
4. **Structured output** — `z.number().int().min(0).max(100)` per category + `z.enum` for `inferredSeniority` + `.strict()` on every object. `max_completion_tokens: 2000`.
5. **Score formula** — `computeOverallScore` returns the full-precision weighted sum (JobHunter, not OpenAI). `formatDisplayScore` returns one-decimal display value.
6. **Ranking** — `rankResults` sorts by `overallScore` descending, then `sourceJobId` ascending. No hidden factors.
7. **Score fingerprint** — SHA-256 of canonical JSON with sorted keys, lowercase hex (64 chars). Includes all SPEC §27.3 fields.
8. **Input too large** — hardcoded 200 KB byte-size pre-check; `scoring_input_too_large` surfaced; no silent truncation.
9. **Per-job failure isolation** — a failure in one `scoreOne` call does NOT terminate the batch.
10. **All OpenAI resources close** — the OpenAI client is owned by `src/profile/openai/`; the scoring service does NOT call `launch`/`close` on it. The orchestrator (TASK-015) owns the run-level lifecycle.
11. **No raw prompts/responses persisted** — per SPEC §25.4. Only input hashes + validated structured output + token usage + errors.
12. **`DiagnosticScope.openaiRequestId`** — extended, tested, and used by the scoring service for per-request diagnostics.
13. **Boundaries guard extended** — `tests/scoring/boundaries.test.ts` mirrors the existing pattern. The `openai` runtime import stays in `src/profile/openai/client.ts`; `src/scoring/` does NOT import the `openai` package directly.
14. **Live test extended** — `tests/live/linkedin.test.ts` gains one new `it` that exercises the scoring flow against a real LinkedIn job-detail page. The test is `LINKEDIN_LIVE=1` gated.
15. **All verification commands pass** — `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (all green); `pnpm exec playwright --version` 1.62.x; `pnpm test:live:list` lists `tests/live/linkedin.test.ts`.
16. **Per-wave commits** — One squash commit per wave (Wave A through Wave E), each with a clear Conventional Commits message. The squash-merge to `main` is a 6th commit that follows `GIT.md §6`.

## Appendices

### A. Reconciler map (file:line pointers to existing surface)

- `OpenAIClient` interface — `src/profile/openai/client.ts` (TASK-008). Reused unchanged.
- `OpenAIHttpClient` (real) — `src/profile/openai/client.ts`. Reused unchanged.
- `FakeOpenAIClient` — `src/profile/openai/fake-client.ts` (TASK-008). Reused unchanged.
- `runWithRetry` — `src/profile/openai/retry.ts` (TASK-008). Reused unchanged (defaults: `maxAttempts: 3`, `baseDelayMs: 500`, `maxDelayMs: 8_000`, `jitter: 'full'`).
- `parseStructuredOutput` — `src/profile/openai/structured-output.ts` (TASK-008). Reused unchanged.
- `buildProfileExtractionPrompt` template — `src/profile/openai/prompt.ts` (TASK-008). Reused structure; scoring adds `buildScoringPrompt`.
- `calculateExtractionFingerprint` — `src/profile/openai/fingerprint.ts` (TASK-008). Reused structure; scoring adds `computeScoreFingerprint`.
- `hashString` — `src/profile/hashing.ts` (TASK-002). Reused unchanged (SHA-256, lowercase hex).
- `Repositories.scoreResults` — `src/persistence/repositories/score-results.ts:1-193`. Adds 3 new methods (no schema change).
- `Repositories.openaiMetadata` — `src/persistence/repositories/openai-metadata.ts:1-164`. Reused unchanged (verify surface is sufficient).
- `Repositories.filterResults` — `src/persistence/repositories/filter-results.ts:1-238`. Reused for filter fingerprint lookup.
- `Repositories.pipelineRuns.updateRunStats` — `src/persistence/repositories/pipeline-runs.ts:135-156` (includes `jobsScored`, `scoresReused`, `scoringErrors`, `scoringDeclinedByUser`).
- `Repositories.transact(fn)` — `src/persistence/repositories/index.ts:50-58` (sync callback).
- `DiagnosticManager.recordScraperError` — `src/diagnostics/manager.ts:109-150` (reused with extended `DiagnosticScope`).
- `DiagnosticScope` — `src/diagnostics/filename.ts:3-9` (add `openaiRequestId`).
- `OperationalConfigSchema.openai.jobScoring.*` — `src/config/schema.ts:120-130`. Reused unchanged.
- `ExitCode.OpenAIFailure = 5` — `src/errors/application-error.ts:1-9`. Per-task failure exit code.
- `ApplicationError` — `src/errors/application-error.ts` (base class for the scoring error family).

### B. Anti-patterns from AGENTS.md (do not violate)

- No `any` in new code (use `unknown` with explicit narrowing). `tsconfig.json:6-8`.
- No `process.exit` inside `src/scoring/` — CLI boundary only. AGENTS.md §10.
- No raw HTML persistence outside of the diagnostic flow (with `Redactor` applied at the text layer).
- No raw OpenAI prompts/responses persisted — per SPEC §25.4. Only input hashes + validated structured output + token usage + errors.
- No silent truncation of scoring input — per SPEC §25.8.
- No hidden ranking factors — per SPEC §26.5.
- No parallel OpenAI calls beyond the configured concurrency — per SPEC §25.5.
- No Drizzle, runtime Pino, `openai` SDK, Commander, Inquirer imports in `src/scoring/*.ts` beyond the explicit allow-list. The `openai` SDK is owned by `src/profile/openai/`; the scoring service uses the `OpenAIClient` interface.
- No `import type` from `drizzle-orm` either — schema types flow via the repository's row interfaces.
- No new database schema / migration. AGENTS.md §12.
- No future-task work (no scoring-plan UI, no reevaluation command — TASK-015 and TASK-017). AGENTS.md §2.
- No login automation or credential storage.
- No new public command or JSON contract change. AGENTS.md §12.

### C. References to SPEC sections

- §25.1 — Default model + independently configurable profile extraction vs job scoring.
- §25.2 — Structured output + Zod validation.
- §25.3 — Retry policy (3 attempts; retryable + non-retryable codes; exponential backoff with jitter; corrective retry for invalid structured output).
- §25.4 — Request persistence (no raw prompts/responses; stored fields enumerated).
- §25.5 — Scoring concurrency (3 by default, configurable positive).
- §25.6 — Scoring request granularity (one request per eligible job; batching is out of MVP).
- §25.7 — Scoring input (include + exclude lists).
- §25.8 — No silent truncation; `scoring_input_too_large` on overflow.
- §26.1 — Eligibility (`complete` + `accepted` + complete enough).
- §26.2 — Rubric (7 categories with weights 30/25/20/10/5/5/5).
- §26.3 — Overall score formula (JobHunter, not OpenAI).
- §26.4 — Score precision (full precision persisted + ranked; one-decimal display).
- §26.5 — Ranking (full-precision descending, then `sourceJobId` ascending for ties; no hidden factors).
- §27.3 — Score fingerprint (9 fields enumerated).
- §27.4 — Stale results (old row preserved; not used as current; rerun when selected).
- §30 — Scoring-plan confirmation (TASK-015's UI; TASK-014 provides the data structure).
- §41.1 — Unit tests (score fingerprint, weighted calculation, ranking tie-breaking, JSON output schemas, exit-code mapping).
- §41.2 — Integration tests (OpenAI structured-response parsing).
- §44 — Open implementation decisions 3 and 8.

### D. References to prior task plans (templates + context)

- TASK-013 plan — `docs/superpowers/plans/2026-08-20-task-013-job-detail-extraction-persistence.md` (1323 lines). Used as the structural template for this plan. All conventions (sub-task numbering, decision-table format, test-plan granularity, verification-command specificity) mirror TASK-013.
- TASK-013 deepwork — `.slim/deepwork/task-013-job-detail-extraction-persistence.md`. The 26 decisions + deviations pattern is inherited by TASK-014.
- TASK-008 plan — the OpenAI service implementation (already merged). Establishes the `src/profile/openai/` surface that TASK-014 reuses.
- TASK-005 task spec — `docs/tasks/TASK-005-diagnostics-artifacts.md`. Establishes `DiagnosticManager` + `DiagnosticScope` that TASK-014 extends.
- TASK-004 task spec — `docs/tasks/TASK-004-persistence-repositories-identifiers.md`. Establishes the `Repositories` facade + the `scoreResults` + `openaiMetadata` repository surfaces that TASK-014 extends.
- TASK-002 task spec — `docs/tasks/TASK-002-paths-configuration-validation-logging.md`. Establishes `OperationalConfigSchema` (the `.strict()` schema) + `ExitCode` enum + `Logger` facade.

### E. References to existing tests (templates)

- `tests/extraction/boundaries.test.ts` (TASK-013) — Mirror for `tests/scoring/boundaries.test.ts`. Same structure, same `BANNED_IMPORTS`, same `RUNTIME_PLAYWRIGHT_IMPORT_RE` (optional), same `PROCESS_EXIT_RE`.
- `tests/extraction/service.test.ts` (TASK-013) — Mirror for `tests/scoring/service.test.ts`. Same `FakeBrowserSession`-equivalent pattern (use `FakeOpenAIClient` instead).
- `tests/linkedin/fixtures/loadFixture.ts` — Re-export for `tests/scoring/fixtures/loadFixture.ts`. Same fixture loader pattern.
- `tests/live/linkedin.test.ts` (TASK-012/013) — Extend for the scoring live test. Same `describe.skipIf(!ENABLED)` gate.

### F. Per-wave commit messages (Conventional Commits)

Per `GIT.md §6`, each wave produces one commit. The squash-merge to `main` is a 6th commit that summarizes the 5 wave commits.

- Wave A: `feat(scoring): add linkedin scoring pure helpers (TASK-014 W1)`
- Wave B: `feat(diagnostics): add openaiRequestId to DiagnosticScope (TASK-014 W2)`
- Wave C: `feat(scoring): add linkedin scoring fixtures and openai mock (TASK-014 W3)`
- Wave D: `feat(scoring): add linkedin scoring service and repository extensions (TASK-014 W4)`
- Wave E: `chore(tasks): add scoring boundaries, live test, and docs (TASK-014 W5)`
- Squash: `feat(scoring): add linkedin openai scoring, fixtures, and live test (TASK-014)`
