# TASK-013 Implementation Plan — Job-Detail Extraction, Embedded Panel Fallback, and Persistence

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implement public, unauthenticated LinkedIn job-detail extraction (SPEC §22.1–22.12) + per-job persistence (SPEC §23.2–23.3) + per-attempt diagnostics (SPEC §39.1) + reliability (SPEC §40). TASK-013 consumes the `failed` placeholders written by `LinkedInDiscoveryService` (TASK-012, `src/linkedin/discovery-service.ts:235`), processes the queued jobs through a panel-first, dedicated-page-fallback extraction flow, and promotes each job to `complete` / `partial` via the new `Repositories.jobs.updateDiscoveryEvent` method. The module lives at `src/linkedin/extraction/` (sibling of TASK-012's flat `src/linkedin/`), surfaces `LinkedInExtractionService.extractOne()` + `extractBatch()`, and is **CLI-free** — TASK-015's pipeline orchestrator calls these. The `HtmlSnapshotCapture` stub at `src/diagnostics/capture/html-snapshot.ts:1-15` is replaced in place with a real `Page.content()`-backed implementation. No new schema, no new migration, no new CLI subcommand, no new `playwright` dependency (already a direct dep from TASK-012). Cancellation is `AbortSignal`-based; per-job failure isolation is guaranteed by `try/finally` + per-card error capture.

**Architecture:** A new `src/linkedin/extraction/` subdirectory houses the extraction layer. The pure helpers (`src/linkedin/extraction/normalize.ts`, `src/linkedin/extraction/required-fields.ts`, `src/linkedin/extraction/status.ts`, `src/linkedin/extraction/detail-url.ts`) have no Playwright / no Drizzle / no Pino / no Commander / no Inquirer / no OpenAI imports — they are pure functions of their inputs (the same pattern as `src/init/classify.ts` + `src/filter/evaluate.ts`). The browser layer (`src/linkedin/extraction/panel-parser.ts`, `src/linkedin/extraction/dedicated-parser.ts`) imports Playwright TYPES only and uses `page.locator(selector).textContent()` for per-field reads (auto-waiting) plus `page.evaluate()` for bulk normalization. The orchestrator (`src/linkedin/extraction/service.ts` → `LinkedInExtractionService`) composes: `Repositories.jobs.findBySourceJobId` (`src/persistence/repositories/jobs.ts:243`), `Repositories.jobs.updateExtraction` (`jobs.ts:255`), the new `Repositories.jobs.updateDiscoveryEvent` (Wave D, no schema change), `Repositories.jobs.recordExtractionAttempt` (`jobs.ts:347`), `BrowserSession.openFallbackPage` / `closeFallbackPage` (`src/linkedin/browser-session.ts:47-48` — forward-compat added in TASK-012), the existing `navigateWithTimeout` (`src/linkedin/navigation.ts`) + `dismissRecoverableOverlays` (`src/linkedin/overlay.ts`), `DiagnosticManager.recordScraperError` (`src/diagnostics/manager.ts:109`) with `scope.jobId` + `scope.extractionAttemptId` already supported (`src/diagnostics/filename.ts:3-9`), `OperationalConfigSchema.scraper.timeouts.{detailPanelMs, dedicatedPageMs}` (`src/config/schema.ts:49-64`), and the new `LinkedInExtractionError` family (extends `LinkedInScraperError` from TASK-012, all exit 1). The replacement `HtmlSnapshotCapture` at `src/diagnostics/capture/html-snapshot.ts:1-15` uses `await page.content()` (per Decision 13 refined) and throws `MissingBrowserImplementationError` on failure. The `LINKEDIN_SELECTORS` map (`src/linkedin/selectors.ts`) gains a `panel.*` + `dedicated.*` group (Decision 25) and `LINKEDIN_SELECTORS_MAP_VERSION` is bumped to `2`. **No new schema, no new migration, no new CLI subcommand.** Cancellation is `AbortSignal`-based; per-job failure isolation is guaranteed by `try/finally` + per-card error capture (extracted to `extractionAttempts` with `success: false` + the existing `discoveryEvents` row updated in the same `db.transaction`).

**Tech Stack:** NO new direct dependencies. Reuses everything TASK-012 already wired: `playwright` (sole runtime importer remains `src/linkedin/playwright-session.ts`), `linkedom` (dev dep, fixture parsing in unit tests), `zod`, `drizzle-orm`, `better-sqlite3`, `pino` (via the `Logger` facade at `src/logging/logger.ts`), `vitest`. The boundaries test extends the existing `tests/linkedin/boundaries.test.ts` to count the new `extraction/` files and adds a sibling `tests/extraction/boundaries.test.ts` that mirrors the pattern.

## Open decisions confirmed before implementation

These map to the 26 pinned decisions (1–24 + 25–26 added by librarian) in `.slim/deepwork/task-013-job-detail-extraction-persistence.md` and to the SPEC §22 + §23 + §29 + §38 + §39 + §40 + §41.1–41.3 references. The implementing agent must stop and ask the user to confirm all 26 resolutions — **plus the `HtmlSnapshotCapture` in-place replacement** and the **one new repository method `updateDiscoveryEvent`** (no schema change) — before any file in `src/linkedin/extraction/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Module location | New `src/linkedin/extraction/` subdirectory (sibling of TASK-012's flat `src/linkedin/`). Layout: `index.ts`, `state.ts`, `errors.ts`, `normalize.ts`, `required-fields.ts`, `status.ts`, `detail-url.ts`, `panel-parser.ts`, `dedicated-parser.ts`, `service.ts`, `log.ts`. **No new subdirectory under `src/diagnostics/capture/`** — the only capture strategy TASK-013 touches is `src/diagnostics/capture/html-snapshot.ts` (in-place replacement). | §22, §22.1, AGENTS.md §5 |
| 2 | Pure parsers | `panel-parser.ts` + `dedicated-parser.ts` accept a Playwright `Page` + a `FIELDS` selector map (Decision 25). Unit tests use `linkedom` (`parseHTML(html)` from `linkedom/extended` — already a dev dep from TASK-012) to parse saved fixture HTML. The two-layer split (production takes `Page`, unit tests take HTML string) mirrors `src/linkedin/card-id.ts`. | §41.1, §41.3 |
| 3 | Per-job flow | `LinkedInExtractionService.extractOne({ job, run, searchExecution, searchPage, signal }) → Promise<ExtractionOutcome>`. Reads existing `JobRow` via `findBySourceJobId`; if `extractionStatus === 'complete' \| 'partial'`, returns immediately with `outcome.kind = 'skipped'`. Otherwise: panel select + bounded wait for description (`state: 'visible'`, timeout `detailPanelMs`); verify panel title anchor's `href` matches the selected `sourceJobId` (Decision 7 refined); on panel failure or `panelJobIdMismatch` (Decision 26), open a dedicated page via `BrowserSession.openFallbackPage` + extract via `dedicated-parser.ts`; compute status via `computeExtractionStatus`; atomic update (`updateExtraction` + `recordExtractionAttempt` + new `updateDiscoveryEvent`) inside `this.ctx.db.transaction(...)`; close fallback page in `try/finally`. | §22.6, §22.7, §22.9, §22.10, §40 |
| 4 | Status calculation | `computeExtractionStatus(fields: { title, company, location, description }) → 'complete' \| 'partial'`. Pure. `'failed'` is reserved for the no-`sourceJobId` case (TASK-012 writes a `discoveryErrors` row, NOT a `jobs` row) and is never computed by TASK-013 (every job passed to TASK-013 has a `sourceJobId`). | §22.8, §41.1 |
| 5 | Required-field validation | `validateRequiredFields(fields) → { valid: true } \| { valid: false; missing: RequiredField[] }`. Pure. Each text field is non-empty after `normalizeText()`. `RequiredField = 'title' \| 'company' \| 'location' \| 'description'`. `sourceJobId` is the entry-gate; if absent, the job is never passed to TASK-013. | §22.3, §22.4, §41.1 |
| 6 | Text normalization | `normalizeText(html: string) → string`. Pure. Removes presentation HTML via a single pass: strip `<script>` + `<style>` blocks, drop empty tags, trim, collapse whitespace, preserve paragraph + list boundaries. **Strips the `Show more` / `See more` literal** (Decision 6 addendum) — appears in the panel description as a `button.show-more-less-html__button--more` and the dedicated page's truncated text. Mirrors `OpenCLI job-detail.js`'s `clean` helper. | §22.5, §41.1 |
| 7 | Panel verification | After clicking the card, read the panel title element's anchor `href` (`.job-details-jobs-unified-top-card__job-title a`). Assert it ends with `/jobs/view/<selected sourceJobId>/`. Cross-check `page.url()` includes `currentJobId=<selectedId>` (LinkedIn updates the URL fragment on click). On mismatch, retry with a bounded poll loop (max 3 attempts, 500ms each) — if still mismatched, throw `PanelJobIdMismatchError` (Decision 26) → fall back to dedicated page. The panel root does NOT carry a `data-job-id` attribute (per librarian research). | §22.6, §22.7, §40 |
| 8 | Fallback URL | `buildDetailUrl(sourceJobId: string) → string` returns `https://www.linkedin.com/jobs/view/<id>/`. Pure. Throws `LinkedInExpectedPageError({ reason: 'invalid_source_job_id' })` for empty/non-numeric IDs. Reused by `LinkedInExtractionService` when opening the fallback page. | §22.2, §22.7 |
| 9 | Per-job persistence | `Repositories.jobs.updateExtraction(id, patch)` (existing — `jobs.ts:255`) for fields + status + `successfulMethod` + `lastExtractionAttemptTimestamp`. `Repositories.jobs.recordExtractionAttempt` (existing — `jobs.ts:347`) for each attempted method (panel + dedicated) regardless of success. The existing `discoveryEvents` row's `extractionAttempted` and `currentExtractionState` must be updated → **one new method** `Repositories.jobs.updateDiscoveryEvent(id, patch)` (no schema change) wraps the update in `this.ctx.db.transaction(...)` mirroring `recordNewJob` at `jobs.ts:170-241`. The three writes (`updateExtraction` + `recordExtractionAttempt` + `updateDiscoveryEvent`) are wrapped in a single sync `db.transaction((tx) => { ... })` to guarantee atomicity. | §23.2, §23.3, §40, AGENTS.md §6 |
| 10 | Skip behaviour | `complete` and `partial` jobs are skipped BEFORE opening any page. NO fallback page opened. `recordExtractionAttempt` NOT written (no attempt happened). The existing `discoveryEvents` row (written by TASK-012 at `discovery-service.ts:203-212` with `extractionAttempted: false, skipReason: 'complete_job_already_exists' \| 'partial_job_already_exists'`) is NOT modified. TASK-013 emits a new outcome `kind: 'skipped'` for the orchestrator. | §22.9, §22.10, §40 |
| 11 | Diagnostics integration | On per-job typed error, `diagnosticManager.recordScraperError` is called with `scope: { pipelineRunId, searchExecutionId, jobId, extractionAttemptId }`. `DiagnosticScope` already supports both `jobId` and `extractionAttemptId` (`src/diagnostics/filename.ts:3-9`). The `page` parameter is the live search page (or the dedicated fallback page if the failure happened during fallback extraction). Per the existing pattern in `discovery-service.ts:344-353`. | §39 |
| 12 | Cancellation seam | `AbortSignal` propagated from orchestrator (TASK-015) to `extractOne`. The dedicated page's `navigateWithTimeout` is bounded by `dedicatedPageMs` (20s); the signal is checked between field extraction and DB writes. If aborted mid-job, finalize the current job with `lastExtractionAttemptTimestamp` set + `extractionStatus` unchanged (it stays at the existing value) + emit `outcome.kind = 'cancelled'`, then close the dedicated page in `try/finally` and return. **No retry.** | §29.3, §40, AGENTS.md §5 |
| 13 | HtmlSnapshotCapture replacement | Replace `src/diagnostics/capture/html-snapshot.ts:1-15` (stub throws `MissingBrowserImplementationError`) in place. Real implementation: `HtmlSnapshotCapture.capture(context) → CaptureResult` returns `{ artifactType: 'html_snapshot', extension: 'html', mimeType: 'text/html', contents: await context.page.content() }` (per Decision 13 refined — `page.content()` includes `<!DOCTYPE>` + `<meta charset>`, NOT `document.documentElement.outerHTML`). Wrap in `try/catch`; on failure, throw `MissingBrowserImplementationError('html_snapshot_failed', ..., cause)`. The new class is the SAME `HtmlSnapshotCapture` symbol already exported from `src/diagnostics/capture/index.ts` (no barrel change). Mirror the `LinkedInPlaywrightTraceCapture` pattern at `src/diagnostics/capture/playwright-trace.ts`. | §39.1, AGENTS.md §12 |
| 14 | HtmlSnapshotCapture redactor | HTML is written **un-redacted** (Decision 14). `Redactor.redactString()` would corrupt the markup (URL/email patterns are too aggressive on HTML attributes + inline styles). Documented exception. The page content is already redacted-by-omission: it does NOT contain cookies, session tokens, or `localStorage` (anonymous context, no logged-in user). User confirmation required (precondition). | §39.1, §40 |
| 15 | Per-attempt error codes | Stable strings used in test fixtures + persisted in `extractionAttempts.errorCode` + surfaced in `SearchExtractionOutcome`: `panel_load_timeout`, `panel_mismatch` (per Decision 26), `panel_parse_failed`, `panel_missing_field`, `panel_undismissable_overlay`, `dedicated_load_timeout`, `dedicated_parse_failed`, `dedicated_missing_field`, `dedicated_undismissable_overlay`, `unknown_failure`. All lower_snake_case. | §22.7, §22.8, §40, §41.1 |
| 16 | Typed errors | `LinkedInExtractionError` base (extends `LinkedInScraperError`, exit `ExitCode.Fatal = 1`). Subclasses: `PanelExtractionError` (panel load/parse/timeout failure), `PanelJobIdMismatchError` (Decision 26 — title anchor href does not match selected `sourceJobId`), `DedicatedPageError` (fallback page load/parse/timeout failure), `RequiredFieldMissingError` (every field missing — distinct from `partial` where some fields exist), `DetailUrlBuildError` (invalid `sourceJobId`). Per-job errors are NOT thrown across the `extractOne` boundary — they are SURFACED via `ExtractionOutcome.kind: 'failed'` and persisted to `extractionAttempts` with `success: false` + the existing `discoveryEvents` row updated + an `updateExtraction` patch (so the orchestrator never throws for a per-job failure). The orchestrator catches `LinkedInScraperError` only for hard-stop conditions (e.g. browser launch failure). | §22.7, §22.8, §22.12, AGENTS.md §10 |
| 17 | `LinkedInExtractionService` | Public API: `extractOne({ job, run, searchExecution, searchPage, signal, onProgress? }) → Promise<ExtractionOutcome>`. `extractBatch({ run, searchExecution, jobs, searchPage, signal }) → Promise<ExtractionBatchOutcome>` iterates the batch and aggregates per-job outcomes. Returns `{ schemaVersion, jobId, kind: 'complete' \| 'partial' \| 'failed' \| 'skipped' \| 'cancelled', fields, attemptedMethods, errorCode, artifactIds }`. The orchestrator (TASK-015) calls `extractBatch` once per search execution. The service NEVER calls `browserSession.launch()` or `browserSession.close()` — TASK-015 owns run-level lifecycle (mirrors TASK-012's `LinkedInDiscoveryService`). | §22, §22.6, §22.7, AGENTS.md §5 |
| 18 | Fixture harness | New `tests/extraction/fixtures/` directory with 6 HTML fixtures: `panel-complete.html` (all 5 required fields present, no `Show more` literal), `panel-partial.html` (only `title` + `company` + truncated `description`), `panel-mismatch.html` (panel title anchor's href points to a different `sourceJobId`), `panel-parse-failure.html` (DOM structure unparseable — missing description container), `dedicated-complete.html` (all 5 required fields), `dedicated-partial.html` (only `title` + `company`). Reuses `loadFixture` helper from `tests/linkedin/fixtures/loadFixture.ts` (Task 12). New helper `tests/extraction/fixtures/loadFixture.ts` re-exports the shared helper. | §41.1, §41.3 |
| 19 | Integration test seam | New `tests/extraction/helpers/playwright-route-session.ts` extends the existing `PlaywrightRouteSession` (TASK-012) to route BOTH the search URL AND the dedicated page URL (`https://www.linkedin.com/jobs/view/<id>/`) to fixture HTML. New `tests/extraction/helpers/fake-session.ts` for pure-Node tests (no real Chromium). | §41.2, §41.3 |
| 20 | No new schema/migration | All tables used (`jobs`, `discoveryEvents`, `extractionAttempts`, `diagnosticArtifacts`) already exist (`src/persistence/schema.ts:275, 304, 357, 501`). The plan MUST NOT add DDL. The plan MUST add ONE new repository method (`updateDiscoveryEvent`) — this is a method, not a migration. | §23, AGENTS.md §12 |
| 21 | Live tests | TASK-013 extends `tests/live/linkedin.test.ts` (already created in TASK-012) with one new `it`: navigate to a public LinkedIn job-detail page (`https://www.linkedin.com/jobs/view/<id>/` of a real job), assert all 5 required fields are extracted, assert `extractionStatus === 'complete'`. Continue to be `LINKEDIN_LIVE=1` gated via `describe.skipIf(!ENABLED)`. | §41.3 |
| 22 | Boundaries guard | New `tests/extraction/boundaries.test.ts` (mirror `tests/linkedin/boundaries.test.ts`): enumerates `src/linkedin/extraction/*.ts`, bans runtime imports of `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`; ALLOWS `playwright` for type-only imports in `src/linkedin/extraction/{panel-parser,dedicated-parser,service}.ts` (mirrors the 6-entry allow-list pattern). Bans `process.exit(...)`. Updates the `src/linkedin/` boundaries test to count the new `extraction/` files (mirror the "exists as a directory with at least N modules" assertion in `tests/linkedin/boundaries.test.ts:137-143`). | §5, §9, AGENTS.md §5 |
| 23 | Logging | `LinkedInExtractionLogger` interface (`src/linkedin/extraction/log.ts`) with methods: `extractionStart({ jobId, sourceJobId })`, `extractionComplete({ jobId, kind })`, `extractionSkip({ jobId, reason })`, `extractionFail({ jobId, errorCode, method })`, `panelMismatch({ jobId, expected, actual })`, `fallbackStart({ jobId })`, `fallbackClose({ jobId })`. Domain uses the `Logger` facade from `src/logging/logger.ts`; pino adapter stays at the boundary (mirrors TASK-012's `noopLinkedInScraperLogger` + `pinoLinkedInScraperLogger` at `src/linkedin/log.ts`). | §29, AGENTS.md §5, §10 |
| 24 | No CLI command | TASK-013 has no top-level CLI subcommand. `LinkedInExtractionService` is invoked by TASK-015's pipeline orchestrator. Thin CLI integration is NOT part of this task (matches "thin CLI handlers, no service is wired without an orchestrator" precedent — `src/init/cli-adapters.ts:1-50`). | §5, §10, AGENTS.md |
| 25 | `FIELDS` selector map sharing | Panel + dedicated parsers share a single `FIELDS: Readonly<Record<'title' \| 'company' \| 'location' \| 'description', string>>` map. The dedicated page reuses the unified top-card DOM (per librarian research), so the selectors are IDENTICAL. The parser modules are thin wrappers that take a `Page` and the map; this reduces code duplication. Bump `LINKEDIN_SELECTORS_MAP_VERSION` to `2` when adding the new `panel.*` and `dedicated.*` groups. | §41.1, §41.3 |
| 26 | `panelJobIdMismatch` typed error | New `PanelJobIdMismatchError` extending `LinkedInExtractionError` (Decision 16), with `metadata: { expectedSourceJobId, actualSourceJobId, attempts }`. Thrown when the panel title anchor's `href` does NOT match the selected `sourceJobId` after the bounded retry loop. Maps to dedicated-page fallback (per SPEC §22.7 — "The panel shows another job" is one of the fallback conditions). | §22.6, §22.7, §40 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0` (`package.json:7, 9`). No new LLM provider, job source, UI framework, hosted service, authentication system, or direct dependency. Reuses `playwright` (TASK-012 dep), `linkedom` (TASK-012 dev dep), `zod`, `drizzle-orm`, `better-sqlite3`, `pino` (via the `Logger` facade), `vitest`.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"` (`tsconfig.json:3-4`). Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables` (`tsconfig.json:6-8`). No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach` (AGENTS.md §4).
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/linkedin/extraction/` — except the Playwright-bound modules on the explicit allow-list (Decision 22) — **must not** import Commander, Inquirer, Drizzle directly, the `openai` SDK, or Pino directly. The `LinkedInExtractionLogger` interface is the seam; `src/linkedin/extraction/service.ts` takes the logger via constructor injection. `src/linkedin/extraction/{normalize,required-fields,status,detail-url}.ts` are pure (no Playwright / Drizzle / Pino).
- **Browser / Inquirer isolation:** The `BrowserSession` interface (`src/linkedin/browser-session.ts`) is the seam. `PlaywrightBrowserSession` is the only Playwright-importing real implementation. The CLI never imports `@inquirer/prompts` from `extraction` (there is no CLI surface in this task).
- **Validation:** Zod at every external boundary. `OperationalConfigSchema` is the canonical config validator (TASK-002). Persisted row JSON columns are revalidated via the repository methods directly. The `LINKEDIN_EXTRACTION_SCHEMA_VERSION` constant is the only new constant added by this task; it is `1`.
- **Errors:** Typed errors extending `ApplicationError`. The `LinkedInExtractionError` family lives in `src/linkedin/extraction/errors.ts` and extends `LinkedInScraperError` (TASK-012, `src/linkedin/errors.ts:15`). Exit-code mapping follows Decision 16 + Decision 24. The orchestrator throws typed errors for unrecoverable per-search conditions (`LinkedInAccessBlockedError` from TASK-012 only); per-job errors are surfaced as `ExtractionOutcome.kind: 'failed'` and written to `extractionAttempts` + the existing `discoveryEvents` row updated.
- **History preservation (AGENTS.md §6):** Extraction never deletes, resets, or supersedes historical jobs, discovery events, or extraction attempts. The `updateExtraction` call is a NO-OP for `extractionStatus: 'complete'` (defensive check in the repository method — Decision 10). The `updateDiscoveryEvent` method updates ONLY the specified row; no cascade delete.
- **Determinism:** The pure helpers (`normalize.ts`, `required-fields.ts`, `status.ts`, `detail-url.ts`) are pure functions of their inputs. The `FakeBrowserSession` makes HTTP-shape fidelity tests deterministic by serving saved HTML from `tests/extraction/fixtures/*.html`.
- **Tests:** Vitest. Pure-parser tests use `linkedom` + saved HTML fixtures. Browser-session integration tests use Vitest + Playwright + `context.route()` interception against the same fixtures. DB-integration tests use `mkdtempSync` + `createDatabaseConnection` + `runMigrations` + `createRepositories` (`tests/init/init-service.test.ts:176-185`). The `FakeBrowserSession` replaces live Chromium in unit/integration tests. Live tests are guarded by `process.env['LINKEDIN_LIVE']` and run via `pnpm test:live`. No live OpenAI.
- **JSON output discipline (AGENTS.md §10):** TASK-013 has no CLI subcommand and no JSON output contract; `ExtractionOutcome` is the in-process typed result. TASK-015 will own the run-level JSON output.
- **No secrets:** The orchestrator never logs `OPENAI_API_KEY`, prompt transcripts, raw OpenAI responses, LinkedIn session cookies (anonymous context — none exist), or raw panel/dedicated HTML beyond the redacted snapshot already produced by `DiagnosticManager.recordScraperError` (`diagnostics/manager.ts:115-118`). The new `HtmlSnapshotCapture` writes HTML un-redacted (Decision 14 documented exception) but the HTML is already free of session tokens and cookies (anonymous context, page is the public job-detail page).

## Reconciler facts (from `.slim/deepwork/task-013-job-detail-extraction-persistence.md` + `@librarian` research)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and the `@librarian` research and are not re-litigated in this plan.

- **`PlaywrightBrowserSession` owns Playwright at runtime.** Only `src/linkedin/playwright-session.ts` imports `playwright` at runtime. The extraction layer (`src/linkedin/extraction/{panel-parser,dedicated-parser,service}.ts`) imports Playwright TYPES only; runtime values flow via the `BrowserSession` seam.
- **`HtmlSnapshotCapture` stub REPLACED in this task:** `src/diagnostics/capture/html-snapshot.ts:1-15` (currently throws `MissingBrowserImplementationError` at `capture/html-snapshot.ts:9-13`). TASK-013 replaces it with a real `Page.content()`-backed implementation.
- **OperationalConfigSchema is `.strict()`** (`src/config/schema.ts:96-106`). Reuse `diagnostics.onScraperError.htmlSnapshot` flag (already wired through `DiagnosticManager.recordScraperError` — `diagnostics/manager.ts:88-96`).
- **Per-job atomicity rule:** `updateExtraction` and `recordExtractionAttempt` are single writes with no internal transaction. The new `updateDiscoveryEvent` method MUST be sync (use `this.ctx.db.transaction((tx) => { ... })` mirroring `recordNewJob` at `jobs.ts:170-241`). Wrap the three per-job writes in a single sync `this.ctx.db.transaction(...)` at the service layer.
- **`Repositories.transact` callback MUST be sync.** `better-sqlite3` rejects Promise returns (`src/persistence/repositories/index.ts:54-58`).
- **`ExitCode.Fatal = 1`** (per-task failures) — `src/errors/application-error.ts:1-9`. Per-job errors do NOT cross the `extractOne` boundary; the orchestrator surfaces them as outcomes.
- **`tests/live/linkedin.test.ts` already exists** (TASK-012 Wave E placeholder). TASK-013 extends it with one new `it`, gated by `LINKEDIN_LIVE=1`.
- **`DiagnosticScope` already supports `jobId` and `extractionAttemptId`** (`src/diagnostics/filename.ts:3-9`). No extension needed.
- **No HTML fixtures exist for the panel or dedicated page.** Plan creates `tests/extraction/fixtures/*.html` (6 fixtures per Decision 18).
- **Boundaries test encodes the allow-list exactly** (`tests/linkedin/boundaries.test.ts:60-67`). The "allow-list contains exactly these entries" assertion is the runtime guard. The new `extraction/` files use TYPE-ONLY Playwright imports; the runtime Playwright importer count must remain 1 (`src/linkedin/playwright-session.ts`).
- **`ExtractionOutcome`** carries `schemaVersion`, `jobId`, `kind` (`'complete' | 'partial' | 'failed' | 'skipped' | 'cancelled'`), `fields`, `attemptedMethods`, `errorCode`, `artifactIds`. The `kind: 'skipped'` value is new (mirrors TASK-012's `'cancelled'`).
- **Browser lifecycle is TASK-015's, not TASK-013's.** SPEC §21.2 requires one browser context per run. TASK-015's orchestrator calls `browserSession.launch()` once at run start and `browserSession.close()` once at run end. TASK-013's `extractOne()` receives an already-launched `BrowserSession` and manages per-job dedicated-page lifecycle: `openFallbackPage(url)` → per-job body → `closeFallbackPage(page)` in `try/finally`. The outer `browserSession.close()` lives in TASK-015's run-level try/finally.
- **TASK-012's discovery service writes `extractionStatus: 'failed'` as a placeholder** for new jobs (`src/linkedin/discovery-service.ts:235`). TASK-013 reads these via `findBySourceJobId` and promotes via `updateExtraction`.
- **Panel + dedicated page selectors are IDENTICAL** (librarian research): both use the unified top-card BEM classes. The `FIELDS` selector map is shared between `panel-parser.ts` and `dedicated-parser.ts` (Decision 25).
- **Panel verification reads the title anchor's `href`** (NOT a hidden data attribute — the panel root does not carry `data-job-id` per librarian research). Cross-check: `page.url()` includes `currentJobId=<selectedId>`.
- **Wait condition is `state: 'visible'` on the description selector**, NOT on the wrapper (librarian research — `state: 'attached'` is too permissive, fires during the previous panel's transition).
- **HTML snapshot uses `page.content()`**, NOT `document.documentElement.outerHTML` (librarian research — `page.content()` includes `<!DOCTYPE>` + `<meta charset>`).
- **`linkedom` is adequate** for all panel + dedicated-page fixtures (librarian research — no coverage gaps for the BEM classes + `data-*` attributes).
- **Race conditions guarded by** (librarian research): (a) `panelJobIdMismatch` retry loop (bounded 3×500ms), (b) description-visible wait bounded by `detailPanelMs` (10s) / `dedicatedPageMs` (20s), (c) `navigateWithTimeout` `blocked` short-circuit, (d) `Show more` / `See more` literal stripping in `normalizeText`.
- **No JSON-LD** on LinkedIn's public job-detail page (verified 2026-08-20). Do NOT add a JSON-LD extraction path.

## File Structure

```text
src/linkedin/
  selectors.ts                          # MODIFIED: add panel.* + dedicated.* groups; bump LINKEDIN_SELECTORS_MAP_VERSION to 2 (Wave C)
src/linkedin/extraction/
  state.ts                              # NEW: ExtractionOutcome, ExtractionBatchOutcome, ExtractionFieldSet, RequiredField (Wave A)
  errors.ts                             # NEW: LinkedInExtractionError family + PanelJobIdMismatchError (Wave A)
  normalize.ts                          # NEW: normalizeText(html) → string — strips presentation HTML + "Show more" literal (Wave A)
  required-fields.ts                    # NEW: validateRequiredFields(fields) → { valid, missing } (Wave A)
  status.ts                             # NEW: computeExtractionStatus(fields) → 'complete' | 'partial' (Wave A)
  detail-url.ts                         # NEW: buildDetailUrl(sourceJobId) → string (Wave A)
  panel-parser.ts                       # NEW: parsePanel(page, fields) → ExtractionFieldSet — Playwright types only (Wave C)
  dedicated-parser.ts                   # NEW: parseDedicatedPage(page, fields) → ExtractionFieldSet — Playwright types only (Wave C)
  service.ts                            # NEW: LinkedInExtractionService.extractOne() + extractBatch() (Wave D)
  log.ts                                # NEW: LinkedInExtractionLogger interface + pino + noop adapters (Wave A)
  index.ts                              # NEW: public barrel (Wave E)
src/diagnostics/capture/
  html-snapshot.ts                      # REPLACED in place — uses page.content() (Wave B)
src/persistence/repositories/
  jobs.ts                               # MODIFIED: add updateDiscoveryEvent(id, patch) method (Wave D)
tests/linkedin/
  boundaries.test.ts                    # MODIFIED: bump file count to include extraction/ (Wave E)
tests/extraction/
  fixtures/
    panel-complete.html                 # NEW: all 5 fields present, no "Show more" literal (Wave C)
    panel-partial.html                  # NEW: only title + company + truncated description (Wave C)
    panel-mismatch.html                 # NEW: panel title anchor points to different sourceJobId (Wave C)
    panel-parse-failure.html            # NEW: missing description container (Wave C)
    dedicated-complete.html             # NEW: all 5 fields present (Wave C)
    dedicated-partial.html              # NEW: only title + company (Wave C)
    loadFixture.ts                      # NEW: re-exports tests/linkedin/fixtures/loadFixture.ts (Wave C)
  helpers/
    playwright-route-session.ts         # NEW: routes BOTH search URL + dedicated page URL (Wave E)
    fake-session.ts                     # NEW: pure-Node test helper for extraction (Wave E)
  state.test.ts                         # NEW: structural assertions on ExtractionOutcome (Wave A)
  errors.test.ts                        # NEW: each LinkedInExtractionError subclass's exitCode + code (Wave A)
  normalize.test.ts                     # NEW: linkedom-based unit tests (Wave A)
  required-fields.test.ts               # NEW: every missing/invalid field combination (Wave A)
  status.test.ts                        # NEW: every field combination → 'complete' | 'partial' (Wave A)
  detail-url.test.ts                    # NEW: buildDetailUrl + invalid ID throws (Wave A)
  panel-parser.test.ts                  # NEW: linkedom-based unit tests for parsePanel (Wave C)
  dedicated-parser.test.ts              # NEW: linkedom-based unit tests for parseDedicatedPage (Wave C)
  service.test.ts                       # NEW: full integration with FakeBrowserSession + real DB (Wave D)
  service-boundaries.test.ts            # NEW: extraction/ subdirectory boundaries guard (Wave E)
  log.test.ts                           # NEW: pinoLinkedInExtractionLogger structured-log shape (Wave A)
tests/live/
  linkedin.test.ts                      # MODIFIED: add 1 new `it` for dedicated-page live extraction (Wave E)
docs/tasks/
  TASK-013-job-detail-extraction-persistence.md  # MODIFIED: update "Implementation results" + status (Wave E)
docs/tasks/INDEX.md                     # MODIFIED: update TASK-013 row in the ordered table (Wave E)
README.md                               # MODIFIED: optional one-line note about extraction flow (Wave E; small)
```

Files change together by responsibility. The pure helpers (`src/linkedin/extraction/{normalize,required-fields,status,detail-url}.ts`) have no Drizzle, no Commander, no Inquirer, no OpenAI, no Pino imports, no Playwright imports. The parsers (`panel-parser.ts`, `dedicated-parser.ts`) import Playwright TYPES only. The orchestrator (`service.ts`) is the only layer that composes helpers + parsers + browser seam + repositories + diagnostic manager. The capture strategy (`src/diagnostics/capture/html-snapshot.ts`) is replaced in place — no new subdirectory.

### ASCII dependency diagram

```text
                            ┌────────────────────────────────────┐
                            │         TASK-015 (future)          │
                            │   Pipeline orchestrator + CLI      │
                            │   (`jobhunter run`)                │
                            └──────────────┬─────────────────────┘
                                           │ calls extractBatch() per search
                                           ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │        src/linkedin/extraction/index.ts (barrel)                 │
     └────┬───────────┬───────────┬───────────────┬──────────────────┬─┘
          │           │           │               │                  │
          ▼           ▼           ▼               ▼                  ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ ┌────────────────┐
    │service.ts│ │ state.ts │ │ errors.ts│ │ panel-parser + │ │ log.ts         │
    │(orchestr)│ │ (types)  │ │ (typed)  │ │ dedicated-     │ │ (Logger        │
    │          │ │          │ │          │ │ parser (types) │ │  facade)       │
    │          │ │          │ │          │ │ only)          │ │                │
    └────┬─────┘ └────┬─────┘ └──────────┘ └────────┬───────┘ └────────────────┘
         │            │                             │
         │            │                             ▼
         │            │                  ┌────────────────────┐
         │            │                  │ selectors.ts       │
         │            │                  │ (extended with     │
         │            │                  │ panel.* +          │
         │            │                  │ dedicated.*)       │
         │            │                  └────────────────────┘
         │            │
         │            │ composes (via existing barrels, no direct imports of
         │            │ Commander / Drizzle / Pino / OpenAI / Inquirer):
         ▼            ▼
     ┌────────────────────────────────────────────────────────────────────┐
     │   src/persistence/repositories/{jobs, pipelineRuns, diagnostics}  │
     │   src/linkedin/{browser-session, navigation, overlay, playwright-session} │
     │   src/diagnostics/{manager, redactor, filename, capture/{screenshot,playwright-trace,html-snapshot}} │
     │   src/config/{schema, loader}                                      │
     │   src/errors/application-error.ts                                  │
     │   src/logging/logger.ts (via LinkedInExtractionLogger adapter)     │
     └────────────────────────────────────────────────────────────────────┘
```

The arrows above are conceptual — `service.ts` imports repositories and the diagnostic manager through their existing barrels (`src/persistence/repositories/index.js`, `src/diagnostics/index.js`) and never reaches into their internals. The `LinkedInExtractionLogger` adapter (`src/linkedin/extraction/log.ts`) wraps a `Logger` from `src/logging/logger.ts`; the orchestrator itself never imports `pino`. The parsers import Playwright TYPES only (`Page`, `Locator`); runtime values flow via the `BrowserSession` seam. `BrowserSession` itself remains the only runtime Playwright importer (via `src/linkedin/playwright-session.ts`). The replaced `HtmlSnapshotCapture` at `src/diagnostics/capture/html-snapshot.ts` imports Playwright TYPES only; the runtime `Page` value flows via `CaptureContext.page` (extended in TASK-012 Wave C).

---

### Task 1 (Wave A): `state.ts` — `ExtractionOutcome`, `ExtractionFieldSet`, `RequiredField`

**Files:**
- Create: `src/linkedin/extraction/state.ts`
- Create: `tests/extraction/state.test.ts` (TypeScript-only structural assertion)

**Goal:** Establish the pure state vocabulary that drives every other module under `src/linkedin/extraction/`. `LINKEDIN_EXTRACTION_SCHEMA_VERSION = 1` is the only new constant. The orchestrator's per-job return shape (`ExtractionOutcome`) is consumed by TASK-015; the field set (`ExtractionFieldSet`) is the input to the status calculator + required-field validator.

**`state.ts` (sketch):**

```ts
/**
 * State vocabulary for TASK-013 — LinkedIn job-detail extraction
 * (SPEC §22.1–22.12). The shapes below are the typed contract
 * between `service.ts` and TASK-015's pipeline orchestrator.
 * Pure TypeScript types — no runtime values, no I/O.
 */
export const LINKEDIN_EXTRACTION_SCHEMA_VERSION = 1 as const;
export type LinkedinExtractionSchemaVersion = typeof LINKEDIN_EXTRACTION_SCHEMA_VERSION;

export type RequiredField = 'title' | 'company' | 'location' | 'description';

export interface ExtractionFieldSet {
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
}

export type ExtractionMethod = 'search_detail_panel' | 'dedicated_job_page';
export type ExtractionKind = 'complete' | 'partial' | 'failed' | 'skipped' | 'cancelled';

export interface ExtractionOutcome {
  readonly schemaVersion: LinkedinExtractionSchemaVersion;
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly kind: ExtractionKind;
  readonly fields: ExtractionFieldSet;
  readonly attemptedMethods: readonly ExtractionMethod[];
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly artifactIds: readonly number[];
}

export interface ExtractionBatchOutcome {
  readonly schemaVersion: LinkedinExtractionSchemaVersion;
  readonly runId: number;
  readonly searchExecutionId: number;
  readonly perJob: readonly ExtractionOutcome[];
  readonly totals: {
    readonly complete: number;
    readonly partial: number;
    readonly failed: number;
    readonly skipped: number;
    readonly cancelled: number;
  };
}
```

**`tests/extraction/state.test.ts`:** import the types; assert each shape's structural keys; assert `ExtractionKind` includes all 5 values; assert `LINKEDIN_EXTRACTION_SCHEMA_VERSION === 1`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/state.test.ts` passes.

---

### Task 2 (Wave A): `errors.ts` — `LinkedInExtractionError` family + `PanelJobIdMismatchError`

**Files:**
- Create: `src/linkedin/extraction/errors.ts`
- Create: `tests/extraction/errors.test.ts`

**Goal:** Define the typed error family that the extraction layer throws for hard-stop conditions (NOT per-job failures — those surface as `ExtractionOutcome.kind: 'failed'`). Every subclass extends `LinkedInScraperError` (TASK-012, `src/linkedin/errors.ts:15`) so the CLI boundary can map via the existing `exitWithError` (`src/cli.ts:139-142`).

**Subclasses (per Decision 16 + Decision 26):**
- `LinkedInExtractionError extends LinkedInScraperError` — base; exit 1.
- `PanelExtractionError extends LinkedInExtractionError` — code `panel_extraction_failed`; metadata `{ url, reason }`.
- `PanelJobIdMismatchError extends LinkedInExtractionError` (Decision 26) — code `panel_job_id_mismatch`; metadata `{ expectedSourceJobId, actualSourceJobId, attempts }`. Maps to dedicated-page fallback (SPEC §22.7).
- `DedicatedPageError extends LinkedInExtractionError` — code `dedicated_page_failed`; metadata `{ url, reason }`.
- `RequiredFieldMissingError extends LinkedInExtractionError` — code `required_field_missing`; metadata `{ missing: readonly RequiredField[] }`. Thrown only when EVERY field is missing (distinct from `partial` where some exist).
- `DetailUrlBuildError extends LinkedInExtractionError` — code `detail_url_build_failed`; metadata `{ sourceJobId }`. Thrown for empty/non-numeric IDs.

**Tests:** assert each subclass's `code`, `exitCode`, and `metadata` shape; assert `PanelJobIdMismatchError` carries the expected + actual IDs.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/errors.test.ts` passes.

---

### Task 3 (Wave A): `normalize.ts` — `normalizeText(html)` + `Show more` stripping

**Files:**
- Create: `src/linkedin/extraction/normalize.ts`
- Create: `tests/extraction/normalize.test.ts`

**Goal:** Pure text normalizer for the panel + dedicated-page description HTML. Strips presentation HTML, normalizes whitespace, preserves paragraph + list boundaries, and strips the `Show more` / `See more` literal (Decision 6 addendum, librarian race-condition #5).

**`normalize.ts` (sketch):**

```ts
import type { RequiredField } from './state.js';

/** Strip "Show more" / "See more" / "View more" CTA literals from the body. */
const SHOW_MORE_LITERAL_RE = /\b(show more|see more|view more)\b\.?/gi;

/** Block-level tags whose inner text should be preserved as a paragraph. */
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'UL', 'OL', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** Tags to drop entirely (their inner text is NOT meaningful job content). */
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON']);

export function normalizeText(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let text = input;
  // Drop script/style blocks first (their inner text is irrelevant).
  for (const tag of DROP_TAGS) {
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    text = text.replace(re, ' ');
  }
  // Convert block-level tags to a single space (preserves word boundaries).
  for (const tag of BLOCK_TAGS) {
    const openRe = new RegExp(`<${tag}[^>]*>`, 'gi');
    const closeRe = new RegExp(`<\\/${tag}>`, 'gi');
    text = text.replace(openRe, ' ').replace(closeRe, ' ');
  }
  // Drop all remaining tags.
  text = text.replace(/<[^>]+>/g, ' ');
  // Strip "Show more" / "See more" / "View more" CTA literals.
  text = text.replace(SHOW_MORE_LITERAL_RE, '');
  // Decode common HTML entities (mirrors the `cheerio` `decodeEntities` behavior).
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse repeated whitespace (including newlines) to a single space.
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Validate that a normalized field is non-empty (SPEC §22.4 — every required
 * field must contain non-whitespace text after normalization).
 */
export function isValidRequiredField(value: string | null): boolean {
  return typeof value === 'string' && normalizeText(value).length > 0;
}
```

**Tests (linkedom-free; pure string manipulation):**
- `normalizeText('')` returns `''`.
- `normalizeText('<p>Hello</p>')` returns `'Hello'`.
- `normalizeText('<p>Hello</p><p>World</p>')` returns `'Hello World'`.
- `normalizeText('<script>alert(1)</script>Real content')` returns `'Real content'`.
- `normalizeText('<button>Show more</button>Content')` returns `'Content'`.
- `normalizeText('<p>About the job.</p><p>Responsibilities...</p>')` preserves paragraph boundaries (asserts the output contains a separator).
- `normalizeText('<li>One</li><li>Two</li>')` returns `'One Two'`.
- `normalizeText('&nbsp;Hello&nbsp;')` returns `'Hello'`.
- `isValidRequiredField(null)` returns `false`; `isValidRequiredField('  ')` returns `false`; `isValidRequiredField('Hello')` returns `true`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/normalize.test.ts` passes.

---

### Task 4 (Wave A): `required-fields.ts` + `status.ts` + `detail-url.ts`

**Files:**
- Create: `src/linkedin/extraction/required-fields.ts`
- Create: `src/linkedin/extraction/status.ts`
- Create: `src/linkedin/extraction/detail-url.ts`
- Create: `tests/extraction/required-fields.test.ts`
- Create: `tests/extraction/status.test.ts`
- Create: `tests/extraction/detail-url.test.ts`

**Goal:** Three small pure helpers used by `service.ts` (Wave D) to classify + build URLs.

**`required-fields.ts` (sketch):**

```ts
import type { RequiredField, ExtractionFieldSet } from './state.js';
import { isValidRequiredField } from './normalize.js';

export interface RequiredFieldsValidation {
  readonly valid: boolean;
  readonly missing: readonly RequiredField[];
}

export function validateRequiredFields(fields: ExtractionFieldSet): RequiredFieldsValidation {
  const required: readonly RequiredField[] = ['title', 'company', 'location', 'description'];
  const missing: RequiredField[] = [];
  for (const field of required) {
    if (!isValidRequiredField(fields[field])) missing.push(field);
  }
  return { valid: missing.length === 0, missing };
}
```

**`status.ts` (sketch):**

```ts
import type { ExtractionFieldSet, ExtractionKind } from './state.js';
import { validateRequiredFields } from './required-fields.js';

/**
 * Compute the extraction status (SPEC §22.8).
 *   - 'complete' → all 4 required fields are valid.
 *   - 'partial'  → sourceJobId is present (the entry-gate; never
 *                   computed by TASK-013) but one or more of the
 *                   4 other required fields are missing/invalid.
 * 'failed' is reserved for the no-sourceJobId case (TASK-012 owns
 * this — no `jobs` row is ever created).
 */
export function computeExtractionStatus(
  fields: ExtractionFieldSet,
): 'complete' | 'partial' {
  const validation = validateRequiredFields(fields);
  return validation.valid ? 'complete' : 'partial';
}
```

**`detail-url.ts` (sketch):**

```ts
import { LinkedInExpectedPageError } from '../../linkedin/errors.js';
import { DetailUrlBuildError } from './errors.js';

const SOURCE_JOB_ID_RE = /^\d{6,}$/;

/**
 * Build the canonical dedicated-page URL for a LinkedIn job
 * (SPEC §22.2). The URL is derived — never scraped.
 */
export function buildDetailUrl(sourceJobId: string): string {
  if (typeof sourceJobId !== 'string' || !SOURCE_JOB_ID_RE.test(sourceJobId)) {
    throw new DetailUrlBuildError({ sourceJobId });
  }
  return `https://www.linkedin.com/jobs/view/${sourceJobId}/`;
}
```

Wait — `detail-url.ts` should NOT import from `src/linkedin/errors.ts` (cross-module dependency, even if same family). Replace with a local error or re-import from a shared location. Recommendation: define `DetailUrlBuildError` in `errors.ts` (Task 2) and import it. Remove the `LinkedInExpectedPageError` import.

**Tests:**
- `required-fields.test.ts` — 16 cases (all combinations of 4 fields present/absent, asserting `valid` + `missing`).
- `status.test.ts` — 16 cases (all combinations of 4 fields present/absent, asserting `complete` | `partial`).
- `detail-url.test.ts` — `buildDetailUrl('123456')` returns the expected URL; `buildDetailUrl('')` throws; `buildDetailUrl('abc')` throws; `buildDetailUrl('12345')` (5 digits) throws.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/{required-fields,status,detail-url}.test.ts` passes.

---

### Task 5 (Wave A): `log.ts` — `LinkedInExtractionLogger` + pino + noop adapters

**Files:**
- Create: `src/linkedin/extraction/log.ts`
- Create: `tests/extraction/log.test.ts`

**Goal:** Logger facade for the extraction layer. Mirrors TASK-012's `LinkedInScraperLogger` (`src/linkedin/log.ts`) but for extraction events.

**`log.ts` (sketch):**

```ts
import type { ExtractionKind } from './state.js';
import type { Logger } from '../../logging/logger.js';

export interface LinkedInExtractionLogger {
  extractionStart(args: { jobId: number; sourceJobId: string }): void;
  extractionComplete(args: { jobId: number; kind: ExtractionKind }): void;
  extractionSkip(args: { jobId: number; reason: string }): void;
  extractionFail(args: { jobId: number; errorCode: string; method?: string }): void;
  panelMismatch(args: { jobId: number; expectedSourceJobId: string; actualSourceJobId: string }): void;
  fallbackStart(args: { jobId: number; url: string }): void;
  fallbackClose(args: { jobId: number }): void;
}

export function noopLinkedInExtractionLogger(): LinkedInExtractionLogger {
  return {
    extractionStart: () => {},
    extractionComplete: () => {},
    extractionSkip: () => {},
    extractionFail: () => {},
    panelMismatch: () => {},
    fallbackStart: () => {},
    fallbackClose: () => {},
  };
}

export function pinoLinkedInExtractionLogger(logger: Logger): LinkedInExtractionLogger {
  return {
    extractionStart: (a) => logger.info({ event: 'job.extraction.start', ...stringifyIds(a) }),
    extractionComplete: (a) => logger.info({ event: 'job.extraction.complete', ...stringifyIds(a) }),
    extractionSkip: (a) => logger.info({ event: 'job.extraction.skip', ...stringifyIds(a) }),
    extractionFail: (a) => logger.warn({ event: 'job.extraction.fail', ...stringifyIds(a) }),
    panelMismatch: (a) => logger.warn({ event: 'job.panel.mismatch', ...stringifyIds(a) }),
    fallbackStart: (a) => logger.info({ event: 'job.fallback.start', ...stringifyIds(a) }),
    fallbackClose: (a) => logger.info({ event: 'job.fallback.close', ...stringifyIds(a) }),
  };
}

function stringifyIds<T extends Record<string, unknown>>(args: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'number' ? String(v) : v;
  }
  return out;
}
```

**Tests:** assert each method emits the expected `event` + structured fields; assert `noopLinkedInExtractionLogger().extractionStart({...})` does not throw.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/log.test.ts` passes.

---

### Task 6 (Wave A): Update `tests/linkedin/boundaries.test.ts` to count extraction files

**Files:**
- Modify: `tests/linkedin/boundaries.test.ts:137-143` (the "exists as a directory with at least the 12 Wave D modules" assertion).

**Goal:** Update the boundaries guard to count the new `extraction/` files. The new minimum is `15` (12 prior + `state`, `errors`, `normalize`, `required-fields`, `status`, `detail-url` = 6 new; minus `index.ts` not yet created in Wave A → +5 = 17 in Wave E). Update the count assertion to be `>= 17` by Wave E.

**Wave A state:** `>= 12` (existing) + 5 new (`state`, `errors`, `normalize`, `required-fields`, `status`, `detail-url` — actually 6; let me recount: state, errors, normalize, required-fields, status, detail-url, log = 7 new in Wave A) = `>= 19` by end of Wave A. Update the assertion to `>= 19` in Wave A, then `>= 20` in Wave C (panel-parser, dedicated-parser), `>= 21` in Wave D (service), `>= 22` in Wave E (index).

Wait — counting: Wave A = state, errors, normalize, required-fields, status, detail-url, log = 7 files. Existing at end of TASK-012 = 14 (state, errors, selectors, card-id, overlay, load-more, log, browser-session, playwright-session, fake-session, fake-page, navigation, truncate-metadata, discovery-service, index) — actually 15. New extraction files = 7 in Wave A. Total = 22. Then Wave C adds 2 (panel-parser, dedicated-parser) = 24. Wave D adds 1 (service) = 25. Wave E adds 1 (index) = 26.

Update the assertion to `>= 26` by Wave E (final state). Use a `toBeGreaterThanOrEqual(26)` assertion.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/linkedin/boundaries.test.ts` passes.

---

### Task 7 (Wave B): `HtmlSnapshotCapture` in-place replacement — `await page.content()`

**Files:**
- Modify: `src/diagnostics/capture/html-snapshot.ts:1-15` (replace stub with real impl)
- Create: `tests/diagnostics/capture/html-snapshot.test.ts` (new test file)

**Goal:** Replace the `HtmlSnapshotCapture` stub (the LAST remaining capture-strategy stub from TASK-005) with a real `Page.content()`-backed implementation. Per Decision 13 refined + librarian research: use `await page.content()` (NOT `document.documentElement.outerHTML` — `page.content()` includes `<!DOCTYPE>` + `<meta charset>`).

**`html-snapshot.ts` (replace with):**

```ts
import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export class HtmlSnapshotCapture implements CaptureStrategy {
  readonly artifactType = 'html_snapshot' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    const page = context.page;
    if (page === undefined) {
      throw new MissingBrowserImplementationError(
        'browser_implementation_missing',
        'HtmlSnapshotCapture requires a Playwright page in the capture context.',
        { artifactType: this.artifactType },
      );
    }
    try {
      const html = await page.content();
      return {
        artifactType: this.artifactType,
        extension: 'html',
        mimeType: 'text/html; charset=utf-8',
        contents: html,
      };
    } catch (cause) {
      throw new MissingBrowserImplementationError(
        'html_snapshot_failed',
        'HtmlSnapshotCapture failed to read page content.',
        { artifactType: this.artifactType },
        cause instanceof Error ? cause : undefined,
      );
    }
  }
}
```

**`tests/diagnostics/capture/html-snapshot.test.ts`:** create a fake `CaptureContext` with a `page` mock that returns a known HTML string; assert the returned `CaptureResult` has `artifactType: 'html_snapshot'`, `extension: 'html'`, `mimeType: 'text/html; charset=utf-8'`, `contents: <known HTML>`. Then create a context with `page: undefined`; assert it throws `MissingBrowserImplementationError('browser_implementation_missing', ...)`. Then create a context with a page mock that throws; assert it throws `MissingBrowserImplementationError('html_snapshot_failed', ...)`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test tests/diagnostics/capture/html-snapshot.test.ts` passes.

---

### Task 8 (Wave B): `DiagnosticManager` integration test for `HtmlSnapshotCapture`

**Files:**
- Create: `tests/diagnostics/manager-html-snapshot.test.ts`

**Goal:** End-to-end test: when `diagnosticManager.recordScraperError` is called with a `page` in the `DiagnosticInput`, the `html_snapshot` artifact is written to disk + persisted in `diagnosticArtifacts` table. Mirrors the existing `tests/diagnostics/manager.test.ts:23-34, 88-92, 162-167` capture-strategy faking pattern.

**Test:** create a temp directory + in-memory DB; instantiate `DiagnosticManager` with `{ htmlSnapshot: true, screenshot: false, ... }`; pass a fake `Page` whose `content()` returns a known HTML; call `recordScraperError({ scope: { jobId: 1 }, error: new Error('test'), page: fakePage })`; assert the returned `outcome.artifactIds.length === 1` + the persisted file exists on disk + the `diagnosticArtifacts` row has `artifactType: 'html_snapshot'`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/diagnostics/manager-html-snapshot.test.ts` passes.

---

### Task 9 (Wave C): Update `LINKEDIN_SELECTORS` — add `panel.*` + `dedicated.*` groups, bump version

**Files:**
- Modify: `src/linkedin/selectors.ts:21-53` (add new groups; bump `LINKEDIN_SELECTORS_MAP_VERSION` to `2`)
- Create: `tests/linkedin/selectors-extended.test.ts` (new test file)

**Goal:** Extend the selector map (Decision 25 — shared `FIELDS` map) with the new `panel.*` + `dedicated.*` groups from librarian research. Bump the version to `2`.

**`selectors.ts` (extend):**

```ts
export const LINKEDIN_SELECTORS_MAP_VERSION = 2 as const;

export const LINKEDIN_SELECTORS = {
  cards: { /* ...unchanged... */ },
  loadMore: { /* ...unchanged... */ },
  endOfResults: { /* ...unchanged... */ },
  overlays: { /* ...unchanged... */ },
  panel: {
    container: 'div.jobs-search__job-details--wrapper',
    title: '.job-details-jobs-unified-top-card__job-title a',
    titleElement: '.job-details-jobs-unified-top-card__job-title',
    titleAnchor: '.job-details-jobs-unified-top-card__job-title a',
    company: '.job-details-jobs-unified-top-card__company-name',
    location: '.job-details-jobs-unified-top-card__primary-description-container',
    description: '.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, .show-more-less-html__markup',
  },
  dedicated: {
    title: '.job-details-jobs-unified-top-card__job-title',
    company: '.job-details-jobs-unified-top-card__company-name a',
    location: '.job-details-jobs-unified-top-card__primary-description-container',
    description: '.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, .show-more-less-html__markup',
  },
} as const;

/** Shared FIELDS map (Decision 25) — used by both panel-parser and dedicated-parser. */
export const LINKEDIN_FIELDS: Readonly<Record<'title' | 'company' | 'location' | 'description', string>> = {
  title: LINKEDIN_SELECTORS.panel.titleElement,
  company: LINKEDIN_SELECTORS.panel.company,
  location: LINKEDIN_SELECTORS.panel.location,
  description: LINKEDIN_SELECTORS.panel.description,
};
```

**Tests:** assert `LINKEDIN_SELECTORS_MAP_VERSION === 2`; assert each new group has the expected keys; assert `LINKEDIN_FIELDS` reuses the panel selectors.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/linkedin/selectors-extended.test.ts` passes.

---

### Task 10 (Wave C): `panel-parser.ts` — `parsePanel(page, sourceJobId, fields)` → `ExtractionFieldSet`

**Files:**
- Create: `src/linkedin/extraction/panel-parser.ts`
- Create: `tests/extraction/panel-parser.test.ts` (linkedom-based unit tests)

**Goal:** Pure-ish parser that takes a Playwright `Page` + the `FIELDS` map and reads the panel's title / company / location / description. Uses `page.locator(selector).textContent()` for per-field reads (auto-waiting). Verifies the panel title anchor's `href` matches the selected `sourceJobId` (Decision 7 refined) — throws `PanelJobIdMismatchError` after a bounded retry loop.

**`panel-parser.ts` (sketch):**

```ts
import type { Page } from 'playwright';
import { LINKEDIN_FIELDS, LINKEDIN_SELECTORS, JOB_ID_HREF_PATTERN } from '../selectors.js';
import type { ExtractionFieldSet } from './state.js';
import { PanelJobIdMismatchError, PanelExtractionError } from './errors.js';
import { normalizeText } from './normalize.js';

const PANEL_VERIFY_MAX_ATTEMPTS = 3;
const PANEL_VERIFY_RETRY_MS = 500;
const PANEL_DESCRIPTION_WAIT_MS = 10_000;

export interface ParsePanelOptions {
  readonly sourceJobId: string;
  readonly fields?: Readonly<Record<keyof ExtractionFieldSet, string>>;
  readonly signal?: AbortSignal;
}

export async function parsePanel(
  page: Page,
  options: ParsePanelOptions,
): Promise<ExtractionFieldSet> {
  const fields = options.fields ?? LINKEDIN_FIELDS;
  // Wait for the description container (state: 'visible', NOT 'attached').
  try {
    await page.locator(fields.description).first().waitFor({ state: 'visible', timeout: PANEL_DESCRIPTION_WAIT_MS });
  } catch (cause) {
    throw new PanelExtractionError(
      { url: page.url(), reason: 'description_not_visible' },
      cause instanceof Error ? cause : undefined,
    );
  }

  // Verify the panel belongs to the selected job (Decision 7 + Decision 26).
  const expectedId = options.sourceJobId;
  let actualHref: string | null = null;
  for (let attempt = 0; attempt < PANEL_VERIFY_MAX_ATTEMPTS; attempt++) {
    if (options.signal?.aborted) {
      throw new PanelExtractionError({ url: page.url(), reason: 'cancelled' });
    }
    actualHref = await page.locator(LINKEDIN_SELECTORS.panel.titleAnchor).first().getAttribute('href');
    if (actualHref !== null && JOB_ID_HREF_PATTERN.test(actualHref)) {
      const match = actualHref.match(JOB_ID_HREF_PATTERN);
      if (match && match[1] === expectedId) break;
    }
    await new Promise((resolve) => setTimeout(resolve, PANEL_VERIFY_RETRY_MS));
  }
  if (actualHref === null || !JOB_ID_HREF_PATTERN.test(actualHref)) {
    throw new PanelJobIdMismatchError({
      expectedSourceJobId: expectedId,
      actualSourceJobId: 'unknown',
      attempts: PANEL_VERIFY_MAX_ATTEMPTS,
    });
  }
  const match = actualHref.match(JOB_ID_HREF_PATTERN);
  if (!match || match[1] !== expectedId) {
    throw new PanelJobIdMismatchError({
      expectedSourceJobId: expectedId,
      actualSourceJobId: match?.[1] ?? 'unknown',
      attempts: PANEL_VERIFY_MAX_ATTEMPTS,
    });
  }

  // Read the 4 fields.
  const [title, company, location, description] = await Promise.all([
    page.locator(fields.title).first().textContent(),
    page.locator(fields.company).first().textContent(),
    page.locator(fields.location).first().textContent(),
    page.locator(fields.description).first().textContent(),
  ]);

  return {
    title: title === null ? null : normalizeText(title),
    company: company === null ? null : normalizeText(company),
    location: location === null ? null : normalizeText(location),
    description: description === null ? null : normalizeText(description),
  };
}
```

**Tests (linkedom-based, no real Playwright):** use `linkedom.parseHTML(html)` to create a `document`; mock the `Page` interface with `evaluate()`-style methods (or use the `PlaywrightRouteSession` from TASK-012 against the 4 panel fixtures). For unit tests, prefer the `PlaywrightRouteSession` integration approach (mirrors TASK-012's `panel-parser.test.ts` pattern at `tests/linkedin/helpers/playwright-route-session.smoke.test.ts`).

Test cases:
- `panel-complete.html` → all 4 fields non-null; the service layer computes `'complete'`.
- `panel-partial.html` → `title` + `company` + truncated `description`; the service layer computes `'partial'`.
- `panel-mismatch.html` → throws `PanelJobIdMismatchError` with `expectedSourceJobId` + `actualSourceJobId`.
- `panel-parse-failure.html` (missing description) → throws `PanelExtractionError({ reason: 'description_not_visible' })`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/panel-parser.test.ts` passes; `PLAYWRIGHT_SMOKE=1 pnpm test tests/extraction/panel-parser.smoke.test.ts` passes.

---

### Task 11 (Wave C): `dedicated-parser.ts` — `parseDedicatedPage(page, fields)` → `ExtractionFieldSet`

**Files:**
- Create: `src/linkedin/extraction/dedicated-parser.ts`
- Create: `tests/extraction/dedicated-parser.test.ts`
- Create: `tests/extraction/fixtures/{panel-complete.html, panel-partial.html, panel-mismatch.html, panel-parse-failure.html, dedicated-complete.html, dedicated-partial.html}` (6 fixtures)
- Create: `tests/extraction/fixtures/loadFixture.ts` (re-exports the shared helper)

**Goal:** Pure-ish parser that takes a Playwright `Page` + the `FIELDS` map and reads the dedicated page's title / company / location / description. Reuses the SAME `LINKEDIN_FIELDS` map as the panel parser (Decision 25 — LinkedIn reuses the unified top-card). No verification step needed (the URL is built from the `sourceJobId` directly — `parseDedicatedPage` does not verify).

**`dedicated-parser.ts` (sketch):**

```ts
import type { Page } from 'playwright';
import { LINKEDIN_FIELDS } from '../selectors.js';
import type { ExtractionFieldSet } from './state.js';
import { DedicatedPageError } from './errors.js';
import { normalizeText } from './normalize.js';

const DEDICATED_DESCRIPTION_WAIT_MS = 20_000;

export interface ParseDedicatedPageOptions {
  readonly fields?: Readonly<Record<keyof ExtractionFieldSet, string>>;
  readonly signal?: AbortSignal;
}

export async function parseDedicatedPage(
  page: Page,
  options: ParseDedicatedPageOptions = {},
): Promise<ExtractionFieldSet> {
  const fields = options.fields ?? LINKEDIN_FIELDS;
  try {
    await page.locator(fields.description).first().waitFor({ state: 'visible', timeout: DEDICATED_DESCRIPTION_WAIT_MS });
  } catch (cause) {
    throw new DedicatedPageError(
      { url: page.url(), reason: 'description_not_visible' },
      cause instanceof Error ? cause : undefined,
    );
  }
  const [title, company, location, description] = await Promise.all([
    page.locator(fields.title).first().textContent(),
    page.locator(fields.company).first().textContent(),
    page.locator(fields.location).first().textContent(),
    page.locator(fields.description).first().textContent(),
  ]);
  return {
    title: title === null ? null : normalizeText(title),
    company: company === null ? null : normalizeText(company),
    location: location === null ? null : normalizeText(location),
    description: description === null ? null : normalizeText(description),
  };
}
```

**Fixtures (sketches — see `tests/linkedin/fixtures/loadFixture.ts` for the loadFixture helper pattern):**

- `panel-complete.html` — full panel with all 4 fields, no `Show more` literal.
- `panel-partial.html` — panel with `title` + `company` + truncated `description` (contains `<button>Show more</button>`).
- `panel-mismatch.html` — panel with title anchor's href pointing to `/jobs/view/999999/`.
- `panel-parse-failure.html` — panel with title + company + location but NO description container.
- `dedicated-complete.html` — full dedicated page with all 4 fields.
- `dedicated-partial.html` — dedicated page with only `title` + `company`.

**Tests (linkedom-based for unit; PlaywrightRouteSession for integration):**
- `dedicated-complete.html` → all 4 fields non-null; service computes `'complete'`.
- `dedicated-partial.html` → only `title` + `company`; service computes `'partial'`.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/dedicated-parser.test.ts` passes.

---

### Task 12 (Wave D): `Repositories.jobs.updateDiscoveryEvent(id, patch)` method

**Files:**
- Modify: `src/persistence/repositories/jobs.ts` (add `updateDiscoveryEvent` method after the existing `recordDiscoveryEvent` at `jobs.ts:273-291`)
- Create: `tests/persistence/jobs-update-discovery-event.test.ts`

**Goal:** Add the ONE new repository method (no schema change). Updates `extractionAttempted` + `currentExtractionState` + `skipReason` on an existing `discoveryEvents` row. Sync `db.transaction` wrapper mirroring `updateExtraction` at `jobs.ts:255-271`.

**`jobs.ts` (add after `recordDiscoveryEvent`):**

```ts
export interface DiscoveryEventPatch {
  readonly currentExtractionState?: ExtractionStatus;
  readonly extractionAttempted?: boolean;
  readonly skipReason?: string | null;
}

async updateDiscoveryEvent(id: number, patch: DiscoveryEventPatch): Promise<void> {
  this.ctx.db.transaction((tx) => {
    const update: Record<string, unknown> = {};
    if (patch.currentExtractionState !== undefined) update.currentExtractionState = patch.currentExtractionState;
    if (patch.extractionAttempted !== undefined) update.extractionAttempted = patch.extractionAttempted;
    if (patch.skipReason !== undefined) update.skipReason = patch.skipReason;
    tx.update(discoveryEvents).set(update).where(eq(discoveryEvents.id, id)).run();
  });
}

async findLatestDiscoveryEventByJobAndSearch(
  jobId: number,
  searchExecutionId: number,
): Promise<DiscoveryEventRow | null> {
  const rows = this.ctx.db
    .select()
    .from(discoveryEvents)
    .where(
      and(
        eq(discoveryEvents.jobId, jobId),
        eq(discoveryEvents.searchExecutionId, searchExecutionId),
      ),
    )
    .orderBy(desc(discoveryEvents.id))
    .limit(1)
    .all();
  const row = rows[0];
  return row === undefined ? null : discoveryEventRowFromRecord(row);
}
```

The `updateDiscoveryEvent` method must be `async` to match the `JobsRepository` interface (the `db.transaction` call is sync internally, but the method signature is async — mirrors `updateExtraction` at `jobs.ts:255-271`). The `findLatestDiscoveryEventByJobAndSearch` method is used by `LinkedInExtractionService.extractOne` to resolve the `discoveryEvents.id` for the current (run, search) context — required by `updateDiscoveryEvent(id, patch)`.

**Tests:** create a job via `recordNewJob` (returns `discoveryEventId`); update the event with `currentExtractionState: 'complete', extractionAttempted: true`; assert the row reflects the patch. For `findLatestDiscoveryEventByJobAndSearch`: insert two events for the same job+search; assert the method returns the most recent one (highest `id`).

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/persistence/jobs-update-discovery-event.test.ts` passes.

---

### Task 13 (Wave D): `LinkedInExtractionService` — `extractOne()` + `extractBatch()`

**Files:**
- Create: `src/linkedin/extraction/service.ts`
- Create: `tests/extraction/service.test.ts` (full integration with FakeBrowserSession + real DB)
- Create: `src/linkedin/extraction/index.ts` (placeholder; finalized in Wave E)

**Goal:** The orchestrator. Per-job flow: read existing job → skip if complete/partial → panel select + extract → on panel failure open fallback page + extract → compute status → atomic update (`updateExtraction` + `recordExtractionAttempt` + `updateDiscoveryEvent`) → close fallback in `try/finally`. Mirrors TASK-012's `LinkedInDiscoveryService` pattern (`src/linkedin/discovery-service.ts:75-397`).

**`service.ts` (sketch):**

```ts
import type { Page } from 'playwright';
import type { Repositories } from '../../persistence/repositories/index.js';
import type { JobRepository, JobRow } from '../../persistence/repositories/jobs.js';
import type { DiagnosticManager } from '../../diagnostics/manager.js';
import type { BrowserSession } from '../browser-session.js';
import type { ExtractionFieldSet, ExtractionKind, ExtractionOutcome, ExtractionBatchOutcome } from './state.js';
import { LINKEDIN_EXTRACTION_SCHEMA_VERSION } from './state.js';
import type { SearchExecutionRow } from '../../persistence/repositories/pipeline-runs.js';
import { computeExtractionStatus } from './status.js';
import { buildDetailUrl } from './detail-url.js';
import { parsePanel } from './panel-parser.js';
import { parseDedicatedPage } from './dedicated-parser.js';
import { noopLinkedInExtractionLogger, type LinkedInExtractionLogger } from './log.js';
import { PanelExtractionError, PanelJobIdMismatchError, DedicatedPageError } from './errors.js';
import { navigateWithTimeout } from '../navigation.js';
import { dismissRecoverableOverlays } from '../overlay.js';

export interface LinkedInExtractionServiceOptions {
  readonly repositories: Repositories;
  readonly browserSession: BrowserSession;
  readonly diagnosticManager: DiagnosticManager;
  readonly logger?: LinkedInExtractionLogger;
  readonly config: {
    readonly navigationMs: number;
    readonly detailPanelMs: number;
    readonly dedicatedPageMs: number;
    readonly overlayDismissalMs: number;
  };
  readonly now?: () => Date;
}

export interface ExtractOneInput {
  readonly run: { readonly id: number };
  readonly searchExecution: SearchExecutionRow;
  readonly job: { readonly id: number; readonly sourceJobId: string; readonly extractionStatus: 'complete' | 'partial' | 'failed' };
  readonly searchPage: Page;
  readonly signal: AbortSignal;
}

export class LinkedInExtractionService {
  // ... constructor mirrors TASK-012's LinkedInDiscoveryService ...

  async extractOne(input: ExtractOneInput): Promise<ExtractionOutcome> {
    const startedAt = this.now().toISOString();
    this.logger.extractionStart({ jobId: input.job.id, sourceJobId: input.job.sourceJobId });

    // Step 1: skip complete/partial (SPEC §22.9 + §22.10).
    if (input.job.extractionStatus === 'complete' || input.job.extractionStatus === 'partial') {
      this.logger.extractionSkip({ jobId: input.job.id, reason: input.job.extractionStatus });
      return { /* kind: 'skipped' */ };
    }

    // Step 2: panel extraction.
    let fields: ExtractionFieldSet | null = null;
    let attemptedMethods: ('search_detail_panel' | 'dedicated_job_page')[] = [];
    try {
      fields = await parsePanel(input.searchPage, { sourceJobId: input.job.sourceJobId, signal: input.signal });
      attemptedMethods.push('search_detail_panel');
    } catch (panelError) {
      this.logger.panelMismatch(/* ... */);  // if PanelJobIdMismatchError
      // Step 3: fallback to dedicated page.
      const detailUrl = buildDetailUrl(input.job.sourceJobId);
      let fallbackPage: Page | null = null;
      try {
        fallbackPage = await this.browserSession.openFallbackPage(detailUrl);
        const nav = await navigateWithTimeout({ page: fallbackPage, url: detailUrl, timeoutMs: this.config.navigationMs });
        if (!nav.ok) {
          throw new DedicatedPageError({ url: detailUrl, reason: nav.reason }, nav.cause);
        }
        await dismissRecoverableOverlays(fallbackPage, { overlayDismissalMs: this.config.overlayDismissalMs });
        fields = await parseDedicatedPage(fallbackPage, { signal: input.signal });
        attemptedMethods.push('dedicated_job_page');
      } finally {
        if (fallbackPage !== null) {
          try { await this.browserSession.closeFallbackPage(fallbackPage); } catch { /* best-effort */ }
        }
      }
    }

    // Step 4: compute status + atomic update (3 writes inside one db.transaction).
    const kind: ExtractionKind = fields === null ? 'failed' : computeExtractionStatus(fields);
    const event = await this.repositories.jobs.findLatestDiscoveryEventByJobAndSearch(
      input.job.id,
      input.searchExecution.id,
    );
    if (event === null) {
      // No discovery event exists for this (job, search) pair — this is a
      // data-integrity bug (TASK-012 should have inserted one). Surface a
      // typed error so the orchestrator can decide to abort the run.
      throw new Error(
        `extractOne: no discovery event found for jobId=${input.job.id}, searchExecutionId=${input.searchExecution.id}`,
      );
    }
    const completedAt = this.now().toISOString();
    this.repositories.jobs.ctx.db.transaction((tx) => {
      // Write 1: record the extraction attempt (panel + dedicated, if attempted).
      for (let i = 0; i < attemptedMethods.length; i++) {
        const method = attemptedMethods[i]!;
        tx.insert(extractionAttempts).values({
          jobId: input.job.id,
          pipelineRunId: input.run.id,
          searchExecutionId: input.searchExecution.id,
          attemptTimestamp: completedAt,
          method,
          attemptNumber: i + 1,
          success: kind !== 'failed',
          errorCode: kind === 'failed' ? 'panel_and_dedicated_failed' : null,
          errorMessage: null,
        }).run();
      }
      // Write 2: update the job's extraction status + fields + successful method.
      const update: Record<string, unknown> = {
        extractionStatus: kind,
        lastExtractionAttemptTimestamp: completedAt,
        updatedTimestamp: completedAt,
      };
      if (kind === 'complete' || kind === 'partial') {
        if (fields?.title !== undefined) update.title = fields.title;
        if (fields?.company !== undefined) update.company = fields.company;
        if (fields?.location !== undefined) update.location = fields.location;
        if (fields?.description !== undefined) update.description = fields.description;
        update.successfulMethod = attemptedMethods[attemptedMethods.length - 1] ?? null;
      }
      tx.update(jobs).set(update).where(eq(jobs.id, input.job.id)).run();
      // Write 3: update the existing discoveryEvents row.
      tx.update(discoveryEvents)
        .set({
          currentExtractionState: kind,
          extractionAttempted: true,
        })
        .where(eq(discoveryEvents.id, event.id))
        .run();
    });

    this.logger.extractionComplete({ jobId: input.job.id, kind });
    return { /* ... */ };
  }

  async extractBatch(input: { run, searchExecution, jobs, searchPage, signal }): Promise<ExtractionBatchOutcome> {
    const perJob: ExtractionOutcome[] = [];
    for (const job of input.jobs) {
      if (input.signal.aborted) break;
      perJob.push(await this.extractOne({ run: input.run, searchExecution: input.searchExecution, job, searchPage: input.searchPage, signal: input.signal }));
    }
    return { /* ... aggregate totals ... */ };
  }
}
```

**Tests:** use a `FakeBrowserSession` + real DB (create a temp DB via `createDatabaseConnection` + `runMigrations`); insert a job via `recordNewJob` with `extractionStatus: 'failed'`; call `extractOne()` with a fake panel; assert the returned outcome; assert the DB row was updated to `'complete'` (or `'partial'`) + a new `extractionAttempts` row was written + the `discoveryEvents` row was updated.

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/extraction/service.test.ts` passes.

---

### Task 14 (Wave E): `tests/extraction/boundaries.test.ts` + extend `playwright-route-session.ts` + extend `tests/live/linkedin.test.ts` + docs

**Files:**
- Create: `tests/extraction/boundaries.test.ts` (mirror `tests/linkedin/boundaries.test.ts`)
- Create: `tests/extraction/helpers/playwright-route-session.ts` (route BOTH search URL + dedicated page URL)
- Create: `tests/extraction/helpers/fake-session.ts` (pure-Node test helper for extraction)
- Modify: `tests/live/linkedin.test.ts` (add 1 new `it` for dedicated-page live extraction)
- Modify: `src/linkedin/extraction/index.ts` (finalize public barrel — exports `LinkedInExtractionService`, types, errors)
- Modify: `tests/linkedin/boundaries.test.ts` (bump file count assertion to `>= 26`)
- Modify: `docs/tasks/TASK-013-job-detail-extraction-persistence.md` (update "Implementation results" + status)
- Modify: `docs/tasks/INDEX.md` (update TASK-013 row to "✅ Implemented")
- Modify: `README.md` (optional one-line note about extraction flow)

**`tests/extraction/boundaries.test.ts` (sketch):** mirror `tests/linkedin/boundaries.test.ts`. Enumerate `src/linkedin/extraction/*.ts`. Ban runtime imports of `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`, `pino`. Allow `playwright` for `panel-parser.ts`, `dedicated-parser.ts`, `service.ts` (type-only). Sole runtime Playwright importer remains `src/linkedin/playwright-session.ts`. Ban `process.exit(...)`.

**`tests/extraction/helpers/playwright-route-session.ts` (sketch):**

```ts
import { PlaywrightBrowserSession } from '../../../src/linkedin/playwright-session.js';
import { loadFixture, type FixtureName } from '../fixtures/loadFixture.js';

export class PlaywrightExtractionRouteSession extends PlaywrightBrowserSession {
  constructor(/* ... */) { /* ... */ }
  override async launch(): Promise<{ browser, context }> {
    const result = await super.launch();
    await result.context.route('https://www.linkedin.com/jobs/view/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: loadFixture('dedicated-complete') }),
    );
    return result;
  }
}
```

**`tests/live/linkedin.test.ts` (add new `it`):**

```ts
it.skipIf(!ENABLED)('extracts a public job-detail page end-to-end', async () => {
  // Navigate to a real LinkedIn job-detail page; assert all 5 required fields extracted.
  // ...
});
```

**`src/linkedin/extraction/index.ts` (finalize):**

```ts
export { LinkedInExtractionService } from './service.js';
export type { LinkedInExtractionServiceOptions, ExtractOneInput } from './service.js';
export {
  LINKEDIN_EXTRACTION_SCHEMA_VERSION,
  LINKEDIN_FIELDS,
} from '../selectors.js';
export type {
  ExtractionOutcome,
  ExtractionBatchOutcome,
  ExtractionFieldSet,
  ExtractionKind,
  ExtractionMethod,
  RequiredField,
  LinkedinExtractionSchemaVersion,
} from './state.js';
export { parsePanel } from './panel-parser.js';
export type { ParsePanelOptions } from './panel-parser.js';
export { parseDedicatedPage } from './dedicated-parser.js';
export type { ParseDedicatedPageOptions } from './dedicated-parser.js';
export { normalizeText, isValidRequiredField } from './normalize.js';
export { validateRequiredFields } from './required-fields.js';
export type { RequiredFieldsValidation } from './required-fields.js';
export { computeExtractionStatus } from './status.js';
export { buildDetailUrl } from './detail-url.js';
export {
  LinkedInExtractionError,
  PanelExtractionError,
  PanelJobIdMismatchError,
  DedicatedPageError,
  RequiredFieldMissingError,
  DetailUrlBuildError,
} from './errors.js';
export { noopLinkedInExtractionLogger, pinoLinkedInExtractionLogger } from './log.js';
export type { LinkedInExtractionLogger } from './log.js';
```

**Verify by running:** `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm format:check` clean; `pnpm test` (all tests pass); `PLAYWRIGHT_SMOKE=1 pnpm test tests/extraction/panel-parser.smoke.test.ts tests/extraction/dedicated-parser.smoke.test.ts` passes; `pnpm test:live:list` lists `tests/live/linkedin.test.ts`; `pnpm exec playwright --version` shows 1.62.x.

---

## Test plan

Reference SPEC §41.1 (unit) + §41.2 (integration) + §41.3 (scraper).

### Unit tests (no I/O)

| Wave | Test file | Coverage |
|---|---|---|
| A | `tests/extraction/state.test.ts` | Structural assertions on `ExtractionOutcome` + `ExtractionKind` (5 values) + `LINKEDIN_EXTRACTION_SCHEMA_VERSION === 1`. |
| A | `tests/extraction/errors.test.ts` | Each `LinkedInExtractionError` subclass's `code` + `exitCode` + `metadata` shape. `PanelJobIdMismatchError` carries the expected + actual IDs. |
| A | `tests/extraction/normalize.test.ts` | Empty input → `''`. Script/style blocks dropped. `Show more` / `See more` / `View more` literals stripped. Block-level tags preserved as word boundaries. Common HTML entities decoded. Whitespace collapsed. |
| A | `tests/extraction/required-fields.test.ts` | 16 cases (all combinations of 4 fields present/absent, asserting `valid` + `missing`). |
| A | `tests/extraction/status.test.ts` | 16 cases (all combinations of 4 fields present/absent, asserting `complete` \| `partial`). |
| A | `tests/extraction/detail-url.test.ts` | Valid `sourceJobId` (6+ digits) → expected URL. Empty / non-numeric / 5-digit IDs throw `DetailUrlBuildError`. |
| A | `tests/extraction/log.test.ts` | Each method emits the expected `event` + structured fields; `noopLinkedInExtractionLogger()` does not throw. |
| C | `tests/extraction/panel-parser.test.ts` (linkedom + PlaywrightRouteSession) | 4 fixtures: complete → all 4 fields; partial → 3 fields; mismatch → throws `PanelJobIdMismatchError`; parse-failure → throws `PanelExtractionError`. |
| C | `tests/extraction/dedicated-parser.test.ts` (linkedom + PlaywrightRouteSession) | 2 fixtures: complete → all 4 fields; partial → 2 fields. |
| C | `tests/linkedin/selectors-extended.test.ts` | `LINKEDIN_SELECTORS_MAP_VERSION === 2`; new `panel.*` + `dedicated.*` groups present; `LINKEDIN_FIELDS` reuses panel selectors. |
| E | `tests/extraction/boundaries.test.ts` | All `src/linkedin/extraction/*.ts` files (a separate set, not the whole `src/linkedin/` tree) avoid banned imports; runtime Playwright importer count remains 1. `tests/linkedin/boundaries.test.ts` is the single source of truth for the `>= 26` global file-count assertion (it uses the recursive `listLinkedinSourceFiles` walker). |
| E | `tests/linkedin/boundaries.test.ts` (updated) | File count assertion `>= 26` (the new `extraction/` files counted). |

### Integration tests (with real DB + real Playwright + fixtures)

| Wave | Test file | Coverage |
|---|---|---|
| B | `tests/diagnostics/manager-html-snapshot.test.ts` | `recordScraperError({ page })` writes the HTML snapshot artifact to disk + persists the `diagnosticArtifacts` row. |
| D | `tests/persistence/jobs-update-discovery-event.test.ts` | `updateDiscoveryEvent(id, patch)` updates the existing `discoveryEvents` row; does not insert a new row. |
| D | `tests/extraction/service.test.ts` | Full per-job flow: insert `extractionStatus: 'failed'` job via `recordNewJob`; call `extractOne()` with a fake panel; assert outcome; assert DB updates (`updateExtraction` + `recordExtractionAttempt` + `updateDiscoveryEvent`); assert `try/finally` closes the fallback page. **Plus:** `extractOne` on a `complete` job returns `kind: 'skipped'`, the `jobs` row title is unchanged, the `discoveryEvents.skipReason` is unchanged, and zero `extractionAttempts` rows are inserted (immutability guard per Decision 10). |

### Smoke tests (PLAYWRIGHT_SMOKE=1 gated)

| Wave | Test file | Coverage |
|---|---|---|
| C | `tests/extraction/panel-parser.smoke.test.ts` | Real Playwright Chromium + `PlaywrightRouteSession` serving `panel-complete.html`; assert all 4 fields extracted. |
| C | `tests/extraction/dedicated-parser.smoke.test.ts` | Real Playwright Chromium + `PlaywrightExtractionRouteSession` serving `dedicated-complete.html`; assert all 4 fields extracted. |
| D | `tests/extraction/service.smoke.test.ts` | Real Playwright Chromium + `PlaywrightExtractionRouteSession` + real DB; assert full per-job flow. |

### Live tests (LINKEDIN_LIVE=1 gated, opt-in only)

| Wave | Test file | Coverage |
|---|---|---|
| E | `tests/live/linkedin.test.ts` (extended) | Navigate to a real LinkedIn job-detail page; assert all 5 required fields extracted; assert `extractionStatus === 'complete'`. Still `describe.skipIf(!ENABLED)`. |

## Verification commands

Run after each wave. The implementer MUST run them in order and confirm all pass before moving to the next wave.

```bash
# After every wave:
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test tests/linkedin tests/extraction tests/persistence tests/diagnostics

# After Wave B (capture strategy replacement):
pnpm test tests/diagnostics/manager-html-snapshot.test.ts

# After Wave C (parsers + fixtures):
pnpm test tests/extraction/{panel-parser,dedicated-parser}.test.ts

# After Wave D (orchestrator + new repository method):
pnpm test tests/extraction/service.test.ts tests/persistence/jobs-update-discovery-event.test.ts

# After Wave E (boundaries + live test + docs):
pnpm test
pnpm exec playwright --version  # expect 1.62.x
pnpm test:live:list  # expect tests/live/linkedin.test.ts

# Smoke tests (gated):
PLAYWRIGHT_SMOKE=1 pnpm test tests/extraction/panel-parser.smoke.test.ts tests/extraction/dedicated-parser.smoke.test.ts tests/extraction/service.smoke.test.ts

# Live tests (opt-in; only when the user explicitly requests):
LINKEDIN_LIVE=1 pnpm test:live

# Final task verification (after all 5 waves):
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm exec playwright --version
```

## Critical preconditions requiring user approval

The implementing agent MUST stop and ask the user to confirm each item before any file in `src/linkedin/extraction/` is edited. Per AGENTS.md §12.

1. **Add ONE new repository method** `Repositories.jobs.updateDiscoveryEvent(id, patch)` (`src/persistence/repositories/jobs.ts` modified after the existing `recordDiscoveryEvent` at line 273). Method addition only — NO schema change, NO migration. (Decision 9)
2. **Replace `HtmlSnapshotCapture` in place** at `src/diagnostics/capture/html-snapshot.ts:1-15` (TASK-005 explicitly assigned TASK-013). The replacement uses `await page.content()` per Decision 13 refined. (Decision 13)
3. **HTML snapshot written WITHOUT `Redactor`** (markup corruption risk). Documented exception per Decision 14. User confirmation required.
4. **NO new database schema / migration** — all tables already exist (`jobs`, `discoveryEvents`, `extractionAttempts`, `diagnosticArtifacts`). (Decision 20)
5. **NO new top-level CLI subcommand** — TASK-015 owns `jobhunter run` orchestration; TASK-013 exposes only `LinkedInExtractionService.extractOne()` + `extractBatch()` consumed by TASK-015. (Decision 24)
6. **NO new `playwright` dependency** — already a direct dep from TASK-012. (Global constraint)
7. **Update `src/linkedin/boundaries.test.ts`** to count the new `extraction/` files (final assertion `>= 26`); add `tests/extraction/boundaries.test.ts` mirroring the pattern. (Decision 22, Task 6, Task 14)
8. **`OperationalConfigSchema` is `.strict()`** — do NOT add new config fields. Reuse `diagnostics.onScraperError.htmlSnapshot` flag (already wired). (Global constraint)

## Open questions + risks

The user should weigh in on these BEFORE implementation begins. Each item is a real risk; if the user disagrees, the plan must be revised before any code is written.

1. **`loadMore` count estimation (carryover from TASK-012).** TASK-012 used `maxIterations = 200` for `loadMoreResults` (Wave A deviation). TASK-013 inherits this default via the same `OperationalConfigSchema.scraper.maxIterations` field. The user has not confirmed whether 200 is the right default. Risk: a run with 200 panels × 4 fields = 800 field extractions × `detailPanelMs` (10s) = 8000s = 2.2 hours per search execution. Acceptable? If not, recommend reducing `maxIterations` to `50` or surfacing a "remaining time" estimate.
2. **Cancellation granularity.** The plan propagates `AbortSignal` to `extractOne` but does NOT cancel mid-`navigateWithTimeout` (Playwright's `goto` does not natively support an `AbortSignal`). The signal is checked between field extractions + DB writes. Risk: a `navigateWithTimeout` call can take up to `dedicatedPageMs` (20s) even after the user presses Ctrl+C. If the user wants tighter cancellation, recommend wrapping `goto` in a `Promise.race` with a signal-driven rejection. (Decision 12 + Global constraint.)
3. **`updateExtraction` is a no-op for `complete` jobs (defensive).** The plan adds a defensive check in `service.ts` so an attempted re-extraction of a `complete` job does not overwrite the immutable snapshot. The user should confirm this is the intended behavior — alternative: throw `Error` to surface the bug.
4. **HTML snapshot un-redacted (Decision 14).** The plan explicitly documents the HTML snapshot as the ONE exception to text-layer redaction. The user should confirm this is acceptable, given the page is the public job-detail page (no session tokens, no cookies). If the user wants redaction, the recommendation is to use `Redactor.redactString()` and accept the markup corruption risk (most redactions will be URL-only).
5. **`buildDetailUrl` throws for 5-digit IDs (Decision 8).** LinkedIn job IDs are typically 6+ digits, but 5-digit IDs have been observed in some older postings. The plan throws `DetailUrlBuildError` for 5-digit IDs as a defensive measure. The user should confirm whether to relax the regex to `^\d{5,}$` (5+ digits) or keep the strict `^\d{6,}$` (6+ digits).
6. **`LINKEDIN_FIELDS` selector sharing (Decision 25).** The plan shares the `FIELDS` map between panel + dedicated parsers. If LinkedIn changes the panel's top-card to a different selector chain than the dedicated page's top-card (currently both use the unified top-card), the shared map will need to be split. Risk: a LinkedIn A/B test could change one without the other. The user should confirm whether to plan for this divergence now (separate maps from Wave C) or wait for the breakage (cheaper but risks a future-task fix-up).
7. **`navigateWithTimeout` already detects LinkedIn blocks (TASK-012).** The plan reuses `navigateWithTimeout` for the dedicated page. Risk: the dedicated page may have a different block pattern than the search page. The user should confirm whether to add a dedicated-page-specific block detector or trust the existing one (TASK-012's `DEFAULT_BLOCK_PATTERNS` already include the `/authwall` redirect path).

## Completion criteria

Per `docs/tasks/TASK-013-job-detail-extraction-persistence.md` "Completion criteria" + per-wave commits. The task is complete when ALL of the following are true:

1. **Per-job flow** — `LinkedInExtractionService.extractOne()` correctly handles the 4 outcomes: `complete` (all 4 fields valid), `partial` (some fields valid), `failed` (no fallback worked), `skipped` (existing complete/partial). All 4 outcomes have unit + integration tests.
2. **Panel-first, dedicated-page-fallback** — Panel extraction is attempted first. On any panel failure (timeout, mismatch, missing description), the dedicated page is opened via `BrowserSession.openFallbackPage` and extraction is retried. The dedicated page is closed in `try/finally` on every path.
3. **Complete-job immutability** — `extractOne` returns `kind: 'skipped'` for existing `complete` jobs; NO panel opened, NO fallback opened, NO content replaced, NO duplicate. The `updateExtraction` call is a NO-OP for `complete` jobs (defensive check in the service).
4. **Partial-job no-retry** — `extractOne` returns `kind: 'skipped'` for existing `partial` jobs. NO panel opened, NO fallback opened, NO content replaced. The existing `discoveryEvents.skipReason` is NOT modified.
5. **Required-field validation** — `validateRequiredFields` correctly identifies missing/invalid fields. `computeExtractionStatus` returns `'complete'` only when all 4 fields are valid.
6. **Per-job failure isolation** — A failure in one `extractOne` call does NOT terminate the batch. The failure is surfaced as `kind: 'failed'` + persisted to `extractionAttempts` with `success: false` + the existing `discoveryEvents` row updated + an `updateExtraction` patch. The next job is processed.
7. **All browser resources close** — On every exit path (success, failure, cancellation), the dedicated fallback page is closed via `BrowserSession.closeFallbackPage` in `try/finally`. The outer browser context is closed by TASK-015's orchestrator.
8. **`HtmlSnapshotCapture` is real** — `src/diagnostics/capture/html-snapshot.ts:1-15` is replaced with a `Page.content()`-backed implementation. The stub is gone.
9. **`updateDiscoveryEvent` is wired** — The new repository method is added to `src/persistence/repositories/jobs.ts`. The method is wrapped in `this.ctx.db.transaction(...)` and is used by the service layer for every per-job persistence.
10. **Boundaries guard extended** — `tests/linkedin/boundaries.test.ts` is updated to count the new `extraction/` files (final `>= 26`). `tests/extraction/boundaries.test.ts` mirrors the pattern and locks the new module's domain boundaries.
11. **Live test extended** — `tests/live/linkedin.test.ts` gains one new `it` that exercises the dedicated-page extraction against a real LinkedIn job-detail page. The test is `LINKEDIN_LIVE=1` gated.
12. **All verification commands pass** — `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (all green); `PLAYWRIGHT_SMOKE=1 pnpm test tests/extraction/panel-parser.smoke.test.ts tests/extraction/dedicated-parser.smoke.test.ts tests/extraction/service.smoke.test.ts` (3/3 pass); `pnpm test:live:list` lists `tests/live/linkedin.test.ts`.
13. **Per-wave commits** — One squash commit per wave (Wave A through Wave E), each with a clear Conventional Commits message. The squash-merge to `main` is a 6th commit that follows `GIT.md §6`.

## Appendices

### A. Reconciler map (file:line pointers to existing surface)

- `Repositories.jobs.updateExtraction(id, patch)` — `src/persistence/repositories/jobs.ts:255-271`. Reused for the per-job status promotion. Decision 9.
- `Repositories.jobs.recordExtractionAttempt(input)` — `src/persistence/repositories/jobs.ts:347-366`. Reused for the per-method attempt record. Decision 9.
- `Repositories.jobs.findBySourceJobId(sourceJobId)` — `src/persistence/repositories/jobs.ts:243-247`. Reused for the cross-search dedup before the per-job extraction loop. Decision 3.
- `Repositories.jobs.recordNewJob(input)` — `src/persistence/repositories/jobs.ts:170-241`. NOT called by TASK-013 (TASK-012 already inserted the placeholder row at `discovery-service.ts:220-239`).
- **`Repositories.jobs.updateDiscoveryEvent(id, patch)` — NEW, added in Task 12 (Wave D).** Method addition, no schema change. Sync `db.transaction` wrapper mirroring `updateExtraction` at `jobs.ts:255-271`. Decision 9.
- `Repositories.transact(fn)` — `src/persistence/repositories/index.ts:50-58`. Callback MUST be sync (better-sqlite3 rejects Promise returns). The service uses `this.ctx.db.transaction((tx) => { ... })` directly (mirroring `createRunWithSearches` at `pipeline-runs.ts:175-224`).
- `DiagnosticManager.recordScraperError({ scope, error, currentUrl, page, browserContext })` — `src/diagnostics/manager.ts:109-150`. Already extended in TASK-012 Wave C. Decision 11.
- `DiagnosticScope` — `src/diagnostics/filename.ts:3-9`. Already supports `jobId` + `extractionAttemptId`. No extension needed.
- **`HtmlSnapshotCapture` at `src/diagnostics/capture/html-snapshot.ts:1-15` — REPLACED in place in Task 7 (Wave B).** Uses `await page.content()` per Decision 13 refined.
- `BrowserSession.openFallbackPage(url)` / `closeFallbackPage(page)` — `src/linkedin/browser-session.ts:47-48`. Forward-compat added in TASK-012; TASK-013 is the first real consumer. The single-active-fallback invariant is enforced by the session; `BrowserCapacityExceededError` thrown on concurrent calls. Decision 3.
- `navigateWithTimeout` — `src/linkedin/navigation.ts`. Reused for the dedicated page navigation. Decision 3.
- `dismissRecoverableOverlays` — `src/linkedin/overlay.ts`. Reused for the dedicated page overlay dismissal. Decision 3.
- `LINKEDIN_SELECTORS` — `src/linkedin/selectors.ts:23-53`. Extended in Task 9 (Wave C) with `panel.*` + `dedicated.*` groups; `LINKEDIN_SELECTORS_MAP_VERSION` bumped to `2`. Decision 25.
- `LINKEDIN_SELECTORS_MAP_VERSION` — `src/linkedin/selectors.ts:21`. Bumped to `2` in Task 9. Decision 25.
- `OperationalConfigSchema.scraper.timeouts.{detailPanelMs, dedicatedPageMs}` — `src/config/schema.ts:49-64`. Already in the schema; reused. Decision 11.
- `OperationalConfigSchema.scraper.maxNoProgressAttempts` — NOT relevant for TASK-013 (loop is bounded by `maxIterations` from TASK-012). Decision 12.
- `ExitCode.Fatal = 1` — `src/errors/application-error.ts:1-9`. Per-task failure exit code. Decision 16.
- `ExitCode.LinkedInBlocked = 4` — `src/errors/application-error.ts:6`. Reused for `LinkedInAccessBlockedError` from TASK-012 (no per-job extraction, no fallback) — TASK-013 inherits the same access-blocked behavior.

### B. Anti-patterns from AGENTS.md (do not violate)

- No `any` in new code (use `unknown` with explicit narrowing). `tsconfig.json:6-8`.
- No `process.exit` inside `src/linkedin/extraction/` — CLI boundary only. AGENTS.md §10.
- No raw HTML persistence outside of the diagnostic flow (with `Redactor` applied at the text layer; HTML is the documented exception per Decision 14).
- No silent overwrite of canonical complete-job snapshots — `updateExtraction` is a NO-OP for `extractionStatus: 'complete'` (defensive check). Decision 10.
- No automatic retry of partial jobs (SPEC §22.10, §40).
- No parallel panel extraction or parallel fallback pages (SPEC §29.1).
- No Drizzle, Pino, OpenAI, Commander, Inquirer imports in `src/linkedin/extraction/` beyond the existing allow-list. AGENTS.md §5.
- No `import type` from `drizzle-orm` either — schema types flow via the repository's row interfaces (mirrors TASK-012). AGENTS.md §5.
- No new database schema / migration. AGENTS.md §12.
- No future-task work (no scoring, no filter integration — TASK-014 and TASK-015). AGENTS.md §2.
- No login automation or credential storage. AGENTS.md §8.
- No new public command or JSON contract change. AGENTS.md §12.

### C. References to SPEC sections

- §22.1 — Canonical source ID (`sourceJobId`).
- §22.2 — Derived detail URL.
- §22.3 — Required fields (`title`, `company`, `location`, `description`).
- §22.4 — Field validation (non-whitespace after normalization).
- §22.5 — Text normalization.
- §22.6 — Stage 1: embedded panel.
- §22.7 — Stage 2: dedicated page (fallback).
- §22.8 — Extraction statuses (`complete`, `partial`, `failed`).
- §22.9 — Complete-job behavior (skip, immutable).
- §22.10 — Partial-job behavior (diagnostic-only, no retry).
- §22.11 — Failed discoveries (no source ID → `discoveryErrors`).
- §22.12 — Failure isolation (per-job).
- §23.2 — Canonical job record.
- §23.3 — Discovery events.
- §29.1 — Scraping concurrency (sequential).
- §29.3 — Graceful cancellation.
- §38 — Per-discovered-job behavior.
- §39.1 — Default scraper artifacts.
- §40 — Reliability requirements.
- §41.1 — Unit tests.
- §41.2 — Integration tests.
- §41.3 — Scraper tests (fixtures preferred; live opt-in).

### D. References to prior task plans (templates + context)

- TASK-012 plan — `docs/superpowers/plans/2026-08-19-task-012-linkedin-discovery-result-loading.md` (1465 lines). Used as the structural template for this plan. All conventions (sub-task numbering, decision-table format, test-plan granularity, verification-command specificity) mirror TASK-012.
- TASK-012 deepwork — `.slim/deepwork/task-012-linkedin-discovery-result-loading.md`. The 22 decisions + 16b–16f addenda. Several TASK-012 decisions are inherited by TASK-013 (e.g., `BrowserSession` interface, `LinkedInScraperError` base, `navigateWithTimeout` pattern, `linkedom` parser fit, `playwright` as the sole runtime importer).
- TASK-005 task spec — `docs/tasks/TASK-005-diagnostics-artifacts.md`. Explicitly assigns `src/diagnostics/capture/html-snapshot.ts` to TASK-013 (the LAST remaining capture-strategy stub).
- TASK-004 task spec — `docs/tasks/TASK-004-persistence-repositories-identifiers.md`. Establishes the `Repositories` facade + the `jobs` repository surface (`updateExtraction`, `recordExtractionAttempt`, `findBySourceJobId`, `recordNewJob`).
- TASK-002 task spec — `docs/tasks/TASK-002-paths-configuration-validation-logging.md`. Establishes `OperationalConfigSchema` (the `.strict()` schema that blocks new config fields) + `ExitCode` enum + `Logger` facade.

### E. References to existing tests (templates)

- `tests/linkedin/boundaries.test.ts` — Mirror for `tests/extraction/boundaries.test.ts`. Same structure, same `BANNED_IMPORTS`, same `RUNTIME_PLAYWRIGHT_IMPORT_RE`, same `PROCESS_EXIT_RE`.
- `tests/linkedin/helpers/playwright-route-session.ts` — Extend for `tests/extraction/helpers/playwright-route-session.ts`. Same `loadFixture` import + `context.route()` pattern.
- `tests/linkedin/fixtures/loadFixture.ts` — Re-export for `tests/extraction/fixtures/loadFixture.ts`. No new fixture-loading logic.
- `tests/live/linkedin.test.ts` — Extend with one new `it` for the dedicated-page live extraction. Same `describe.skipIf(!ENABLED)` gate.

### F. Per-wave commit messages (Conventional Commits)

Per `GIT.md §6`, each wave produces one commit. The squash-merge to `main` is a 6th commit that summarizes the 5 wave commits.

- Wave A: `feat(extraction): add linkedin extraction pure helpers (TASK-013 W1)`
- Wave B: `feat(diagnostics): replace html-snapshot capture strategy (TASK-013 W2)`
- Wave C: `feat(extraction): add linkedin panel and dedicated parsers (TASK-013 W3)`
- Wave D: `feat(extraction): add linkedin extraction service and updateDiscoveryEvent (TASK-013 W4)`
- Wave E: `chore(tasks): add extraction fixtures, boundaries, and live test (TASK-013 W5)`
- Squash: `feat(extraction): add linkedin job-detail extraction, fixtures, and live test (TASK-013)`
