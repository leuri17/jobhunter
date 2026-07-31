# TASK-017 — Explicit Job Reevaluation and Scope Handling

**Status:** Planned; not approved for implementation
**Order:** 017
**Dependencies:** TASK-010, TASK-014, TASK-015, TASK-016

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
