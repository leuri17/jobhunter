# JobHunter MVP Task Index

**Status:** Planning decomposition approved for review; TASK-001 through TASK-019 implemented; TASK-014 was implemented across 7 commits on `feat/task-014-openai-scoring-ranking` (with parent-row setup deferred to a follow-up).
**Source of truth:** `SPEC.md`
**Implementation status:** TASK-001 through TASK-019 are implemented (TASK-007 was squash-merged from `feat/task-007-cv-import`, 1 commit after post-review revisions; TASK-010 was implemented across 14 commits on `feat/task-010-deterministic-filters`; TASK-011 was implemented across 8 commits on `feat/task-011-guided-initialization`; TASK-012 was implemented across 5 wave commits on `feat/task-012-linkedin-discovery-result-loading`; TASK-014 was implemented across 7 commits on `feat/task-014-openai-scoring-ranking`; TASK-015 was implemented across 5 wave commits on `feat/task-015-pipeline-orchestration`; TASK-016 was implemented across 5 wave commits on `feat/task-016-inspection-tables-json-output`; TASK-017 was implemented across 5 wave commits on `feat/task-017-explicit-reevaluation`; TASK-018 was implemented across 5 wave commits on `feat/task-018-integration-acceptance-verification`; TASK-019 was implemented across 4 wave commits on `feat/task-019-logger-stdout-routing`). A post-merge audit of TASK-007 is tracked at `docs/tasks/AUDIT-TASK-007-2026-08-13.md`. TASK-019 resolved the 1 production finding surfaced by TASK-018 (logger → stdout leak, SPEC §40 violation).

## Purpose

This ledger divides the complete JobHunter MVP into ordered macro tasks. Each task is independently reviewable and must be planned and approved before implementation. The task boundaries preserve the separation required by `SPEC.md` between CLI concerns, application services, domain rules, persistence, browser automation, OpenAI operations, logging, and platform paths.

## Workflow rules

1. Work on one macro task at a time.
2. Before implementation, read the selected task document and only its relevant `SPEC.md` sections.
3. Inspect completed dependencies.
4. Create a detailed, test-first plan for the selected task and request approval.
5. Implement only the approved task.
6. Run the task's verification requirements and update its task document with results.
7. Stop before beginning the next task.
8. Ask before adding or removing direct dependencies, changing public contracts, changing the database schema/migrations, deleting tracked code, or expanding the selected task.
9. Do not commit, create branches, or create worktrees without following `GIT.md` and obtaining the required approval.

## Ordered macro tasks

| ID | Task | Depends on | Primary deliverable |
|---|---|---|---|
| [TASK-001](./TASK-001-repository-typescript-foundation.md) | Repository and TypeScript foundation | — | Pinned Node/pnpm project, strict native-ESM TypeScript build and test harness |
| [TASK-002](./TASK-002-paths-configuration-validation-logging.md) | OS paths, configuration, validation, logging, and typed errors | 001 | ✅ Implemented — Safe runtime paths, validated atomic configuration, structured logging/error primitives |
| [TASK-003](./TASK-003-database-schema-migrations.md) | SQLite connection, Drizzle schema, migrations, and initialization | 001, 002 | ✅ Implemented — Foreign-key-enforced DB, Drizzle schema for 18 MVP entities, committed migration, transactional init lifecycle |
| [TASK-004](./TASK-004-persistence-repositories-identifiers.md) | Repositories, transactions, lifecycle rules, and CLI identifiers | 003 | Storage interfaces and repositories with stable user-facing identifiers |
| [TASK-005](./TASK-005-diagnostics-artifacts.md) | Diagnostics and artifact management | 002, 003, 004 | Safe, associated diagnostic artifact persistence and capture services |
| [TASK-006](./TASK-006-search-configuration-url-generation.md) | Search configuration workflow and LinkedIn URL generation | 002, 004 | Interactive search settings, URL parsing, Cartesian search matrix and URL builder |
| [TASK-007](./TASK-007-cv-import-local-text-extraction.md) | CV import, immutable source persistence, and local text extraction | 002, 004, 005 | ✅ Implemented (squash-merged from `feat/task-007-cv-import`, 1 commit) — `profile import` subcommand, immutable storage, SHA-256 dedup, text/OCR/malformed/encrypted handling, no OpenAI |
| [AUDIT-TASK-007](./AUDIT-TASK-007-2026-08-13.md) | Code audit of TASK-007 | — | Post-merge audit: 3 Critical, 9 Important, 10 Minor, 5 Verification; use as fix-up checklist |
| [TASK-008](./TASK-008-openai-profile-extraction.md) | OpenAI profile extraction and structured validation | 002, 004, 007 | Versioned, fingerprinted, validated profile drafts from imported source text |
| [TASK-009](./TASK-009-profile-review-approval-overrides.md) | Profile review, editing, conflicts, approval, versioning, and overrides | 004, 008 | Explicitly reviewed profile lifecycle with conflict resolution and derived overrides |
| [TASK-010](./TASK-010-deterministic-filters.md) | Global deterministic filters and filter fingerprints | 004, 009 | ✅ Implemented (14 commits on `feat/task-010-deterministic-filters`) — Versioned `JobFilterConfig` schema, keyword/seniority/language evaluators, fingerprint composer, `FilterApplyService` cache ledger, `ConfigureFiltersService` interactive flow, `jobhunter configure filters` CLI subcommand; never calls OpenAI |
| [TASK-011](./TASK-011-guided-initialization.md) | Guided initialization and resumable setup orchestration | 006, 007, 008, 009, 010 | ✅ Implemented (8 commits) on `feat/task-011-guided-initialization` — `InitOrchestrator` state machine, idempotent `jobhunter init` subcommand, resumable from first incomplete prerequisite, no `--json` in this task |
| [TASK-012](./TASK-012-linkedin-discovery-result-loading.md) | LinkedIn result discovery, load-more behavior, and access handling | 002, 004, 005, 006 | ✅ Implemented (5 wave commits on `feat/task-012-linkedin-discovery-result-loading`) — `LinkedInDiscoveryService` orchestrator, `BrowserSession` + `PlaywrightBrowserSession` + `FakeBrowserSession` seam, `PlaywrightRouteSession` fixture-routing helper, captured-strategy stubs replaced in place (`ScreenshotCapture` + `LinkedInPlaywrightTraceCapture`), `navigateWithTimeout` bounded navigation, HTML fixtures + loadFixture helper, live-test placeholder gated by `LINKEDIN_LIVE=1`. Browser launch/close is TASK-015's responsibility; the discovery service manages per-page lifecycle only. |
| [TASK-013](./TASK-013-job-detail-extraction-persistence.md) | Job-detail extraction, embedded panel fallback, and persistence | 004, 005, 012 | ✅ Implemented (5 wave commits on `feat/task-013-job-detail-extraction-persistence`) — `LinkedInExtractionService` orchestrator, `parsePanel` + `parseDedicatedPage` parsers sharing `LINKEDIN_FIELDS` selectors, 2 new repository methods (`updateDiscoveryEvent`, `findLatestDiscoveryEventByJobAndSearch`), `HtmlSnapshotCapture` real implementation, 6 HTML fixtures, `DRIZZLE_ORM_ALLOW_LIST` carve-out for service.ts. |
| [TASK-014](./TASK-014-openai-scoring-ranking.md) | OpenAI scoring, score fingerprints, weighted scoring, and ranking | 004, 009, 010, 013 | ✅ Implemented (7 commits on `feat/task-014-openai-scoring-ranking`) — `src/scoring/` module complete (pure helpers + service + barrel); `tests/scoring/` covers all 8 pure helpers + boundaries test + fake-scoring-pipeline helper. Full scoreOne/scoreBatch integration tests with parent-row setup deferred to a follow-up (see "Known limitations" in the task doc). |
| [TASK-015](./TASK-015-pipeline-orchestration-cancellation.md) | Pipeline orchestration, reuse/invalidation, confirmation, concurrency, and cancellation | 005, 006, 010, 011, 012, 013, 014 | ✅ Implemented (5 wave commits on `feat/task-015-pipeline-orchestration`) — `PipelineOrchestrator` + `jobhunter run` subcommand with SIGINT handling, scoring plan confirmation, and top-N output; 10/12 integration tests passing (T9 + T11 require richer panel-parser fixture) |
| [TASK-016](./TASK-016-inspection-tables-json-output.md) | Job/run inspection, adaptive tables, JSON output, and exit codes | 004, 014, 015 | Read-only inspection commands and stable machine-readable output |
| [TASK-017](./TASK-017-explicit-reevaluation.md) | Explicit job reevaluation and scope handling | 010, 014, 015, 016 | ✅ Implemented (5 wave commits on `feat/task-017-explicit-reevaluation`) — `ReevaluationService` + read-only fingerprint helpers + `ScoreResultRepository.invalidateActiveByJob(jobId)` + `JobRepository.listComplete()` + `jobhunter jobs reevaluate` subcommand with `--filters-only` / `--scores-only` / `--job <job-id>` / `--dry-run` / `--yes` / `--json` flags; cascading filter→score invalidation; `--dry-run` never writes the database and never calls OpenAI; `--yes` bypasses only the OpenAI scoring confirmation |
| [TASK-018](./TASK-018-integration-acceptance-verification.md) | Cross-system integration testing, diagnostics verification, and MVP acceptance | 001–017 | ✅ Implemented — `tests/acceptance/` suite (acceptance-evidence × 43, reliability × 17, cli-adapters × 28, docs-consistency × 7+1) + `pnpm test:acceptance` script + minimal README alignment; full verification transcript captured (1854 / 7 / 0 across the full suite, 95 / 1 / 0 for the acceptance subset); live-LinkedIn opt-in guard confirmed; 1 production finding surfaced (logger → stdout leak, SPEC §40 violation, resolved by TASK-019) |
| [TASK-019](./TASK-019-logger-stdout-routing-fix.md) | Route rootLogger to stderr for clean --json stdout (SPEC §40 reliability fix) | 002, 018 | ✅ Implemented — single-line `createLogger` change in `src/cli.ts` (passes `destinations: { stdout: process.stderr }`) + regex workaround dropped from `tests/acceptance/cli-adapters.test.ts` + new behavioral assertion (29 cli-adapter tests, +1 from TASK-018's 28) + R-17 strengthened to behavioral check in `tests/acceptance/reliability.test.ts`; full verification: pnpm test:acceptance = 97 / 0 / 0 |

## Shared constraints for every task

- Use Node.js `24.18.0`, pnpm `11.18.0`, strict TypeScript, native ESM, and the approved technology foundation.
- Use Zod at external, persisted, CLI, profile, filter, OpenAI, and JSON boundaries.
- Keep domain/application logic independent of Commander, Inquirer, Playwright, Drizzle, and Pino unless the selected task explicitly owns the adapter.
- Preserve historical profiles, extraction attempts, filter results, score results, diagnostics, and errors.
- Do not log secrets or persist raw OpenAI prompts/responses by default.
- Keep JSON stdout to exactly one complete JSON document when `--json` is supported.
- Keep live LinkedIn tests explicit and excluded from normal CI.
- Do not implement non-goals or future-task work.

## Approval boundary

The decomposition itself is approved. No macro task is approved for implementation by that approval. Each task requires its own detailed plan, test plan, verification commands, and explicit approval before coding begins.
