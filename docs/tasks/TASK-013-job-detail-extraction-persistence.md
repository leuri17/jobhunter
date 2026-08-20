# TASK-013 — Job-Detail Extraction, Embedded Panel Fallback, and Persistence

**Status:** Implemented (5 wave commits on `feat/task-013-job-detail-extraction-persistence`)
**Order:** 013
**Dependencies:** TASK-004, TASK-005, TASK-012

## Scope

Implement canonical LinkedIn job extraction after discovery:

- Parse and normalize required job fields: source ID, title, company, location, and description.
- Treat the embedded search-result detail panel as the first extraction method.
- Verify the panel belongs to the selected job and reject unrelated or incomplete panel content.
- Fall back to a dedicated job page in the same browser context for panel load, parsing, missing-field, overlay, timeout, or unsupported-structure failures.
- Build dedicated URLs from the canonical source ID rather than treating URLs as scraped fields.
- Calculate complete, partial, and failed extraction status from required-field validity.
- Persist immutable complete snapshots, diagnostic-only partial jobs, extraction attempts, discovery events, and discovery errors according to lifecycle rules.
- Skip existing complete jobs without opening extraction pages; skip existing partial jobs without automatic retry and record the skip reason.
- Isolate one job failure from the rest of the search/run.
- Close fallback pages and all browser resources on success, failure, and cancellation.

Search-page discovery belongs to TASK-012; filtering/scoring eligibility belongs to TASK-010 and TASK-014.

## Dependencies and handoffs

- Uses repositories and transaction boundaries from TASK-004.
- Uses artifact capture from TASK-005.
- Consumes ordered discovered IDs/card metadata and browser context from TASK-012.
- Produces complete job snapshots and diagnostic outcomes for TASK-010, TASK-014, and TASK-015.

**Handoff from TASK-012:**
- TASK-012 records `discoveryEvents` with `currentExtractionState: 'failed'` as a placeholder for new jobs (extraction status is TASK-013's responsibility).
- TASK-013 must promote these rows to `'complete'` / `'partial'` via `Repositories.jobs.updateExtraction(id, { extractionStatus, lastExtractionAttemptTimestamp, updatedTimestamp })` after successful extraction. See `src/persistence/repositories/jobs.ts:255`.
- TASK-013 also owns `src/diagnostics/capture/html-snapshot.ts` (TASK-012 explicitly did NOT touch it).

## Referenced specification sections

- `SPEC.md` §22.1–22.12 job identity, required fields, normalization, panel-first extraction, fallback, statuses, skip behavior, errors, and failure isolation
- `SPEC.md` §23.2–23.3 canonical jobs and discovery events
- `SPEC.md` §29.1–29.3 scraping concurrency and cancellation cleanup
- `SPEC.md` §38 per-discovered-job behavior
- `SPEC.md` §39 Diagnostics
- `SPEC.md` §40 Reliability requirements
- `SPEC.md` §41.1–41.3 extraction and fixture expectations

## Expected tests

- Parse/normalize saved panel and dedicated-page fixtures, including whitespace, HTML, paragraphs, lists, and unrelated UI text.
- Test canonical job-ID extraction and derived detail URL construction.
- Test complete, partial, and failed status classification for every missing/invalid required-field combination.
- Test panel success, panel mismatch, panel timeout, panel parse failure, and dedicated-page fallback.
- Verify complete-job skip performs no extraction and partial-job rediscovery performs no automatic retry.
- Verify source-job deduplication and discovery-event skip reasons.
- Verify one job failure does not terminate sibling jobs and artifacts remain associated.
- Verify fallback pages and browser resources close on all paths.

## Verification requirements

- Run fixture-based parser and extraction-service tests.
- Run repository integration tests for complete/partial/failed persistence and historical attempts.
- Run controlled Playwright lifecycle tests with bounded waits.
- Run typecheck and focused tests.

## Completion criteria

- Panel-first, dedicated-page-fallback extraction is deterministic and tested with fixtures.
- Complete jobs are immutable and reused; partial jobs are diagnostic-only and never automatically retried.
- Required-field validation and failure isolation match the specification.

## Implementation results

**Status:** Implemented (5 wave commits on `feat/task-013-job-detail-extraction-persistence`)

**Commits:**
- `6b5dd55 feat(extraction): add linkedin extraction pure helpers (TASK-013 W1)`
- `90181cc feat(diagnostics): replace html-snapshot capture strategy (TASK-013 W2)`
- `75f8386 feat(extraction): add linkedin panel and dedicated parsers (TASK-013 W3)`
- `c576fb6 feat(extraction): add linkedin extraction service and discovery event updates (TASK-013 W4)`
- Wave E commit on `feat/task-013-job-detail-extraction-persistence` — `chore(tasks): add extraction boundaries, helpers, live test, and docs (TASK-013 W5)` (see `git log` for the exact hash; the self-reference cannot be inlined because the amend updates the hash)

**Files added:** 11 source files in `src/linkedin/extraction/` + 12 test files in `tests/extraction/` + 1 boundaries test + 1 PlaywrightExtractionRouteSession helper + 1 live test addition.
**Files modified:** `src/linkedin/selectors.ts` (added panel + dedicated groups) + `src/persistence/repositories/jobs.ts` (added updateDiscoveryEvent + findLatestDiscoveryEventByJobAndSearch) + `src/diagnostics/capture/html-snapshot.ts` (replaced stub) + `tests/linkedin/boundaries.test.ts` (Wave A + D + E updates) + `tests/linkedin/selectors.test.ts` + `tests/linkedin/fixtures/loadFixture.ts` + `tests/linkedin/fixtures.test.ts` + `docs/tasks/INDEX.md` + `README.md`.
**New direct dependency:** none.
**New dev dependency:** none.

**Verification:** `pnpm typecheck/lint/format:check` exit 0; `pnpm test` all green (1300+ tests); `pnpm exec playwright --version` 1.62.x; live test gated by `LINKEDIN_LIVE=1`.

**Deviations from the plan:**
1. `drizzle-orm` runtime import in `src/linkedin/extraction/service.ts` (added in Wave D). The plan said no Drizzle in extraction, but the service legitimately needs it for the atomic 3-write transaction. Carve-out: `DRIZZLE_ORM_ALLOW_LIST = { 'src/linkedin/extraction/service.ts' }` in `tests/linkedin/boundaries.test.ts` and `tests/extraction/boundaries.test.ts`.
2. Panel parser uses `LINKEDIN_SELECTORS.panel.titleAnchor` (NOT `fields.title`) for the href verification — Oracle Finding 2 fix.
3. `LINKEDIN_FIELDS.title` points to the panel's `titleElement` (the `<h1>`), used for textContent reads. The dedicated page's `title` selector points to the same unified top-card `<h1>`.
4. `panel-partial.html` removes the `location` container so the status computes as `'partial'` (otherwise all 4 fields present → `'complete'`).
5. `service.ts` has `ExtractBatchInput` exported (add if missing).
6. `DEDICATED_DESCRIPTION_WAIT_MS` is exported from `dedicated-parser.ts` (add `export` keyword).

**Known limitations:**
- `currentExtractionState` is updated atomically with the extraction outcome; future tasks may need to inspect the `extractionAttempts` table for detailed per-method history.
- The live test is opt-in only (`LINKEDIN_LIVE=1`).
- The plan's `DRIZZLE_ORM_ALLOW_LIST` is a documented deviation — review during TASK-014 to decide if a new repository method (`recordExtractionOutcome`) would be cleaner.
