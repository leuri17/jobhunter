# TASK-005 — Diagnostics and Artifact Management

**Status:** Implemented
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

## Implementation results

- **Verification date:** 2026-08-13
- **Environment:** Node.js v24.18.0, pnpm 11.18.0, linux-x64
- **Branch:** `feat/task-005-diagnostics-artifacts` (worktree at `.worktrees/task-005-diagnostics-artifacts`, branched from main at `769320d`)
- **Dependency versions used:** no new direct dependencies — the task uses only Node built-ins (`node:fs/promises`, `node:path`), the existing `DiagnosticArtifactRepository` from TASK-004, and the `OperationalConfig.diagnostics.onScraperError` schema from TASK-002
- **Plan reference:** `docs/superpowers/plans/2026-08-13-task-005-diagnostics-artifacts.md` (10 sub-tasks)

### Commits (9 total on the feature branch)

1. `5e65f7b` — `feat(diagnostics): add typed diagnostic and browser-implementation errors` (Task 1; also anchors the `.gitignore` diagnostics/ pattern so the new source directory is trackable)
2. `c2a9947` — `feat(diagnostics): add safe filename and scope-path resolver` (Task 2)
3. `41f234c` — `feat(diagnostics): add redactor with built-in secret patterns` (Task 3)
4. `c63a2c7` — `feat(diagnostics): add capture strategy interfaces` (Task 4)
5. `3a54d05` — `feat(diagnostics): add stack-trace and current-url capture strategies` (Task 5+6)
6. `9f8dddd` — `feat(diagnostics): add browser-backed capture strategy stubs` (Task 7)
7. `d12abde` — `feat(diagnostics): add manager that captures scraper-error artifacts` (Task 8)
8. `4a4ffc7` — `feat(diagnostics): add public exports and end-to-end integration test` (Task 9)
9. `8b77d95` — `fix(diagnostics): silence unused-parameter lint in browser stubs` (Task 10 lint fix)

### Verification commands and outcomes

- `node --version` — `v24.18.0` ✅
- `pnpm --version` — `11.18.0` ✅
- `pnpm install --frozen-lockfile` — `Already up to date` ✅
- `pnpm typecheck` — exit 0 ✅
- `pnpm lint` — exit 0 (after the unused-parameter fix) ✅
- `pnpm prettier --check src/diagnostics tests/diagnostics` — `All matched files use Prettier code style` ✅
- `pnpm format:check` — exit 1 with 27 files flagged; all 27 are pre-existing `src/persistence/` and `tests/persistence/` files inherited from TASK-003/004, **none are in `src/diagnostics/` or `tests/diagnostics/`** ✅ (new code is clean)
- `pnpm test` — 35 files / 161 tests pass (131 existing + 30 new) ✅
- `pnpm test:live:list` — empty live suite (correct for non-LinkedIn task) ✅
- `pnpm build` — exit 0, `dist/cli.js` produced ✅
- `node dist/cli.js --help` — exit 0 ✅
- `node dist/cli.js paths` — exit 0, prints diagnostics path under OS-specific data dir ✅
- `rg -n 'from .(commander|@inquirer|playwright|openai|pino|drizzle-orm)' src/diagnostics` — no matches ✅
- `rg -n 'require\(' src/diagnostics` — no matches ✅
- `rg -n 'from .node:fs[^/]' src/diagnostics` — no matches (only `node:fs/promises`) ✅

### Test inventory (30 new tests across 8 new files)

- `tests/diagnostics/filename.test.ts` — 9 tests (sanitize + scope dir + buildSafeFilename)
- `tests/diagnostics/redactor.test.ts` — 8 tests (string + value redactor, circular, extra patterns)
- `tests/diagnostics/capture/stack-trace.test.ts` — 2 tests
- `tests/diagnostics/capture/current-url.test.ts` — 2 tests
- `tests/diagnostics/manager.test.ts` — 6 tests (capture, lazy dir, disabled flags, strategy_missing, capture_failed, redaction, close)
- `tests/diagnostics/integration.test.ts` — 1 end-to-end test (full DB + filesystem + close idempotence)

Total: 161 tests pass (131 existing TASK-001–004 + 30 new TASK-005).

### Deviations from the plan

All deviations were forced by tests catching real issues or by aligning with existing project conventions. None expand the approved task scope.

1. **`.gitignore` `diagnostics/` pattern anchored with `/`.** The unanchored `diagnostics/` rule (line 11 of `.gitignore`) unintentionally matched the new `src/diagnostics/` source directory and blocked `git add`. The fix was a one-character change (`diagnostics/` → `/diagnostics/`) that preserves the original intent (the OS-specific runtime folder at the repo root stays ignored) while letting the new source directory be tracked. Asked for user approval before making the change per `AGENTS.md` §12.

2. **`sanitizeFilenameComponent` test expectations corrected in the plan body.** The plan's body text for Task 2 (behavior rules) and its test cases were internally inconsistent: the rules state "every other character collapses to `-`" and "Uppercase... collapse to `-`", so `_` and `A-Z` must collapse to `-`. But the plan's first test expected `'-api_key-ABC-x-1'` (preserving `_`, uppercase, and leading dash). The implementation correctly follows the rules; the test was fixed in-place to expect `'api-key-abc-x-1'`. The leading-dash strip in `sanitizeFilenameComponent` is intentional (clean filenames, prevents accidental escape from sanitized input).

3. **`buildSafeFilename` suffix leading-dash normalization.** The plan body produced `--attempt-2` (double dash) when the caller passed `suffix: '-attempt-2'`. Added a one-line `opts.suffix.replace(/^-+/, '')` so callers can include or omit the leading dash and get the same canonical output.

4. **`Redactor` pattern ordering + kv negative lookahead.** The plan's order ran `kv` before `qs`, causing the kv pattern to clobber the qs replacement (the literal `[REDACTED]` matches the kv value pattern). Reordered built-ins so `qs` runs before `kv`, and added a negative lookahead `(?!\s*\[REDACTED)` to the kv pattern so it does not re-match values that were already replaced by qs.

5. **`Redactor` extraPatterns test expectation corrected.** The plan's test expected `'cookie=sess-12345 other'` to become `'[REDACTED:session] other'`, but the extra pattern only matched the `sess-12345` substring, so `cookie=` correctly remained. Test expectation updated to `'cookie=[REDACTED:session] other'` and a comment added to the test explaining the substitution.

6. **Manager tests seed a real `pipeline_runs` row.** The plan's manager tests passed a hardcoded `pipelineRunId: 7` (and `jobId: 99`) which the `diagnostic_artifacts` foreign keys rejected. Updated the test `beforeEach` to seed a real run via `pipelineRuns.createRunWithSearches` and reuse the returned `runId` in the assertions, matching the pattern already used in `tests/persistence/repositories/diagnostics.test.ts` (TASK-004).

7. **`CaptureContext.currentUrl` constructed conditionally.** With `exactOptionalPropertyTypes: true`, the manager cannot assign `currentUrl: redactedUrl` where `redactedUrl: string | undefined` to a property typed `currentUrl?: string`. Spread the optional property only when defined: `...(redactedUrl !== undefined ? { currentUrl: redactedUrl } : {})`. Matches the established strict-TS pattern in the codebase.

8. **Lint: explicit `void _context;` in browser-backed capture stubs.** The `screenshot`, `playwright_trace`, and `html_snapshot` stubs accept a `CaptureContext` they do not consume. The project's `@typescript-eslint/no-unused-vars` rule rejects the `_context` parameter even with the underscore prefix. Added an explicit `void _context;` reference to satisfy the rule without renaming or dropping the parameter (which would break the `CaptureStrategy` contract). Same fix applied to the test's `FakeScreenshot` helper.

### Known limitations / follow-ups for downstream tasks

- The browser-backed capture strategies (`screenshot`, `playwright_trace`, `html_snapshot`) raise `MissingBrowserImplementationError` and are not yet wired to Playwright. **TASK-012 (LinkedIn discovery)** is the planned owner for `screenshot` and `playwright_trace`; **TASK-013 (job-detail extraction)** is the planned owner for `html_snapshot`. When those tasks add their implementations, they should register them via `DiagnosticManagerOptions.strategies` and the manager will pick them up automatically.
- `DiagnosticManager.close()` is a no-op today. The hook is in place for SPEC §29.3 graceful-cancellation cleanup; TASK-012/13 should close any held Playwright resources from their strategies via this method.
- `DiagnosticManager.recordScraperError` returns synchronously without awaiting a Drizzle `transaction`. The diagnostics insert is fast and the manager is designed to never throw, so this is acceptable for the MVP. If a future task needs atomicity across the artifact write and the failure-row insert, it can wrap the `repositories.diagnostics.insert` calls in a `db.transaction` via `Repositories.transact`.
- The redactor covers API keys, Bearer tokens, password/secret/token fields, and common query-string secrets. It is intentionally conservative (false negatives are acceptable, false positives are not). Downstream tasks that surface additional secret shapes (e.g., LinkedIn session cookies) should add extra `RedactionPattern`s via the constructor.
