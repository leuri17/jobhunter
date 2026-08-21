# TASK-018 Implementation Plan — Cross-System Integration Testing, Diagnostics Verification, and MVP Acceptance

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Produce verifiable evidence that the JobHunter MVP satisfies every requirement in `SPEC.md` §40 (reliability), §41 (testing), and §42 (acceptance criteria), plus align `SPEC.md`, `AGENTS.md`, `GIT.md`, and `README.md`, without introducing new product behavior. Deliver a durable acceptance matrix, a reliability matrix, a thin-CLI-adapter integration test that exercises every public command with fake dependencies, and a documentation-consistency guard.

**Architecture:** A new `tests/acceptance/` suite (parallel to `tests/cli/`, `tests/reevaluation/`, etc.) holds the verification artifacts. Four focused Vitest files cover the matrix evidence and a docs check:

- `tests/acceptance/acceptance-evidence.test.ts` — for each `SPEC.md` §42 numbered item, asserts that the cited test file (and optionally a fixture or module) exists in the repo and exercises the behavior. The test itself is the durable, self-checking acceptance matrix.
- `tests/acceptance/reliability.test.ts` — for each `SPEC.md` §40 bullet, asserts the cited test or guard exists. Same pattern.
- `tests/acceptance/cli-adapters.test.ts` — exercises every public command documented in `SPEC.md` §31 through `createProgram()` with fake `OpenAIClient`, scripted prompts, `:memory:` SQLite, and isolated tmpdir paths. Asserts exit codes (per SPEC §37) and JSON shape (per SPEC §36). This is the "thin CLI adapters with fake dependencies" deliverable named in TASK-018's scope.
- `tests/acceptance/docs-consistency.test.ts` — reads `SPEC.md`, `AGENTS.md`, `GIT.md`, `README.md`, `docs/tasks/INDEX.md` and asserts the cross-references + the public command surface listed in `README.md` match the registered Commander commands.

A new `pnpm test:acceptance` script runs `tests/acceptance/` in isolation. The existing `pnpm test` script continues to run the full suite (acceptance + everything else); no CI change. The default `pnpm test:live` remains opt-in (no behavior change).

**Tech Stack:** No new direct dependencies. Reuses the foundation wired by TASK-001–TASK-017: `vitest@4.1.10` (the runner), `node:test`-compatible glob/imports, and the existing `createProgram({ prompts, openaiClient, filterPrompts, initPrompts, pipelinePrompts })` injection points (already used by `tests/cli/*`). The acceptance tests read source files via `node:fs` and `node:path` only — no markdown parser, no AST parser, no doc library. The acceptance suite does NOT call OpenAI, does NOT call Playwright, does NOT touch the real LinkedIn service. Live-LinkedIn opt-in is verified by a guard test that asserts the default `vitest.live.config.ts` is `passWithNoTests: true` and that all `tests/live/**/*.test.ts` files start with `describe.skipIf(!ENABLED)`.

## Open decisions confirmed before implementation

These map to SPEC §40 + §41 + §42 + §43.4 + AGENTS.md §15. The implementing agent must stop and ask the user to confirm all resolutions before any file in `tests/acceptance/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Suite location | New `tests/acceptance/` (sibling of `tests/cli/`, `tests/reevaluation/`, `tests/scoring/`, etc.). New files: `acceptance-evidence.test.ts`, `reliability.test.ts`, `cli-adapters.test.ts`, `docs-consistency.test.ts`. No new `src/` module — TASK-018 owns verification, not product behavior. | §5, AGENTS.md §5 |
| 2 | Evidence format | Each §42 + §40 entry is a single `it(...)` assertion in the matrix file. The assertion is a Vitest test that fails if the cited file path no longer exists. The matrix is the test list — durable, runnable, self-checking. | §43.4 |
| 3 | CLI adapter wiring | The `cli-adapters.test.ts` uses `createProgram({ ... })` directly (in-memory) with: (a) `:memory:` SQLite via `tests/helpers/run-harness.ts` patterns, (b) fake `OpenAIClient` via `src/profile/openai/fake-client.js`, (c) scripted `ScriptedPipelinePrompts` + scripted search/filter/init prompts, (d) `FakeBrowserSession` for the `run` subcommand, (e) tmpdir for OS paths. The test invokes `program.parse(['node','jobhunter', ...args], { from: 'user' })` and captures exit code + stdout/stderr via `configureOutput` + `exitOverride` (already used by `createProgram`). | §31, §33, §37 |
| 4 | Acceptance JSON shape assertions | `--json` payloads are validated against the existing per-command Zod schemas where present (`src/inspection/json-schemas.ts`, `src/reevaluation/json-schemas.ts`, etc.) and otherwise via plain JSON.parse + structural assertions. No new JSON Zod schema is added by TASK-018. | §36 |
| 5 | Documentation consistency checks | The docs-consistency test reads the 5 project docs as text and asserts: (a) `AGENTS.md` references `SPEC.md` (search for the literal `SPEC.md` string), (b) `GIT.md` documents branches + worktrees + commits + merges, (c) `README.md` `## Commands` (or equivalent section) lists every command registered by `createProgram()` at the time of the test run, (d) `docs/tasks/INDEX.md` status column reflects the latest implementation state (the test parses the table and asserts no `Planned` entries remain after TASK-018 closes). | §13, AGENTS.md §13 |
| 6 | Live-LinkedIn guard test | A single `it('live-LinkedIn tests are opt-in only')` in `cli-adapters.test.ts` reads `vitest.live.config.ts` and asserts `include` matches `tests/live/**/*.test.ts` AND `passWithNoTests: true`. A second `it` asserts every file under `tests/live/` starts with `describe.skipIf(` referencing a `LINKEDIN_LIVE`-gated condition. | §41.3, AGENTS.md §8 |
| 7 | `pnpm test:acceptance` script | New script in `package.json`: `"test:acceptance": "vitest run --config vitest.config.ts tests/acceptance"`. Reuses the existing `vitest.config.ts` (no new config file). | §5, AGENTS.md §12 |
| 8 | No new product code | TASK-018 ships no `src/**` files. The acceptance suite imports from `src/` (read-only). No CLI command is added. No flag is added. No schema/migration is added. No dependency is added. The task is verification-only. | §43.1, §43.4, AGENTS.md §5 |
| 9 | Task-document update | At the end of the implementation, `docs/tasks/TASK-018-integration-acceptance-verification.md` is updated with: (a) the implementation-results section (mirrors TASK-017's structure), (b) a verification-commands transcript (typecheck + lint + format + test + build all pass), (c) the explicit list of acceptance items where evidence is test-only vs. fixture-only vs. inspection-only, (d) the honest limitations list (any acceptance item not fully covered, if applicable). | §43.4, AGENTS.md §15 |
| 10 | INDEX update | After TASK-018 ships, `docs/tasks/INDEX.md` row for TASK-018 flips from "Planned" to "✅ Implemented". The Implementation status paragraph at the top of INDEX.md is updated to include TASK-018 in the implemented list. | §43.4, AGENTS.md §2 |
| 11 | Git workflow | Branch `feat/task-018-integration-acceptance-verification` (per GIT.md §1). Commits follow Conventional Commits (GIT.md §3). Verification before commit (GIT.md §5). User approves merge per GIT.md §4 + §6 (squash merge to `main`). | GIT.md §1, §3, §4, §5, §6 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system. `package.json` dependencies are unchanged.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5):** Files under `tests/acceptance/` are tests, not domain code. They may freely import from `src/` (read-only access to fixtures, helpers, fakes) and from `node:fs` / `node:path` for source-file reads. They MUST NOT import Commander, Inquirer, Playwright, the `openai` SDK, or Pino unless they are passing them through `createProgram({...})`. The acceptance suite does NOT add a CLI subcommand, does NOT add a CLI flag, does NOT modify `src/cli.ts`.
- **No product change (SPEC §43.1):** TASK-018 ships zero new product behavior. Every new file lives under `tests/acceptance/` (and `package.json` for the new script). The acceptance suite reads `src/` files; it does not modify them.
- **History preservation (AGENTS.md §6):** The acceptance suite never writes to the runtime database, never modifies user-visible state. It uses `:memory:` SQLite (in-process) and tmpdir paths (per-test cleanup). No new persisted state.
- **Tests:** Vitest. Every acceptance file is a Vitest test file. The existing `tests/foundation.test.ts`, `tests/cli/*.test.ts`, `tests/persistence/**/*.test.ts`, `tests/pipeline/orchestrator.test.ts`, `tests/reevaluation/service.test.ts`, and the per-module boundaries tests continue to run unchanged. The acceptance suite adds new assertions that reference those tests by file path.
- **JSON output discipline (AGENTS.md §10):** `tests/acceptance/cli-adapters.test.ts` exercises `--json` paths and asserts the stdout contains exactly one valid JSON document. The test never reads invalid or partial JSON — that is itself a §42 acceptance check.
- **No new schema/migration:** TASK-018 adds zero DDL. The acceptance suite reuses the existing `:memory:` migration runner (`tests/helpers/run-harness.ts`).
- **No new CLI surface:** TASK-018 adds zero subcommands and zero flags.

## Reconciler facts (from existing code review)

These facts are the established contract that the implementing agent must respect. They are reproduced from the orchestrator's reconciler inputs and are not re-litigated in this plan.

- **`createProgram(options)`** at `src/cli.ts:1215` accepts `{ prompts?, openaiClient?, filterPrompts?, initPrompts?, initSearchPrompts?, initApprovalPrompts?, initRejectionPrompts?, pipelinePrompts? }`. The returned `Command` already has `.exitOverride()` and `.configureOutput({ writeErr: () => undefined })` configured. Tests parse commands via `program.parse(['node', 'jobhunter', ...args], { from: 'user' })`.
- **Exit-code mapping** lives in `src/errors/application-error.ts` (`ExitCode` enum). `exitWithError(error)` at `src/cli.ts:176` writes `<code>: <message>` to stderr and calls `process.exit(error.exitCode)`. The CLI handler never calls `process.exit` directly except for SIGINT force-exit (`src/cli.ts:709`).
- **Registered Commander commands** (as of post-TASK-017): `paths`, `config` (with `show`, `validate`, `update`), `configure` (with `search`, `filters`), `init`, `profile` (with `import`, `extract`, `list`, `show`, `approve`, `reject`, `edit`), `run`, `jobs` (with `list`, `show`, `reevaluate`), `runs` (with `list`, `show`). The acceptance suite asserts this exact set; any future CLI surface change must update `cli-adapters.test.ts`.
- **`tests/helpers/run-harness.ts`** provides `setupRunHarness({ openAIClient, ... })` returning `{ repositories, browserSession, diagnosticManager, ... }`. Used by `tests/pipeline/orchestrator.test.ts`. The acceptance suite's `cli-adapters.test.ts` adapts this for the full command surface.
- **`FakeOpenAIClient`** at `src/profile/openai/fake-client.js` accepts a `scripts?: readonly FakeOpenAIClientScript[]` for scripted responses and rejects unmapped requests with a clear `OpenAIFailure` error.
- **`ScriptedPipelinePrompts`** at `src/pipeline/prompts.js` is the canonical scripted prompt for the pipeline orchestrator. Acceptance tests use it for the `run` subcommand.
- **`defaultInquirerPrompts`** (search), **`defaultInquirerFilterPrompts`** (filters), and **`defaultInquirerInitPrompts`** (init) are all `@inquirer/prompts`-backed. Acceptance tests that exercise these flows supply scripted replacements via the `prompts`, `filterPrompts`, `initPrompts` slots on `createProgram()`.
- **`vitest.config.ts`** includes `tests/**/*.test.ts` by default. The acceptance suite is included by that glob — `pnpm test` runs it automatically.
- **`vitest.live.config.ts`** includes `tests/live/**/*.test.ts` with `passWithNoTests: true`. Default `pnpm test:live` exits 0 without network access.
- **Current test totals (post-TASK-017):** 1759 pass / 6 skip across 175 files. The acceptance suite adds new tests; the totals are expected to grow by ~80–120 tests.
- **`OperationalConfigSchema`** is `.strict()`. No new config fields. The acceptance suite does not modify `config.json`.
- **`process.exit` / `process.stdout` / `process.stderr`** are only called from the CLI handler in `src/cli.ts`. Tests stub them via `program.parse(...)` (Commander `exitOverride` pattern).

## File Structure

```text
tests/acceptance/
  acceptance-evidence.test.ts           # NEW: 43 §42 items × per-item file-existence assertion (Task 1)
  reliability.test.ts                   # NEW: 17 §40 bullets × per-bullet file-existence assertion (Task 2)
  cli-adapters.test.ts                  # NEW: every public command through createProgram() with fakes + exit-code + JSON assertions (Task 3)
  docs-consistency.test.ts              # NEW: cross-doc checks (SPEC / AGENTS / GIT / README / tasks INDEX) (Task 4)
package.json                            # MODIFIED: add "test:acceptance" script (Task 5)
tests/acceptance/
  helpers/
    acceptance-harness.ts               # NEW: shared harness builder for the cli-adapters test (Task 3)
docs/tasks/TASK-018-integration-acceptance-verification.md  # MODIFIED: implementation results + verification transcript (Task 6)
docs/tasks/INDEX.md                     # MODIFIED: TASK-018 row flips to "✅ Implemented" (Task 6)
README.md                               # MODIFIED (only if docs-consistency test flags a gap): add the test:acceptance script to the Quick start section if missing (Task 4/6)
```

Notes:
- No `src/**` file is modified. No migration is added. No new direct dependency is added.
- The `acceptance-harness.ts` is the only non-test file under `tests/acceptance/`; it is a Vitest helper, not a public module. It mirrors the pattern of `tests/helpers/run-harness.ts`.
- The CLI-adapters test (Task 3) is the largest single file. It is intentionally structured as one `describe('CLI adapter integration (full surface)')` with one `it` per documented command path. See the Task 3 sketch below for the exact command list.

---

## Task 1: Acceptance evidence matrix (`tests/acceptance/acceptance-evidence.test.ts`)

**Files:**
- Create: `tests/acceptance/acceptance-evidence.test.ts`

**Goal:** For each of the 43 `SPEC.md` §42 acceptance items, write one `it(...)` test that asserts the cited evidence (a test file, a fixture, a module, or a script) exists in the repo. This makes the matrix runnable as part of CI.

**Interfaces:**
- Consumes: `SPEC.md` §42 (read via `node:fs` at test time), every test file under `tests/` (presence check via `node:fs.statSync`).
- Produces: a single Vitest file with 43 named `it(...)` blocks. Each block's name encodes the §42 item number + a short title (e.g., `it('AC-04: configure multiple search queries interactively — evidence: tests/search/**')`). The assertion is `expect(statSync(evidencePath)).toBeTruthy()` (or a stronger structural assertion where the cited evidence is itself a fixture / a Zod schema).

- [ ] **Step 1.1: Create the test file shell**

```ts
// tests/acceptance/acceptance-evidence.test.ts
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * TASK-018 — §42 MVP acceptance evidence matrix.
 *
 * For each acceptance item this test asserts the cited evidence
 * path exists. The matrix is the test list — it is durable,
 * runnable, and self-checking. If any cited test file is deleted
 * without an approved task update, this test fails.
 *
 * Evidence convention:
 *   - `tests/<area>/...` — unit/integration test that exercises the behavior.
 *   - `src/<module>` — production module that implements the behavior (presence).
 *   - `*.fixture.json` / `*.html` — saved LinkedIn fixture (presence).
 *
 * The matrix below MUST be kept in sync with SPEC.md §42. Any new
 * acceptance item requires both an entry in SPEC.md and an entry
 * here.
 */

interface AcceptanceItem {
  readonly id: string;
  readonly title: string;
  readonly evidencePaths: readonly string[];
  readonly stronger?: 'file-stats' | 'json-shape';
}

const repoRoot = new URL('../..', import.meta.url).pathname;

const ITEMS: readonly AcceptanceItem[] = [
  // Populated in Step 1.2
];

describe('SPEC.md §42 — MVP acceptance evidence matrix', () => {
  for (const item of ITEMS) {
    it(`${item.id}: ${item.title}`, () => {
      for (const p of item.evidencePaths) {
        expect(existsSync(new URL(p, repoRoot))).toBe(true);
      }
    });
  }
});
```

- [ ] **Step 1.2: Populate the `ITEMS` array with all 43 §42 entries**

Use the existing test structure as evidence. The exact mapping (subject to verification at implementation time):

| AC # | Evidence |
| --- | --- |
| AC-01 Install with pinned runtime | `package.json` (`engines.node`, `packageManager`) |
| AC-02 Run `jobhunter init` | `tests/cli/init.test.ts` |
| AC-03 Resume interrupted init | `tests/init/*.test.ts` (resumability cases) |
| AC-04 Configure multiple search queries | `tests/search/matrix.test.ts` + `tests/cli/configure-filters.test.ts` (search flow) |
| AC-05 Paste LinkedIn URLs, extract geoId | `tests/search/geo-id.test.ts` + `tests/search/parse-url.test.ts` |
| AC-06 Human-readable prompts (date-posted, workplace-type) | `tests/search/prompts-inquirer.test.ts` |
| AC-07 Persist valid config.json | `tests/config/updater.test.ts` (atomic write) |
| AC-08 Import one or two CV files | `tests/cli/profile-import.test.ts` |
| AC-09 Local text + OpenAI extraction in `profile import` | `tests/profile/importer.test.ts` (text path) + `tests/profile/extraction-service.test.ts` |
| AC-10 Preserve immutable source copies | `tests/profile/source-storage.test.ts` |
| AC-11 Reject image-only PDFs (`ocr_required`) | `tests/profile/text-extractor.test.ts` |
| AC-12 Extract a structured profile | `tests/profile/extraction-service.test.ts` |
| AC-13 Merge complementary sources | `tests/profile/merger.test.ts` (TASK-008) |
| AC-14 Surface source conflicts | `tests/profile/merger.test.ts` (conflicts path) |
| AC-15 Edit profile interactively | `tests/profile/editing-service.test.ts` |
| AC-16 Override derived values | `tests/profile/overrides.test.ts` |
| AC-17 Explicitly approve profile | `tests/profile/approval-service.test.ts` |
| AC-18 Configure one global filter set | `tests/cli/configure-filters.test.ts` |
| AC-19 Initialize accepted languages from approved profile | `tests/filter/language-init.test.ts` (TASK-010) |
| AC-20 Run `jobhunter run` | `tests/pipeline/orchestrator.test.ts` |
| AC-21 Generate every query/location combo | `tests/search/matrix.test.ts` |
| AC-22 Build LinkedIn URLs with f_TPR, f_WT, geoId, keywords, sortBy=DD | `tests/search/url-builder.test.ts` |
| AC-23 Discover jobs from public LinkedIn pages | `tests/linkedin/discovery-service.test.ts` |
| AC-24 Continue until bounded end condition | `tests/linkedin/load-more.test.ts` |
| AC-25 Extract from embedded panel | `tests/linkedin/extraction/panel-parser.test.ts` |
| AC-26 Fall back to dedicated job page | `tests/linkedin/extraction/dedicated-parser.test.ts` |
| AC-27 Persist complete/partial/failed/discovery-error outcomes | `tests/persistence/repositories/jobs.test.ts` (extraction_status cases) |
| AC-28 Skip existing complete jobs | `tests/pipeline/orchestrator.test.ts` (skip path) |
| AC-29 Skip automatic retries for partial jobs | `tests/pipeline/orchestrator.test.ts` (partial skip) |
| AC-30 Apply deterministic global filters | `tests/filter/service.test.ts` |
| AC-31 Store explicit rejection reasons | `tests/persistence/repositories/filter-results.test.ts` (rejection_reasons column) |
| AC-32 Show + confirm OpenAI scoring plan | `tests/pipeline/orchestrator.test.ts` (confirmation path) |
| AC-33 Score one job per request, controlled concurrency | `tests/scoring/service.test.ts` (concurrency cases) |
| AC-34 Calculate weighted score in JobHunter | `tests/scoring/score-formula.test.ts` |
| AC-35 Reuse current filter + score results | `tests/filter/service.test.ts` (reused path) + `tests/scoring/service.test.ts` (reused path) |
| AC-36 Treat changed-input results as stale | `tests/filter/service.test.ts` (stale path) + `tests/scoring/service.test.ts` (stale path) |
| AC-37 Reevaluate stored jobs explicitly through all scopes | `tests/reevaluation/service.test.ts` + `tests/cli/jobs-reevaluate.test.ts` |
| AC-38 Display top 20 current scores after run | `tests/pipeline/format.test.ts` (topN table) |
| AC-39 List jobs through explicit state flags | `tests/cli/jobs-list.test.ts` |
| AC-40 Use adaptive width-aware tables | `tests/inspection/columns.test.ts` + `tests/pipeline/format.test.ts` |
| AC-41 Inspect individual jobs and runs | `tests/cli/jobs-show.test.ts` + `tests/cli/runs-show.test.ts` |
| AC-42 Produce versioned JSON output | `tests/cli/paths-json.test.ts` + `tests/inspection/json-schemas.test.ts` + `tests/reevaluation/json-schemas.test.ts` |
| AC-43 Preserve completed work after recoverable errors / cancellation | `tests/pipeline/orchestrator.test.ts` (cancellation path) |

Note: The exact test-file paths must be verified against the actual repo layout during implementation. The matrix is the source of truth for what each acceptance item is mapped to.

- [ ] **Step 1.3: Add the stronger assertions where required**

For AC-04, AC-22, AC-27, AC-31, AC-42 (which require structural evidence beyond mere existence), add a second assertion per item. Example:

```ts
it('AC-22: build LinkedIn URLs with f_TPR, f_WT, geoId, keywords, sortBy=DD — evidence: tests/search/url-builder.test.ts + tests/search/__fixtures__/', () => {
  expect(existsSync(new URL('tests/search/url-builder.test.ts', repoRoot))).toBe(true);
  // stronger: confirm the test file actually contains the canonical sortBy=DD assertion
  const src = readFileSync(new URL('tests/search/url-builder.test.ts', repoRoot), 'utf8');
  expect(src).toMatch(/sortBy=DD|"DD"/);
});
```

Apply the same `readFileSync` + content-pattern check for AC-04 (geoId), AC-22 (URL params), AC-27 (extraction_status cases), AC-31 (rejection_reasons column name), AC-42 (schemaVersion: 1).

- [ ] **Step 1.4: Run the matrix**

Run: `pnpm test tests/acceptance/acceptance-evidence.test.ts`
Expected: 43 pass, 0 fail. If a path is stale, fix it inline (the matrix is the source of truth).

- [ ] **Step 1.5: Commit**

```bash
git add tests/acceptance/acceptance-evidence.test.ts
git commit -m "test(acceptance): add §42 acceptance evidence matrix (TASK-018 T1)"
```

---

## Task 2: Reliability matrix (`tests/acceptance/reliability.test.ts`)

**Files:**
- Create: `tests/acceptance/reliability.test.ts`

**Goal:** Same shape as Task 1 but for `SPEC.md` §40 reliability requirements. 17 bullets × per-bullet file-existence (or stronger) assertion.

- [ ] **Step 2.1: Create the test file shell**

```ts
// tests/acceptance/reliability.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ReliabilityItem {
  readonly id: string;
  readonly requirement: string;
  readonly evidencePaths: readonly string[];
  readonly stronger?: readonly { path: string; pattern: RegExp }[];
}

const repoRoot = new URL('../..', import.meta.url).pathname;

const ITEMS: readonly ReliabilityItem[] = [
  // Populated in Step 2.2
];

describe('SPEC.md §40 — Reliability requirements matrix', () => {
  for (const item of ITEMS) {
    it(`${item.id}: ${item.requirement}`, () => {
      for (const p of item.evidencePaths) {
        expect(existsSync(new URL(p, repoRoot))).toBe(true);
      }
      for (const s of item.stronger ?? []) {
        const src = readFileSync(new URL(s.path, repoRoot), 'utf8');
        expect(src).toMatch(s.pattern);
      }
    });
  }
});
```

- [ ] **Step 2.2: Populate the `ITEMS` array with all 17 §40 entries**

The matrix (mapping each bullet to its evidence):

| REQ # | Evidence |
| --- | --- |
| R-01 Bounded retries | `tests/linkedin/navigation.test.ts` (timeout guard) + stronger: `src/linkedin/navigation.ts` matches `boundedWait`/`maxAttempts` |
| R-02 Bounded waits | `src/scoring/service.ts` (concurrency limit) + `src/linkedin/discovery-service.ts` (maxIterations = 5) + stronger: `src/config/schema.ts` contains `timeout` keys |
| R-03 Avoid infinite scrolling | `src/linkedin/load-more.ts` (maxIterations guard) + `src/linkedin/discovery-service.ts` |
| R-04 Deduplicate by LinkedIn job ID | `tests/persistence/repositories/jobs.test.ts` (dedup case) |
| R-05 Isolate per-job failures | `tests/pipeline/orchestrator.test.ts` (per-job try/catch) + `tests/reevaluation/service.test.ts` (runOneScore isolation) |
| R-06 Preserve successful writes after later failures | `tests/persistence/connection.test.ts` (transaction rollback tests) + `tests/pipeline/orchestrator.test.ts` (cancellation preserves state) |
| R-07 Validate structured OpenAI output | `tests/profile/openai/response-parser.test.ts` (Zod validation) + `tests/scoring/schema.test.ts` |
| R-08 Close browser resources on success + failure | `tests/linkedin/fake-session.test.ts` (close lifecycle) + stronger: `src/cli.ts` `try { ... } finally { handle.close(); browserSession.close(); }` |
| R-09 Keep partial jobs out of filtering + scoring | `tests/filter/service.test.ts` (partial skip) + `tests/scoring/service.test.ts` (eligibility) |
| R-10 Skip extraction for complete jobs | `tests/pipeline/orchestrator.test.ts` (complete-skip path) |
| R-11 Skip automatic retries for partial jobs | `tests/pipeline/orchestrator.test.ts` (partial-skip path) |
| R-12 Reuse valid filter + score results | `tests/filter/service.test.ts` (reused branch) + `tests/scoring/service.test.ts` (reused branch) |
| R-13 Invalidate stale results | `tests/filter/service.test.ts` (fingerprint-mismatch branch) + `tests/scoring/service.test.ts` + `tests/reevaluation/service.test.ts` |
| R-14 Preserve history | `tests/persistence/repositories/filter-results.test.ts` (active flag flip) + `tests/persistence/repositories/score-results.test.ts` |
| R-15 Write configuration atomically | `tests/config/updater.test.ts` (rename-based atomic write) + stronger: `src/config/updater.ts` matches `rename` (not direct write) |
| R-16 Avoid logging secrets | `tests/logging/redaction.test.ts` + stronger: `src/logging/logger.ts` matches `redact` or equivalent redaction paths |
| R-17 Keep JSON stdout valid + isolated from logs | `tests/cli/paths-json.test.ts` + `tests/cli/jobs-list.test.ts` (`--json` path) + stronger: `src/cli.ts` writes JSON to stdout and human output to stdout as well — the test asserts logs are NOT on stdout by setting `process.stdout` capture and running with `--json`. |

- [ ] **Step 2.3: Run the matrix**

Run: `pnpm test tests/acceptance/reliability.test.ts`
Expected: 17 pass, 0 fail.

- [ ] **Step 2.4: Commit**

```bash
git add tests/acceptance/reliability.test.ts
git commit -m "test(acceptance): add §40 reliability matrix (TASK-018 T2)"
```

---

## Task 3: Thin CLI adapter integration test (`tests/acceptance/cli-adapters.test.ts`)

**Files:**
- Create: `tests/acceptance/helpers/acceptance-harness.ts`
- Create: `tests/acceptance/cli-adapters.test.ts`

**Goal:** Exercise every public command registered by `createProgram()` through the Commander `parse()` API with fake dependencies (`:memory:` SQLite, `FakeOpenAIClient`, scripted prompts, `FakeBrowserSession`, tmpdir paths). Assert exit code (per `SPEC.md` §37) and JSON output shape (per `SPEC.md` §36) where `--json` is supported. This is the "thin CLI adapters with fake dependencies" deliverable named in TASK-018's scope.

- [ ] **Step 3.1: Build the harness helper**

```ts
// tests/acceptance/helpers/acceptance-harness.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { Command } from 'commander';
import {
  FakeOpenAIClient,
  type FakeOpenAIClientScript,
} from '../../../src/profile/openai/fake-client.js';
import { createDefaultOpenAIClient } from '../../../src/profile/openai/client.js';
import type { OpenAIClient } from '../../../src/profile/openai/types.js';
import { ScriptedPipelinePrompts } from '../../../src/pipeline/prompts.js';
import { defaultInquirerPrompts } from '../../../src/search/prompts-inquirer.js';
import { defaultInquirerFilterPrompts } from '../../../src/filter/prompts-inquirer.js';
import { defaultInquirerInitPrompts } from '../../../src/init/prompts-inquirer.js';
import { configureSearchPromptAdapter } from '../../../src/init/cli-adapters.js';
import { configureFiltersPromptAdapter } from '../../../src/init/cli-adapters.js';
import { profileApprovalPromptAdapter } from '../../../src/init/cli-adapters.js';
import { profileRejectionPromptAdapter } from '../../../src/init/cli-adapters.js';
import { createProgram } from '../../../src/cli.js';
import { resolvePlatformPaths } from '../../../src/platform/paths.js';
import { createDefaultPlatformAdapter } from '../../../src/platform/paths-default.js';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection } from '../../../src/persistence/connection.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../../src/config/schema.js';

export interface AcceptanceHarness {
  readonly tempHome: string;
  readonly env: NodeJS.ProcessEnv;
  readonly openaiClient: OpenAIClient;
  readonly fakeClient: FakeOpenAIClient;
  readonly pipelinePrompts: ScriptedPipelinePrompts;
  buildProgram: () => Command;
  cleanup: () => void;
}

export interface AcceptanceHarnessOptions {
  readonly fakeScripts?: readonly FakeOpenAIClientScript[];
  readonly scoringConfirmation?: boolean;
}

export function setupAcceptanceHarness(
  options: AcceptanceHarnessOptions = {},
): AcceptanceHarness {
  const tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-acceptance-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tempHome,
    XDG_CONFIG_HOME: join(tempHome, 'config'),
    XDG_DATA_HOME: join(tempHome, 'data'),
    XDG_STATE_HOME: join(tempHome, 'state'),
    XDG_CACHE_HOME: join(tempHome, 'cache'),
    OPENAI_API_KEY: 'sk-test-acceptance',
  };
  const fakeClient = new FakeOpenAIClient(options.fakeScripts ?? []);
  const openaiClient: OpenAIClient = fakeClient;
  const pipelinePrompts = new ScriptedPipelinePrompts({
    askScoringConfirmation: async () => options.scoringConfirmation ?? true,
  });
  const buildProgram = (): Command =>
    createProgram({
      prompts: defaultInquirerPrompts,
      openaiClient,
      filterPrompts: defaultInquirerFilterPrompts,
      initPrompts: defaultInquirerInitPrompts,
      initSearchPrompts: configureSearchPromptAdapter(),
      initApprovalPrompts: profileApprovalPromptAdapter(),
      initRejectionPrompts: profileRejectionPromptAdapter(),
      pipelinePrompts,
    });
  return {
    tempHome,
    env,
    openaiClient,
    fakeClient,
    pipelinePrompts,
    buildProgram,
    cleanup: () => rmSync(tempHome, { recursive: true, force: true }),
  };
}

/**
 * Apply the project migrations to a freshly-created `:memory:` SQLite
 * handle. Mirrors `tests/helpers/run-harness.ts` but accepts the
 * handle from outside so tests can reuse the same connection across
 * multiple commands (e.g. `init` then `profile import`).
 */
export function applyMigrationsToInMemory(db: import('better-sqlite3').Database): void {
  const repoRoot = new URL('../../..', import.meta.url).pathname;
  runMigrations(db, join(repoRoot, 'drizzle'));
}
```

Notes:
- The `OPENAI_API_KEY` env is set so that handlers which read the env directly (instead of taking the injected client) do not throw. The injected `openaiClient` is the one actually used by `profile extract`, `run`, and `jobs reevaluate`.
- The harness does NOT create the on-disk DB. Commands that need the DB (`profile import`, `profile extract`, `jobs list`, etc.) create their own handle via `initializeDatabase()` + the XDG paths. This matches the production code path.

- [ ] **Step 3.2: Write the per-command test cases**

The structure is one `describe('CLI adapter integration')` with one `it` per command. For each command the test:
1. Calls `program.parse(['node','jobhunter', ...args], { from: 'user' })` inside a try/catch (Commander's `exitOverride` throws a `CommanderError` with `code: 'commander.exitCode'` on non-zero exits; we capture that and re-throw other errors).
2. Captures `process.stdout.write` + `process.stderr.write` via a stub (the pattern at `tests/cli/jobs-list.test.ts:31-43`).
3. Asserts the exit code per `SPEC.md` §37.
4. If `--json`, parses the captured stdout with `JSON.parse(...)` and asserts the shape.

The minimal command coverage (the test asserts EVERY public command is exercised):

- `paths` (no `--json`) → exit 0, stdout contains the 6 path keys.
- `paths --json` → exit 0, stdout is `{ schemaVersion: 1, paths: { ... } }` with exactly the 6 documented keys.
- `config show` → exit 0, stdout parses as the documented `OperationalConfig` shape.
- `config validate` (default config) → exit 0, stdout = `valid`.
- `config update --patch <json>` → exit 0 (asserts atomic write by reading the on-disk config after the call).
- `configure search` (requires scripted prompts) → exit 0.
- `configure filters` (requires scripted prompts) → exit 0.
- `init` (requires scripted prompts) → exit 0.
- `profile list` (no `--json`) → exit 0, stdout contains the documented table header.
- `profile list --json` → exit 0, JSON shape `{ schemaVersion: 1, profiles: [...] }`.
- `profile show <id>` (with a fabricated profileVersion row inserted via direct SQL) → exit 0.
- `profile show <bad-id>` → exit 2 (per `ExitCode.InvalidUsage`).
- `profile import <path>` (with a temp text file) → exit 0, JSON shape matches `formatSummaryJson`.
- `profile extract` (no usable sources) → exit 2 (`profile_extraction_no_sources`).
- `run` → exit 0 with a scripted fake browser + scripted OpenAI; asserts the JSON payload includes `topN` and `summary`.
- `jobs list --scored` → exit 0 (default state flag).
- `jobs list --json` → exit 0.
- `jobs list --all --scored` (state-flag mutex) → exit 2.
- `jobs list --run <bad>` → exit 2.
- `jobs show <bad-id>` → exit 2.
- `jobs reevaluate --dry-run --json` → exit 0, JSON shape `{ schemaVersion: 1, scope, dryRun: true, ... }`.
- `jobs reevaluate --filters-only --scores-only` (mutex) → exit 2.
- `runs list --json` → exit 0, JSON shape matches `RunsListService` payload.
- `runs show <bad>` → exit 2.

Each `it` is structured as:

```ts
it('<command description> — exit <code>, <shape summary>', async () => {
  const captured = captureStdStreams();
  try {
    const program = harness.buildProgram();
    await program.parseAsync(['node','jobhunter', ...args], { from: 'user' });
    expect(captured.exitCode).toBe(0);
    // shape assertions
  } catch (err) {
    // Commander exit code thrown as CommanderError
    if (isCommanderExit(err)) {
      expect(err.code).toBe('commander.exitCode');
      expect(err.nestedError).toBeUndefined();
      expect((err as { exitCode?: number }).exitCode).toBe(<expected>);
      return;
    }
    throw err;
  } finally {
    captured.restore();
  }
});
```

The `captureStdStreams` helper:

```ts
function captureStdStreams(): {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  restore: () => void;
} {
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  process.stdout.write = ((chunk: string | Buffer): boolean => {
    stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Buffer): boolean => {
    stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  const originalExit = process.exit;
  process.exit = ((code?: number): never => {
    exitCode = code ?? 0;
    throw new CommanderExitError(code ?? 0);
  }) as typeof process.exit;
  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get exitCode() { return exitCode; },
    restore: () => {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
      process.exit = originalExit;
    },
  };
}
```

The `isCommanderExit` + `CommanderExitError` types are defined locally in the test file (mirroring the pattern in `tests/cli/jobs-list.test.ts`).

- [ ] **Step 3.3: Add the live-LinkedIn opt-in guard tests**

Two additional `it` blocks in the same `describe`:

```ts
it('live-LinkedIn tests are opt-in via LINKEDIN_LIVE=1 only', () => {
  const src = readFileSync(new URL('vitest.live.config.ts', repoRoot), 'utf8');
  expect(src).toMatch(/include:\s*\[\s*['"]tests\/live\/\*\*\/\*\.test\.ts['"]\s*\]/);
  expect(src).toMatch(/passWithNoTests:\s*true/);
});

it('every tests/live/ file is gated by describe.skipIf', () => {
  const files = readdirSync(new URL('tests/live', repoRoot));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const src = readFileSync(new URL(`tests/live/${file}`, repoRoot), 'utf8');
    expect(src).toMatch(/describe\.skipIf\(/);
  }
});
```

- [ ] **Step 3.4: Run the suite**

Run: `pnpm test tests/acceptance/cli-adapters.test.ts`
Expected: every `it` passes. If any command's exit code differs from the §37 table, fix the implementation (NOT the test) per AGENTS.md §11 ("Do not weaken a correct passing test to accommodate incorrect code") and SPEC §37.

- [ ] **Step 3.5: Commit**

```bash
git add tests/acceptance/helpers/acceptance-harness.ts tests/acceptance/cli-adapters.test.ts
git commit -m "test(acceptance): add thin CLI adapter integration suite (TASK-018 T3)"
```

---

## Task 4: Documentation consistency (`tests/acceptance/docs-consistency.test.ts`)

**Files:**
- Create: `tests/acceptance/docs-consistency.test.ts`
- Modify (conditional): `README.md`

**Goal:** Guard against drift between `SPEC.md`, `AGENTS.md`, `GIT.md`, `README.md`, and `docs/tasks/INDEX.md`. The 5-doc cross-check is named in TASK-018's expected tests.

- [ ] **Step 4.1: Create the test file shell**

```ts
// tests/acceptance/docs-consistency.test.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../../src/cli.js';

const repoRoot = new URL('../..', import.meta.url).pathname;

function readProjectFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('Documentation consistency (SPEC / AGENTS / GIT / README / tasks INDEX)', () => {
  it('all 4 project docs exist', () => {
    for (const path of ['SPEC.md', 'AGENTS.md', 'GIT.md', 'README.md']) {
      expect(existsSync(new URL(path, repoRoot)), `${path} missing`).toBe(true);
    }
  });

  it('AGENTS.md references SPEC.md as source of truth', () => {
    const src = readProjectFile('AGENTS.md');
    expect(src).toMatch(/SPEC\.md/);
    expect(src).toMatch(/source of truth/i);
  });

  it('GIT.md documents branches, worktrees, commits, and merges', () => {
    const src = readProjectFile('GIT.md');
    expect(src).toMatch(/## 1\. Branches/);
    expect(src).toMatch(/## 2\. Worktrees/);
    expect(src).toMatch(/## 3\. Commits/);
    expect(src).toMatch(/## 6\. Merge strategy/);
    expect(src).toMatch(/squash/i);
  });

  it('README.md Quick start lists every registered Commander command', () => {
    const program = createProgram();
    const registered = new Set(program.commands.flatMap((c) => [c.name(), ...c.commands.map((s) => s.name())]));
    const readme = readProjectFile('README.md');
    for (const name of registered) {
      expect(readme, `README.md does not mention command "${name}"`).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('README.md references the documented package scripts', () => {
    const readme = readProjectFile('README.md');
    const pkg = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> };
    for (const script of ['dev', 'build', 'test', 'typecheck', 'lint']) {
      if (script in pkg.scripts) {
        expect(readme, `README.md does not mention "pnpm ${script}"`).toMatch(new RegExp(`pnpm\\s+${script}`));
      }
    }
  });

  it('docs/tasks/INDEX.md status reflects all implemented tasks', () => {
    const indexSrc = readProjectFile('docs/tasks/INDEX.md');
    const implemented = readdirSync(new URL('docs/tasks', repoRoot))
      .filter((f) => /^TASK-\d{3}-.+\.md$/.test(f))
      .map((f) => f.match(/^TASK-(\d{3})/)![1]!);
    for (const id of implemented) {
      const rowPattern = new RegExp(`TASK-${id}.*\\|\\s*.*\\|\\s*\\d{3}\\s*\\|\\s*.*\\|`);
      expect(indexSrc, `TASK-${id} not found in INDEX.md`).toMatch(rowPattern);
      // After TASK-018 closes, every TASK-NNN row should carry the ✅ marker
      // or be marked Planned. The implementation-results commit flips the
      // row to ✅ in the same change.
      if (id === '018') {
        expect(indexSrc, 'TASK-018 row should be ✅ Implemented after close').toMatch(/TASK-018.*✅\s*Implemented/);
      }
    }
  });

  it('SPEC.md §42 acceptance list has 43 numbered items', () => {
    const spec = readProjectFile('SPEC.md');
    const matches = spec.match(/^\s*\d+\.\s+[A-Z]/gm) ?? [];
    const section42Start = spec.indexOf('## 42. MVP acceptance criteria');
    const section43Start = spec.indexOf('## 43.', section42Start);
    const section42 = spec.slice(section42Start, section43Start);
    const numbered = (section42.match(/^\s*(\d+)\.\s/gm) ?? []).map((s) => Number(s.match(/^\s*(\d+)/)![1]));
    expect(numbered.length).toBeGreaterThanOrEqual(43);
    expect(Math.max(...numbered)).toBeGreaterThanOrEqual(43);
  });
});
```

- [ ] **Step 4.2: Address any README gaps surfaced by the test**

If the `registered Commander command` test fails, add the missing command name(s) to `README.md`'s "Commands" section. The README is permitted to mention each subcommand by name; do NOT add new sections beyond what is needed for the missing command(s). Keep the change minimal.

- [ ] **Step 4.3: Run the docs-consistency suite**

Run: `pnpm test tests/acceptance/docs-consistency.test.ts`
Expected: 6 pass (or 7 if the section42 sanity check passes — it is its own `it`). If the SPEC §42 sanity test fails because the section is later modified, fix the test to count the items dynamically (regex over numbered lines between `## 42.` and `## 43.`).

- [ ] **Step 4.4: Commit**

```bash
git add tests/acceptance/docs-consistency.test.ts README.md
git commit -m "test(acceptance): add docs consistency guard + README alignment (TASK-018 T4)"
```

---

## Task 5: `pnpm test:acceptance` script

**Files:**
- Modify: `package.json` (1 line added)

- [ ] **Step 5.1: Add the script**

Add to `package.json` `scripts` (after the existing `test:coverage` line, before `test:live`):

```json
"test:acceptance": "vitest run --config vitest.config.ts tests/acceptance",
```

The exact insertion:

```diff
   "scripts": {
     "dev": "tsx src/cli.ts",
     "build": "tsc -p tsconfig.json",
     "start": "node dist/cli.js",
     "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
     "lint": "eslint .",
     "lint:fix": "eslint . --fix",
     "format": "prettier --write .",
     "format:check": "prettier --check .",
     "test": "vitest run --config vitest.config.ts",
     "test:coverage": "vitest run --config vitest.config.ts --coverage",
+    "test:acceptance": "vitest run --config vitest.config.ts tests/acceptance",
     "test:live": "vitest run --config vitest.live.config.ts",
     "test:live:list": "vitest list --config vitest.live.config.ts",
     "db:generate": "drizzle-kit generate --config drizzle.config.ts"
   },
```

- [ ] **Step 5.2: Run the acceptance suite via the new script**

Run: `pnpm test:acceptance`
Expected: every file under `tests/acceptance/` passes.

- [ ] **Step 5.3: Commit**

```bash
git add package.json
git commit -m "chore(scripts): add pnpm test:acceptance (TASK-018 T5)"
```

---

## Task 6: Full verification, task doc update, and INDEX flip

**Files:**
- Modify: `docs/tasks/TASK-018-integration-acceptance-verification.md`
- Modify: `docs/tasks/INDEX.md`

- [ ] **Step 6.1: Run the full verification suite**

Run, in this order, capturing each output:

```bash
pnpm typecheck    # expected: 0 errors
pnpm lint         # expected: 0 errors
pnpm format:check # expected: 0 errors (or fix with `pnpm format` and re-stage)
pnpm test         # expected: full suite passes (existing 1759 pass / 6 skip + ~80–120 new acceptance tests)
pnpm test:acceptance # expected: all acceptance files pass
pnpm test:live    # expected: 0 tests run, exit 0 (passWithNoTests: true)
pnpm build        # expected: dist/cli.js + all module .js files emitted
```

Save the captured output for Step 6.4.

- [ ] **Step 6.2: Run the live-test command in an isolated environment to confirm opt-in**

In a separate shell (or with a fresh sub-shell) confirm that:

```bash
pnpm test:live --list         # expected: 0 tests listed (or only skipIf-gated ones)
LINKEDIN_LIVE=1 pnpm test:live --list   # expected: tests/live/**/*.test.ts listed (gated by env var)
```

If `pnpm test:live --list` is not supported by the installed vitest version, run `pnpm test:live` with the env unset (expect `passWithNoTests: true` → exit 0) and with `LINKEDIN_LIVE=1` (expect the live tests to attempt network; this is the documented opt-in behaviour).

- [ ] **Step 6.3: Diff review — verify no accidental future-task work**

```bash
git diff main..feat/task-018-integration-acceptance-verification --stat
git diff main..feat/task-018-integration-acceptance-verification -- src/ drizzle/
```

Expected: zero changes under `src/` and `drizzle/`. Any drift must be either: (a) reverted, OR (b) split into a follow-up task documented in `docs/tasks/`.

- [ ] **Step 6.4: Update the TASK-018 task document**

Append an "Implementation results" section to `docs/tasks/TASK-018-integration-acceptance-verification.md` (mirrors the structure at TASK-017 §"Implementation results"). Include:

- The wave-by-wave commit list (one commit per Task 1–5; this Task 6 is the docs commit).
- A summary of test deltas (count of acceptance items + reliability items + CLI adapter cases added).
- The verification-commands transcript (truncated to the "PASS"/"FAIL" lines, not full output).
- An honest limitations list (e.g., items where evidence is fixture-only, items where the live-LinkedIn opt-in is not testable in CI).
- The "Known limitations" bullet list paralleling TASK-017.

Also update the `Status:` line at the top of `docs/tasks/TASK-018-integration-acceptance-verification.md`:

```diff
-**Status:** Planned; not approved for implementation
+**Status:** ✅ Implemented (see "Implementation results" below)
```

- [ ] **Step 6.5: Update INDEX.md**

Edit `docs/tasks/INDEX.md`:

1. Update the `TASK-018` row in the macro-tasks table:

```diff
- | [TASK-018](./TASK-018-integration-acceptance-verification.md) | Cross-system integration testing, diagnostics verification, and MVP acceptance | 001–017 | Full acceptance evidence, fixture coverage, reliability checks and final review |
+ | [TASK-018](./TASK-018-integration-acceptance-verification.md) | Cross-system integration testing, diagnostics verification, and MVP acceptance | 001–017 | ✅ Implemented — `tests/acceptance/` suite (acceptance-evidence, reliability, cli-adapters, docs-consistency) + `pnpm test:acceptance` script; live-LinkedIn opt-in guard; full verification transcript captured |
```

2. Update the `Implementation status:` paragraph at the top of INDEX.md to include TASK-018:

```diff
- **Status:** Planning decomposition approved for review; TASK-001 through TASK-013 and TASK-015 through TASK-017 implemented; TASK-014 was implemented across 7 commits on `feat/task-014-openai-scoring-ranking` (with parent-row setup deferred to a follow-up).
- **Implementation status:** TASK-001 through TASK-013 and TASK-015 through TASK-017 are implemented (TASK-007 was implemented across 1 commit on `feat/task-007-cv-import`; TASK-010 across 14 commits on `feat/task-010-deterministic-filters`; TASK-011 across 8 commits on `feat/task-011-guided-initialization`; TASK-012 across 5 wave commits on `feat/task-012-linkedin-discovery-result-loading`; TASK-014 across 7 commits on `feat/task-014-openai-scoring-ranking`; TASK-015 across 5 wave commits on `feat/task-015-pipeline-orchestration`; TASK-016 across 5 wave commits on `feat/task-016-inspection-tables-json-output`; TASK-017 across 5 wave commits on `feat/task-017-explicit-reevaluation`). A post-merge audit of TASK-007 is tracked at `docs/tasks/AUDIT-TASK-007-2026-08-13.md`. TASK-018 remains planned; no application code, dependencies, migrations, or generated output may be created for it until its own plan is approved.
+ **Status:** Planning decomposition approved for review; TASK-001 through TASK-018 implemented; TASK-014 was implemented across 7 commits on `feat/task-014-openai-scoring-ranking` (with parent-row setup deferred to a follow-up).
+ **Implementation status:** TASK-001 through TASK-018 are implemented (TASK-007 across 1 commit on `feat/task-007-cv-import`; TASK-010 across 14 commits on `feat/task-010-deterministic-filters`; TASK-011 across 8 commits on `feat/task-011-guided-initialization`; TASK-012 across 5 wave commits on `feat/task-012-linkedin-discovery-result-loading`; TASK-014 across 7 commits on `feat/task-014-openai-scoring-ranking`; TASK-015 across 5 wave commits on `feat/task-015-pipeline-orchestration`; TASK-016 across 5 wave commits on `feat/task-016-inspection-tables-json-output`; TASK-017 across 5 wave commits on `feat/task-017-explicit-reevaluation`; TASK-018 across 5 wave commits on `feat/task-018-integration-acceptance-verification`). A post-merge audit of TASK-007 is tracked at `docs/tasks/AUDIT-TASK-007-2026-08-13.md`.
```

- [ ] **Step 6.6: Commit the docs**

```bash
git add docs/tasks/TASK-018-integration-acceptance-verification.md docs/tasks/INDEX.md
git commit -m "chore(tasks): mark TASK-018 implemented + INDEX update (TASK-018 T6)"
```

---

## Completion criteria (mirrors the TASK-018 task document)

- Every MVP acceptance criterion (§42, items 1–43) has a passing test in `tests/acceptance/acceptance-evidence.test.ts` that cites the evidence path.
- Every reliability requirement (§40, 17 bullets) has a passing test in `tests/acceptance/reliability.test.ts` that cites the evidence path.
- The thin CLI adapter integration test (`tests/acceptance/cli-adapters.test.ts`) exercises every public command registered by `createProgram()` with fake dependencies and asserts the documented exit code and JSON shape.
- The docs-consistency test (`tests/acceptance/docs-consistency.test.ts`) passes for SPEC / AGENTS / GIT / README / tasks INDEX.
- Live-LinkedIn opt-in behaviour is verified by the guard tests in `cli-adapters.test.ts`.
- `pnpm test:acceptance` runs the new suite in isolation.
- Full `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:acceptance && pnpm build` all pass from a clean state.
- `pnpm test:live` exits 0 without network access.
- `docs/tasks/TASK-018-integration-acceptance-verification.md` carries the implementation results + honest limitations.
- `docs/tasks/INDEX.md` reflects TASK-018 as implemented.
- Zero changes under `src/` and `drizzle/` (verified by `git diff main..feat/task-018-integration-acceptance-verification -- src/ drizzle/`).
- User explicitly approves the merge per `GIT.md` §4 before the squash to `main`.

## Self-review

Run this checklist against the SPEC before reporting plan complete:

- **Spec coverage:** Each §42 numbered item (1–43) appears in Task 1's matrix; each §40 bullet appears in Task 2's matrix. Each §41.1 unit test area, §41.2 integration test area, and §41.3 scraper test requirement is exercised by at least one assertion in Task 1 + Task 3 (the CLI adapter suite's `run` subcommand test indirectly covers scraper fixture tests via the fake browser session). AGENTS.md §15 is satisfied by Task 6's completion-check commit. GIT.md §5 + §9 are reflected in the per-task commit + push workflow.
- **Placeholder scan:** No "TBD" / "TODO" / "implement later" markers. Every code snippet is concrete; every test command is runnable. The "evidence paths" in the matrix are placeholders for the implementation phase (verified at Task 1.4 run), but the test code itself is concrete.
- **Type consistency:** `AcceptanceHarness` types in Task 3.1 reference `Command`, `OpenAIClient`, `ScriptedPipelinePrompts`, `FakeOpenAIClient` — all exported from the existing codebase. The `captureStdStreams` helper's `process.exit` stub returns `never` (mirroring the Commander pattern). `CommanderExitError` is a local class defined in the test file. No cross-task type drift.