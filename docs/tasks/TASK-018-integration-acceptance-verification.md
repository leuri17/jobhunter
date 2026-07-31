# TASK-018 — Cross-System Integration Testing, Diagnostics Verification, and MVP Acceptance

**Status:** Planned; not approved for implementation
**Order:** 018
**Dependencies:** TASK-001–TASK-017

## Scope

Validate the integrated product against the MVP acceptance criteria and reliability requirements without introducing new product behavior:

- Run cross-system integration tests covering initialization, configuration, search, profile import/extraction, approval, filters, scraping fixtures, extraction, filtering, scoring, ranking, inspection, JSON, reevaluation, and cancellation.
- Run fixture-based scraper tests and verify the live LinkedIn suite remains opt-in and excluded from normal CI.
- Verify each of the 43 MVP acceptance criteria in `SPEC.md` §42 through deterministic scenarios, fixtures, or fakes.
- Verify reliability requirements from `SPEC.md` §40: bounded retries, bounded waits, infinite-loop prevention, deduplication, failure isolation, preserved writes, validation, resource closure, partial-job separation, complete-job reuse, history preservation, atomic configuration writes, secret safety, and clean JSON stdout.
- Verify typed error mapping for each documented exit code, including recoverable-error runs that return `0` and JSON commands that do not write invalid output.
- Verify documentation alignment between `SPEC.md`, `AGENTS.md`, `GIT.md`, and `README.md`.
- Verify no future-task work was added to any prior task.

This task owns verification, evidence collection, and final review only.

## Dependencies and handoffs

- Consumes every prior task's deliverable as finished, integrated code.
- Produces acceptance evidence, sign-off, and any documented limitation list.
- Any gap requires a follow-up task created through the same planning workflow, not inline expansion.

## Referenced specification sections

- `SPEC.md` §40 reliability requirements
- `SPEC.md` §41.1–41.3 unit, integration, and scraper test expectations
- `SPEC.md` §42 MVP acceptance criteria
- `SPEC.md` §43.4 review before completion
- `AGENTS.md` §15 completion check
- `GIT.md` §5 verification before a commit and §9 pull request content

## Expected tests

- A reproducible acceptance run mapping each `SPEC.md` §42 numbered item to passing tests, fixtures, or documented evidence.
- A reliability matrix mapping each `SPEC.md` §40 requirement to a test or guard.
- A live-LinkedIn opt-in verification that the default run does not exercise network access.
- A final integration test invoking every public command through thin CLI adapters with fake dependencies and asserting expected exit codes and JSON output.
- A documentation consistency check across the four documentation files.

## Verification requirements

- Run the full project typecheck, lint, build, and normal test suite from a clean state.
- Run the documented live-test command in an isolated environment to confirm opt-in behavior.
- Review the complete diff versus `main`/the base branch for accidental future-task work.
- Capture verification output and any honest limitations in this task document.
- Obtain explicit user approval before requesting a merge or follow-up commit.

## Completion criteria

- Every MVP acceptance criterion is satisfied with documented evidence.
- No reliability requirement is silently skipped or approximated.
- Documentation is aligned and the task ledger accurately reflects the work performed.
- The user explicitly approves completion before any commit, push, or merge action.
