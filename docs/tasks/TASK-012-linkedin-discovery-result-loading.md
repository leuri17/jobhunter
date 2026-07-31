# TASK-012 — LinkedIn Result Discovery, Load-More Behavior, and Access Handling

**Status:** Planned; not approved for implementation
**Order:** 012
**Dependencies:** TASK-002, TASK-004, TASK-005, TASK-006

## Scope

Implement public, unauthenticated LinkedIn search-page execution:

- Launch headless Playwright Chromium with a fresh unauthenticated context per run.
- Execute generated searches sequentially and reuse the context across search and fallback pages.
- Navigate to each generated URL, validate the expected page, detect recoverable overlays, dismiss them with bounded strategies, and report typed access-blocked errors when scraping cannot continue.
- Discover job cards and canonical LinkedIn job IDs, preserving available card metadata.
- Load additional results until a deterministic bounded end condition occurs without imposing a per-search result cap.
- Avoid infinite loops through no-progress counters, repeated IDs, rendered-count checks, and unavailable load mechanisms.
- Persist independent search executions with run, query/location, URL, timestamps, status, counts, errors, and diagnostic references.
- Continue after isolated card/discovery failures whenever safe; preserve discovery errors when no canonical ID exists.
- Close browser, context, and pages on success, failure, and cancellation.

Job-detail field extraction and canonical job persistence belong to TASK-013.

## Dependencies and handoffs

- Uses resolved scraper settings and paths from TASK-002.
- Uses run/search/discovery repositories from TASK-004.
- Uses diagnostics from TASK-005.
- Consumes generated search inputs from TASK-006.
- Produces ordered discovered-job events and search execution outcomes for TASK-013 and TASK-015.

## Referenced specification sections

- `SPEC.md` §11.4 search-execution persistence
- `SPEC.md` §21.1–21.7 access model, browser lifecycle, search behavior, end detection, overlays, timeouts, and sequential scraping
- `SPEC.md` §22.1–22.2 canonical source ID and detail URL derivation inputs
- `SPEC.md` §22.11–22.12 discovery errors and failure isolation
- `SPEC.md` §29.1 and §29.3 scraping concurrency and cleanup
- `SPEC.md` §39 diagnostics
- `SPEC.md` §40 reliability requirements
- `SPEC.md` §41.3 fixture/live scraper tests

## Expected tests

- Test URL navigation, expected-page validation, access blocking, recoverable overlays, and bounded dismissal.
- Test job-card ID parsing, duplicate ID suppression, no-ID discovery errors, and available metadata retention.
- Test each deterministic end-of-results condition and bounded no-progress behavior.
- Test sequential search execution and single active panel/fallback capacity contract.
- Test timeout/retry configuration and typed error mapping.
- Test browser/page/context cleanup on success, per-search failure, per-card failure, and cancellation.
- Use saved HTML fixtures for selectors and discovery logic; keep live tests explicit.

## Verification requirements

- Run fixture-based scraper tests in normal CI.
- Run simulated browser lifecycle/error tests with Playwright fakes or controlled fixtures.
- Confirm live LinkedIn tests are isolated behind the explicit live-test command/configuration.
- Run typecheck and focused scraper/persistence tests.

## Completion criteria

- Every configured search executes sequentially and terminates through a bounded condition.
- Canonical IDs and discovery errors are persisted with run/search context.
- Access-blocked errors are typed and existing data remains intact.
- All browser resources close on every tested exit path.
