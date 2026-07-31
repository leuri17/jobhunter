# TASK-016 — Job/Run Inspection, Adaptive Tables, JSON Output, and Exit Codes

**Status:** Planned; not approved for implementation
**Order:** 016
**Dependencies:** TASK-004, TASK-014, TASK-015

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
