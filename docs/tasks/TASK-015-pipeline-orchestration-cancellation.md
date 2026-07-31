# TASK-015 — Pipeline Orchestration, Reuse/Invalidation, Confirmation, Concurrency, and Cancellation

**Status:** Planned; not approved for implementation
**Order:** 015
**Dependencies:** TASK-005, TASK-006, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014

## Scope

Compose the completed pipeline stages into `jobhunter run`:

- Load/validate configuration, initialize/migrate the database, load the active approved profile, verify active filters, and validate OpenAI credentials.
- Snapshot normalized configuration without secrets, create a run, create independent search executions, and generate all configured searches.
- Execute searches and persist complete/partial/failed outcomes while isolating recoverable failures.
- Apply or reuse current filters only for jobs discovered during the run.
- Build and display the scoring plan before new OpenAI scoring requests; require confirmation unless `--yes` is supplied.
- Score eligible accepted jobs with configured concurrency, reuse matching scores, and preserve reusable results if the user declines.
- Rank current successful scores and print the configured top-N results.
- Implement independent extraction/filter/score cache behavior and stale-result rules; do not scan unrelated stale jobs during a normal run.
- Handle `Ctrl+C` by stopping new work, safely finishing/cancelling active operations, persisting completed work, closing resources, finalizing `cancelled`, and printing a summary.
- Finalize all run statistics and statuses, including recoverable errors and declined scoring.

Read-only inspection and explicit reevaluation commands belong to TASK-016 and TASK-017.

## Dependencies and handoffs

- Integrates all prerequisite application services and repositories.
- Produces the end-to-end run service consumed by inspection, reevaluation, and acceptance tests.
- Must not add per-query/per-location filters, background scheduling, authenticated scraping, or hidden ranking factors.

## Referenced specification sections

- `SPEC.md` §8.4 run configuration snapshot
- `SPEC.md` §27.1–27.5 cache reuse, fingerprints, stale results, and normal-run scope
- `SPEC.md` §29.1–29.3 concurrency and cancellation
- `SPEC.md` §30 scoring-plan confirmation
- `SPEC.md` §33 `jobhunter run`
- `SPEC.md` §38 run behavior and statuses
- `SPEC.md` §40 reliability requirements
- `SPEC.md` §42 MVP acceptance criteria 20–38

## Expected tests

- Verify prerequisite validation prevents state changes when configuration/profile/filter requirements fail.
- Verify run and search records are created transactionally with configuration snapshots that exclude secrets.
- Verify all query/location combinations execute sequentially.
- Verify complete and partial extraction reuse/skip behavior inside normal runs.
- Verify current filter/score reuse and stale reruns are independent by stage.
- Verify scoring-plan display and confirmation, including decline and `--yes` semantics.
- Verify recoverable search/job/filter/score errors produce `completed_with_errors` and preserve successful work.
- Verify cancellation stops scheduling, persists completed work, closes browser/database/OpenAI resources, and finalizes as `cancelled`.
- Verify top-N output uses current successful scores relevant to the run and no scraping/result cap is introduced.

## Verification requirements

- Run end-to-end integration tests with fake browser/OpenAI adapters and temporary persistence.
- Run cancellation tests with controlled signals and delayed fake operations.
- Run normal and failure-path CLI smoke tests.
- Run typecheck, build, focused integration tests, and the task's acceptance subset.

## Completion criteria

- `jobhunter run` executes the full documented pipeline with correct stage boundaries and lifecycle persistence.
- Reuse, invalidation, confirmation, concurrency, recoverable errors, and cancellation are observable and tested.
- The run summary and status records contain the required counts and diagnostics.
