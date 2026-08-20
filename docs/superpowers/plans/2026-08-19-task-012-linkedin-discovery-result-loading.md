# TASK-012 Implementation Plan — LinkedIn Result Discovery, Load-More Behavior, and Access Handling

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implement public, unauthenticated LinkedIn search-page execution (SPEC §21.1–21.7 + §22.1–22.2 + §22.11–22.12 + §29.1 + §29.3 + §39 + §40 + §41.3 + §42 acceptance 23–24). The implementation lives in a new sibling module `src/linkedin/` and surfaces a single application service `LinkedInDiscoveryService.discover({ run, searchMatrixEntry, signal, onProgress? }) → Promise<SearchDiscoveryOutcome>` that TASK-015 will invoke once per matrix entry. The module is **CLI-free** in this task (no top-level `jobhunter` subcommand is added); TASK-015 owns the orchestrator that calls `discover()`. The scraper executes the per-search sequence (navigate → validate page → detect overlays → dismiss recoverable overlays → discover cards → iterate IDs → load-more → bounded end) on a headless Playwright Chromium instance, persists `searchExecutions` + `discoveryEvents` + `discoveryErrors` + `diagnosticArtifacts`, closes browser/context/pages on every exit path, and surfaces typed errors with exit codes 1/4. The two stubs at `src/diagnostics/capture/screenshot.ts` and `src/diagnostics/capture/playwright-trace.ts` (both currently throw `MissingBrowserImplementationError`) are replaced with real Playwright-backed implementations in this task; the `html-snapshot.ts` stub stays untouched (TASK-013).

**Architecture:** A new `src/linkedin/` sibling of `src/init/` and `src/filter/` houses the layer. The pure layer (`src/linkedin/state.ts`, `src/linkedin/card-id.ts`, `src/linkedin/selectors.ts`, `src/linkedin/errors.ts`, `src/linkedin/log.ts`) has no Playwright / no Drizzle / no Pino / no Commander / no Inquirer imports. The browser seam (`src/linkedin/browser-session.ts` + `src/linkedin/playwright-session.ts` + `src/linkedin/fake-session.ts`) wraps Playwright (`BrowserSession` interface → `PlaywrightBrowserSession` real impl → `FakeBrowserSession` for tests). The orchestrator (`src/linkedin/discovery-service.ts`) composes: `Repositories.pipelineRuns.updateSearchStatus` (`src/persistence/repositories/pipeline-runs.ts:293`), `Repositories.jobs.findBySourceJobId` (`jobs.ts:243`) + `Repositories.jobs.recordNewJob` (`jobs.ts:170`, atomic jobs + event + attempt), `Repositories.jobs.recordDiscoveryEvent` (`jobs.ts:273`), `Repositories.jobs.recordDiscoveryError` (`jobs.ts:311`), `DiagnosticManager.recordScraperError` (`src/diagnostics/manager.ts:98`) with `scope.searchExecutionId` / `scope.discoveryErrorId` already supported (`src/diagnostics/filename.ts:3-9`), `OperationalConfigSchema.scraper.timeouts` (`src/config/schema.ts:49-64`), and `ExitCode.LinkedInBlocked` (`src/errors/application-error.ts:6`). The two capture-strategy stubs at `src/diagnostics/capture/screenshot.ts` and `src/diagnostics/capture/playwright-trace.ts` are replaced in place with Playwright-backed implementations (importing Playwright types only — runtime values flow via `BrowserSession`); the orchestrator constructs `DiagnosticManager` with the strategies wired at construction time. **The browser lifecycle (launch / close) is owned by TASK-015**, not the orchestrator: `discover()` receives an already-launched `BrowserSession` and only manages per-search page lifecycle (`openPage` → per-search body → `closePage`). No new schema, no new migration, no new CLI subcommand. Cancellation is `AbortSignal`-based — the orchestrator owns the per-search/per-card try/finally cleanup, but the SIGINT → AbortSignal wiring AND the browser launch/close wiring are TASK-015's.

**Tech Stack:** One new direct dependency: `playwright` (NOT `@playwright/test` — Vitest remains the test runner). `playwright` is NOT in `package.json` today (`package.json:28-37` dependencies + `package.json:38-53` devDependencies do not list it). This dependency requires user approval per AGENTS.md §12 before `pnpm add` runs. Chromium binary installation runs via `pnpm exec playwright install chromium` as a one-shot postinstall. All other tech is reused: `zod`, `drizzle-orm`, `better-sqlite3`, `pino` (via the `Logger` facade at `src/logging/logger.ts`), `vitest`, `linkedom` (test-only, parses saved HTML for unit tests), and the existing `Repositories` / `DiagnosticManager` / `loadConfig` / `updateConfig` surface. The boundaries test mirrors `tests/init/boundaries.test.ts` and ALLOWS `playwright` in `src/linkedin/` (it is the only domain module allowed to import it) and ALLOWS `pino` only as a type-only import in `src/linkedin/log.ts`.

## Open decisions confirmed before implementation

These map to the 28 pinned decisions (22 + 16a–16f) in `.slim/deepwork/task-012-linkedin-discovery-result-loading.md` and to the SPEC §21 + §22 + §29 + §39 + §40 + §41.3 + §42 references. The implementing agent must stop and ask the user to confirm all 28 resolutions — **plus the `playwright` dependency approval (Decision 16)** — before any file in `src/linkedin/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Module location | New `src/linkedin/` (sibling of `src/init/`, `src/filter/`, `src/profile/`, `src/search/`). Layout: `index.ts`, `state.ts`, `errors.ts`, `selectors.ts`, `card-id.ts`, `overlay.ts`, `load-more.ts`, `navigation.ts`, `truncate-metadata.ts`, `browser-session.ts`, `playwright-session.ts`, `fake-session.ts`, `discovery-service.ts`, `log.ts`. **No `src/linkedin/capture-strategies/` subtree** — capture strategies live in `src/diagnostics/capture/` (Decision 16b + Required Finding #3). | §21, §22.11–22.12, AGENTS.md §5 |
| 2 | Browser seam | `BrowserSession` interface (`launch() → { context, browser }`, `close()`, `openPage(url)`, `closePage(page)`, `openFallbackPage(url)`, `closeFallbackPage(page)`, `withRoute(pathPattern, handler)`). `launch()` / `close()` are owned by **TASK-015's orchestrator** (SPEC §21.2: one context per run). `openFallbackPage` is included now (forward-compat for TASK-013) and throws `BrowserCapacityExceededError` if a fallback is already open (Decision 9). Real implementation (`PlaywrightBrowserSession`) calls `playwright.chromium.launch({ headless: true })` + `browser.newContext()`. Tests inject `FakeBrowserSession` that serves saved HTML fixtures via `context.route()` interception. | §21.2, §21.7, §41.3 |
| 3 | Page navigation | `navigateWithTimeout(page, url, ms) → Promise<NavigationResult>` where `NavigationResult = { ok: true; status } \| { ok: false; reason: 'timeout' \| 'blocked' \| 'unexpected' }`. Post-navigation, assert `page.url()` parses to `https://www.linkedin.com/jobs/search/` (via `parseLinkedInJobsSearchURL`-like URL host validation; no fetch-side validation). | §21.3, §21.6 |
| 4 | Expected-page validation | Assert presence of at least one of: `li.jobs-search-results__list-item` selector, the result-count text node, or the "no results" element. Failure → typed `LinkedInExpectedPageError`. | §21.3 |
| 5 | Overlay handling | `OverlayDetector.detect(page) → readonly OverlayDescriptor[]` enumerates visible overlays (selector + dismissal strategy). `dismissOverlay(page, descriptor) → Promise<boolean>` applies ONE strategy (close, Escape, outside-click, accept, reject) bounded by `overlayDismissalMs`. If still visible after dismissal → `OverlayUndismissableError`. | §21.5 |
| 6 | Card ID parsing | `parseCardJobId(element, document) → string \| null`. Accepts: (a) `data-occludable-job-id` attribute on the anchor element; (b) `data-job-id` attribute; (c) `<a href="/jobs/view/<digits>">` regex parse. Returns `null` when none found. The first successful source wins. | §21.3, §22.1 |
| 7 | Discovery dedup | Per-search `Map<string, CardIdLocation>` preserves first-seen `cardIndex` + `cardPosition` and card metadata (title / company / location snippet when available). Cross-search dedup uses `Repositories.jobs.findBySourceJobId`; existing jobs are still recorded as `discoveryEvents` with `isNew=false`. | §40, AGENTS.md §6 |
| 8 | Load-more loop | For-loop with bounded iterations (cap = `4 × maxNoProgressAttempts + 5`). Each iteration: count current cards → if count unchanged AND IDs unchanged from prior iteration, increment no-progress counter; else reset. Stop on: explicit end-of-results element visible, noProgress ≥ `maxNoProgressAttempts`, "See more jobs" / pagination control absent, or no DOM change after a `waitForTimeout(initialResultsMs / 4)`. | §21.4, §21.6 |
| 9 | Browser capacity contract | One `BrowserContext` reused for the entire run (SPEC §21.2 — TASK-015 owns launch/close) + one fallback page at a time. `BrowserSession` tracks `activePages` count; `openFallbackPage(...)` throws `BrowserCapacityExceededError` if a fallback is already open. The orchestrator never opens a fallback in this task (TASK-013 owns extraction) — the capacity hook exists for forward-compat. | §21.7, §29.1 |
| 10 | Search execution persistence | `Repositories.pipelineRuns.updateSearchStatus(id, { finalStatus, endTimestamp, jobsDiscovered, newJobs, existingJobs, errors, diagnosticRefs })` (`pipeline-runs.ts:293-308`) after each search completes (success, failure, OR cancellation). Discovery events/errors written inside `this.ctx.db.transaction((tx) => { ... })` (mirrors `createRunWithSearches` at `pipeline-runs.ts:175-224`) per card to ensure atomic dedup + event insert. Prefer `Repositories.jobs.recordNewJob` (`jobs.ts:170-241`) for atomic job + event + optional extraction attempt. | §22.11, AGENTS.md §6 |
| 11 | Diagnostics integration | `DiagnosticManager.recordScraperError({ scope: { pipelineRunId, searchExecutionId }, error, currentUrl, timestamp })` (`diagnostics/manager.ts:98-137`) on every typed scraper error BEFORE the per-search `try/finally` cleanup. Per-card errors get a `scope.discoveryErrorId` after `Repositories.jobs.recordDiscoveryError` returns the row id; otherwise `artifactRefs` is updated post-hoc by re-running `recordScraperError` with the updated scope (or by direct `Repositories.diagnostics.insert` for the artifact id only). `DiagnosticScope` already supports both `searchExecutionId` and `discoveryErrorId` (`diagnostics/filename.ts:3-9`). | §39 |
| 12 | Cancellation seam | `AbortSignal`-based: `DiscoveryServiceOptions.signal` is propagated to Playwright via `context.setOffline(true)` on abort + immediate page closure (`browserContext.clearCookies()` is NOT called — anonymous context, no cookies). The orchestrator does NOT register SIGINT handlers AND does NOT close the browser — TASK-015 owns BOTH `process.on('SIGINT', ...)` AND `browserSession.close()`. Per-iteration loop checks `signal.aborted` between card discovery and DB writes; if aborted, the current iteration finishes, the page is closed via `browserSession.closePage(page)`, `updateSearchStatus({ finalStatus: 'cancelled' })` is called, and the orchestrator returns the partial outcome. | §29.3, AGENTS.md §5 |
| 13 | Typed errors | `LinkedInAccessBlockedError` (exit `ExitCode.LinkedInBlocked = 4`), `LinkedInExpectedPageError` (exit `ExitCode.Fatal = 1`), `OverlayUndismissableError` (exit 1), `NavigationTimeoutError` (exit 1), `LoadMoreLoopExhaustedError` (exit 1 — soft warning, search completes), `BrowserLaunchError` (exit 1), `BrowserCapacityExceededError` (exit 1 — defensive; should never fire in this task). All extend a shared `LinkedInScraperError` base. **Note**: the constant is `ExitCode.LinkedInBlocked` (not `LinkedInBlock`), confirmed at `src/errors/application-error.ts:6`. | §21.1, §21.5, AGENTS.md §10 |
| 14 | `LinkedInDiscoveryService` | Public API: `discover({ run, searchMatrixEntry, signal, onProgress? }) → Promise<SearchDiscoveryOutcome>`. The orchestrator (TASK-015) calls this once per matrix entry. Returns `{ jobsDiscovered, newJobs, existingJobs, errors, artifactIds, finalStatus }`. The service throws on unrecoverable conditions; per-card errors are recorded in `discoveryErrors` (returned in the outcome, not thrown). | §21, §22.12 |
| 15 | Fixture harness | Unit tests use `linkedom` (`parseHTML(html)` from `linkedom/extended`) for parser/selector logic; integration tests use Playwright + `context.route()` interception serving saved HTML from `tests/linkedin/fixtures/*.html` (no live network). Saved fixtures must be seeded by this task — no `.html` fixtures exist today. **DO NOT** use `page.setContent()` for HTTP-shape fidelity tests — use `context.route()` instead. | §41.3 |
| 16 | Playwright dependency | NEW direct dependency: `playwright` (NOT `@playwright/test` — we only need the library, no test runner; Vitest remains the test runner). **Confirmed not in `package.json` today**. Requires user approval per AGENTS.md §12 before `pnpm add playwright`. Plan includes `pnpm add playwright` + `pnpm exec playwright install chromium` as one-shot postinstall. `playwright-report/` and `test-results/` are already in `.gitignore`. **Vitest's `@vitest/browser-playwright` peer (NOT installed) is dev-only and out of scope.** | AGENTS.md §3, §12 |
| 16b | Capture-strategy stub replacement (in place) | TASK-012 OWNS replacement of `src/diagnostics/capture/screenshot.ts` (currently stub — `capture/screenshot.ts:11` says "wired by TASK-012/13") AND `src/diagnostics/capture/playwright-trace.ts` (currently stub — `capture/playwright-trace.ts:11` says "wired by TASK-012"). TASK-012 MUST NOT touch `src/diagnostics/capture/html-snapshot.ts` — that is TASK-013 (`capture/html-snapshot.ts:11`). The replacements live **in place** in `src/diagnostics/capture/` (NOT under `src/linkedin/capture-strategies/` — YAGNI); they import Playwright TYPES only (`import type { Page, BrowserContext } from 'playwright'`); runtime Playwright values flow via the `BrowserSession` seam. `BrowserSession` itself remains the only runtime Playwright importer (via `src/linkedin/playwright-session.ts`). | TASK-005, AGENTS.md §12 |
| 16c | Transaction rule | `Repositories.transact(fn)` callback MUST be sync (`src/persistence/repositories/index.ts:54-58`). `recordDiscoveryEvent` and `recordDiscoveryError` are single INSERTs with NO internal transaction. For per-card atomicity use either `recordNewJob` (already atomic for jobs + event + attempt — `jobs.ts:170-241`) or `this.ctx.db.transaction((tx) => { ... })` mirroring the `createRunWithSearches` pattern at `pipeline-runs.ts:175-224`. The orchestrator wraps the per-card insert in a sync `this.ctx.db.transaction((tx) => { tx.insert(...).run(); })` when `recordNewJob` is not the right shape (e.g., when `recordDiscoveryEvent` is the only write). | AGENTS.md §4, §8 |
| 16d | Boundaries allow-list | New `tests/linkedin/boundaries.test.ts` MUST extend both the `BANNED_IMPORTS` exception and the "allow-list contains exactly these entries" assertion (mirror `tests/init/boundaries.test.ts:34-37, 134-140`). The Playwright-bound allow-list set MUST contain exactly: `src/linkedin/browser-session.ts` (Playwright type imports — `Page`, `Browser`, `BrowserContext`, `Route`, `Request`), `src/linkedin/playwright-session.ts` (runtime Playwright), `src/linkedin/fake-session.ts` (test helper), `src/diagnostics/capture/screenshot.ts` (replaced stub — Playwright types only), `src/diagnostics/capture/playwright-trace.ts` (replaced stub — Playwright types only). Adding/removing entries requires updating the allow-list assertion in lock-step. | AGENTS.md §5 |
| 16e | No schema change | `OperationalConfigSchema` is `.strict()` (`src/config/schema.ts:96-106`) and rejects unknown keys. The plan MUST NOT add new config fields (e.g. no `scraper.screenshot: boolean`); reuse the existing `diagnostics.onScraperError.{screenshot,playwrightTrace}` flags (already wired through `DiagnosticManager.recordScraperError` — `diagnostics/manager.ts:88-96`). | AGENTS.md §12 |
| 16f | `tests/live/` does not exist yet | `vitest.live.config.ts:1-8` already includes `tests/live/**/*.test.ts` with `passWithNoTests: true`. The plan must (a) create the directory with `.gitkeep`, (b) seed at least one placeholder live test guarded by `process.env['LINKEDIN_LIVE'] === '1'` (or `describe.skip`) so `pnpm test:live` is not empty in CI. | §41.3 |
| 17 | No new schema/migration | All tables used (`searchExecutions`, `jobs`, `discoveryEvents`, `discoveryErrors`, `diagnosticArtifacts`) already exist (`persistence/schema.ts:246, 275, 304, 332, 501`). No DDL changes. | AGENTS.md §12 |
| 18 | No CLI command | TASK-012 has no top-level CLI subcommand. The `LinkedInDiscoveryService` is invoked by TASK-015's pipeline orchestrator (`jobhunter run`). Thin CLI integration is NOT part of this task (matches "thin CLI handlers, no service is wired without an orchestrator" precedent — `src/init/cli-adapters.ts:1-50`). | AGENTS.md §5, §10 |
| 19 | Live LinkedIn tests | Live tests stay opt-in via `vitest.live.config.ts` (already configured). The new live test file is NOT included in `pnpm test`; only `pnpm test:live` runs it. CI matrix runs `pnpm test` + `pnpm typecheck` + `pnpm lint` + `pnpm format:check`. | §41.3 |
| 20 | Boundaries guard | New `tests/linkedin/boundaries.test.ts` mirroring `tests/init/boundaries.test.ts`: enumerates `src/linkedin/**/*.ts`, bans runtime imports of `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`; ALLOWS `playwright` (because the scraper owns it); ALLOWS `pino` only as type import in `src/linkedin/log.ts`. Bans `process.exit(...)` in domain. Reuses `RUNTIME_IMPORT_RE` and `PROCESS_EXIT_RE` regexes from `tests/init/boundaries.test.ts:50, 57`. | AGENTS.md §5 |
| 21 | Logging | `LinkedInScraperLogger` interface (`src/linkedin/log.ts`) with methods: `searchStart({ searchId })`, `searchComplete({ searchId, jobsDiscovered })`, `searchFail({ searchId, errorCode })`, `searchCancel({ searchId })`, `cardDiscovered({ searchId, sourceJobId, isNew })`, `cardSkip({ searchId, sourceJobId, reason })`, `cardError({ searchId, errorCode })`. Domain uses the `Logger` facade from `src/logging/logger.ts`; the inquirer/pino adapter stays at the boundary (mirrors `src/init/log.ts:42-56` `pinoInitLogger`). | AGENTS.md §5, §10 |
| 22 | Exit-code mapping (final) | 0 = search completed (even if some cards failed — exit code is decided by TASK-015 over the aggregate run); 1 = unrecoverable browser / navigation error (`LinkedInExpectedPageError`, `NavigationTimeoutError`, `BrowserLaunchError`, `OverlayUndismissableError` when the search cannot continue); 4 = access blocked (`LinkedInAccessBlockedError`). The service throws typed errors — never calls `process.exit`. CLI boundary (TASK-015) maps via `exitWithError` (`src/cli.ts:134-146`) reading `error.exitCode`. | §21.1, AGENTS.md §10 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0` (`package.json:7, 9`). No new LLM provider, job source, UI framework, hosted service, or authentication system. One new direct dependency: `playwright` (Decision 16) — requires user approval before `pnpm add`.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"` (`tsconfig.json:3-4`). Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables` (`tsconfig.json:6-8`). No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach` (AGENTS.md §4).
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/linkedin/` — except the Playwright-bound modules on the explicit allow-list (Decision 16d) — **must not** import Commander, Inquirer, Drizzle directly, the `openai` SDK, or Pino directly. The `LinkedInScraperLogger` interface is the seam; `src/linkedin/discovery-service.ts` takes the logger via constructor injection. `src/linkedin/state.ts`, `src/linkedin/card-id.ts`, `src/linkedin/selectors.ts`, `src/linkedin/overlay.ts`, `src/linkedin/load-more.ts` are pure (no Playwright / Drizzle / Pino).
- **Browser / Inquirer isolation:** The `BrowserSession` interface (`src/linkedin/browser-session.ts`) is the seam. `PlaywrightBrowserSession` is the only Playwright-importing real implementation; tests inject `FakeBrowserSession`. The CLI never imports `@inquirer/prompts` from `linkedin` (there is no CLI surface in this task).
- **Validation:** Zod at every external boundary. `OperationalConfigSchema` is the canonical config validator (TASK-002). Persisted row JSON columns (`jobs.availableMetadata`, `discoveryErrors.artifactRefs`) are revalidated via `Repositories.jobs.recordDiscoveryEvent` / `recordDiscoveryError` directly (no new schema). The `LINKEDIN_DISCOVERY_SCHEMA_VERSION` constant is the only new constant added by this task; it is `1`.
- **Errors:** Typed errors extending `ApplicationError`. The `LinkedInScraperError` family lives in `src/linkedin/errors.ts`. Exit-code mapping follows Decision 13 + Decision 22. The orchestrator throws typed errors for unrecoverable per-search conditions (`LinkedInAccessBlockedError`, `LinkedInExpectedPageError`, `NavigationTimeoutError`, `BrowserLaunchError`, `OverlayUndismissableError`); per-card errors are surfaced as `SearchDiscoveryOutcome.errors` and written to `discoveryErrors`. The orchestrator DOES throw `LoadMoreLoopExhaustedError` as a soft warning (caller may catch and treat as success — TASK-015 decides).
- **History preservation (AGENTS.md §6):** Discovery never deletes, resets, or supersedes historical search executions, jobs, or discovery events. New jobs are inserted via `Repositories.jobs.recordNewJob`; re-discoveries are inserted as `discoveryEvents` with `isNew=false`. The orchestrator never deletes from `searchExecutions` or `discoveryErrors`.
- **Determinism:** The pure helpers (`state.ts`, `card-id.ts`, `selectors.ts`) are pure functions of their inputs. The `FakeBrowserSession` makes HTTP-shape fidelity tests deterministic by serving saved HTML from `tests/linkedin/fixtures/*.html`. `parseCardJobId` is a pure function of `(element, document)`.
- **Tests:** Vitest. Pure-card-id tests use `linkedom` + saved HTML fixtures. Browser-session integration tests use Vitest + Playwright + `context.route()` interception against the same fixtures. DB-integration tests use `mkdtempSync` + `createDatabaseConnection` + `runMigrations` + `createRepositories` (`tests/init/init-service.test.ts:176-185`). The `FakeBrowserSession` replaces live Chromium in unit/integration tests. Live tests are guarded by `process.env['LINKEDIN_LIVE']` and run via `pnpm test:live`. No live OpenAI.
- **JSON output discipline (AGENTS.md §10):** TASK-012 has no CLI subcommand and no JSON output contract; `SearchDiscoveryOutcome` is the in-process typed result. TASK-015 will own the run-level JSON output.
- **No secrets:** The orchestrator never logs `OPENAI_API_KEY`, prompt transcripts, raw OpenAI responses, LinkedIn session cookies (anonymous context — none exist), or raw card HTML beyond the redacted snapshot already produced by `DiagnosticManager.recordScraperError` (`diagnostics/manager.ts:104-108`). Card metadata in `discoveryErrors.availableMetadata` is truncated to ≤ 2 KiB and redacted via `Redactor` (`src/diagnostics/redactor.ts`) before persistence.

## Reconciler facts (from `.slim/deepwork/task-012-linkedin-discovery-result-loading.md`)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and are not re-litigated in this plan.

- **`PlaywrightBrowserSession` owns Playwright at runtime.** Only `src/linkedin/playwright-session.ts` imports `playwright` at runtime. The two capture strategies (`src/diagnostics/capture/screenshot.ts` + `src/diagnostics/capture/playwright-trace.ts`) and `src/linkedin/browser-session.ts` import Playwright TYPES only; runtime values flow via the `BrowserSession` seam (Decision 16b).
- **Two capture-strategy stubs REPLACED in this task:** `src/diagnostics/capture/screenshot.ts` and `src/diagnostics/capture/playwright-trace.ts` (both currently throw `MissingBrowserImplementationError` at `capture/screenshot.ts:9-13` / `capture/playwright-trace.ts:9-13`). TASK-012 replaces them with real Playwright-backed implementations. The third stub `src/diagnostics/capture/html-snapshot.ts` (`capture/html-snapshot.ts:9-13`) is TASK-013's — DO NOT touch.
- **`OperationalConfigSchema` is `.strict()`** (`src/config/schema.ts:96-106`). Reuse `diagnostics.onScraperError.{screenshot,playwrightTrace}` instead (`diagnostics/manager.ts:88-96`).
- **Per-card atomicity rule:** `recordDiscoveryEvent` and `recordDiscoveryError` are single INSERTs with no internal transaction. Wrap per-card writes in `this.ctx.db.transaction(...)` OR use `Repositories.jobs.recordNewJob` (`jobs.ts:170-241`, atomic) OR the `createRunWithSearches` pattern (`pipeline-runs.ts:175-224`).
- **`Repositories.transact` callback MUST be sync.** `better-sqlite3` rejects Promise returns (`src/persistence/repositories/index.ts:54-58`).
- **`ExitCode.LinkedInBlocked`** (exact spelling — not `LinkedInBlock`) — `src/errors/application-error.ts:6`.
- **`tests/live/` does not exist yet.** Plan creates it (`vitest.live.config.ts:1-8` already includes `tests/live/**/*.test.ts` with `passWithNoTests: true`).
- **`DiagnosticScope` already supports `searchExecutionId` and `discoveryErrorId`** (`src/diagnostics/filename.ts:3-9`). No extension needed.
- **No HTML fixtures exist.** Plan creates `tests/linkedin/fixtures/*.html` (basic, no-results, with-modal).
- **Boundaries test encodes the allow-list exactly** (`tests/init/boundaries.test.ts:34-37, 134-140`). The "allow-list contains exactly these entries" assertion is the runtime guard.
- **`SearchDiscoveryOutcome`** carries `jobsDiscovered`, `newJobs`, `existingJobs`, `errors`, `artifactIds`, `finalStatus: SearchExecutionStatus`. `SearchExecutionStatus` enum: `pending | running | completed | failed | cancelled` (`src/persistence/schema.ts:259-261`).
- **Browser lifecycle is TASK-015's, not TASK-012's.** SPEC §21.2 requires one browser context per run. TASK-015's orchestrator calls `browserSession.launch()` once at run start and `browserSession.close()` once at run end. TASK-012's `discover()` receives an already-launched `BrowserSession` and only manages per-search page lifecycle: `openPage(url)` → per-search body → `closePage(page)`. The outer `browserSession.close()` lives in TASK-015's run-level try/finally.

## File Structure

```text
src/linkedin/
  state.ts                              # NEW: SearchDiscoveryOutcome, DiscoveredCard, OverlayDescriptor, BrowserCapacity, etc. (Task 1)
  errors.ts                             # NEW: LinkedInScraperError family (Decision 13) (Task 2)
  selectors.ts                          # NEW: centralized LinkedIn selector map (Decision 15 input #3) (Task 3)
  card-id.ts                            # NEW: parseCardJobId(element, document) → string | null (Decision 6) (Task 4)
  overlay.ts                            # NEW: OverlayDetector + dismissOverlay (Decision 5) (Task 5)
  load-more.ts                          # NEW: bounded no-progress loop (Decision 8) (Task 6)
  navigation.ts                         # NEW: navigateWithTimeout(page, url, ms) → NavigationResult (Task 9 — Minor Finding #3)
  truncate-metadata.ts                  # NEW: truncateAvailableMetadata(meta) → ≤ 2 KiB string (Task 9 — Minor Finding #4)
  browser-session.ts                    # NEW: BrowserSession interface (Task 7; includes openFallbackPage per Minor Finding #1)
  playwright-session.ts                 # NEW: PlaywrightBrowserSession real impl — only runtime Playwright importer (Task 7)
  fake-session.ts                       # NEW: FakeBrowserSession test helper (Task 7)
  discovery-service.ts                  # NEW: LinkedInDiscoveryService orchestrator (Task 9; owns per-page lifecycle only — browser launch/close is TASK-015's)
  log.ts                                # NEW: LinkedInScraperLogger + pino adapter (Task 10)
  index.ts                              # NEW: public barrel (Task 11)
src/diagnostics/capture/
  screenshot.ts                         # REPLACED in place (Task 8 — Playwright types only)
  playwright-trace.ts                   # REPLACED in place (Task 8 — Playwright types only; renamed to LinkedInPlaywrightTraceCapture, re-exported as PlaywrightTraceCapture via capture/index.ts for backward compatibility)
  index.ts                              # UNCHANGED structure; re-exports the new classes via a thin shim (Task 8 — Oracle Decision #3)
tests/linkedin/
  helpers/
    playwright-route-session.ts         # NEW: real Playwright + context.route() against saved HTML fixtures (Task 9 setup — Minor Finding #2)
  fixtures/
    search-results-basic.html           # NEW: 5 cards, "See more jobs" control (Task 12)
    search-results-no-results.html      # NEW: empty result page (Task 12)
    search-results-with-modal.html      # NEW: recoverable login-modal overlay (Task 12)
    loadFixture.ts                      # NEW: helper returning parsed HTML (Task 12)
  state.test.ts                         # NEW: structural assertions on the pure types (Task 1)
  errors.test.ts                        # NEW: each LinkedInScraperError subclass's exitCode + code (Task 2)
  selectors.test.ts                     # NEW: structural assertions on the centralised selector map (Task 3)
  card-id.test.ts                       # NEW: pure parseCardJobId via linkedom (Task 4)
  overlay.test.ts                       # NEW: unit + integration (Task 5)
  load-more.test.ts                     # NEW: unit + integration (Task 6)
  navigation.test.ts                    # NEW: navigateWithTimeout returns documented NavigationResult (Task 9)
  truncate-metadata.test.ts             # NEW: truncateAvailableMetadata caps at 2 KiB (Task 9)
  browser-session.test.ts               # NEW: FakeBrowserSession + PlaywrightBrowserSession lifecycle (Task 7)
  capture-strategies.test.ts            # NEW: screenshot + playwright-trace capture (Task 8 — exercises the replaced stubs in src/diagnostics/capture/)
  discovery-service.test.ts             # NEW: full integration with PlaywrightRouteSession + real DB (Task 9)
  log.test.ts                           # NEW: pinoLinkedInScraperLogger structured-log shape (Task 10)
  boundaries.test.ts                    # NEW: tree-walk guard mirroring tests/init/boundaries.test.ts (Task 11; allow-list includes browser-session.ts per Decision 16d)
tests/live/
  .gitkeep                              # NEW (Task 13)
  linkedin.test.ts                      # NEW: placeholder live test guarded by LINKEDIN_LIVE env var (Task 13)
README.md                               # MODIFIED (Task 14 — Oracle Decision #2: one-line maintenance note about fixture refresh + Chromium binary install)
```

Files change together by responsibility. The pure helpers (`state.ts`, `errors.ts`, `selectors.ts`, `card-id.ts`, `overlay.ts`, `load-more.ts`, `navigation.ts`, `truncate-metadata.ts`) have no Drizzle, no Commander, no Inquirer, no OpenAI, no Pino imports, no Playwright imports. The orchestrator (`discovery-service.ts`) is the only layer that composes helpers + browser seam + repositories + diagnostic manager. `browser-session.ts` imports Playwright TYPES only; `playwright-session.ts` is the only runtime Playwright importer; `fake-session.ts` is a test helper with no Playwright import. The capture strategies live in `src/diagnostics/capture/` (replaced in place — no `src/linkedin/capture-strategies/` subtree).

### ASCII dependency diagram

```text
                            ┌────────────────────────────────────┐
                            │         TASK-015 (future)          │
                            │   Pipeline orchestrator + CLI      │
                            │   (`jobhunter run`)                │
                            └──────────────┬─────────────────────┘
                                           │ calls (one per matrix entry)
                                           ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │             src/linkedin/index.ts (barrel)                      │
    └────┬───────────┬───────────┬───────────────┬──────────────────┬─┘
         │           │           │               │                  │
         ▼           ▼           ▼               ▼                  ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ ┌────────────────┐
   │discovery-│ │ state.ts │ │ errors.ts│ │ browser-session│ │ navigation.ts  │
   │service.ts│ │ (types)  │ │ (typed)  │ │ (interface,    │ │ truncate-      │
   │ (orch.)  │ │          │ │          │ │ Playwright     │ │ metadata.ts    │
   │          │ │          │ │          │ │ types only)    │ │ (pure helpers) │
   └────┬─────┘ └────┬─────┘ └──────────┘ └────────┬───────┘ └────────────────┘
        │            │                             │
        │            │                             ▼
        │            │                  ┌────────────────────┐
        │            │                  │ playwright-session │
        │            │                  │ .ts (only runtime  │
        │            │                  │ Playwright import) │
        │            │                  └────────────────────┘
        │            │                  ┌────────────────────┐
        │            │                  │ fake-session.ts    │
        │            │                  │ (test helper, no  │
        │            │                  │ Playwright import) │
        │            │                  └────────────────────┘
        │            │
        │            │ composes (via existing barrels, no direct imports of
        │            │ Commander / Drizzle / Pino / OpenAI / Inquirer):
        ▼            ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │   src/persistence/repositories/{pipelineRuns, jobs, diagnostics}   │
    │   src/diagnostics/{manager, redactor, filename, capture/{screenshot,playwright-trace,html-snapshot}} │
    │   src/config/{schema, loader}                                      │
    │   src/search/{matrix, url-builder}                                 │
    │   src/errors/application-error.ts                                  │
    │   src/logging/logger.ts (via LinkedInScraperLogger adapter)        │
    └────────────────────────────────────────────────────────────────────┘
```

The arrows above are conceptual — `discovery-service.ts` imports repositories and the diagnostic manager through their existing barrels (`src/persistence/repositories/index.js`, `src/diagnostics/index.js`) and never reaches into their internals. The `LinkedInScraperLogger` adapter (`src/linkedin/log.ts`) wraps a `Logger` from `src/logging/logger.ts`; the orchestrator itself never imports `pino`. The replaced capture strategies at `src/diagnostics/capture/screenshot.ts` and `src/diagnostics/capture/playwright-trace.ts` import Playwright TYPES only (`Page`, `BrowserContext`); runtime values flow via the `BrowserSession` seam — the capture strategies receive a `getPage()` / `getContext()` callback wired by the orchestrator from `BrowserSession`. `browser-session.ts` imports Playwright TYPES only (`Page`, `Browser`, `BrowserContext`, `Route`, `Request`); only `playwright-session.ts` imports `playwright` at runtime.

---

### Task 1: `state.ts` — `SearchDiscoveryOutcome`, `DiscoveredCard`, `OverlayDescriptor`, `BrowserCapacity`

**Files:**
- Create: `src/linkedin/state.ts`
- Create: `tests/linkedin/state.test.ts` (TypeScript-only structural assertion)

**Goal:** Establish the pure state vocabulary that drives every other module under `src/linkedin/`. `LINKEDIN_DISCOVERY_SCHEMA_VERSION = 1` is the only new constant. The orchestrator's return shape (`SearchDiscoveryOutcome`) is consumed by TASK-015; the per-card and per-overlay shapes (`DiscoveredCard`, `OverlayDescriptor`) are consumed by the orchestrator + tests.

**`state.ts`:**

```ts
/**
 * State vocabulary for TASK-012 — LinkedIn result discovery.
 *
 * The shapes below are the typed contract between `discovery-service.ts`
 * and TASK-015's pipeline orchestrator. They are pure TypeScript types
 * (no runtime values), so this file has no side effects and no imports
 * beyond the type imports.
 */
import type { SearchExecutionStatus } from '../persistence/repositories/pipeline-runs.js';

export const LINKEDIN_DISCOVERY_SCHEMA_VERSION = 1 as const;
export type LinkedinDiscoverySchemaVersion = typeof LINKEDIN_DISCOVERY_SCHEMA_VERSION;

/** LinkedIn URL host + path validation (must be `https://www.linkedin.com/jobs/search/`). */
export const LINKEDIN_JOBS_SEARCH_HOST = 'www.linkedin.com';
export const LINKEDIN_JOBS_SEARCH_PATH = '/jobs/search/';

/** A single discovered job card on a search-results page. */
export interface DiscoveredCard {
  /** LinkedIn numeric job ID (canonical source identifier). */
  readonly sourceJobId: string;
  /** 1-based position of the card on the page (top-to-bottom). */
  readonly cardPosition: number;
  /** 0-based index in the DOM list. */
  readonly cardIndex: number;
  /** Optional metadata extracted from the card (title, company, location snippet). */
  readonly availableMetadata: Readonly<Record<string, string>> | null;
}

/** A visible overlay descriptor (selector + dismissal strategy). */
export interface OverlayDescriptor {
  /** Playwright selector that resolves to the overlay's close button or container. */
  readonly selector: string;
  /** Which dismissal strategy applies (close / escape / outside-click / accept / reject). */
  readonly strategy: 'close' | 'escape' | 'outside_click' | 'accept' | 'reject';
  /** Human-readable label for diagnostics. */
  readonly label: string;
}

/** Browser capacity contract (Decision 9). One fallback page at a time. */
export interface BrowserCapacity {
  readonly activePages: number;
  readonly maxConcurrentPages: 1; // single fallback page at a time
}

/**
 * Top-level result returned by `LinkedInDiscoveryService.discover(...)`.
 * Consumed by TASK-015's orchestrator. The orchestrator (TASK-015) maps
 * this into `searchExecutions` + `discoveryEvents` + `discoveryErrors`
 * via `Repositories.pipelineRuns.updateSearchStatus` and the per-card
 * insert path.
 */
export interface SearchDiscoveryOutcome {
  readonly schemaVersion: LinkedinDiscoverySchemaVersion;
  /** LinkedIn-side numeric ID of the search execution row (TASK-015 owns the row). */
  readonly searchExecutionId: number;
  /** Final status to apply to `searchExecutions.finalStatus`. */
  readonly finalStatus: SearchExecutionStatus;
  /** Total distinct job IDs discovered on the page (after dedup). */
  readonly jobsDiscovered: number;
  /** Number of new jobs (not previously in `jobs` table). */
  readonly newJobs: number;
  /** Number of re-discovered jobs (already in `jobs` table). */
  readonly existingJobs: number;
  /** Per-card errors written to `discoveryErrors` (TASK-012 owns the rows; TASK-015 surfaces them). */
  readonly errors: readonly {
    readonly cardPosition: number | null;
    readonly cardIndex: number | null;
    readonly errorCode: string;
    readonly diagnosticMessage: string;
    readonly discoveryErrorId: number;
  }[];
  /** Diagnostic artifact IDs produced during the search (from `DiagnosticManager.recordScraperError`). */
  readonly artifactIds: readonly number[];
}
```

**Tests (`tests/linkedin/state.test.ts`):**
- `LINKEDIN_DISCOVERY_SCHEMA_VERSION === 1`.
- `SearchDiscoveryOutcome` is a readonly interface with the documented fields.
- `DiscoveredCard` requires `sourceJobId`, `cardPosition`, `cardIndex`; `availableMetadata` may be null.
- `OverlayDescriptor.strategy` is the documented union.
- `BrowserCapacity.maxConcurrentPages === 1`.
- Structural compilation assertions only (no runtime fixtures yet — these types are consumed by every other task).

**Verification:**
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.
- The boundaries test added in Task 11 asserts no banned imports once `state.ts` is in place.

---

### Task 2: `errors.ts` — `LinkedInScraperError` family

**Files:**
- Create: `src/linkedin/errors.ts`
- Create: `tests/linkedin/errors.test.ts`
- Extend: `tests/linkedin/boundaries.test.ts` (skeleton — finalised in Task 11)

**Goal:** Typed error family extending `ApplicationError`. Every error pins a specific exit code so the CLI boundary (TASK-015) needs no `instanceof` cascade. Per-card errors are NOT represented here — they live in `SearchDiscoveryOutcome.errors` and on the `discoveryErrors` table.

**`errors.ts`:**

```ts
import {
  ApplicationError,
  type ApplicationErrorMetadata,
  type ExitCodeValue,
  ExitCode,
} from '../errors/application-error.js';

/**
 * Base class for every error raised by `LinkedInDiscoveryService`. Subclasses
 * pin a specific exit code so the CLI boundary (TASK-015) needs no
 * `instanceof` cascade. Per-card errors are NOT represented here — they
 * live on `SearchDiscoveryOutcome.errors[]` and on the `discoveryErrors`
 * table.
 */
export class LinkedInScraperError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    exitCode: ExitCodeValue,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, exitCode, metadata, cause);
  }
}

/** LinkedIn blocked anonymous access (auth wall, captcha, region block). Exit `LinkedInBlocked = 4`. */
export class LinkedInAccessBlockedError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'linkedin_access_blocked',
      'LinkedIn blocked anonymous access to the search page.',
      ExitCode.LinkedInBlocked,
      metadata,
      cause,
    );
  }
}

// The remaining six subclasses follow the same constructor shape. Their
// (code, message, exitCode) triples are listed in the table below; each
// is a 6-line constructor that delegates to `super(code, message, exitCode, metadata, cause)`.
```

| Subclass | `code` | Exit code |
|---|---|---|
| `LinkedInExpectedPageError` | `linkedin_expected_page_missing` | `ExitCode.Fatal` (1) |
| `NavigationTimeoutError` | `navigation_timeout` | `ExitCode.Fatal` (1) |
| `OverlayUndismissableError` | `overlay_undismissable` | `ExitCode.Fatal` (1) |
| `LoadMoreLoopExhaustedError` | `load_more_loop_exhausted` | `ExitCode.Fatal` (1, soft warning — TASK-015 may treat as success) |
| `BrowserLaunchError` | `browser_launch_failed` | `ExitCode.Fatal` (1) |
| `BrowserCapacityExceededError` | `browser_capacity_exceeded` | `ExitCode.Fatal` (1, defensive — should never fire in TASK-012) |
```

**Tests (`tests/linkedin/errors.test.ts`):**
- Each subclass maps to the documented `exitCode` and `code`.
- `toJSON()` returns the documented shape with `cause` populated when supplied.
- `LinkedInScraperError` itself extends `ApplicationError`.
- `LinkedInAccessBlockedError.exitCode === ExitCode.LinkedInBlocked` (the constant is `LinkedInBlocked`, NOT `LinkedInBlock` — `src/errors/application-error.ts:6`).

**Verification:**
- `pnpm test tests/linkedin/errors.test.ts tests/linkedin/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 3: `selectors.ts` — centralized LinkedIn selector map

**Files:**
- Create: `src/linkedin/selectors.ts`
- Create: `tests/linkedin/selectors.test.ts` (TypeScript-only structural assertion)

**Goal:** Single source of truth for every Playwright CSS / role / test-id selector the scraper uses. Centralised so a LinkedIn DOM change is a one-file update, with per-failure diagnostics pointing at the failing selector. This file is PURE (no Playwright import — selectors are just strings). The file is consumed by `overlay.ts` (Task 5), `load-more.ts` (Task 6), and `discovery-service.ts` (Task 9). The orchestrator's `recordScraperError` calls include `metadata: { selector: <failing selector> }` so the diagnostic message identifies the breakage.

**`selectors.ts` (sketch — exact selectors are refined during integration tests):**

```ts
/**
 * Centralised LinkedIn selector map. Pure data — no Playwright import.
 * Replace selectors here when LinkedIn DOM changes; the
 * `recordScraperError` calls in the orchestrator surface the failing
 * selector via `metadata.selector` so the diagnostic message identifies
 * the breakage.
 *
 * Selector naming convention: `<feature>.<element>` (e.g.
 * `cards.listItem`, `loadMore.button`, `overlays.loginModal`).
 */
export const LINKEDIN_SELECTORS = {
  cards: {
    listItem: 'li.jobs-search-results__list-item',
    listItemAlt: 'div.job-search-card', // alt selector for lazy-rendered variants
    anchor: 'a[href*="/jobs/view/"]',
  },
  loadMore: {
    button: 'button.infinite-scroller__show-more-button',
    sentinel: 'div.infinite-scroller__page-end',
  },
  endOfResults: {
    noResults: 'p.artdeco-empty-state__message',
    explicitEnd: 'div.jobs-search-no-results',
  },
  overlays: {
    loginModal: 'div[data-modal="login"]',
    joinModal: 'div[data-modal="join"]',
    cookieConsent: 'div#artdeco-global-alert-container',
    genericModal: 'div[data-test-modal-container]',
    closeButton: 'button[aria-label="Dismiss"]',
  },
} as const;

export type LinkedinSelectorKey = keyof typeof LINKEDIN_SELECTORS;
```

**Tests (`tests/linkedin/selectors.test.ts`):**
- `LINKEDIN_SELECTORS` is a frozen-as-const object.
- Every group has at least one selector (cards, loadMore, endOfResults, overlays).
- The orchestrator-level `metadata.selector` is one of the documented keys (tested via `discovery-service.test.ts` in Task 9).

**Verification:**
- `pnpm test tests/linkedin/selectors.test.ts` — all green.
- `pnpm typecheck` — exit 0.

---

### Task 4: `card-id.ts` — `parseCardJobId(element, document) → string | null`

**Files:**
- Create: `src/linkedin/card-id.ts`
- Create: `tests/linkedin/card-id.test.ts` (unit via linkedom)

**Goal:** Pure function that extracts the canonical LinkedIn job ID from a card element. Three sources accepted in priority order (Decision 6): (a) `data-occludable-job-id` attribute on the anchor, (b) `data-job-id` attribute, (c) `<a href="/jobs/view/<digits>">` regex parse. Returns `null` when none found (the orchestrator writes a `discoveryError` row for these).

**`card-id.ts`:**

```ts
import type * as Linkedom from 'linkedom/extended';

/**
 * Extract the canonical LinkedIn job ID from a card element.
 *
 * Accepts three sources in priority order:
 *   1. `data-occludable-job-id` attribute on the anchor element (most stable).
 *   2. `data-job-id` attribute on the anchor element.
 *   3. `<a href="/jobs/view/<digits>">` regex parse on the anchor's href.
 *
 * Returns `null` when none found — the orchestrator writes a
 * `discoveryErrors` row for these.
 *
 * The function is PURE: it takes a `LinkedomElement` and a `LinkedomDocument`
 * and returns `string | null`. It has no side effects, no I/O, no network.
 */
export function parseCardJobId(element: unknown, _document: unknown): string | null {
  // Implementation is decided during integration testing. The signature
  // and the three priority sources are pinned. The function does NOT
  // touch Playwright — the orchestrator passes `page.locator(...).elementHandle()`
  // → DOM tree via `evaluate(el => el.outerHTML)` → linkedom parse.
  // See `tests/linkedin/card-id.test.ts` for the expected parse outcomes.
  void element;
  void _document;
  throw new Error('parseCardJobId: implemented in Task 4 integration');
}
```

> **Implementation note for the implementing agent:** the real implementation is ~30 lines. Use the `linkedom/extended` types in the signature. Iterate the element's `attributes` to find `data-occludable-job-id` (highest priority), then `data-job-id`. Fall back to a regex `\d{6,}` over the anchor's `href`. The function never throws — it returns `null` on every failure path (missing element, missing attributes, no anchor, regex no-match).

**Tests (`tests/linkedin/card-id.test.ts`):**
- `parseCardJobId` returns `null` for an element with no anchor and no `data-occludable-job-id`.
- Returns the `data-occludable-job-id` value when present.
- Returns the `data-job-id` value when `data-occludable-job-id` is absent.
- Falls back to the regex-extracted ID from the `href` when both attributes are absent.
- Rejects the regex match if the href does not contain `/jobs/view/<digits>` (sanity check — anchors elsewhere on the page should not be mis-parsed).
- Strips non-digit characters and validates the ID is ≥ 6 digits (LinkedIn job IDs are 6–10 digits).

**Verification:**
- `pnpm test tests/linkedin/card-id.test.ts` — all green.
- `pnpm typecheck` — exit 0.

---

### Task 5: `overlay.ts` — `OverlayDetector.detect(page)` + `dismissOverlay(page, descriptor)`

**Files:**
- Create: `src/linkedin/overlay.ts`
- Create: `tests/linkedin/overlay.test.ts` (unit via linkedom + integration via Playwright + FakeBrowserSession)

**Goal:** Two pure-PageObject-style functions that work over a Playwright `Page` and the `OverlayDescriptor` shape from `state.ts`. Pure on the input (no I/O outside Playwright). The detector reads `LINKEDIN_SELECTORS.overlays` and the dismisser applies ONE strategy (close, Escape, outside-click, accept, reject) bounded by `overlayDismissalMs`. If the overlay is still visible after dismissal → throw `OverlayUndismissableError`.

**`overlay.ts`:**

```ts
import type { Page } from 'playwright';
import type { OverlayDescriptor } from './state.js';
import { LINKEDIN_SELECTORS } from './selectors.js';
import { OverlayUndismissableError } from './errors.js';

export interface OverlayDetectionOptions {
  readonly overlayDismissalMs: number;
}

/** Detect all currently-visible overlays on the page. Pure read; no side effects. */
export async function detectOverlays(
  page: Page,
  _opts: OverlayDetectionOptions,
): Promise<readonly OverlayDescriptor[]> {
  void _opts;
  // Implementation iterates LINKEDIN_SELECTORS.overlays groups and returns
  // the descriptors whose selectors resolve to a visible element.
  throw new Error('detectOverlays: implemented in Task 5 integration');
}

/** Dismiss a single overlay with the strategy encoded in its descriptor.
 *  Throws `OverlayUndismissableError` if still visible after the bounded wait. */
export async function dismissOverlay(
  page: Page,
  descriptor: OverlayDescriptor,
  opts: OverlayDetectionOptions,
): Promise<void> {
  void page;
  void descriptor;
  void opts;
  throw new Error('dismissOverlay: implemented in Task 5 integration');
}
```

> **Implementation note:** The detector returns a `readonly OverlayDescriptor[]` ordered by z-index / DOM depth (topmost first). The dismisser applies the strategy, then waits `state: 'hidden'` on the descriptor's selector with `timeout: opts.overlayDismissalMs`. If the wait throws, the orchestrator catches `playwright.TimeoutError` and throws `OverlayUndismissableError` with `metadata: { selector, strategy, overlayDismissalMs }`. The orchestrator's `recordScraperError` includes the same metadata so the diagnostic message identifies the failing selector.

**Tests (`tests/linkedin/overlay.test.ts`):**
- `detectOverlays` returns an empty array on the basic fixture (no overlays).
- Returns 1 descriptor on the with-modal fixture (login modal).
- The login modal descriptor has `strategy: 'close'` (default for `loginModal`).
- `dismissOverlay` resolves without throwing on the with-modal fixture (FakeBrowserSession serves HTML that hides the modal when `selector` is clicked).
- `dismissOverlay` throws `OverlayUndismissableError` when the modal stays visible after `overlayDismissalMs`.
- `detectOverlays` is read-only (asserted via `page.on('console')` not seeing any error logs).

**Verification:**
- `pnpm test tests/linkedin/overlay.test.ts` — all green.
- `pnpm typecheck` — exit 0.

---

### Task 6: `load-more.ts` — bounded no-progress loop

**Files:**
- Create: `src/linkedin/load-more.ts`
- Create: `tests/linkedin/load-more.test.ts` (unit via linkedom + integration via Playwright + FakeBrowserSession)

**Goal:** A `discoverAllCards(page, opts) → Promise<readonly DiscoveredCard[]>` function that iterates the bounded load-more loop (Decision 8). Iterates up to `4 × maxNoProgressAttempts + 5` times; counts current cards each iteration; if count + IDs are unchanged, increments the no-progress counter; else resets. Stops on explicit end-of-results element, noProgress ≥ `maxNoProgressAttempts`, "See more jobs" control absent, or no DOM change after a `waitForTimeout(initialResultsMs / 4)`. Throws `LoadMoreLoopExhaustedError` ONLY when the loop hits the no-progress budget AND the page still has more "load-more" controls to click (i.e., a real bug); otherwise returns the discovered set and lets the orchestrator decide whether to surface a warning.

**`load-more.ts`:**

```ts
import type { Page } from 'playwright';
import type { DiscoveredCard } from './state.js';
import { LINKEDIN_SELECTORS } from './selectors.js';
import { parseCardJobId } from './card-id.js';
import { LoadMoreLoopExhaustedError } from './errors.js';

export interface LoadMoreOptions {
  readonly initialResultsMs: number;
  readonly maxNoProgressAttempts: number;
  readonly now?: () => Date;
}

/** Bounded load-more loop. Returns the discovered card set (deduped within the loop). */
export async function discoverAllCards(
  page: Page,
  opts: LoadMoreOptions,
): Promise<readonly DiscoveredCard[]> {
  void page;
  void opts;
  throw new Error('discoverAllCards: implemented in Task 6 integration');
}
```

> **Implementation note:** The loop maintains a `Map<string, CardIdLocation>` keyed by `sourceJobId`. Each iteration:
>   1. Read `await page.locator(LINKEDIN_SELECTORS.cards.listItem).all()`.
>   2. For each element, call `parseCardJobId` and record into the map.
>   3. If the new map size + new IDs match the previous iteration's snapshot, increment `noProgress`. Else reset and store the snapshot.
>   4. If `noProgress >= maxNoProgressAttempts`, break (the orchestrator decides whether to throw `LoadMoreLoopExhaustedError` based on whether the page still has more controls).
>   5. Otherwise check for the "See more jobs" button; if absent, break. If present, click it (bounded by `initialResultsMs`) and continue.
>   6. Also break when the "no results" element is visible (single result case) or the explicit end-of-results element is visible.

**Tests (`tests/linkedin/load-more.test.ts`):**
- Basic fixture (5 cards, no "See more" button): `discoverAllCards` returns 5 cards in 1 iteration.
- Fixture with 5 cards + working "See more" → FakeBrowserSession serves a second batch after click → 10 cards total in 2 iterations.
- Fixture with 5 cards + non-functional "See more" (click → DOM unchanged) → loop hits `noProgress >= maxNoProgressAttempts` → returns 5 cards AND `LoadMoreLoopExhaustedError` metadata (the orchestrator decides throw vs. warn).
- No-results fixture → returns 0 cards, no error.
- Mixed-ID iteration (same IDs reappear): map dedups by `sourceJobId` (first-seen position wins).

**Verification:**
- `pnpm test tests/linkedin/load-more.test.ts` — all green.
- `pnpm typecheck` — exit 0.

---

### Task 7: `browser-session.ts` + `playwright-session.ts` + `fake-session.ts`

**Files:**
- Create: `src/linkedin/browser-session.ts`
- Create: `src/linkedin/playwright-session.ts`
- Create: `src/linkedin/fake-session.ts`
- Create: `tests/linkedin/browser-session.test.ts`

**Goal:** Browser seam. `BrowserSession` is the interface; `PlaywrightBrowserSession` is the real implementation (the only file that imports `playwright` at runtime — Decision 16b); `FakeBrowserSession` is the test helper for pure unit tests. All three follow the same interface:

```ts
export interface BrowserSession {
  /** Launch one Chromium instance + create one fresh unauthenticated context.
   *  OWNED BY TASK-015, NOT BY THE ORCHESTRATOR (SPEC §21.2). */
  launch(): Promise<{ context: BrowserContext; browser: Browser }>;
  /** Close the browser process + context. OWNED BY TASK-015. */
  close(): Promise<void>;
  /** Open a page in the active context (per-search page). */
  openPage(url: string): Promise<Page>;
  /** Close the per-search page. The orchestrator's per-search try/finally
   *  calls this — it does NOT call `close()`. */
  closePage(page: Page): Promise<void>;
  /** Forward-compat hook for TASK-013's dedicated-page fallback (SPEC §22.7).
   *  Throws `BrowserCapacityExceededError` if a fallback is already open. */
  openFallbackPage(url: string): Promise<Page>;
  /** Forward-compat hook for TASK-013's dedicated-page fallback. */
  closeFallbackPage(page: Page): Promise<void>;
  /** Register a `context.route()` interceptor (used by integration tests). */
  withRoute(
    page: Page,
    pattern: string | RegExp,
    handler: (route: Route, request: Request) => Promise<void> | void,
  ): Promise<void>;
}
```

`PlaywrightBrowserSession.launch()`:
- Calls `chromium.launch({ headless: true })` (NO `chromium.launchPersistentContext` — anonymous context).
- Creates `browser.newContext()` (fresh, no cookies).
- Tracks `activePages: number`; `openPage` calls `context.newPage()` and increments; `closePage` decrements after `page.close()`. `openFallbackPage` reuses `openPage` but enforces the single-active-fallback invariant by checking a separate `activeFallbackPages` counter.

`FakeBrowserSession.launch()`:
- Returns a stub `{ context, browser }` where `context` is a linkedom-backed fake (NOT Playwright). For pure unit tests of `BrowserSession` itself, the fake just returns a stub. **Note:** integration tests that need real HTTP routing use `tests/linkedin/helpers/playwright-route-session.ts` (Minor Finding #2), which is a separate helper that wraps a real Playwright Chromium with `context.route()` interception against the saved fixtures. `FakeBrowserSession` is kept minimal — it does NOT reimplement Playwright.

`withRoute(page, pattern, handler)`:
- Real: `await page.route(pattern, handler)`.
- Fake: stores the route definition for assertion; the integration helper in Task 9 reads it.

**Tests (`tests/linkedin/browser-session.test.ts`):**
- `FakeBrowserSession.launch()` returns a `{ context, browser }` pair (stub).
- `FakeBrowserSession.openPage(url)` returns a stub Page; `activePages` increments.
- `FakeBrowserSession.closePage()` decrements without throwing on a previously-closed page (defensive).
- `FakeBrowserSession.openFallbackPage()` throws `BrowserCapacityExceededError` on the second invocation while a fallback is already open.
- `FakeBrowserSession.withRoute()` records the route definition (asserted via `.routes` property).
- Real `PlaywrightBrowserSession.launch()` followed by `openPage(url)` followed by `close()` closes the browser without leaking handles (asserted by `chromium-server` registry).

**Verification:**
- `pnpm test tests/linkedin/browser-session.test.ts` — all green.
- `pnpm typecheck` — exit 0.

> **Prerequisite:** `pnpm add playwright` (Task 14) MUST run BEFORE this task's `pnpm typecheck` — the `BrowserSession` interface imports Playwright types (`Page`, `Browser`, `BrowserContext`, `Route`, `Request`). See Task 14's "Sequencing prerequisite" note.

---

### Task 8: Capture-strategy stub replacement (in place; no subtree)

**Files:**
- Modify: `src/diagnostics/capture/screenshot.ts` (replace stub in place)
- Modify: `src/diagnostics/capture/playwright-trace.ts` (replace stub in place; rename export to `LinkedInPlaywrightTraceCapture`, re-exported via `src/diagnostics/capture/index.ts` shim)
- Modify: `src/diagnostics/capture/index.ts` (update re-export to preserve backward-compatible `PlaywrightTraceCapture` name)
- Create: `tests/linkedin/capture-strategies.test.ts`

**Goal:** Replace the two stubs at `src/diagnostics/capture/screenshot.ts` and `src/diagnostics/capture/playwright-trace.ts` (both throw `MissingBrowserImplementationError` today) with real Playwright-backed implementations. **DO NOT touch `src/diagnostics/capture/html-snapshot.ts`** — TASK-013 owns it. The replacements live **in place** under `src/diagnostics/capture/` (no `src/linkedin/capture-strategies/` subtree — YAGNI; Playwright types-only imports satisfy the architectural rationale).

**`src/diagnostics/capture/screenshot.ts` (NEW — replaces stub at line 11):**

```ts
import type { Page } from 'playwright';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export interface ScreenshotCaptureDeps {
  /** Get the active page from the active session (DI-injected for tests). */
  readonly getPage: () => Page | undefined;
}

export class ScreenshotCapture implements CaptureStrategy {
  readonly artifactType = 'screenshot' as const;
  constructor(private readonly deps: ScreenshotCaptureDeps) {}
  async capture(_context: CaptureContext): Promise<CaptureResult> {
    void _context;
    const page = this.deps.getPage();
    if (page === undefined) {
      throw new Error('ScreenshotCapture: no active page');
    }
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    return {
      artifactType: 'screenshot',
      extension: 'png',
      mimeType: 'image/png',
      contents: buffer,
    };
  }
}
```

**`src/diagnostics/capture/playwright-trace.ts` (NEW — replaces stub at line 11):**

```ts
import type { BrowserContext } from 'playwright';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export interface PlaywrightTraceCaptureDeps {
  readonly getContext: () => BrowserContext | undefined;
  /** Where to write the trace zip. The orchestrator wires this to
   *  `paths.diagnostics.directory + '/traces'`. */
  readonly traceDirectory: string;
}

/** Named `LinkedInPlaywrightTraceCapture` to avoid collision with
 *  the `PlaywrightTraceCapture` shim in `capture/index.ts`. The
 *  re-export at `capture/index.ts:5` preserves the legacy public name. */
export class LinkedInPlaywrightTraceCapture implements CaptureStrategy {
  readonly artifactType = 'playwright_trace' as const;
  constructor(private readonly deps: PlaywrightTraceCaptureDeps) {}
  async capture(_context: CaptureContext): Promise<CaptureResult> {
    void _context;
    const context = this.deps.getContext();
    if (context === undefined) {
      throw new Error('LinkedInPlaywrightTraceCapture: no active context');
    }
    const tracePath = `${this.deps.traceDirectory}/${context.pages()[0]?.url() ?? 'unknown'}-${Date.now()}.zip`;
    await context.tracing.stop({ path: tracePath });
    return {
      artifactType: 'playwright_trace',
      extension: 'zip',
      mimeType: 'application/zip',
      contents: await import('node:fs/promises').then((fs) => fs.readFile(tracePath)),
    };
  }
}
```

**`src/diagnostics/capture/index.ts` (MODIFIED — add re-export shim):**

```ts
export type { CaptureArtifactType, CaptureContext, CaptureResult, CaptureStrategy } from './types.js';
export { StackTraceCapture } from './stack-trace.js';
export { CurrentUrlCapture } from './current-url.js';
export { ScreenshotCapture } from './screenshot.js';
// Backward-compatible re-export: legacy public name preserved.
export { LinkedInPlaywrightTraceCapture as PlaywrightTraceCapture } from './playwright-trace.js';
export { HtmlSnapshotCapture } from './html-snapshot.js';
```

**Constructor-time wiring (replaces the `registerLinkedInScraperStrategies` helper):**

The orchestrator / TASK-015 constructs `DiagnosticManager` with the strategies already wired (Required Finding #4 — no `unknown`-cast mutation). The `DiagnosticManager` constructor (`src/diagnostics/manager.ts:75-86`) already accepts `strategies: Partial<Record<CaptureArtifactType, CaptureStrategy>>` at construction. TASK-015 (or the orchestrator's setup code) passes:

```ts
new DiagnosticManager({
  config: operationalConfig.diagnostics.onScraperError,
  paths,
  repositories,
  strategies: {
    current_url: new CurrentUrlCapture(),
    stack_trace: new StackTraceCapture(),
    screenshot: new ScreenshotCapture({ getPage: () => currentPage }),
    playwright_trace: new LinkedInPlaywrightTraceCapture({
      getContext: () => currentContext,
      traceDirectory: join(paths.diagnostics.directory, 'traces'),
    }),
  },
  redactor: new Redactor(),
});
```

No `registerLinkedInScraperStrategies` helper is exported from `src/linkedin/` (Required Finding #3 — YAGNI). The boundary `index.ts` re-exports the capture strategies for completeness but does NOT expose a mutation helper.

> **Backward-compat note:** the existing `src/diagnostics/manager.ts:80-83` default `strategies` map is unchanged — `{ current_url: CurrentUrlCapture, stack_trace: StackTraceCapture }`. The orchestrator's constructor-time override merges the four `screenshot` + `playwright_trace` strategies without altering the defaults. This preserves the existing behaviour for callers that do NOT wire scraper strategies.

**Tests (`tests/linkedin/capture-strategies.test.ts`):**
- `ScreenshotCapture.capture()` returns a valid PNG buffer from the test page.
- `LinkedInPlaywrightTraceCapture.capture()` produces a non-empty `.zip` file.
- Throws when `getPage()` / `getContext()` returns `undefined`.
- The orchestrator's `DiagnosticManager` (constructed with the four strategies) records `screenshot` + `playwright_trace` artifact types when `recordScraperError` runs with `config.screenshot === true` and `config.playwrightTrace === true`.
- `src/diagnostics/capture/index.ts` re-exports `PlaywrightTraceCapture` (backward-compat) and the new class is also accessible as `LinkedInPlaywrightTraceCapture`.

**Verification:**
- `pnpm test tests/linkedin/capture-strategies.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

> **Prerequisite:** `pnpm add playwright` (Task 14) MUST run BEFORE this task's `pnpm typecheck` — the two replacement files import Playwright types (`Page`, `BrowserContext`). See Task 14's "Sequencing prerequisite" note.

---

### Task 9: `discovery-service.ts` — `LinkedInDiscoveryService` (the orchestrator) + `navigation.ts` + `truncate-metadata.ts`

**Files:**
- Create: `src/linkedin/navigation.ts` (Minor Finding #3 — `navigateWithTimeout` declaration)
- Create: `src/linkedin/truncate-metadata.ts` (Minor Finding #4 — `truncateAvailableMetadata` helper)
- Create: `src/linkedin/discovery-service.ts`
- Create: `tests/linkedin/navigation.test.ts`
- Create: `tests/linkedin/truncate-metadata.test.ts`
- Create: `tests/linkedin/discovery-service.test.ts` (full integration; uses `tests/linkedin/helpers/playwright-route-session.ts`)
- Extend: `tests/linkedin/boundaries.test.ts` (orchestrator-specific assertions)

**Goal:** The orchestrator that composes every helper from Tasks 1–8 + the existing `Repositories` / `DiagnosticManager` surface. NEVER re-implements repository logic. NEVER calls `process.exit`. NEVER calls Playwright directly (it goes through `BrowserSession`). NEVER calls `browserSession.launch()` / `browserSession.close()` — TASK-015 owns the run-level browser lifecycle (SPEC §21.2 — Required Finding #1). Per-card errors are returned in `SearchDiscoveryOutcome.errors` (not thrown). The orchestrator DOES throw typed `LinkedInScraperError` subclasses for unrecoverable per-search conditions.

**`src/linkedin/navigation.ts` (NEW — Minor Finding #3):**

```ts
import type { Page } from 'playwright';

export type NavigationResult =
  | { readonly ok: true; readonly status: number | null }
  | { readonly ok: false; readonly reason: 'timeout' | 'blocked' | 'unexpected' };

export interface NavigateWithTimeoutOptions {
  readonly navigationMs: number;
  readonly expectedHost: string; // 'www.linkedin.com' (LINKEDIN_JOBS_SEARCH_HOST)
  readonly expectedPath: string; // '/jobs/search/' (LINKEDIN_JOBS_SEARCH_PATH)
}

/**
 * Navigate to the search URL with a bounded timeout. Returns the
 * documented `NavigationResult` discriminated union. On success, the
 * caller validates the expected page DOM. On failure, the orchestrator
 * maps the reason to the typed `LinkedInScraperError` subclass.
 *
 * This helper is the ONLY entry point for navigation in TASK-012 — it
 * enforces the bounded-timeout contract (SPEC §21.6) and the post-
 * navigation URL host validation. It does NOT touch the filesystem,
 * repositories, or the diagnostic manager.
 */
export async function navigateWithTimeout(
  page: Page,
  url: string,
  opts: NavigateWithTimeoutOptions,
): Promise<NavigationResult> {
  void page;
  void url;
  void opts;
  throw new Error('navigateWithTimeout: implemented in Task 9 integration');
}
```

> **Implementation note:** `navigateWithTimeout` wraps `page.goto(url, { timeout: opts.navigationMs, waitUntil: 'domcontentloaded' })`. On `playwright.TimeoutError`, returns `{ ok: false, reason: 'timeout' }`. On redirect to a non-LinkedIn host (auth wall, captcha), returns `{ ok: false, reason: 'blocked' }`. On any other navigation failure, returns `{ ok: false, reason: 'unexpected' }`. The URL host check uses `new URL(page.url()).hostname === opts.expectedHost && .pathname.startsWith(opts.expectedPath)`.

**`src/linkedin/truncate-metadata.ts` (NEW — Minor Finding #4):**

```ts
import { Redactor } from '../diagnostics/redactor.js';

/** 2 KiB cap on `discoveryErrors.availableMetadata` per Task 9. */
export const AVAILABLE_METADATA_MAX_BYTES = 2048;

/**
 * Truncate available card metadata to ≤ 2 KiB (UTF-8) and redact
 * secret-like values via `Redactor` (`src/diagnostics/redactor.ts`).
 *
 * Called by the orchestrator BEFORE writing to `discoveryErrors` (the
 * metadata is persisted alongside per-card errors; the orchestrator NEVER
 * persists raw HTML — this is the card title / company / location
 * snippet).
 *
 * Truncation strategy: stringify the metadata as JSON, redact, then
 * if `Buffer.byteLength` > `AVAILABLE_METADATA_MAX_BYTES`, drop the
 * longest string values one at a time until the cap is satisfied;
 * preserve keys in deterministic order. Returns `null` if the result
 * is empty after redaction.
 */
export function truncateAvailableMetadata(
  metadata: Readonly<Record<string, string>> | null,
  redactor: Redactor,
): Readonly<Record<string, string>> | null {
  void metadata;
  void redactor;
  throw new Error('truncateAvailableMetadata: implemented in Task 9 integration');
}
```

**`discovery-service.ts` (sketch):**

```ts
import type { Repositories } from '../persistence/repositories/index.js';
import type { SearchMatrixEntry } from '../search/matrix.js';
import type { DiagnosticManager } from '../diagnostics/manager.js';

import type { BrowserSession } from './browser-session.js';
import type {
  DiscoveredCard,
  SearchDiscoveryOutcome,
} from './state.js';
import { LINKEDIN_JOBS_SEARCH_HOST, LINKEDIN_JOBS_SEARCH_PATH } from './state.js';
import {
  LinkedInAccessBlockedError,
  LinkedInExpectedPageError,
  LoadMoreLoopExhaustedError,
  NavigationTimeoutError,
  OverlayUndismissableError,
} from './errors.js';
import { detectOverlays, dismissOverlay } from './overlay.js';
import { discoverAllCards } from './load-more.js';
import { navigateWithTimeout } from './navigation.js';
import { truncateAvailableMetadata } from './truncate-metadata.js';
import type { LinkedInScraperLogger } from './log.js';
import { noopLinkedInScraperLogger } from './log.js';

export interface DiscoveryServiceOptions {
  readonly browserSession: BrowserSession;       // ALREADY LAUNCHED — owned by TASK-015
  readonly repositories: Repositories;
  readonly diagnosticManager: DiagnosticManager;
  readonly logger: LinkedInScraperLogger;
  readonly redactor: Redactor;
  readonly config: {
    readonly timeouts: {
      readonly navigationMs: number;
      readonly initialResultsMs: number;
      readonly overlayDismissalMs: number;
    };
    readonly maxNoProgressAttempts: number;
  };
  readonly now?: () => Date;
}

export interface DiscoverInput {
  readonly run: { readonly id: number };
  readonly searchMatrixEntry: SearchMatrixEntry;
  readonly searchExecutionId: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: { readonly type: 'card' | 'complete'; readonly count?: number }) => void;
}

export class LinkedInDiscoveryService {
  private readonly options: DiscoveryServiceOptions;

  constructor(options: DiscoveryServiceOptions) {
    this.options = options;
  }

  /**
   * Execute the per-search sequence (SPEC §21.3):
   *   1. openPage(search URL)
   *   2. navigateWithTimeout → validate URL host
   *   3. validate expected page DOM
   *   4. detectOverlays + dismissOverlay
   *   5. discoverAllCards → dedup + persist
   *   6. updateSearchStatus({ finalStatus })
   *
   * Browser launch/close is TASK-015's responsibility. The orchestrator
   * only manages per-search page lifecycle: openPage + closePage.
   * Throws typed `LinkedInScraperError` for unrecoverable conditions.
   * Returns `SearchDiscoveryOutcome` on success / cancellation / per-card errors.
   */
  async discover(input: DiscoverInput): Promise<SearchDiscoveryOutcome> {
    void input;
    throw new Error('LinkedInDiscoveryService.discover: implemented in Task 9 integration');
  }
}
```

> **Implementation note:** The full implementation walks the 6-step sequence from SPEC §21.3, with per-card dedup via `Repositories.jobs.findBySourceJobId` (`jobs.ts:243-247`) and per-card persistence via `Repositories.jobs.recordNewJob` (atomic) or a sync `this.ctx.db.transaction` wrap of `recordDiscoveryEvent` + `recordDiscoveryError` per Decision 16c. On `AbortSignal.aborted`, the orchestrator calls `Repositories.pipelineRuns.updateSearchStatus({ finalStatus: 'cancelled' })` (`pipeline-runs.ts:293-308`), closes the per-search page, and returns the partial outcome (Decision 12). The orchestrator NEVER calls `browserSession.close()` — TASK-015 does. On every typed `LinkedInScraperError`, the orchestrator calls `DiagnosticManager.recordScraperError` (`diagnostics/manager.ts:98-137`) BEFORE closing the page (so the screenshot + current-url artifacts are captured against the live page). Per-card errors: the orchestrator passes `availableMetadata` through `truncateAvailableMetadata` (`< 2 KiB` + redaction via `Redactor`) BEFORE writing to `discoveryErrors` (`jobs.ts:311`). `currentExtractionState: 'failed'` is a placeholder; TASK-013 (`docs/tasks/TASK-013-job-detail-extraction-persistence.md`) promotes it to `'complete'` or `'partial'` via `Repositories.jobs.updateExtraction` (`jobs.ts:255`).

**Walk semantics (per-task-pseudocode for the implementing agent — Required Finding #1):**

```text
discover(input):
  # NO browserSession.launch() — TASK-015 already launched it.
  page = browserSession.openPage(input.searchMatrixEntry.generatedUrl)
  try:
    # 1. Navigate with bounded timeout (declared in src/linkedin/navigation.ts)
    nav = await navigateWithTimeout(page, url, {
      navigationMs: config.timeouts.navigationMs,
      expectedHost: LINKEDIN_JOBS_SEARCH_HOST,       # 'www.linkedin.com'
      expectedPath: LINKEDIN_JOBS_SEARCH_PATH,       # '/jobs/search/'
    })
    if !nav.ok:
      if nav.reason === 'timeout':  throw new NavigationTimeoutError({ url, ms: config.timeouts.navigationMs })
      if nav.reason === 'blocked':  throw new LinkedInAccessBlockedError({ url })  # exit 4
      throw new LinkedInExpectedPageError({ url, reason: nav.reason })

    # 2. Validate expected page (cards list OR no-results sentinel)
    if !has_cards_or_no_results(page): throw new LinkedInExpectedPageError({ url, reason: 'expected_dom_missing' })

    # 3. Detect + dismiss recoverable overlays
    for descriptor in await detectOverlays(page, { overlayDismissalMs: config.timeouts.overlayDismissalMs }):
      await dismissOverlay(page, descriptor, { overlayDismissalMs: config.timeouts.overlayDismissalMs })

    # 4. Discover all cards (bounded load-more loop)
    cards = await discoverAllCards(page, { initialResultsMs: config.timeouts.initialResultsMs,
                                          maxNoProgressAttempts: config.maxNoProgressAttempts })

    # 5. Per-card dedup + persistence (truncateAvailableMetadata applied to no-ID cards via recordDiscoveryError)
    newJobs = 0; existingJobs = 0; errors = []
    for card in cards:
      if signal.aborted: break
      existing = await repositories.jobs.findBySourceJobId(card.sourceJobId)
      if existing !== null:
        existingJobs++
        await repositories.jobs.recordDiscoveryEvent({ /* isNew:false, skipReason:'already_known' */ })
        continue
      # atomic: jobs + discoveryEvents in one tx (currentExtractionState='failed' — TASK-013 promotes)
      await repositories.jobs.recordNewJob({ /* ... see recordNewJob at jobs.ts:170-241 */ })
      newJobs++

    # 6. Finalize search execution
    finalStatus = signal.aborted ? 'cancelled' : 'completed'
    await repositories.pipelineRuns.updateSearchStatus(input.searchExecutionId, { finalStatus, ... })
    return { schemaVersion: 1, searchExecutionId, finalStatus, jobsDiscovered: cards.length, newJobs, existingJobs, errors, artifactIds: [] }
  finally:
    # Per-search page lifecycle only — NOT browser close (TASK-015 owns browser close).
    await browserSession.closePage(page)
```

**Tests (`tests/linkedin/discovery-service.test.ts`):**
- End-to-end: use `tests/linkedin/helpers/playwright-route-session.ts` (a real Playwright Chromium with `context.route()` interception serving `search-results-basic.html`); run `discover()`; assert `jobsDiscovered === 5`, `newJobs === 5`, `existingJobs === 0`, `finalStatus === 'completed'`.
- Dedup: pre-seed a job with `sourceJobId: '12345'`; re-discover; assert `existingJobs === 1`, `newJobs === 0`, `isNew=false` on the recorded event.
- No-results: route the search URL to `search-results-no-results.html`; assert `jobsDiscovered === 0`, `finalStatus === 'completed'`, no errors thrown.
- Overlay: route the search URL to `search-results-with-modal.html`; assert `OverlayDescriptor` for `loginModal` is detected, dismissed, and the search continues normally.
- Undismissable overlay: route to HTML where the modal stays visible; assert `OverlayUndismissableError` thrown with `metadata.selector === LINKEDIN_SELECTORS.overlays.loginModal`.
- Access blocked: route to a redirect to a non-LinkedIn host; assert `LinkedInAccessBlockedError` thrown with `exitCode === ExitCode.LinkedInBlocked` (4).
- Expected page missing: route to a 404; assert `LinkedInExpectedPageError` thrown with `exitCode === ExitCode.Fatal` (1).
- Cancellation: `signal.aborted = true` between two cards; assert `finalStatus === 'cancelled'`, `closePage(page)` was called, and the recorded `searchExecutions` row has `finalStatus = 'cancelled'`. **Browser is NOT closed by the orchestrator** (asserted via `browserSession.close === spy` that was never invoked).
- Cleanup on every exit path: assert `browserSession.closePage(page)` was called in each of the above scenarios. **NOT `browserSession.close()`.**
- Sequential: run `discover()` twice in series (no overlap); assert both complete.
- Single active page: `browserSession.openPage()` is called at most once per `discover()` invocation (TASK-012 only needs one page; the fallback capacity hook is forward-compat for TASK-013 and never invoked in TASK-012).
- Timeout config: pass `config.timeouts.navigationMs: 1` and assert `NavigationTimeoutError` (the page never has time to load).
- No HTML persistence: assert no `html_snapshot` artifact is written during any test.
- Truncate helper integration: for a no-ID card, `discoveryErrors.availableMetadata` is `<= 2048` bytes and `apiKey`-like strings are redacted to `[REDACTED…]`.

**Tests (`tests/linkedin/navigation.test.ts`):**
- `navigateWithTimeout` returns `{ ok: true, status: 200 }` on a successful navigation.
- Returns `{ ok: false, reason: 'timeout' }` when the page exceeds `navigationMs`.
- Returns `{ ok: false, reason: 'blocked' }` when redirected to a non-LinkedIn host.
- Returns `{ ok: false, reason: 'unexpected' }` on other navigation failures.

**Tests (`tests/linkedin/truncate-metadata.test.ts`):**
- `truncateAvailableMetadata({ title: 'Engineer' }, redactor)` returns `{ title: 'Engineer' }`.
- Caps at 2048 bytes for a 5 KiB input — drops longest values first.
- Replaces `apiKey`-like strings with `[REDACTED…]` via `Redactor`.
- Returns `null` if all values are redacted to empty.

**Boundaries test extension (`tests/linkedin/boundaries.test.ts`):**
- Scan every `.ts` file under `src/linkedin/**`. Assert no import of `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`. ALLOW `playwright` for files in the Playwright allow-list (Decision 16d — five entries). ALLOW `pino` only as type-only import in `src/linkedin/log.ts`.
- Add a dedicated assertion for `src/linkedin/discovery-service.ts` (mirrors the `src/init/init-service.ts` assertion at `tests/init/boundaries.test.ts:160-180`).
- Add a dedicated assertion that `src/linkedin/discovery-service.ts` does NOT import `process` directly.

**Verification:**
- `pnpm test tests/linkedin/discovery-service.test.ts tests/linkedin/navigation.test.ts tests/linkedin/truncate-metadata.test.ts tests/linkedin/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

> **Prerequisite:** `pnpm add playwright` (Task 14) MUST run BEFORE this task's `pnpm typecheck` — `navigation.ts`, `discovery-service.ts`, and the `tests/linkedin/helpers/playwright-route-session.ts` helper all import Playwright types (`Page`, `Browser`, `BrowserContext`, `Route`, `Request`). See Task 14's "Sequencing prerequisite" note.

---

### Task 10: `log.ts` — `LinkedInScraperLogger` interface + adapters

**Files:**
- Create: `src/linkedin/log.ts`
- Create: `tests/linkedin/log.test.ts`

**Goal:** Pino seam for the discovery orchestrator. Mirrors `src/init/log.ts:42-56`. `noopLinkedInScraperLogger` is the default for unit tests; `pinoLinkedInScraperLogger(logger)` wraps a `Logger` from `src/logging/logger.ts` and emits structured logs (`component: 'linkedin_scraper'`, `event`, `searchId`, `errorCode` when applicable). The orchestrator NEVER imports `pino` directly.

**`log.ts`:**

```ts
import type { Logger as CodebaseLogger } from '../logging/logger.js';
import type { SearchExecutionStatus } from '../persistence/repositories/pipeline-runs.js';

/**
 * Structured-log seam for the LinkedIn discovery orchestrator. Mirrors
 * `src/init/log.ts:12-21`. Every method emits one event with a
 * `component: 'linkedin_scraper'` context, the `searchId`, and an
 * optional `errorCode`. The orchestrator NEVER imports `pino`
 * directly; it only sees the `LinkedInScraperLogger` interface.
 */
export interface LinkedInScraperLogger {
  searchStart(input: { readonly searchId: number; readonly url: string }): void;
  searchComplete(input: { readonly searchId: number; readonly jobsDiscovered: number }): void;
  searchFail(input: { readonly searchId: number; readonly errorCode: string; readonly message: string }): void;
  searchCancel(input: { readonly searchId: number }): void;
  cardDiscovered(input: { readonly searchId: number; readonly sourceJobId: string; readonly isNew: boolean }): void;
  cardSkip(input: { readonly searchId: number; readonly sourceJobId: string; readonly reason: string }): void;
  cardError(input: { readonly searchId: number; readonly errorCode: string; readonly message: string }): void;
  finalStatusApplied(input: { readonly searchId: number; readonly finalStatus: SearchExecutionStatus }): void;
}

export const noopLinkedInScraperLogger: LinkedInScraperLogger = {
  searchStart: () => undefined,
  searchComplete: () => undefined,
  searchFail: () => undefined,
  searchCancel: () => undefined,
  cardDiscovered: () => undefined,
  cardSkip: () => undefined,
  cardError: () => undefined,
  finalStatusApplied: () => undefined,
};

/**
 * Production adapter: wraps the codebase's `Logger` interface (`src/logging/logger.ts`)
 * and emits structured logs. The orchestrator NEVER imports `pino`
 * directly; it only sees the `LinkedInScraperLogger` interface.
 */
export function pinoLinkedInScraperLogger(logger: CodebaseLogger): LinkedInScraperLogger {
  return {
    searchStart: ({ searchId, url }) =>
      logger.info({ component: 'linkedin_scraper', event: 'search.start', searchId, url }, 'search started'),
    searchComplete: ({ searchId, jobsDiscovered }) =>
      logger.info({ component: 'linkedin_scraper', event: 'search.complete', searchId, jobsDiscovered }, 'search complete'),
    searchFail: ({ searchId, errorCode, message }) =>
      logger.warn({ component: 'linkedin_scraper', event: 'search.fail', searchId, errorCode }, message),
    searchCancel: ({ searchId }) =>
      logger.info({ component: 'linkedin_scraper', event: 'search.cancel', searchId }, 'search cancelled'),
    cardDiscovered: ({ searchId, sourceJobId, isNew }) =>
      logger.info({ component: 'linkedin_scraper', event: 'card.discovered', searchId, sourceJobId, isNew }, 'card discovered'),
    cardSkip: ({ searchId, sourceJobId, reason }) =>
      logger.info({ component: 'linkedin_scraper', event: 'card.skip', searchId, sourceJobId, reason }, 'card skipped'),
    cardError: ({ searchId, errorCode, message }) =>
      logger.warn({ component: 'linkedin_scraper', event: 'card.error', searchId, errorCode }, message),
    finalStatusApplied: ({ searchId, finalStatus }) =>
      logger.info({ component: 'linkedin_scraper', event: 'search.final_status', searchId, finalStatus }, 'final status applied'),
  };
}
```

**Tests (`tests/linkedin/log.test.ts`):**
- Assert `pinoLinkedInScraperLogger(logger)` emits structured logs with `component: 'linkedin_scraper'`, `event`, `searchId`, and optional `errorCode`. Use a fake `Logger` that records `info` / `warn` calls and assert the structured payload shape.
- Assert `noopLinkedInScraperLogger` is a no-op (returns `undefined` for every method).
- Assert `RUNTIME_IMPORT_RE.test("import type { Logger } from 'pino'")` returns `false` (cross-reference with Task 11's boundaries test).

**Verification:**
- `pnpm test tests/linkedin/log.test.ts tests/linkedin/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 11: `index.ts` — public barrel + boundaries test finalisation

**Files:**
- Create: `src/linkedin/index.ts`
- Extend: `tests/linkedin/boundaries.test.ts` (finalised; allow-list encoded with 5 Playwright entries)

**Goal:** Re-export every public symbol from `src/linkedin/`. The boundaries test mirrors `tests/init/boundaries.test.ts` exactly, including the "allow-list contains exactly these entries" assertion.

**`index.ts`:**

```ts
export {
  LINKEDIN_DISCOVERY_SCHEMA_VERSION,
  LINKEDIN_JOBS_SEARCH_HOST,
  LINKEDIN_JOBS_SEARCH_PATH,
  type LinkedinDiscoverySchemaVersion,
  type BrowserCapacity,
  type DiscoveredCard,
  type OverlayDescriptor,
  type SearchDiscoveryOutcome,
} from './state.js';

export {
  LinkedInScraperError,
  LinkedInAccessBlockedError,
  LinkedInExpectedPageError,
  NavigationTimeoutError,
  OverlayUndismissableError,
  LoadMoreLoopExhaustedError,
  BrowserLaunchError,
  BrowserCapacityExceededError,
} from './errors.js';

export { LINKEDIN_SELECTORS, type LinkedinSelectorKey } from './selectors.js';
export { parseCardJobId } from './card-id.js';
export { detectOverlays, dismissOverlay, type OverlayDetectionOptions } from './overlay.js';
export { discoverAllCards, type LoadMoreOptions } from './load-more.js';
export { navigateWithTimeout, type NavigateWithTimeoutOptions, type NavigationResult } from './navigation.js';
export { AVAILABLE_METADATA_MAX_BYTES, truncateAvailableMetadata } from './truncate-metadata.js';
export { type BrowserSession } from './browser-session.js';
export { PlaywrightBrowserSession } from './playwright-session.js';
export { FakeBrowserSession } from './fake-session.js';
export { LinkedInDiscoveryService, type DiscoveryServiceOptions, type DiscoverInput } from './discovery-service.js';
export { noopLinkedInScraperLogger, pinoLinkedInScraperLogger, type LinkedInScraperLogger } from './log.js';

// Re-export the capture strategies from src/diagnostics/capture/ for completeness.
// (No `registerLinkedInScraperStrategies` helper — Required Finding #4.)
export {
  ScreenshotCapture, type ScreenshotCaptureDeps,
  LinkedInPlaywrightTraceCapture, type PlaywrightTraceCaptureDeps,
} from '../diagnostics/capture/index.js';
```

**Boundaries test (`tests/linkedin/boundaries.test.ts`):**

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LINKEDIN_DIR = join(process.cwd(), 'src', 'linkedin');

const BANNED_IMPORTS = [
  'commander',
  '@inquirer/prompts',
  'drizzle-orm',
  'openai',
  // 'playwright' is ALLOWED for files in PLAYWRIGHT_ALLOW_LIST
  // 'pino' is ALLOWED only as type-only import in src/linkedin/log.ts
] as const;

// Required Finding #2: 5-entry Playwright allow-list (browser-session.ts added).
const PLAYWRIGHT_ALLOW_LIST: ReadonlySet<string> = new Set([
  'src/linkedin/browser-session.ts',                      // Playwright TYPES only
  'src/linkedin/playwright-session.ts',                   // runtime Playwright
  'src/linkedin/fake-session.ts',                         // test helper
  'src/diagnostics/capture/screenshot.ts',                // replaced stub (types only)
  'src/diagnostics/capture/playwright-trace.ts',          // replaced stub (types only)
]);

const PINO_TYPE_ONLY_ALLOW_LIST: ReadonlySet<string> = new Set([
  'src/linkedin/log.ts',
]);

const RUNTIME_IMPORT_RE = /^\s*import\s+(?!type\s)[^;]*['"]pino['"]/m;
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(/;

function listLinkedinSourceFiles(dir: string): string[] { /* ... mirrors tests/init/boundaries.test.ts:59-82 */ }
function importMatches(source: string, moduleName: string): boolean { /* ... */ }
function relativeFromCwd(absolute: string): string { /* ... */ }

describe('src/linkedin domain-boundary guard', () => {
  it('exists as a directory');
  it('every .ts file under src/linkedin/ avoids the banned imports (with carve-out)');
  // Required Finding #2: 5-entry Playwright allow-list encoded as a runtime assertion.
  it('encodes the playwright allow-list so browser-session.ts + playwright-session.ts + fake-session.ts + the two capture stubs remain legal');
  it('asserts the playwright allow-list contains EXACTLY these 5 entries (locks the file structure)');
  it('allows type-only `import type { ... } from "pino"` in src/linkedin/log.ts');
  it('RUNTIME_IMPORT_RE accepts `import type` and rejects runtime `pino` imports');
  it('explicitly scans src/linkedin/discovery-service.ts for banned imports');
  it('explicitly asserts src/linkedin/discovery-service.ts does NOT call process.exit');
});
```

**Verification:**
- `pnpm test tests/linkedin/` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

> **Prerequisite:** `pnpm add playwright` (Task 14) MUST run BEFORE this task's `pnpm typecheck` — the boundaries test enumerates files under `src/linkedin/` and validates Playwright type imports against the allow-list. See Task 14's "Sequencing prerequisite" note.

---

### Task 12: HTML fixtures + helper (`tests/linkedin/fixtures/`)

**Files:**
- Create: `tests/linkedin/fixtures/search-results-basic.html` (5 cards + "See more" absent)
- Create: `tests/linkedin/fixtures/search-results-no-results.html` (empty result page)
- Create: `tests/linkedin/fixtures/search-results-with-modal.html` (recoverable login modal)
- Create: `tests/linkedin/fixtures/loadFixture.ts` (helper returning parsed HTML)

**Goal:** Saved HTML fixtures for HTTP-shape fidelity tests (per Decision 15). The basic fixture has 5 cards with `data-occludable-job-id` attributes; the no-results fixture has the `artdeco-empty-state__message` element; the with-modal fixture overlays the `loginModal` selector that hides on click. **No raw job descriptions or PII** — only structural markup + minimal card metadata (title, company, location). The fixtures are versioned + trivially replaceable.

**`loadFixture.ts`:**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname);

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}
```

**Verification:**
- `pnpm test tests/linkedin/` — fixtures are loaded by `card-id.test.ts`, `overlay.test.ts`, `load-more.test.ts`, `discovery-service.test.ts`, and the `tests/linkedin/helpers/playwright-route-session.ts` helper introduced in Task 9.
- Visual sanity check (manual): each fixture renders the documented DOM shape via a browser preview.

---

### Task 13: Live tests placeholder (`tests/live/`)

**Files:**
- Create: `tests/live/.gitkeep`
- Create: `tests/live/linkedin.test.ts` (placeholder, opt-in)

**Goal:** Per Decision 16f, create the `tests/live/` directory (does not exist today) and seed at least one placeholder live test guarded by `process.env['LINKEDIN_LIVE'] === '1'`. The placeholder is skipped unless the env var is set, so `pnpm test:live` is not empty in CI but does not hit live LinkedIn by default.

**`tests/live/linkedin.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { LINKEDIN_JOBS_SEARCH_HOST } from '../../src/linkedin/state.js';

const ENABLED = process.env['LINKEDIN_LIVE'] === '1';

describe.skipIf(!ENABLED)('LinkedIn live discovery (opt-in)', () => {
  it('placeholder: verifies the configured host matches', () => {
    expect(LINKEDIN_JOBS_SEARCH_HOST).toBe('www.linkedin.com');
  });

  // Future live test: navigate to the search-results page with a real Chromium
  // and assert the `data-occludable-job-id` attribute is present on cards.
  // Skipped unless LINKEDIN_LIVE=1.
});
```

**Verification:**
- `pnpm test:live:list` lists at least `tests/live/linkedin.test.ts`.
- `pnpm test:live` runs the suite; without `LINKEDIN_LIVE=1` the suite is empty (or skipped) and exits 0.
- `pnpm test` does NOT include `tests/live/` (`vitest.config.ts` excludes it).

---

### Task 14: Final integration, documentation alignment, and verification

**Files:**
- Modify: `docs/tasks/TASK-012-linkedin-discovery-result-loading.md` (mark Implemented, record results)
- Modify: `docs/tasks/INDEX.md` (one-line status update)
- Modify: `package.json` (add `playwright` direct dependency + `postinstall` script — requires user approval)
- Modify: `README.md` (Oracle Decision #2 — one-line maintenance note about fixture refresh + Chromium binary install)

**Goal:** No public surface changes outside `src/linkedin/` and the two stub replacements. The pipeline orchestrator (TASK-015) consumes `LinkedInDiscoveryService` via the barrel (`src/linkedin/index.js`) — no `src/cli.ts` edits in this task. The task document records implementation results (commit hashes, verification output, test inventory, deviations, known limitations) and `INDEX.md` flips TASK-012 from `Planned` to `Implemented` with a one-line summary.

**Sequencing prerequisite (Minor Finding #6):** `pnpm add playwright` MUST run BEFORE Tasks 7, 8, 9, 10, and 11 can `pnpm typecheck` cleanly. The five Playwright-bound source files (`src/linkedin/browser-session.ts`, `src/linkedin/playwright-session.ts`, `src/diagnostics/capture/screenshot.ts`, `src/diagnostics/capture/playwright-trace.ts`, plus `src/linkedin/navigation.ts`) import Playwright types. The recommended implementation order is therefore:

1. **Stop and request user approval for `pnpm add playwright`** (Decision 16 + AGENTS.md §12).
2. **Once approved:** run `pnpm add playwright` and `pnpm exec playwright install chromium` BEFORE starting Task 7.
3. Tasks 7 → 8 → 9 → 10 → 11 → 12 → 13 may then proceed; each task's `pnpm typecheck` will succeed because `playwright` types are resolvable.
4. Task 14 finalises the `package.json` `postinstall` script + lockfile + the version pin decision (recorded in the implementation results).

> **Note:** if the user defers the `playwright` approval, the implementing agent must STOP and request approval before proceeding past Task 6. Tasks 7–11 cannot be typechecked without `playwright` installed (the import resolution will fail).

**Documentation updates:**
- Append an "Implementation results" section to `docs/tasks/TASK-012-linkedin-discovery-result-loading.md` (commit hashes, verification output, test inventory, deviations, known limitations).
- Add a row to `docs/tasks/INDEX.md` updating TASK-012 from `Planned` to `Implemented` with a one-line summary.
- Update `README.md` with: (a) Chromium binary install is a one-shot `pnpm exec playwright install chromium` postinstall (already wired via `package.json`'s `postinstall` script); (b) the saved HTML fixtures at `tests/linkedin/fixtures/*.html` need periodic refresh when LinkedIn changes its DOM — refresh by re-saving the fixture HTML in lock-step with selector updates in `src/linkedin/selectors.ts` (Oracle Decision #2).

**`package.json` change (requires user approval per AGENTS.md §12):**

```diff
   "dependencies": {
     "@inquirer/prompts": "8.5.2",
     "better-sqlite3": "13.0.3",
     "commander": "15.0.0",
     "drizzle-orm": "0.45.2",
     "openai": "7.4.0",
+    "playwright": "<version-from-librarian-recommendation>",
     "pdf-parse": "2.4.5",
     "pino": "10.3.1",
     "zod": "4.4.3"
   },
   ...
   "scripts": {
     ...
+    "postinstall": "playwright install chromium"
   }
```

> **Note:** the implementing agent must STOP and request user approval before running `pnpm add playwright`. The exact version is decided by the user (librarian input recommends the latest stable Playwright 1.5x.x — confirming the version is part of the user's approval).

**Verification (final, runs in CI):**
- `pnpm install --frozen-lockfile` → `Already up to date` (after `playwright` is added with approval).
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm format:check` → exit 0 (run `pnpm format` first if any new files need reformatting).
- `pnpm test` → all tests pass (existing baseline + new TASK-012 tests).
- `pnpm test:live:list` → lists at least `tests/live/linkedin.test.ts`.
- `pnpm test:live` → empty live suite (correct — TASK-012 has no live-runner consumer).
- `pnpm exec playwright install --dry-run` → verifies Chromium binary is present in CI.
- **Targeted boundary grep** (the implementing agent runs this in the shell, mirrors the `tests/linkedin/boundaries.test.ts` guarantee):
  ```bash
  rg -n --type ts "from 'commander'|@inquirer/prompts|drizzle-orm|from 'openai'|from 'pino'|process\.exit\(" src/linkedin/
  ```
  Expected output: zero matches (no runtime Pino import anywhere under `src/linkedin/`; the type-only Pino import in `src/linkedin/log.ts` is the only acceptable match, and the regex's `from 'pino'` literal will match — the agent confirms it is type-only). No `process.exit(` matches. If the boundary violation surfaces any unexpected match the implementing agent must stop and re-architect.

## Test strategy

The 7 expected test categories in `docs/tasks/TASK-012-linkedin-discovery-result-loading.md` §"Expected tests" map to the following files (the test categories themselves are mandated by SPEC §21 + §42 acceptance 23–24). Each file name mentions the category it covers.

| # | Expected test category (from TASK-012 §"Expected tests") | Test file |
|---|---|---|
| 1 | URL navigation, expected-page validation, access blocking, recoverable overlays, and bounded dismissal | `tests/linkedin/discovery-service.test.ts` (scenarios: basic, no-results, overlay, access-blocked, expected-page-missing, undismissable-overlay) + `tests/linkedin/overlay.test.ts` |
| 2 | Job-card ID parsing, duplicate ID suppression, no-ID discovery errors, and available metadata retention | `tests/linkedin/card-id.test.ts` (parseCardJobId priority order) + `tests/linkedin/discovery-service.test.ts` (dedup + no-ID scenario) |
| 3 | Each deterministic end-of-results condition and bounded no-progress behavior | `tests/linkedin/load-more.test.ts` (basic / with load-more / non-functional load-more / no-results / mixed-ID iteration) |
| 4 | Sequential search execution and single active panel/fallback capacity contract | `tests/linkedin/discovery-service.test.ts` (sequential scenario) + `tests/linkedin/browser-session.test.ts` (activePages invariant) |
| 5 | Timeout/retry configuration and typed error mapping (per Minor Finding #5: "bounded retries" in SPEC §40 are satisfied by the existing timeouts in `OperationalConfigSchema.scraper.timeouts` — no retry config field is added; SPEC §21.6 pins panel + dedicated-page attempts to 1, which the orchestrator respects via `navigateWithTimeout`'s single-shot contract) | `tests/linkedin/discovery-service.test.ts` (timeout scenario + every typed error's exitCode assertion) + `tests/linkedin/navigation.test.ts` (single-shot timeout contract) |
| 6 | Browser/page/context cleanup on success, per-search failure, per-card failure, and cancellation | `tests/linkedin/discovery-service.test.ts` (cleanup-on-every-exit-path assertions) + `tests/linkedin/browser-session.test.ts` |
| 7 | Saved HTML fixtures for selectors and discovery logic; live tests explicit | `tests/linkedin/fixtures/*.html` (basic, no-results, with-modal) + `tests/linkedin/fixtures/loadFixture.ts` + `tests/live/linkedin.test.ts` (opt-in placeholder) |

The dedicated "no `process.exit` inside `src/linkedin/`" assertion lives in `tests/linkedin/boundaries.test.ts` (final tree walk + dedicated `discovery-service.ts` assertion).

The domain-discipline boundary tests are:
- **(a) no Commander / Inquirer / Drizzle / OpenAI / runtime Pino imports in `src/linkedin/` (outside allow-list)** — `tests/linkedin/boundaries.test.ts` (full tree scan + dedicated `discovery-service.ts` assertion).
- **(b) Playwright is owned by `src/linkedin/playwright-session.ts` + `src/linkedin/fake-session.ts` + the two capture strategies** — same boundaries file, with the Playwright allow-list encoded exactly (Decision 16d).
- **(c) no `process.exit` inside `src/linkedin/`** — same file (regex matches `process.exit(` and ignores `process.exitCode` — the latter is permitted).
- **(d) history preserved** — `tests/linkedin/discovery-service.test.ts` (assertion: pre-seeded `searchExecutions` row's `finalStatus` is unchanged when re-discover aborts; pre-seeded jobs are not deleted when a new card with the same `sourceJobId` is discovered).

## Verification commands

All commands from `AGENTS.md` §15 adapted to this task:

- `pnpm install --frozen-lockfile` → `Already up to date` (after `playwright` is added with approval — Decision 16).
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm format:check` → exit 0 (run `pnpm format` first if any new files need reformatting).
- `pnpm test` → all tests pass (existing baseline + new TASK-012 tests).
- `pnpm test:live:list` → lists at least `tests/live/linkedin.test.ts` (correct — placeholder is included).
- `pnpm test:live` → empty live suite (correct — placeholder is skipped without `LINKEDIN_LIVE=1`).
- `pnpm exec playwright install --dry-run` → verifies Chromium binary is present.
- **Targeted boundary grep** — the implementing agent MUST run this in the shell:
  ```bash
  rg -n --type ts "from 'commander'|@inquirer/prompts|drizzle-orm|from 'openai'|from 'pino'|process\.exit\(" src/linkedin/
  ```
  Expected output: zero matches. No `process.exit(` matches. If the boundary violation surfaces any unexpected match the implementing agent must stop and re-architect.

## Completion criteria

Mirror SPEC.md §21 + §22 + §29 + §39 + §40 + §42 acceptance 23–24 and TASK-012 §"Completion criteria". The implementing agent confirms each item before reporting the task complete.

1. **Sequential search execution** — `LinkedInDiscoveryService.discover()` executes each matrix entry's generated URL in order; no parallel panel extraction, no parallel fallback pages. Verified by `tests/linkedin/discovery-service.test.ts` (sequential scenario) + `tests/linkedin/browser-session.test.ts` (activePages invariant).
2. **Expected page validation** — every search URL navigates with bounded timeout; the expected DOM is asserted; failure → typed `LinkedInExpectedPageError`. Verified by `tests/linkedin/discovery-service.test.ts` (expected-page-missing scenario).
3. **Access block typed error** — anonymous access blocked → `LinkedInAccessBlockedError` with `exitCode === ExitCode.LinkedInBlocked` (4); already persisted data remains intact. Verified by `tests/linkedin/discovery-service.test.ts` (access-blocked scenario).
4. **Recoverable overlay dismissal** — login / join / cookie / modal overlays are detected and dismissed with bounded strategies; failure → `OverlayUndismissableError`. Verified by `tests/linkedin/overlay.test.ts` + `tests/linkedin/discovery-service.test.ts` (overlay + undismissable scenarios).
5. **Job-card ID parsing + dedup + metadata retention** — `parseCardJobId` accepts the three priority sources; cross-search dedup via `Repositories.jobs.findBySourceJobId`; existing jobs recorded as `discoveryEvents` with `isNew=false`; available metadata preserved in `discoveryErrors.availableMetadata` when no ID. Verified by `tests/linkedin/card-id.test.ts` + `tests/linkedin/discovery-service.test.ts` (dedup + no-ID scenarios).
6. **Bounded end-of-results detection** — explicit end-of-results element, repeated IDs, no rendered-count change, or unavailable load mechanism all stop the loop. Verified by `tests/linkedin/load-more.test.ts` (5 scenarios).
7. **No per-search result cap** — the MVP does not impose a cap; the loop iterates until a bounded end. Verified by `tests/linkedin/load-more.test.ts` (with load-more scenario demonstrates > 5 cards).
8. **Persistence with run/search context** — every search execution updates `searchExecutions` with `finalStatus`, `endTimestamp`, `jobsDiscovered`, `newJobs`, `existingJobs`, `errors`, `diagnosticRefs`. Discovery events written with `isNew`. Verified by `tests/linkedin/discovery-service.test.ts` (DB-side assertions on every scenario).
9. **Continued after isolated card failures** — per-card failures do not terminate the run; they appear as `discoveryErrors` rows + `SearchDiscoveryOutcome.errors[]`. Verified by `tests/linkedin/discovery-service.test.ts` (no-ID scenario).
10. **Browser/page/context cleanup on every exit path** — `browserSession.closePage(page)` is called on success, per-search failure, per-card failure, and cancellation (Required Finding #1). The orchestrator NEVER calls `browserSession.close()` — that is TASK-015's responsibility. Verified by `tests/linkedin/discovery-service.test.ts` (cleanup assertions on every scenario assert `closePage` was called AND `close` was NOT called) + `tests/linkedin/browser-session.test.ts`.
11. **Cancellation handoff to TASK-015** — the orchestrator exposes `signal?: AbortSignal` and respects `signal.aborted`; the SIGINT → AbortSignal wiring is TASK-015's. Verified by `tests/linkedin/discovery-service.test.ts` (cancellation scenario).
12. **No login automation, no credential storage** — anonymous context only; no `cookies` / `localStorage` writes. Verified by `tests/linkedin/browser-session.test.ts` (no cookies written assertion).
13. **No new schema / migration** — `package.json:dependencies` + `drizzle/` unchanged (except the `playwright` addition); CI migrates against the existing schema. Verified by `pnpm install --frozen-lockfile` (no diff outside `playwright`) + the targeted grep.
14. **Both TASK-012-owned capture-strategy stubs replaced in place; `html-snapshot.ts` UNTOUCHED** — `src/diagnostics/capture/screenshot.ts` + `src/diagnostics/capture/playwright-trace.ts` are replaced with Playwright-backed implementations (Required Finding #3 — no `src/linkedin/capture-strategies/` subtree); `src/diagnostics/capture/html-snapshot.ts` stays as-is for TASK-013. Verified by `git diff src/diagnostics/capture/` (only `screenshot.ts` + `playwright-trace.ts` modified; `html-snapshot.ts` untouched) + `tests/linkedin/capture-strategies.test.ts` (exercises the replaced stubs in their final location).
15. **Domain boundaries** — `tests/linkedin/boundaries.test.ts` (full tree scan + dedicated `discovery-service.ts` assertion) + the targeted grep.
16. **Strict TypeScript** — `pnpm typecheck` is exit 0; no `any` in `src/linkedin/`. The orchestrator's typed-error catch (`catch (error)`) narrows via `error instanceof LinkedInScraperError` — never `any`.
17. **Public surface + barrel** — `src/linkedin/index.ts` re-exports every public symbol. TASK-015 consumes them via the barrel.
18. **Documentation** — `docs/tasks/TASK-012-linkedin-discovery-result-loading.md` has an "Implementation results" section; `docs/tasks/INDEX.md` lists TASK-012 as `Implemented`. SPEC.md and README.md are aligned (`playwright` postinstall note added to README if applicable).

## Known limitations / follow-ups for downstream tasks

1. **Job-detail extraction is TASK-013's responsibility.** TASK-012 records a `discoveryEvents` row per card with `currentExtractionState: 'failed'` (placeholder; the matching `jobs.extractionStatus` is also `'failed'`). TASK-013 (`docs/tasks/TASK-013-job-detail-extraction-persistence.md`) promotes both via `Repositories.jobs.updateExtraction` (`jobs.ts:255`) once it has extracted `title` / `company` / `location` / `description`. TASK-013's implementer MUST scan for `'failed'` placeholders before computing filter/score results. The orchestrator NEVER calls `Repositories.jobs.updateExtraction` in TASK-012 — that's TASK-013's. The `LinkedInAccessBlockedError` exit code (4) is per-search; TASK-015's run-level exit code aggregates over all searches.
2. **No dedicated-job-page fallback in this task.** TASK-022.7 (SPEC) §22.6–22.7 panel/dedicated extraction is TASK-013's. The `BrowserSession` capacity hook (`openFallbackPage` throwing `BrowserCapacityExceededError`) is forward-compat for TASK-013; the orchestrator never opens one in TASK-012.
3. **`SearchDiscoveryOutcome.artifactIds` may be empty for per-card errors.** The orchestrator passes `scope: { discoveryErrorId }` to `recordScraperError` AFTER the `recordDiscoveryError` insert returns the row id; on race conditions the artifact id may be associated with a future `recordScraperError` call. Verified by `tests/linkedin/discovery-service.test.ts` (no-ID scenario + diagnostics scenario).
4. **LinkedIn DOM drift.** Selectors in `src/linkedin/selectors.ts` are versioned + trivially replaceable. The saved fixtures (`tests/linkedin/fixtures/*.html`) will go stale when LinkedIn changes its DOM; the implementing agent MUST update the fixtures + selectors in lock-step. A maintenance note is added to the README per Oracle Decision #2: "TASK-012 fixtures (`tests/linkedin/fixtures/*.html`) need periodic refresh when LinkedIn changes its DOM — refresh by re-saving the fixture HTML in lock-step with selector updates in `src/linkedin/selectors.ts`. Failures surface as `selector`-keyed `metadata` in `DiagnosticManager.recordScraperError` output."
5. **Chromium binary size in CI.** `pnpm exec playwright install chromium` downloads ~150 MiB. CI workflows that exclude this binary need a fallback (e.g. `PLAYWRIGHT_BROWSERS_PATH=0` skip + use `playwright-core` with system Chromium). Not addressed in this task.
6. **`playwright` dependency approval is a precondition.** The implementing agent MUST stop and ask the user to approve `pnpm add playwright` before Task 14 runs. The `package.json` diff in Task 14 is the only artifact that requires this approval.
7. **Concurrent `discover()` invocations are safe by construction.** SQLite's serialized write lock + per-search sequential execution means two `jobhunter run` invocations on the same `HOME` cannot corrupt the DB. The orchestrator's idempotent updateSearchStatus + per-card findBySourceJobId pattern means re-running a search from a cancelled state produces a deterministic outcome. **No explicit concurrent-discovery test is added** — the property is structural (SQLite + `repositories.db.transaction` sync callback at `src/persistence/repositories/index.ts:54-58`).
8. **`SearchMatrixEntry` is the orchestrator input.** The matrix entry's `generatedUrl` is built by TASK-006's `buildLinkedInSearchURL` (`src/search/url-builder.ts:24`). TASK-015 passes the matrix entry directly to `discover()`; the orchestrator does NOT call `buildLinkedInSearchURL` itself.
9. **No `playwright-report/` or `test-results/` output.** Both directories are already in `.gitignore` (`/home/leuri/Projects/dev/jobhunter/.gitignore:21-22`); the integration tests do not produce them.
10. **The `BrowserSession` interface is forward-compat for TASK-013 + TASK-015.** `openFallbackPage` + `closeFallbackPage` are already on the interface (Minor Finding #1 — TASK-013 does NOT have to extend it; it just calls the existing methods). TASK-015 may add `subscribeToSignals(signal: AbortSignal)` for SIGINT and owns the run-level `launch()` / `close()` lifecycle (Required Finding #1 — already documented in Decision 2 + Reconciler facts). The implementing agent keeps the interface minimal in TASK-012 for the methods TASK-013 actually needs; additional extensions are deferred.
11. **No retry on partial searches.** SPEC §40: "no automatic retries of partial jobs." TASK-012 honors this — a `LoadMoreLoopExhaustedError` surfaces a soft warning; the orchestrator does not retry the same `generatedUrl`.
12. **`tests/live/` placeholder test stays in CI.** `pnpm test:live:list` lists it; `pnpm test:live` (without `LINKEDIN_LIVE=1`) skips it. Future tasks may add real live tests; the placeholder file is the seed.

## Anti-patterns to call out explicitly

- **Do NOT call `process.exit` inside `src/linkedin/`.** The CLI boundary (TASK-015) owns exit codes via the existing `exitWithError` helper (`src/cli.ts:134-146`).
- **Do NOT persist raw HTML.** Only error-time diagnostics are captured (screenshot + current-url + stack trace). The HTML snapshot artifact type (`html_snapshot`) is TASK-013's. The orchestrator MUST NOT call `HtmlSnapshotCapture.capture()` even though it is registered (TASK-013 owns replacement of the `html-snapshot.ts` stub).
- **Do NOT touch `src/diagnostics/capture/html-snapshot.ts`.** That is TASK-013 (`capture/html-snapshot.ts:11` comment). TASK-012 owns `screenshot.ts` + `playwright-trace.ts` (replacement of stubs **in place** — no `src/linkedin/capture-strategies/` subtree; Required Finding #3).
- **Do NOT log `OPENAI_API_KEY`, prompt transcripts, raw LinkedIn response bodies, or card HTML.** The orchestrator's `LinkedInScraperLogger` adapter is responsible for the structured log shape; the orchestrator never adds raw HTML to log payloads.
- **Do NOT silently overwrite search execution / discovery state.** Every status change goes through `Repositories.pipelineRuns.updateSearchStatus` (`pipeline-runs.ts:293`). The orchestrator does NOT call `updateSearchStatus` outside the per-search try/finally.
- **Do NOT batch multiple searches.** Sequential by SPEC §21.7. The orchestrator never runs two `discover()` calls in parallel within the same run.
- **Do NOT parallelize panel extraction or fallback pages.** SPEC §21.7 + §29.1. The orchestrator runs the per-search sequence serially.
- **Do NOT import Drizzle, Pino, OpenAI, Commander, or Inquirer in `src/linkedin/` beyond the explicit allow-list.** Playwright is the only allowed framework import (Decision 16d).
- **Do NOT `import type` from `drizzle-orm` either.** Schema types flow via the repository's row interfaces (`SearchExecutionRow` at `pipeline-runs.ts`, `JobRow` at `jobs.ts:13-27`, `DiscoveryErrorRow` at `jobs.ts:67-78`).
- **Do NOT add a new database schema / migration.** All tables used (`searchExecutions`, `jobs`, `discoveryEvents`, `discoveryErrors`, `diagnosticArtifacts`) already exist (`persistence/schema.ts:246, 275, 304, 332, 501`).
- **Do NOT add future-task work.** No `LinkedInExtractionService`, no `LinkedInPipelineOrchestrator`. The orchestrator NEVER calls `browserSession.openFallbackPage` / `closeFallbackPage` — those exist on the interface for TASK-013's forward-compat but are not invoked in TASK-012. The orchestrator NEVER calls `browserSession.launch()` / `close()` — those are TASK-015's run-level lifecycle.
- **Do NOT add login automation or credential storage.** Anonymous context only; no cookies / localStorage writes.
- **Do NOT add a CLI command.** TASK-012 has no CLI surface; the `LinkedInDiscoveryService` is invoked by TASK-015.
- **Do NOT add new config fields.** `OperationalConfigSchema` is `.strict()` (`src/config/schema.ts:96-106`); reuse `diagnostics.onScraperError.{screenshot,playwrightTrace}` instead.
- **Do NOT add `playwright` to `package.json` without user approval.** Decision 16 + AGENTS.md §12. The implementing agent MUST request approval before `pnpm add playwright` (this approval gates Tasks 7–11 because they import Playwright types — Minor Finding #6).
- **Do NOT export a `registerLinkedInScraperStrategies` helper.** `DiagnosticManager`'s constructor already accepts `strategies: Partial<Record<CaptureArtifactType, CaptureStrategy>>` (`diagnostics/manager.ts:29`); consumers wire at construction. No `unknown`-cast mutation through the manager (Required Finding #4).

(End of plan — total sub-tasks: 14; total new source files: 16 (14 in src/linkedin/ — index, state, errors, selectors, card-id, overlay, load-more, navigation, truncate-metadata, browser-session, playwright-session, fake-session, discovery-service, log — and 2 stub replacements in src/diagnostics/capture/); total new test files: 19 (13 .test.ts in tests/linkedin/ — state, errors, selectors, card-id, overlay, load-more, navigation, truncate-metadata, browser-session, capture-strategies, discovery-service, log, boundaries — plus 1 helper: tests/linkedin/helpers/playwright-route-session.ts — plus 1 loadFixture.ts + 3 HTML fixtures in tests/linkedin/fixtures/ — and 1 in tests/live/: linkedin.test.ts); total modified source files: 4 (`src/diagnostics/capture/screenshot.ts`, `src/diagnostics/capture/playwright-trace.ts`, `src/diagnostics/capture/index.ts` (re-export shim), `package.json`); total modified test files: 0; total modified doc files: 3 (`docs/tasks/TASK-012-linkedin-discovery-result-loading.md`, `docs/tasks/INDEX.md`, `README.md` — fixture maintenance note per Oracle Decision #2).)