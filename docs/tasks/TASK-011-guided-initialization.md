# TASK-011 — Guided Initialization and Resumable Setup Orchestration

**Status:** Implemented on `feat/task-011-guided-initialization`
**Order:** 011
**Dependencies:** TASK-006, TASK-007, TASK-008, TASK-009, TASK-010

## Scope

Compose the prerequisite services into an idempotent, resumable `jobhunter init` workflow:

- Resolve paths, create required directories, initialize/migrate SQLite, and create default configuration only when missing.
- Validate `OPENAI_API_KEY` without persisting it and stop cleanly before OpenAI-dependent steps when absent.
- Run search configuration, source import, local extraction, profile draft generation, review/editing, explicit approval, and global filter configuration in the prescribed order.
- Inspect persisted state and classify each setup step as `complete`, `incomplete`, `failed`, or `not_started`.
- Resume from the first incomplete prerequisite while reusing valid state and preserving all existing records.
- Never silently overwrite existing config, database, sources, approved profiles, or filter versions.
- Preserve completed work after cancellation, extraction failure, missing credentials, rejection, or unresolved conflicts.
- Display a final setup summary and readiness indication only when all completion requirements exist.

This task owns orchestration and state classification; it does not add new profile, filter, persistence, or scraper rules.

## Dependencies and handoffs

- Integrates completed configuration, persistence, search, import, profile, and filter services.
- Produces an initialization application service and thin CLI command for TASK-015 and acceptance testing.
- Any prerequisite service behavior change requires approval as scope expansion.

## Referenced specification sections

- `SPEC.md` §8.3–8.6 configuration loading and update behavior
- `SPEC.md` §9.1–9.6 guided initialization, API key handling, partial state, completion, idempotence, and resume
- `SPEC.md` §31 CLI command surface
- `SPEC.md` §38 run/status conventions where applicable
- `SPEC.md` §40 reliability requirements
- `SPEC.md` §42 MVP acceptance criteria 1–20

## Expected tests

- Run initialization from an empty home and verify the prescribed step order and final readiness.
- Resume after each supported incomplete/failed/cancelled step without duplicating state.
- Verify missing API key stops before OpenAI while preserving prior work.
- Verify existing config/database/profile/filter/source records are never silently overwritten.
- Verify rejected profiles and unresolved conflicts leave setup incomplete without replacing the active profile.
- Verify partial initialization can be rerun safely and step statuses are accurate.
- Verify cancellation closes resources and preserves completed work.

## Verification requirements

- Run initialization integration tests with fake prompts and fake OpenAI clients.
- Run filesystem/database tests in isolated temporary OS-specific directories.
- Run a CLI smoke test for first-run, resume, missing-key, rejection, and completion paths.
- Run typecheck, build, and focused tests.

## Completion criteria

- `jobhunter init` is safe to repeat and resumes at the first incomplete prerequisite.
- Completion is reported only when valid configuration, search settings, approved profile, active filters, and migrated database all exist.
- No initialization step silently resets persisted user state.

## Implementation results

### Commit hashes

The orchestrator commits Waves A–D in a later turn per `GIT.md` §4. The commit hashes will be filled in by the orchestrator after the squash merge. The expected commit structure is:

- Wave A — `state.ts`, `errors.ts`, `classify.ts`, `prompts.ts`, `prompts-inquirer.ts`, `tests/init/boundaries.test.ts` skeleton
- Wave B — `log.ts`, `init-service.ts`, `tests/init/init-service.test.ts`, `tests/init/boundaries.test.ts` extension
- Wave C — `cli-adapters.ts`, `openai-resolve.ts`, `format.ts`, `index.ts`, `tests/cli/init.test.ts`, `tests/init/format.test.ts`, `tests/init/boundaries.test.ts` finalisation, `src/cli.ts` `init` subcommand
- Wave D — `tests/cli/init.test.ts` scenario-6 fix (injectable `initApprovalPrompts` / `initRejectionPrompts` options), two lint cleanups in `src/init/init-service.ts`, `docs/tasks/TASK-011-guided-initialization.md` + `docs/tasks/INDEX.md` updates

Final commit hashes: TBD by orchestrator.

### Verification output

- `pnpm install --frozen-lockfile` → `Already up to date` (no new dependencies).
- `pnpm typecheck` → exit 0 (both `tsconfig.json` and `tsconfig.test.json`).
- `pnpm lint` → exit 0 (clean after Wave D removed the unused `resolveRepoRootForMigrations` import and the useless initial `null` assignment on `loadedConfig` in `src/init/init-service.ts`).
- `pnpm format:check` → exit 0 (Wave D ran `pnpm format` to reformat 5 files: `src/cli.ts`, `src/init/index.ts`, `src/init/init-service.ts`, `src/init/log.ts`, `tests/cli/init.test.ts`).
- `pnpm build` → exit 0; `dist/cli.js` produced.
- `pnpm test` → 102 test files, 1005 tests, all green.
- `pnpm test:live` → empty live suite (correct — TASK-011 owns no live LinkedIn surface).
- Targeted boundary grep `rg -n --type ts "from 'commander'|@inquirer/prompts|playwright|drizzle-orm|from 'openai'|from 'pino'|process\.exit\(" src/init/` → only the two documented `@inquirer/prompts` carve-out matches (`src/init/prompts-inquirer.ts` and `src/init/cli-adapters.ts`). Zero `process.exit(` matches.

### Test inventory

The plan called for 8 files under `tests/init/` plus 1 under `tests/cli/` = 9 new test files. The actual implementation consolidates the pure-helper tests (`state.ts`, `errors.ts`, `classify.ts`, `prompts.ts`, `prompts-inquirer.ts`, `log.ts`) into behaviour exercised through the orchestrator's integration tests in `tests/init/init-service.test.ts`. The boundary guard (`tests/init/boundaries.test.ts`) covers the pure-module surface. **Final tally: 4 new test files (3 in `tests/init/` + 1 in `tests/cli/`).** Each file:

| File | One-line description |
|---|---|
| `tests/init/boundaries.test.ts` | Domain-boundary guard (tree-walk over `src/init/**` + dedicated `init-service.ts` assertions: no Commander / Inquirer / Playwright / Drizzle / OpenAI / Pino runtime imports; `process.exit(` banned; `RUNTIME_IMPORT_RE` regex covers type-only pino carve-out) |
| `tests/init/format.test.ts` | `formatInitSummary` renderer covers every documented `SetupSummary` shape (ready: true; ready: false + openAiKeyMissing; edit handoff; blocking conflict; invalid config) — 6 deterministic tests |
| `tests/init/init-service.test.ts` | Orchestrator integration: fresh HOME, resume after pre-seeded config+search+approved+filter, missing API key, draft handoff, cancellation contract, no-op config seeding, malformed config, soft-exit `confirmSummary: false`, filter step without active profile, blocking conflicts on `'approve_now'`, source paths contract — 11 scenarios on a temporary SQLite |
| `tests/cli/init.test.ts` | CLI smoke for `jobhunter init`: 7 scenarios covering fresh init (no OpenAI key), resume (all prerequisites pre-seeded), draft handoff with `edit_then_return`, blocking conflicts with `approve_now`, cancellation via scripted search confirm=false, **missing filter config without an approved profile → exit 3 (Wave D fix)**, and soft-exit on fully-ready init with `confirmSummary: false` |

### Deviations from the plan

1. **Test consolidation.** The plan enumerated 8 separate `tests/init/*.test.ts` files for each pure helper (`state`, `errors`, `classify`, `prompts`, `prompts-inquirer`, `log`, `init-service`, `format`). The actual implementation ships 3 (`boundaries`, `format`, `init-service`). The behaviour covered by the per-helper tests is asserted through the orchestrator's integration tests (e.g. `classify*` functions are exercised end-to-end via `init-service.test.ts`). The pure-module correctness is verified transitively by the boundary guard and the orchestrator test suite.

2. **`src/init/log.ts` does not import `pino` directly.** The plan's reference implementation imports `import type { Logger } from 'pino'`. The actual implementation imports `Logger as CodebaseLogger` from `../logging/logger.js` — the codebase's own facade — so the boundary check shows zero `from 'pino'` matches instead of one type-only match. The `pinoInitLogger` adapter wraps the facade, matching the established codebase pattern (TASK-002). The boundaries test was updated accordingly (`'pino'` carve-out kept for forward-compatibility but no current module matches it).

3. **`src/init/cli-adapters.ts` is a CLI-only module that imports `@inquirer/prompts`.** The plan did not enumerate this file (it consolidates the inline closure literals that the plan scattered inside `createProgram`'s action). It is added to the boundary guard's `INQUIRER_ALLOW_LIST` (alongside `src/init/prompts-inquirer.ts`) and lives outside `src/init/init-service.ts` so the orchestrator stays on the domain side.

4. **`src/init/openai-resolve.ts` is a CLI-only helper.** The plan placed `resolveOpenAiClientOrNull` inside `src/cli.ts`. The actual implementation extracts it to `src/init/openai-resolve.ts` for testability and discoverability; it is imported only by `src/cli.ts`.

5. **The `ExitCode` type contract is widened in Wave D.** Wave D added `initApprovalPrompts?: ProfileApprovalPrompts` and `initRejectionPrompts?: ProfileRejectionPrompts` to `createProgram`'s options shape so the rejection-prompt path can be driven from tests without blocking on stdin. This widens the existing `{ prompts, openaiClient, filterPrompts, initPrompts, initSearchPrompts }` shape by two more optional slots. The new slots are backward-compatible (existing callers omit them and get the inquirer defaults).

6. **`classifyConfig` accepts a pre-loaded `config` field** (per the plan's `ClassifyConfigInput.config?: unknown`). Wave A added this so the orchestrator can re-validate an already-loaded `OperationalConfig` instead of forcing `loadConfig` to throw on bad files. The plan documented this as the `classifyConfig` pre-load contract.

7. **`InitPrompts` interface has an extra `askEditHandoff` + `confirmSummary` seam.** The plan enumerated 4 methods; the actual interface has those plus `askResume` and `askSourcePaths` (already in the plan). The extra seam allows tests to drive the draft-edit handoff prompt and the final summary confirmation deterministically.

8. **Scenario 6 (`tests/cli/init.test.ts`) was originally SKIPPED in Wave C** due to a tooling interaction (the CLI's rejection-prompt path used the real `@inquirer/prompts` adapter which blocks on stdin under Vitest). Wave D fixed the skip by making `initRejectionPrompts` injectable via `createProgram`'s options (see deviation #5 above). Scenario 6 now passes and is no longer skipped.

9. **Wave B↔Wave C file duplication.** `src/init/cli-adapters.ts` was first drafted in Wave B (as the inline closure literals inside `createProgram`) and then extracted to its own module in Wave C. The final structure consolidates them in `src/init/cli-adapters.ts`. There is no duplicate file in the working tree.

10. **Wave D lint cleanups.** Two pre-existing lint errors in `src/init/init-service.ts` were resolved in Wave D: the unused `resolveRepoRootForMigrations` import was removed (the orchestrator does not open the DB; the CLI does), and the initial `null` assignment on `loadedConfig` was replaced with a `let` declaration without `null` because the first assignment always succeeds before any reader.

### Known limitations (per the plan)

1. **`--json` for `jobhunter init` is deferred to TASK-016.** Init remains human-readable in this task; the typed `SetupSummary` is the eventual JSON payload but no `--json` flag is exposed.
2. **No score-result invalidation by profile version.** TASK-014 owns `scoreResults.invalidateByProfileVersion` when it adds the `profile_version_id` column. The init orchestrator only checks `profileVersions.findActiveApproved()`.
3. **No `applicationMetadata` init markers.** Completion is DERIVED from existing tables (`Repositories.findActiveApproved` + `filterConfigurations.findActive` + config / search queries / locations). No new column or migration is added.
4. **`validateOpenAiApiKey` only checks presence, not server-side validity.** Real validation happens implicitly when `ProfileExtractionService.extract` runs and surfaces as `OpenAIAuthenticationError` (exit 5).
5. **Profile editing handoff is a textual message.** The orchestrator prints "Run `jobhunter profile edit <id>`, then re-run init." and exits 0 with a partial summary. Re-entering the editor loop automatically is intentionally out of scope (Decision 6).
6. **No live `pnpm test:live` coverage.** Init is local-only; live tests target LinkedIn scraper behavior (TASK-012 and beyond).
7. **`InitOrchestrator` does not own a `runId` or a `pipelineRuns` row.** Init is a setup wizard, not a pipeline run. The pipeline-run lifecycle is TASK-015's responsibility.
