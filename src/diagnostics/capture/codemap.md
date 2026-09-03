# src/diagnostics/capture/

## Responsibility
Diagnostic artifact collectors. Captures five artifacts on scraper failure:
current URL, HTML snapshot, Playwright trace, screenshot, and stack trace.
Each collector runs in isolation and returns a self-describing
`CaptureResult` (artifactType, extension, mimeType, contents) for the
diagnostics manager to persist to disk.

## Design
Strategy pattern over a uniform `CaptureStrategy` interface. Each strategy
is a stateless class implementing
`capture(context: CaptureContext): Promise<CaptureResult>`. `types.ts`
centralizes the shared `CaptureContext`, `CaptureResult`,
`CaptureStrategy`, and `CaptureArtifactType` shapes; `index.ts` re-exports
them plus all concrete classes. The non-Playwright strategies
(`StackTraceCapture`, `CurrentUrlCapture`) read solely from the context.
The Playwright-backed strategies (`ScreenshotCapture`,
`HtmlSnapshotCapture`, `LinkedInPlaywrightTraceCapture`) read `page` or
`browserContext` and throw `MissingBrowserImplementationError` when those
fields are absent, letting the manager record a typed `capture_failed`
failure rather than crashing the orchestrator. `PlaywrightTraceCapture`
is a backward-compatible re-export alias for
`LinkedInPlaywrightTraceCapture`.

## Flow
`DiagnosticManager.recordScraperError` builds a `CaptureContext` (scope,
timestamp, error, currentUrl, optional `Page`, optional `BrowserContext`)
and fans it out to each enabled strategy. Per artifact:
- `StackTraceCapture.capture` — serializes `context.error.stack` (or
  name/message fallback) to `text/plain` `.txt`.
- `CurrentUrlCapture.capture` — writes `context.currentUrl` to
  `text/plain` `.txt` (or `no url captured`).
- `ScreenshotCapture.capture` — `page.screenshot({ fullPage: true })`,
  normalized to `Buffer`, returned as `image/png` `.png`.
- `HtmlSnapshotCapture.capture` — `page.content()` (includes DOCTYPE +
  meta charset) returned as `text/html; charset=utf-8` `.html`.
- `LinkedInPlaywrightTraceCapture.capture` — `browserContext.tracing.stop`
  to a temp zip, read back as `Buffer`, returned as `application/zip`
  `.zip`; the temp file is unlinked in a `finally` block.

The bundle of `CaptureResult`s is returned to the manager, which persists
each artifact and inserts a `diagnosticArtifacts` row.

## Integration
Consumed by `src/diagnostics/manager.ts` (`DiagnosticManager`); the
`CaptureContext` is constructed from `DiagnosticInput` so the manager
remains the single point of context construction. Uses Playwright APIs
(`Page.screenshot`, `Page.content`, `BrowserContext.tracing`) sourced
from `src/linkedin/playwright-session.ts`. Errors are normalized through
`src/diagnostics/errors.ts` (`MissingBrowserImplementationError`); the
trace strategy also surfaces a typed `tracing_not_started` failure when
`tracing.stop` is called without a prior `tracing.start`.
