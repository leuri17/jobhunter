# JobHunter MVP Task Index

**Status:** Planning decomposition approved for review; TASK-001 through TASK-007 implemented
**Source of truth:** `SPEC.md`
**Implementation status:** TASK-001 through TASK-007 are implemented (TASK-007 was squash-merged from `feat/task-007-cv-import`, 1 commit after post-review revisions). A post-merge audit of TASK-007 is tracked at `docs/tasks/AUDIT-TASK-007-2026-08-13.md`. The remaining tasks (TASK-008 through TASK-018) are planned; no application code, dependencies, migrations, or generated output may be created for them until each task's own plan is approved.

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
| [TASK-010](./TASK-010-deterministic-filters.md) | Global deterministic filters and filter fingerprints | 004, 009 | Auditable filter configuration/evaluation with abstention and invalidation |
| [TASK-011](./TASK-011-guided-initialization.md) | Guided initialization and resumable setup orchestration | 006, 007, 008, 009, 010 | Idempotent `jobhunter init` state machine and setup summary |
| [TASK-012](./TASK-012-linkedin-discovery-result-loading.md) | LinkedIn result discovery, load-more behavior, and access handling | 002, 004, 005, 006 | Sequential public LinkedIn search execution and discovery persistence |
| [TASK-013](./TASK-013-job-detail-extraction-persistence.md) | Job-detail extraction, embedded panel fallback, and persistence | 004, 005, 012 | Complete/partial/failed job outcomes with panel-first extraction |
| [TASK-014](./TASK-014-openai-scoring-ranking.md) | OpenAI scoring, score fingerprints, weighted scoring, and ranking | 004, 009, 010, 013 | Validated one-job scoring, deterministic final score and tie-breaking |
| [TASK-015](./TASK-015-pipeline-orchestration-cancellation.md) | Pipeline orchestration, reuse/invalidation, confirmation, concurrency, and cancellation | 005, 006, 010, 011, 012, 013, 014 | End-to-end `jobhunter run` with safe lifecycle and resumable stage behavior |
| [TASK-016](./TASK-016-inspection-tables-json-output.md) | Job/run inspection, adaptive tables, JSON output, and exit codes | 004, 014, 015 | Read-only inspection commands and stable machine-readable output |
| [TASK-017](./TASK-017-explicit-reevaluation.md) | Explicit job reevaluation and scope handling | 010, 014, 015, 016 | `jobs reevaluate` modes, dry-run planning and confirmation rules |
| [TASK-018](./TASK-018-integration-acceptance-verification.md) | Cross-system integration testing, diagnostics verification, and MVP acceptance | 001–017 | Full acceptance evidence, fixture coverage, reliability checks and final review |

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
