# TASK-013 — Job-Detail Extraction, Embedded Panel Fallback, and Persistence

**Status:** Planned; not approved for implementation
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
