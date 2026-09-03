# src/diagnostics/

## Responsibility

Diagnostics subsystem: capture, redact, persist, and retrieve diagnostic
bundles for failed pipeline runs. Translates scraper errors into
filesystem artifacts (HTML snapshots, screenshots, stack traces, current
URLs, Playwright traces) and indexed repository rows that operators and
the desktop sidecar can browse after the fact.

## Design

- **Manager abstraction** — `DiagnosticManager` (in `manager.ts`) is the
  single entry point. It owns the capture strategy registry, the
  `Redactor`, filesystem paths, and the `repositories.diagnostics`
  handle. Per-artifact work is delegated to a `CaptureStrategy`
  (`CurrentUrlCapture`, `StackTraceCapture`, `ScreenshotCapture`,
  `PlaywrightTraceCapture`, `HtmlSnapshotCapture`) selected from
  `./capture/index.js` by `CaptureArtifactType` discriminator
  (`screenshot | current_url | stack_trace | playwright_trace |
  html_snapshot`).
- **Default factory** — `createDefaultDiagnosticManager` in
  `manager-default.ts` wires the manager from `PlatformPaths` and
  `Repositories`; tests inject a custom manager via orchestrator
  constructor injection.
- **PII redaction** — `Redactor` runs an ordered list of
  `RedactionPattern`s (bearer tokens, query-string secrets,
  key/value pairs, LinkedIn/JSESSIONID cookies, emails, `Set-Cookie`
  headers, OpenAI keys) via `redactString`. `redactValue` walks
  arbitrary objects, replacing values under `SENSITIVE_KEYS`
  (`api_key`, `password`, `authorization`, `cookie`, ...) and
  short-circuiting cycles with a `WeakSet`. Custom patterns are
  appendable through `RedactorOptions.extraPatterns`.
- **Deterministic filenames** — `filename.ts` produces
  collision-resistant, scope-tagged paths: `sanitizeFilenameComponent`
  lowercases and ASCII-filters names; `resolveScopeDirectory` builds a
  nested directory from the `DiagnosticScope` ids
  (`run-{id}/search-{id}/job-{id}/...`); `buildSafeFilename` joins
  artifact type, scope ids, ISO timestamp (colons/dots escaped), and
  extension. Throws `DiagnosticError` on empty inputs.
- **Error types** — `DiagnosticError` (extends `ApplicationError`, fatal
  exit code) and its subclass `MissingBrowserImplementationError`,
  raised when a Playwright-backed strategy is invoked without the
  required `Page`/`BrowserContext` handles.

## Flow

`DiagnosticManager.recordScraperError(input)` is the main path:

1. Resolve timestamp, build per-artifact `flags` map from config.
2. Redact `input.currentUrl` and the stringified error description via
   `Redactor.redactString`.
3. For each enabled `CaptureArtifactType`:
   - Look up the registered `CaptureStrategy`; if missing, push a
     `strategy_missing` failure and call `recordFailure`.
   - Otherwise build a `CaptureContext` (scope, timestamp, error,
     redacted URL, optional `page`/`browserContext`) and call
     `strategy.capture(ctx)`.
   - `persist` writes the result to `paths.diagnostics.directory` under
     `buildSafeFilename(...)`'s relative path, redacting any
     `text/*` payload, and inserts a `diagnostics` row.
   - On throw, push a `capture_failed` `DiagnosticFailure`, emit via
     `onError`, and call `recordFailure` to log a `*.txt` placeholder
     plus a `log_file` repository row.
4. Return `{ artifactIds, failures }` for the caller (orchestrator) to
   correlate with the originating run.

`close()` is reserved for future Playwright-backed lifecycle cleanup and
is currently a no-op.

## Integration

- **Consumers** — invoked by `src/pipeline/orchestrator.ts` on scraper
  errors; the orchestrator passes the live Playwright `Page` and
  `BrowserContext` so `ScreenshotCapture`, `PlaywrightTraceCapture`,
  and `HtmlSnapshotCapture` can sample the failing session.
- **Artifact collection** — `src/diagnostics/capture/` (via
  `./capture/index.js`) supplies the `CaptureStrategy` implementations
  used by the manager.
- **Persistence** — every bundle produces a row in the `diagnostics`
  table via `repositories.diagnostics.insert` in
  `src/persistence/repositories/diagnostics.ts`; binary payloads are
  written under `PlatformPaths.diagnostics.directory`.
- **Wiring** — `createDefaultDiagnosticManager` is composed at boot by
  the desktop sidecar; tests bypass it with constructor injection.
