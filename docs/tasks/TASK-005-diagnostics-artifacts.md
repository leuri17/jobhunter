# TASK-005 — Diagnostics and Artifact Management

**Status:** Planned; not approved for implementation
**Order:** 005
**Dependencies:** TASK-002, TASK-003, TASK-004

## Scope

Implement the diagnostic artifact boundary used by scraping and pipeline failures:

- Resolve the diagnostics directory through the path service.
- Persist artifact metadata and associations to run, search execution, and job when available.
- Capture configured scraper-error artifacts: screenshot, current URL, error message, and stack trace by default.
- Keep Playwright trace and HTML snapshot disabled by default but configurable through operational settings.
- Generate safe deterministic filenames and avoid embedding secrets in artifacts or metadata.
- Preserve the original scraper error when artifact creation fails.
- Provide cleanup/close behavior for any artifact resources without implementing retention automation.

Browser-specific capture hooks belong to TASK-012 and TASK-013; this task owns the reusable artifact manager and persistence boundary.

## Dependencies and handoffs

- Uses paths and diagnostic configuration from TASK-002.
- Uses artifact repository/schema from TASK-003 and TASK-004.
- Produces a testable diagnostic manager consumed by scraper and orchestration tasks.

## Referenced specification sections

- `SPEC.md` §7.1–7.6 directory categories and path behavior
- `SPEC.md` §8.1 diagnostic configuration
- `SPEC.md` §23.1 diagnostic artifact references
- `SPEC.md` §29.3 graceful resource cleanup
- `SPEC.md` §39 Diagnostics
- `SPEC.md` §40 Reliability requirements

## Expected tests

- Verify artifact paths are created only when an artifact is requested.
- Verify safe filenames for run/search/job/error identifiers and hostile metadata.
- Verify default artifact selection matches the specification.
- Verify trace and HTML capture remain disabled unless explicitly enabled.
- Verify metadata is associated with the narrowest available scope.
- Verify a failed screenshot or trace write preserves the original scraper error and records artifact failure metadata.
- Verify secret-like values are not written to logs or artifact metadata.

## Verification requirements

- Run diagnostics unit tests with a temporary diagnostics directory.
- Run persistence integration tests for artifact references and associations.
- Exercise a simulated scraper failure through the artifact manager.
- Run typecheck and focused tests.

## Completion criteria

- Scraper and pipeline code can request diagnostics without knowing filesystem layout or database details.
- Default and opt-in artifact behavior is tested.
- Artifact failures never mask the primary failure.
- Retention and cleanup automation remain explicitly outside the MVP.
