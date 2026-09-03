# src/linkedin/extraction/

## Responsibility

LinkedIn job-detail extraction. Fills the canonical `jobs` row from a discovered card by reading the four required fields (`title`, `company`, `location`, `description`) off either the in-list search-detail panel or the dedicated `/jobs/view/<id>/` page, normalizing text, and classifying the result as `complete` / `partial` / `failed`.

## Design

Orchestrator + strategy parsers, all Playwright-coupled code via the `BrowserSession` seam (parsers import `Page`/`Locator` as types only).

- `service.ts` — `LinkedInExtractionService` orchestrator. Owns the per-job flow: skip-if-complete → panel → dedicated fallback → status compute → atomic 3-write transaction (one `extractionAttempts` row per attempted method + `jobs` update + `discoveryEvents` patch) → close fallback. Never calls `browserSession.launch()` / `close()`; those belong to the run-level lifecycle. `extractOne` returns `ExtractionOutcome` and never throws for per-job failures; typed errors only escape for hard stops (missing discovery event).
- `panel-parser.ts` — `parsePanel(page, { sourceJobId, signal })`. Reads the unified top-card DOM shared with the dedicated page; waits on the description container (`state: 'visible'`, 10s), then verifies the panel title anchor `href` (read from `LINKEDIN_SELECTORS.panel.titleAnchor`, not the `<h1>`) matches `sourceJobId` via a bounded retry loop (`PANEL_VERIFY_MAX_ATTEMPTS = 3` × `PANEL_VERIFY_RETRY_MS = 500ms`). Throws `PanelExtractionError` / `PanelJobIdMismatchError`.
- `dedicated-parser.ts` — `parseDedicatedPage(page, { signal })`. Reuses the same `LINKEDIN_FIELDS` map; no href verification (URL is derived via `buildDetailUrl` upstream). 20s description wait budget (`DEDICATED_DESCRIPTION_WAIT_MS`).
- `normalize.ts` — Pure `normalizeText(input)` strips `<script>`/`<style>`/`<button>`, converts block tags to whitespace, drops `Show more` / `See more` / `View more` literals, decodes common entities, collapses whitespace. `isValidRequiredField(value)` delegates to it.
- `required-fields.ts` — `validateRequiredFields(fields)` iterates the stable `REQUIRED_FIELDS` list (`['title', 'company', 'location', 'description']`) via `isValidRequiredField`, returns `{ valid, missing }`.
- `status.ts` — `computeExtractionStatus(fields)` maps `validateRequiredFields` output to `'complete' | 'partial'`; `'failed'` is reserved for the orchestrator when both methods error.
- `detail-url.ts` — `buildDetailUrl(sourceJobId)` derives the canonical `https://www.linkedin.com/jobs/view/<id>/` URL from a ≥6-digit numeric ID; throws `DetailUrlBuildError` otherwise.
- `state.ts` — Typed vocabulary: `LINKEDIN_EXTRACTION_SCHEMA_VERSION = 1`, `ExtractionFieldSet`, `ExtractionMethod` (`'search_detail_panel' | 'dedicated_job_page'`), `ExtractionKind` (`'complete' | 'partial' | 'failed' | 'skipped' | 'cancelled'`), `ExtractionOutcome`, `ExtractionBatchOutcome`, `RequiredField`.
- `errors.ts` — `LinkedInExtractionError` (extends `LinkedInScraperError`, all `ExitCode.Fatal`) with subclasses `PanelExtractionError`, `PanelJobIdMismatchError`, `DedicatedPageError`, `RequiredFieldMissingError`, `DetailUrlBuildError`. Each pins a stable lower-snake-case `code`.
- `log.ts` — `LinkedInExtractionLogger` interface (7 events: `extractionStart`/`Complete`/`Skip`/`Fail`, `panelMismatch`, `fallbackStart`/`Close`), `noopLinkedInExtractionLogger` factory, `pinoLinkedInExtractionLogger` adapter (pino runtime lives here, not in domain code).
- `index.ts` — Public barrel re-exporting the surface consumed by the orchestrator wiring layer.

## Flow

```
extractOne({ job, searchPage, signal })
  ├─ skip if job.extractionStatus ∈ {'complete','partial'}  → kind: 'skipped'
  ├─ parsePanel(searchPage, { sourceJobId, signal })
  │    ├─ wait description visible (10s)
  │    ├─ verifyPanelHrefMatches  (3×500ms retry, throws PanelJobIdMismatchError)
  │    └─ Promise.all [title, company, location, description] → normalizeText
  ├─ on PanelExtractionError | PanelJobIdMismatchError:
  │    └─ fallback: buildDetailUrl → browserSession.openFallbackPage
  │       → navigateWithTimeout → dismissRecoverableOverlays
  │       → parseDedicatedPage(page, { signal }) → normalizeText
  │       (try/finally: browserSession.closeFallbackPage)
  ├─ computeExtractionStatus(fields) via validateRequiredFields → 'complete' | 'partial'
  │   (orchestrator surfaces 'failed' when both methods errored)
  └─ atomic db.transaction: insert extractionAttempts (one per attempted method,
     success flag on last only) + update jobs (status + 4 fields + successfulMethod
     when complete/partial) + update discoveryEvents (currentExtractionState,
     extractionAttempted=true)
extractBatch({ jobs, signal }) — sequential for...of; AbortSignal checked per
iteration; per-job failures surface as kind:'failed' and never abort the batch.
```

## Integration

- Direct consumer: `src/pipeline/orchestrator.ts` instantiates `LinkedInExtractionService` and calls `extractBatch` per search execution.
- Upstream context: `src/linkedin/discovery-service.ts` writes the initial `extractionStatus` / `extractionAttempted` columns that `extractOne` reads for skip-if-complete (`findLatestDiscoveryEventByJobAndSearch`).
- Browser seam: `BrowserSession` (`src/linkedin/browser-session.ts` / `playwright-session.ts`) for `openFallbackPage` / `closeFallbackPage`; `navigateWithTimeout` (`src/linkedin/navigation.ts`) and `dismissRecoverableOverlays` (`src/linkedin/overlay.ts`).
- Selectors: `LINKEDIN_FIELDS` + `LINKEDIN_SELECTORS.panel.titleAnchor` + `JOB_ID_HREF_PATTERN` from `src/linkedin/selectors.ts`.
- Persistence: writes to `jobs`, `discoveryEvents`, `extractionAttempts` via `Repositories.db.transaction` (`src/persistence/repositories/index.ts`).
- Downstream stages gate on `job.extractionStatus === 'complete'`: `src/filter/` (filter service) and `src/scoring/` (`scoring/service.ts`, `scoring/eligibility.ts`).
