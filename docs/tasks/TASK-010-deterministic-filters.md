# TASK-010 — Global Deterministic Filters and Filter Fingerprints

**Status:** Implemented
**Order:** 010
**Dependencies:** TASK-004, TASK-009

## Scope

Implement one immutable global filter configuration and deterministic evaluation:

- Define and validate versioned filter configuration with excluded companies, title/description keyword rules, maximum seniority, accepted languages, and unsupported-language behavior.
- Provide the interactive `configure filters` flow with profile-derived language initialization, explicit preview, save/discard/exit, and atomic persistence.
- Keep one active global configuration; create a new immutable version for every change.
- Implement shared Unicode/whitespace/separator/alias keyword normalization with meaningful word boundaries and no fuzzy, stemming, regex, or substring matching by default.
- Implement title-only seniority detection with highest-level selection and unknown abstention.
- Implement phrase-based language requirement detection with explicit requirement, non-rejecting reference, and abstention outcomes.
- Produce auditable filter decisions containing evaluated rules, matched fields/keywords, reasons, and severity/outcome.
- Calculate filter fingerprints from job content, configuration, effective profile values, and implementation version.
- Reuse only matching current results and mark changed-input results stale without deleting history.
- Never call OpenAI.

Scoring and pipeline orchestration are out of scope.

## Dependencies and handoffs

- Uses repositories and invalidation operations from TASK-004.
- Consumes the active approved effective profile from TASK-009.
- Produces filter configuration/evaluation/fingerprint contracts for TASK-011, TASK-014, TASK-015, and TASK-017.

## Referenced specification sections

- `SPEC.md` §17.1–17.7 global filter configuration and lifecycle
- `SPEC.md` §18 deterministic keyword matching
- `SPEC.md` §19 deterministic seniority detection
- `SPEC.md` §20 deterministic language filtering
- `SPEC.md` §24.1–24.3 filter outcomes, details, and fingerprints
- `SPEC.md` §27.1–27.2 independent stage cache behavior
- `SPEC.md` §41.1 filter, matcher, seniority, language, and fingerprint tests

## Expected tests

- Validate configuration defaults, normalization, deduplication, versioning, and profile-derived language initialization.
- Test keyword boundaries including `Java` versus `JavaScript`, phrase matching, punctuation aliases, Unicode, and separator variants.
- Test excluded/required-any rules and explicit audit reasons.
- Test seniority mappings, highest-level precedence, equality/maximum checks, and unknown abstention.
- Test language required/preferred/ambiguous classification and accepted/unsupported outcomes.
- Verify filter errors remain errors rather than rejections.
- Verify empty required-any rules do not apply and stale fingerprints preserve historical results.
- Verify no OpenAI client is invoked by the filter engine.

## Verification requirements

- Run pure domain tests with representative fixtures and adversarial boundary cases.
- Run configuration/repository integration tests for immutable versions and invalidation.
- Run prompt/service tests without a terminal.
- Review the deterministic alias and phrase dictionaries as versioned implementation decisions.
- Run typecheck and focused tests.

## Completion criteria

- A complete job can receive an auditable accepted, rejected, or error result deterministically.
- Unknown seniority and uncertain language wording abstain as specified.
- Fingerprints make filter reuse/invalidation reproducible and historical.
- The filter subsystem has no OpenAI or browser dependency.

## Implementation results

### Verification date

2026-08-17

### Environment

- Node.js `v24.18.0`
- pnpm `11.18.0`
- Platform: linux-x64

### Branch

`feat/task-010-deterministic-filters`

### Dependency versions used

No new direct dependencies. TASK-010 uses only:

- `zod` (already pinned by TASK-001)
- `drizzle-orm@0.45.2` (already pinned by TASK-003)
- `better-sqlite3@13.0.3` (already pinned by TASK-003)
- `commander@15.0.0` (already pinned by TASK-001)
- `@inquirer/prompts@8.5.2` (already pinned by TASK-001, used by `src/filter/prompts-inquirer.ts` only)
- `node:crypto` (Node built-in)
- `vitest@4.1.10` (already pinned by TASK-001)

### Plan reference

`docs/superpowers/plans/2026-08-17-task-010-deterministic-filters.md`

### Commits

```
752c0d9 feat(filter): add configure filters CLI subcommand (TASK-010 Task 11)
eb02198 feat(filter): add ConfigureFiltersService with prompts seam and Inquirer adapter (TASK-010 Task 10)
dd91eda feat(filter): add FilterApplyService with cache ledger and persistence (TASK-010 Task 9)
888af56 fix(persistence): correct JSDoc on invalidateByFilterConfigVersion (TASK-010 Task 8)
9aca954 feat(persistence): add filterResults.invalidateByFilterConfigVersion (TASK-010 Task 8)
a2c5ec0 feat(filter): add filter fingerprint composer (TASK-010 Task 7)
08e7ba2 feat(filter): add composite rule evaluator with error-as-non-rejection semantics (TASK-010 Task 6)
7ae6045 feat(filter): extend language detector to scan union of accepted and known languages (TASK-010 Task 6 prerequisite)
e92f69c feat(filter): add language detection with versioned phrase patterns (TASK-010 Task 5)
1a04f20 feat(filter): add seniority detection and max-seniority rule (TASK-010 Task 4)
f60eff8 feat(filter): add keyword normalization, alias map, and token-stream matcher (TASK-010 Task 3)
511c3d3 feat(filter): add job and filter config content hashes (TASK-010 Task 2)
e72f728 fix(filter): anchor boundary guard to subpath imports and re-export SeniorityLevelSchema (TASK-010 Task 1)
a68d246 feat(filter): add version, schema, errors, and domain-boundary guard (TASK-010 Task 1)
```

### Verification commands and outcomes

| Command | Outcome |
|---|---|
| `pnpm install --frozen-lockfile` | `Already up to date` (no new deps) |
| `pnpm typecheck` | exit 0, no output |
| `pnpm lint` | exit 0, no output |
| `pnpm format:check` | `All matched files use Prettier code style!` (clean on first try after `pnpm format`) |
| `pnpm build` | exit 0, `dist/cli.js` produced |
| `pnpm test` | **98 files / 974 / 974 passing**, no regressions (was 911 before TASK-010 → +63 new tests across 14 filter test files, 1 CLI test file, and 1 integration test file) |
| `pnpm test:live` | exit 0, `No test files found` (TASK-010 has no live LinkedIn surface — correct) |
| Targeted boundary grep (`rg -n --type ts 'from .openai\|@inquirer/prompts\|playwright\|drizzle-orm\|"pino"' src/filter/`) | 1 actual import (the `@inquirer/prompts` line in `src/filter/prompts-inquirer.ts`, expected + allowed by the boundaries test) + 4 JSDoc comment mentions of `@inquirer/prompts` in the same three files. No `openai`, `playwright`, `drizzle-orm`, or `pino` imports anywhere in `src/filter/`. The boundaries guard test `tests/filter/boundaries.test.ts` confirms via runtime AST scan. |

### Test inventory

**New test files (15 total):**

- `tests/filter/boundaries.test.ts` — domain-boundary guard (AST scan + Inquirer allow-list)
- `tests/filter/configure-service.test.ts` — 8 tests: fresh config, edit-existing, discard, no-active-profile (×2), discarded-after-edits, corrupted persisted row, persistence failure
- `tests/filter/content-hash.test.ts` — 27 tests: `normalizeForHashing` + `calculateJobContentHash` + `calculateFilterConfigContentHash`
- `tests/filter/errors.test.ts` — 12 tests: every `FilterLifecycleError` subclass + base class
- `tests/filter/evaluate.test.ts` — 33 tests: composite rule evaluator (7 rules × scenarios) + synthetic internal failure → `outcome: 'error'`
- `tests/filter/fingerprint.test.ts` — 32 tests: SHA-256 shape, determinism, sensitivity, insensitivity, `null` profile, minimal input
- `tests/filter/integration.test.ts` — 1 end-to-end test: configure → apply → reuse → swap → re-apply (Task 12)
- `tests/filter/keyword-matcher.test.ts` — token-stream matcher
- `tests/filter/keyword-normalize.test.ts` — NFKC + separator folding
- `tests/filter/language-detector.test.ts` — required/preferred/ambiguous classification
- `tests/filter/schema.test.ts` — Zod defaults + dedup + sort
- `tests/filter/seniority-detector.test.ts` — phrase map + highest-wins
- `tests/filter/seniority-rule.test.ts` — max + equality + unknown abstention
- `tests/filter/service.test.ts` — 13 tests: cache hit / miss / config-version swap / no-active-config / title / seniority / language / all-pass / error / fingerprint-round-trip / pipelineRunId passthrough (×2)
- `tests/cli/configure-filters.test.ts` — 4 tests: save fresh / discard / no-active-profile / backward-compat

**Modified test files (1 total):**

- `tests/persistence/repositories/filter-results.test.ts` — added a 5-test `describe('invalidateByFilterConfigVersion')` block (Task 8)

**Modified source files (2 total):**

- `src/persistence/repositories/filter-results.ts` — added `invalidateByFilterConfigVersion` (Task 8)
- `src/cli.ts` — added `filterPrompts` option + `configure filters` subcommand (Task 11)

### Completion criteria checklist (mirror SPEC §42 + TASK-010 §Completion criteria)

1. **Acceptance / rejection / error per job** — `evaluateJob` produces one of `accepted | rejected | error`. Errors are NOT rejections (`tests/filter/evaluate.test.ts` — synthetic failure asserts `overallOutcome: 'error'`, `rejectionReasons: []`).
2. **Unknown seniority + uncertain language wording abstain** — `applySeniorityRule` returns `abstained` for `unknown` (`tests/filter/seniority-rule.test.ts`); `detectLanguageRequirements` returns empty `requirements` for reference-only phrases; the evaluator abstains the rule without rejecting (`tests/filter/language-detector.test.ts`, `tests/filter/evaluate.test.ts`).
3. **Fingerprint determinism + cache reuse** — `tests/filter/fingerprint.test.ts` (deterministic, sensitive to each sub-input). `tests/filter/service.test.ts` (cache hit / miss). `tests/filter/integration.test.ts` (end-to-end fingerprint + reuse + swap).
4. **No OpenAI / no browser / no schema migration** — `tests/filter/boundaries.test.ts` (runtime AST scan) + targeted grep (1 expected import). No new tables; `filter_configuration_versions` and `filter_results` are reused unchanged from TASK-004.
5. **10 named test categories** — every category in TASK-010 §Expected tests maps to the §Test strategy table in the plan (`docs/superpowers/plans/2026-08-17-task-010-deterministic-filters.md`).
6. **Versioned data + filters history preserved** — `invalidateByFilterConfigVersion` flips `active = false` (Task 8); `activateResult` deactivates the prior active row for the same job (TASK-004). `tests/filter/integration.test.ts` asserts prior rows are visible in `filterResults.listByJob` with `active = false` after a config swap.
7. **CLI subcommand** — `jobhunter configure filters` runs, prompts, saves, exits 0 with a fresh config; exits 0 with `discarded` when the user declines; exits 3 when no active profile exists. `tests/cli/configure-filters.test.ts` covers all three scenarios.
8. **Strict TypeScript** — `pnpm typecheck` exit 0; no `any` in `src/filter/`. The `as readonly unknown[]` cast in the JSON column decode path mirrors the existing pattern in `src/persistence/repositories/filter-results.ts` and is NOT an `any`.
9. **Public surface + barrel** — `src/filter/index.ts` re-exports every public symbol (Task 12). The CLI consumes `ConfigureFiltersService`, `FilterPrompts`, and `defaultInquirerFilterPrompts` via direct module imports (`src/filter/` has no `index.js`-style barrel required for the CLI; the barrel exists for downstream tasks).
10. **Documentation** — this "Implementation results" section + the `INDEX.md` one-line status update complete the documentation alignment.

### Known limitations / follow-ups

1. **Scoring invalidation by filter config version is still deferred.** `score_results` does not carry a `filter_config_version_id` column. TASK-015 must call this out in its plan and ask for approval (per AGENTS.md §12) if it adds a column or consults the active filter config at score time.
2. **No `--json` flag on `configure filters`.** Decision 9 defers this to TASK-016. The CLI handler stays human-readable; the persisted config is reachable via `db_inspect` or the SQLite file.
3. **Alias map and language phrase patterns are versioned constants that may need to grow.** They are tracked as `KEYWORD_ALIAS_VERSION` (1.0.0) and `LANGUAGE_PATTERN_VERSION` (1.1.0, bumped in Task 6 prerequisite to add the `KNOWN_LANGUAGES` union). Adding a new alias or phrase is a one-line edit + a test; bumping the version is a separate concern (the filter implementation version is what enters the fingerprint, not the dict version).
4. **Filter implementation version is bumped manually.** Decision 5 sets `FILTER_IMPLEMENTATION_VERSION = '1.0.0'`. A future task may add a curated test that forces the version bump and re-evaluates a snapshot to confirm the new version emits a different fingerprint. Out of scope for TASK-010.
5. **Keyword normalization duplicates skill / language normalization primitives.** Decision 1 keeps `src/filter/` self-contained — the keyword normalization is a thin variation of the profile name normalization. The implementing agent should NOT extract a shared `src/text-normalize/` module; the duplication is intentional and small.
6. **`filter_results` history grows over time.** Like `score_results`, the table accumulates one row per (job, fingerprint) cycle. The MVP does not garbage-collect; future tasks may add a cleanup hook.
7. **Integration points with downstream tasks (TASK-011, 014, 015, 017) are documented in the `FilterApplyService` API + `FilterApplyResult` shape.** The orchestrator in those tasks is responsible for:
   - calling `FilterApplyService.apply` per job;
   - persisting a `pipeline_runs` row + `jobs` row (preceding the filter call);
   - calling `filterResults.invalidateByFilterConfigVersion` when the active config changes (mid-run or otherwise);
   - carrying the `filterResultId` forward into `score_results` (TASK-015 inserts that FK).
8. **No live `pnpm test:live` coverage.** The filter engine is purely deterministic and unit-tested; the live tests target LinkedIn scraper behavior in TASK-014. `pnpm test:live` is empty and exits 0.
9. **Task 8 JSDoc fix commit (`888af56`).** The Task 8 implementation originally said "a row tied to both versions requires BOTH methods to be flipped inactive"; the reviewer's post-review fix replaced it with "either method alone is enough (first call wins, second call is a no-op)". The contract is now consistent with the actual SQL semantics.
