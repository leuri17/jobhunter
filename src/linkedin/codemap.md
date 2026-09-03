# src/linkedin/

## Responsibility

LinkedIn automation layer: discover job cards on search-results pages, navigate with bounded
timeouts, paginate via "load-more", dismiss recoverable overlays, and persist the per-card
discovery events to the persistence layer. Owns browser-session lifecycle for one pipeline run
(real Playwright in production, fake in tests) and hands discovered cards off to the extraction
subfolder.

## Design

- **Adapter pattern** for browser control: `BrowserSession` interface in `browser-session.ts`
  defines `launch` / `close` (run-level) and `openPage` / `closePage` / `openFallbackPage` /
  `closeFallbackPage` / `withRoute` / `unrouteAll` (per-search). Three implementations:
  `PlaywrightBrowserSession` (sole runtime Playwright importer, enforced by
  `tests/linkedin/boundaries.test.ts`), `FakeBrowserSession` (pure-Node test helper, no
  Playwright import), and the real-Playwright route-interceptor in
  `tests/linkedin/helpers/playwright-route-session.ts`.
- **State machine** for the load-more loop (`load-more.ts`) returns a discriminated
  `LoadMoreOutcome`: `'complete' | 'exhausted' | 'no-progress' | 'cancelled'`. Card dedup uses
  first-seen-wins via `Map<id, DiscoveredCard>`; null-ID cards are preserved with a synthetic
  key so the orchestrator can write `discoveryErrors` rows.
- **Selectors** module (`selectors.ts`) is pure data — `LINKEDIN_SELECTORS` + versioned
  `LINKEDIN_SELECTORS_MAP_VERSION` + `JOB_ID_HREF_PATTERN` + `OVERLAY_DISMISSAL_STRATEGY`.
- **Pure card-ID parser** (`card-id.ts`) tries `data-occludable-job-id` then a href regex;
  never throws, returns `null` on miss. Adapter surface `MinimalElement` /
  `CardIdDocument` decouples from linkedom vs Playwright element handles.
- **Typed error vocabulary** in `errors.ts`: `LinkedInScraperError` base + subclasses
  (`LinkedInAccessBlockedError`, `LinkedInExpectedPageError`, `NavigationTimeoutError`,
  `OverlayUndismissableError`, `LoadMoreLoopExhaustedError`, `BrowserLaunchError`,
  `BrowserCapacityExceededError`) each pinning a specific `ExitCode` so the sidecar HTTP
  mapper needs no `instanceof` cascade.
- **Structured-log seam** (`log.ts`): `LinkedInScraperLogger` interface with
  `noopLinkedInScraperLogger` default + `pinoLinkedInScraperLogger` adapter; orchestrator
  never imports `pino` directly.
- **Factory** `createDefaultBrowserSession` (`browser-default.ts`) composes the real session
  at boot; tests inject `FakeBrowserSession` via constructor.

## Flow

`LinkedInDiscoveryService.discover(input)` walks the per-search sequence:

1. `repositories.pipelineRuns.updateSearchStatus(id, { finalStatus: 'running' })`.
2. `browserSession.openPage(generatedUrl)` (mapped to `LinkedInExpectedPageError` on failure).
3. `navigateWithTimeout({ page, url, timeoutMs })` → discriminated `NavigationResult`; auth-wall
   / login / checkpoint URLs convert to `LinkedInAccessBlockedError`, `TimeoutError` to
   `NavigationTimeoutError`, others to `LinkedInExpectedPageError`.
4. `dismissRecoverableOverlays(page, { overlayDismissalMs })` → undismissed set → throws
   `OverlayUndismissableError` on first undismissable overlay.
5. `loadMoreResults(page, opts)` (alias for `discoverAllCards`) — bounded iterations,
   `maxNoProgressAttempts`, `AbortSignal` check, returns `{ cards, outcome }`.
6. Per-card dedup: `jobs.findBySourceJobId` → existing → `recordDiscoveryEvent`; new →
   `recordNewJob` (atomic jobs + event insert, `extractionStatus: 'failed'` placeholder later
   promoted by `Repositories.jobs.updateExtraction`); null-ID → `recordDiscoveryError` with
   truncated metadata.
7. `updateSearchStatus(id, { finalStatus: 'completed' | 'cancelled', ... })`.
8. `browserSession.closePage(page)` in `try/finally` (orchestrator owns per-search page
   lifecycle; session owns run-level `launch` / `close`).
9. On typed `LinkedInScraperError`: `diagnosticManager.recordScraperError` (BEFORE
   `closePage` so screenshot captures live state) → re-thrown for the orchestrator boundary.

`BrowserSession` enforces single-active-fallback invariant via `BrowserCapacityExceededError`,
tracked in `state.ts: BrowserCapacity`.

## Integration

- **Consumers**: `src/pipeline/orchestrator.ts` (imports `LinkedInDiscoveryService`, owns the
  run-level `launch` / `close` loop and per-search `discover()` call).
- **Hand-off**: `LinkedInExtractionService` (`src/linkedin/extraction/service.ts`) consumes the
  jobs the discovery layer inserts and uses the same `BrowserSession` for dedicated-page
  fallback extraction. Shared selectors via `LINKEDIN_SELECTORS.panel.*` and `LINKEDIN_FIELDS`.
- **Test seam**: `FakeBrowserSession` + `FakePage` + `createFakePage` factory, used directly
  in `tests/linkedin/` (boundary, load-more, overlay, navigation suites). The
  `routes` / `events` log + `activePageCount` getters let tests assert session contract
  compliance without launching Chromium.
- **Cross-cutting**: `DiagnosticManager` (`src/diagnostics/manager.ts`) captures
  screenshots/traces on failure; `Repositories` (`src/persistence/repositories/`) owns the
  `searchExecutions` / `jobs` / `discoveryEvents` / `discoveryErrors` writes; `Redactor`
  (`src/diagnostics/redactor.ts`) is applied by `truncateAvailableMetadata` before the 2 KiB
  cap.
