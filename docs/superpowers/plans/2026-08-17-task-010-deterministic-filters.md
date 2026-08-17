# TASK-010 Implementation Plan — Global Deterministic Filters and Filter Fingerprints

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build the global deterministic filter engine and filter fingerprints that the rest of the pipeline (TASK-011, 014, 015, 017) depends on. The implementation covers the full `jobhunter configure filters` interactive flow, the versioned `JobFilterConfig` schema, the keyword/seniority/language evaluators, the fingerprint calculator, and the cache-shaped persistence path. The filter engine never calls OpenAI, never browses, and never imports CLI or persistence modules.

**Architecture:** A new `src/filter/` sibling of `src/profile/` houses the pure domain. The leaf modules — `keyword-normalize.ts`, `keyword-aliases.ts`, `keyword-matcher.ts`, `seniority-detector.ts`, `language-detector.ts`, `content-hash.ts`, `fingerprint.ts`, `evaluate.ts`, `schema.ts`, `version.ts` — are pure functions with no I/O (SPEC §17.1–17.6 + §18 + §19 + §20 + §24.1–24.3 + §27.1–27.2 + §41.1). Two application services compose them: `FilterApplyService` (loads the active config + active approved profile, builds the fingerprint, looks up a cached active result on `filter_results`, evaluates if missing, and persists via `filterResults.activateResult`) and `ConfigureFiltersService` (interactive prompts in the `ConfigureSearchService` style, profile-derived language initialization, preview → save/discard/exit, atomic version activation). The CLI adds a single `configure filters` subcommand that wires the Inquirer adapter. A new `filterResults.invalidateByFilterConfigVersion(configVersionId)` mirrors the existing `invalidateByProfileVersion` and is the only new persistence method. The test surface mirrors the SPEC §41.1 mandate (keyword matching, alias normalization, seniority detection, language requirement detection, filter rule evaluation, fingerprint coverage).

**Tech Stack:** No new dependencies. Reuses `zod`, `drizzle-orm@0.45.2`, `better-sqlite3@13.0.3`, `commander`, `@inquirer/prompts`, `node:crypto`, `vitest`, the existing `Repositories` facade, and the existing `FilterConfigurationRepository` / `FilterResultRepository` from TASK-004. No new database tables or migrations are required — TASK-003 already created `filter_configuration_versions` and `filter_results` with the columns and partial unique indices TASK-010 needs.

## Open decisions confirmed before implementation

These map to the 11 pinned decisions in `.slim/deepwork/task-010-deterministic-filters.md` and to the SPEC §17 / §18 / §19 / §20 / §24 / §27 references. The implementing agent must stop and ask the user to confirm all 11 resolutions before any file in `src/filter/` is edited.

| # | Decision | Resolution | SPEC ref |
|---|---|---|---|
| 1 | Directory location | New `src/filter/` (sibling of `src/profile/`). | §17.1 |
| 2 | `SeniorityLevel` source | Reuse `SeniorityLevelSchema` and `SENIORITY_LEVELS` from `src/profile/schema.ts`. Do NOT create a duplicate enum. | §19, §17.2 |
| 3 | Language name normalization | Reuse `normalizeLanguageName` from `src/profile/name-normalize.ts`. Do NOT duplicate the alias map. | §17.6, §20 |
| 4 | Versioned data modules | New `src/filter/keyword-aliases.ts` and `src/filter/language-patterns.ts` as versioned constants (parallel to `src/profile/name-aliases.ts`). | §18, §20 |
| 5 | Filter implementation version | `FILTER_IMPLEMENTATION_VERSION = '1.0.0'` exported from `src/filter/version.ts`. Bump on any outcome-changing edit. | §24.2 |
| 6 | Job content hash | SHA-256 over the normalized title, company, location, and description (newlines between fields), via `node:crypto`. Stored on `filter_results.fingerprint` (composed with config + profile + version). | §24.3, §27.1 |
| 7 | Profile values that participate in the fingerprint | `derived.likelySeniority.effectiveValue`, `derived.primaryRoles.effectiveValue`, `derived.primaryDomains.effectiveValue`, `derived.strongestSkills.effectiveValue`, `languages[].normalizedName`, `skills[].normalizedName`. Only this slice is passed to the hash function. **Deviation from the deepwork pinned list:** the deepwork subset listed only 2 derived values (`likelySeniority`, `primaryRoles`); the plan widens to all 4 derived values per SPEC §16.7. This is more SPEC-faithful and must be re-confirmed by the user before Task 7 is implemented. | §24.3, §16.7 |
| 8 | Repository invalidation | Add `filterResults.invalidateByFilterConfigVersion(configVersionId: number): Promise<number>` that mirrors `invalidateByProfileVersion` (transaction, count active rows, mark inactive, return count). Invoked after a new filter config is activated and any time fingerprint inputs change. | §16.3 step 9, §27.1 |
| 9 | CLI presentation | One subcommand `configure filters` with Inquirer prompts in the `ConfigureSearchService` style. `--json` is deferred to TASK-016. Tests inject a failing / scripted prompts adapter. | §17.3, §5.3 |
| 10 | Domain boundaries | No schema migration, no new dependencies, no OpenAI, no browser, no Commander/Inquirer/Drizzle/Pino in `src/filter/` (pure domain) or `src/filter/evaluate.ts`. Application services in `src/filter/service.ts` orchestrate prompts + persistence. | §17, AGENTS.md §5 / §9 |
| 11 | Stale-result handling | The existing `activateResult` already deactivates prior active rows for the same job; the new active row supersedes the old one. The "kept but inactive" rule is satisfied by the existing schema. No new invalidation logic is added for stale rows. The `invalidateByFilterConfigVersion` mirror covers the per-config invalidation path. | §27.1, §27.4 |

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §9):** Files under `src/filter/` (and especially `src/filter/evaluate.ts`) **must not** import Commander, Inquirer, Playwright, Drizzle, the `openai` SDK, or Pino. They may import `zod`, Node built-ins (`node:crypto`), and the existing `src/profile/*.js` siblings that pure domain is allowed to reuse (`SeniorityLevelSchema`, `normalizeLanguageName`). Application services in `src/filter/service.ts` and `src/filter/configure-service.ts` are the only files that may import both the pure helpers and the persistence repositories.
- **Editor / Inquirer isolation:** The `FilterPrompts` interface (`src/filter/prompts.ts`) is the seam. The default Inquirer adapter (`src/filter/prompts-inquirer.ts`) is the only module that imports `@inquirer/prompts`. Tests inject a `FailingFilterPrompts` or `ScriptedFilterPrompts` (mirrors `createFailingPrompts` from `search/`). The CLI never invokes `@inquirer/prompts` directly.
- **Validation:** Zod at every external boundary. `JobFilterConfigSchema` is the canonical validator; persisted `configJson` is revalidated through `JobFilterConfigSchema.safeParse` on load. The `rulesEvaluatedJson`, `rulesPassedJson`, `rulesFailedJson`, and `rejectionReasonsJson` columns are decoded via `jsonColumn<unknown>` (the existing codec). Domain validation lives in the pure helpers, not at the repository boundary.
- **Errors:** Typed errors extending `ApplicationError`. New lifecycle error codes are added to `src/filter/errors.ts`. Approval-style errors map to `ExitCode.InvalidUsage` (2) for invalid configuration payloads, `ExitCode.UserCancellation` (130) for user-cancelled flows, and `ExitCode.Fatal` (1) for storage failures. The evaluator itself never throws — filter errors are recorded as `FilterOutcome = 'error'` on the result row (SPEC §24.1).
- **History preservation (AGENTS.md §6):** Every filter config is immutable after persistence. Every approval-style action creates a new `filter_configuration_versions` row and flips the prior active row inactive. `filter_results` history is preserved via `activateResult` (which deactivates the prior active row for the same job but keeps the row visible in `listByJob`).
- **Determinism:** Job content hashing, keyword normalization, alias resolution, seniority detection, language detection, fingerprint composition, and evaluation are pure functions of their inputs. The `FailingFilterPrompts` and `ScriptedFilterPrompts` adapters make the interactive flow deterministic in tests.
- **Tests:** Vitest. Pure-domain tests are deterministic and unit-style. Service tests use the scripted prompts adapter. Repository tests use temporary SQLite databases (`mkdtempSync(join(tmpdir(), 'jobhunter-...'))`). CLI smoke tests use `process.exit`/`stdout`/`stderr` capture as in TASK-009. No live network, no live LinkedIn, no live OpenAI.
- **JSON output discipline (AGENTS.md §10):** `configure filters` stays human-readable in TASK-010. Structured `--json` output is deferred to TASK-016 per the pinned decision. The filters flowed through `FilterApplyService` are written to the DB; no stdout.
- **No secrets:** Repositories and services must not log configuration payloads (the operator can view them via `configure filters` interactively), raw prompts, raw model responses, or any user-typed filter value beyond the field path and resolution type.

## File Structure

```
src/filter/
  version.ts                             # NEW: FILTER_IMPLEMENTATION_VERSION + Pin (Task 1)
  schema.ts                              # NEW: JobFilterConfigSchema (Zod, schemaVersion: 1) (Task 1)
  errors.ts                              # NEW: typed filter lifecycle errors (Task 1)
  content-hash.ts                        # NEW: job content hash + filter config content hash (Task 2)
  keyword-aliases.ts                     # NEW: versioned keyword alias map (Task 3)
  keyword-normalize.ts                   # NEW: Unicode/whitespace/separator normalization (Task 3)
  keyword-matcher.ts                     # NEW: matcher with word boundaries + phrase support (Task 3)
  seniority-detector.ts                  # NEW: title-only phrase detection + highest-wins (Task 4)
  seniority-rule.ts                      # NEW: max-seniority rule abstention logic (Task 4)
  language-patterns.ts                   # NEW: versioned required/reference phrase patterns (Task 5)
  language-detector.ts                   # NEW: phrase pattern matching + classification (Task 5)
  evaluate.ts                            # NEW: composite rule evaluator (Task 6)
  fingerprint.ts                         # NEW: filter fingerprint composer (Task 7)
  service.ts                             # NEW: FilterApplyService (Task 9)
  configure-service.ts                   # NEW: ConfigureFiltersService (Task 10)
  prompts.ts                             # NEW: FilterPrompts interface + failing/scripted adapters (Task 10)
  prompts-inquirer.ts                    # NEW: default @inquirer/prompts adapter (Task 10)
  index.ts                               # NEW: public re-exports (Task 12)
src/persistence/repositories/
  filter-results.ts                      # MODIFIED: add invalidateByFilterConfigVersion (Task 8)
src/errors/application-error.ts          # (unchanged — ExitCode already covers filter lifecycle)
src/cli.ts                               # MODIFIED: add `configure filters` subcommand (Task 11)
tests/filter/
  schema.test.ts                         # (Task 1)
  errors.test.ts                         # (Task 1)
  content-hash.test.ts                   # (Task 2)
  keyword-normalize.test.ts              # (Task 3)
  keyword-matcher.test.ts                # (Task 3)
  seniority-detector.test.ts             # (Task 4)
  seniority-rule.test.ts                 # (Task 4)
  language-detector.test.ts              # (Task 5)
  evaluate.test.ts                       # (Task 6)
  fingerprint.test.ts                    # (Task 7)
  boundaries.test.ts                     # NEW: assert no OpenAI/CLI/Playwright/Drizzle/Pino imports (Task 1 + 6)
  service.test.ts                        # (Task 9)
  configure-service.test.ts              # (Task 10)
  integration.test.ts                    # cross-service end-to-end (Task 12)
tests/persistence/repositories/
  filter-results.test.ts                 # MODIFIED: add invalidateByFilterConfigVersion tests (Task 8)
tests/cli/
  configure-filters.test.ts              # NEW: CLI smoke for `configure filters` (Task 11)
```

Files change together by responsibility. The pure helpers (`version.ts`, `schema.ts`, `errors.ts`, `content-hash.ts`, `keyword-*.ts`, `seniority-*.ts`, `language-*.ts`, `evaluate.ts`, `fingerprint.ts`) have no Drizzle, no Commander, no Inquirer, no OpenAI, no Pino, no Playwright imports. Application services are the only layer that touches both the helpers and the `Repositories` facade. The CLI layer is a thin shell that opens the database, builds the prompts adapter, calls the service, and renders the result.

---

### Task 1: Filter version, schema, errors, and DOMAIN-BOUNDARY guard

**Files:**
- Create: `src/filter/version.ts`
- Create: `src/filter/schema.ts`
- Create: `src/filter/errors.ts`
- Create: `tests/filter/schema.test.ts`
- Create: `tests/filter/errors.test.ts`
- Create: `tests/filter/boundaries.test.ts` (skeleton — extended in Task 6)

**Goal:** Establish the constant, the Zod schema, the typed error family, and the boundary-guard test that fails if any forbidden dependency shows up under `src/filter/`. Reuse `SeniorityLevelSchema` from `src/profile/schema.ts` (Decision 2) and `normalizeLanguageName` from `src/profile/name-normalize.ts` (Decision 3).

**`version.ts`:**

```ts
/**
 * Filter engine implementation version (SPEC §24.2, Decision 5).
 * Bump on any change that alters filter outcomes (alias map, phrase patterns,
 * evaluation order, abstention semantics). Pure data-only changes do NOT
 * require a bump.
 */
export const FILTER_IMPLEMENTATION_VERSION = '1.0.0' as const;
export type FilterImplementationVersion = typeof FILTER_IMPLEMENTATION_VERSION;
```

**`schema.ts`:** Define `JobFilterConfigSchema` matching SPEC §17.2 verbatim with `schemaVersion: z.literal(1)` and `.strict()` (AGENTS.md §6 — reject unknown fields). Re-export `SeniorityLevelSchema` from `src/profile/schema.ts` — DO NOT define a new enum. Expose a `normalizeJobFilterConfig(input)` helper that trims company strings, dedupes (case-insensitive after normalization), and sorts (deterministic order for tests). Export `FILTER_SCHEMA_VERSION = 1` (the literal pinned value).

```ts
import { z } from 'zod';
import { SeniorityLevelSchema } from '../profile/schema.js';

export const FILTER_SCHEMA_VERSION = 1;

export const JobFilterConfigSchema = z
  .object({
    schemaVersion: z.literal(FILTER_SCHEMA_VERSION),
    excludedCompanies: z.array(z.string()),
    title: z.object({
      excludedKeywords: z.array(z.string()),
      requiredAnyKeywords: z.array(z.string()),
    }),
    description: z.object({
      excludedKeywords: z.array(z.string()),
      requiredAnyKeywords: z.array(z.string()),
    }),
    seniority: z.object({
      maximum: SeniorityLevelSchema.nullable(),
    }),
    languages: z.object({
      accepted: z.array(z.string()),
      rejectWhenExplicitlyRequiresOtherLanguage: z.boolean(),
    }),
  })
  .strict();

export type JobFilterConfig = z.infer<typeof JobFilterConfigSchema>;
```

**`errors.ts`:** Mirror the TASK-009 `ProfileLifecycleError` pattern. Add `FilterLifecycleError` (base, free `exitCode`), and the following subclasses:

- `InvalidFilterConfigError` → `ExitCode.InvalidUsage` (code `invalid_filter_config`)
- `InvalidFilterPayloadError` → `ExitCode.InvalidUsage` (code `invalid_filter_payload`)
- `NoActiveProfileError` → `ExitCode.MissingRequired` (code `no_active_profile`) — raised when `configure filters` is invoked before the first profile approval (SPEC §17.3 first-run gate)
- `UserCancelledFilterConfigError` → `ExitCode.UserCancellation` (code `filter_config_cancelled`)
- `FilterStorageError` → `ExitCode.Fatal` (code `filter_storage_error`)

The evaluator itself never throws — it records `overallOutcome: 'error'` on the result row (SPEC §24.1). The CLI maps storage errors to `ExitCode.Fatal`.

**`boundaries.test.ts` (skeleton — extended in Task 6):** The first test in this file opens every `.ts` file under `src/filter/` and asserts the file's source does NOT import any of: `commander`, `@inquirer/prompts`, `playwright`, `drizzle-orm`, `openai`, `pino`. This is the architectural-floor guard from AGENTS.md §5 / §9. The test re-runs after every protective check (Tasks 1, 3, 4, 5, 6, 7) and stays green.

Allow-list (carved out during Task 10): `src/filter/prompts-inquirer.ts` is the ONE module under `src/filter/` that is allowed to import `@inquirer/prompts`. The boundary test encodes that exception explicitly. Pattern:

```ts
const INQUIRER_ALLOW_LIST = new Set(['src/filter/prompts-inquirer.ts']);
// For every file under src/filter/**:
for (const banned of BANNED_IMPORTS) {
  if (banned === '@inquirer/prompts' && INQUIRER_ALLOW_LIST.has(file)) continue;
  expect(file).not.toMatchImport(banned);
}
```

No other carve-outs. If a future task needs to import `@inquirer/prompts` from another module, the test must be updated with the new allow-list entry, and the update must be explicitly justified in the task description.

**Interfaces:**

```ts
// src/filter/version.ts
export const FILTER_IMPLEMENTATION_VERSION: '1.0.0';
export type FilterImplementationVersion = typeof FILTER_IMPLEMENTATION_VERSION;

// src/filter/schema.ts
export const FILTER_SCHEMA_VERSION: 1;
export const JobFilterConfigSchema: z.ZodType<JobFilterConfig>;
export type JobFilterConfig = z.infer<typeof JobFilterConfigSchema>;
export function normalizeJobFilterConfig(input: JobFilterConfig): JobFilterConfig;

// src/filter/errors.ts
export class FilterLifecycleError extends ApplicationError { /* free exitCode */ }
export class InvalidFilterConfigError extends FilterLifecycleError { /* InvalidUsage */ }
export class InvalidFilterPayloadError extends FilterLifecycleError { /* InvalidUsage */ }
export class NoActiveProfileError extends FilterLifecycleError { /* MissingRequired */ }
export class UserCancelledFilterConfigError extends FilterLifecycleError { /* UserCancellation */ }
export class FilterStorageError extends FilterLifecycleError { /* Fatal */ }
```

**Tests:**
- `schema.test.ts` — Accepts a representative valid config; rejects unknown fields (e.g. `schemaVersion: 2`, `extra: true`); rejects `seniority.maximum` outside the enum; rejects non-string arrays in `excludedCompanies`; `normalizeJobFilterConfig` trims, dedupes case-insensitively, and sorts deterministically.
- `errors.test.ts` — Each new error maps to the documented `exitCode` and `code`; `toJSON` returns the documented shape.
- `boundaries.test.ts` — Skeleton: scans `src/filter/**/*.ts` and asserts no forbidden imports. Task 6 extends this with the "filter errors are not rejections" assertion (the latter lives in `evaluate.test.ts` and is verified via the boundaries test).

**Verification:**
- `pnpm test tests/filter/schema.test.ts tests/filter/errors.test.ts tests/filter/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 2: Job content hash + filter config content hash

**Files:**
- Create: `src/filter/content-hash.ts`
- Create: `tests/filter/content-hash.test.ts`

**Goal:** Two pure hash helpers used by Task 7 (filter fingerprint composition):

1. `calculateJobContentHash(input)` — SHA-256 over the normalized title, company, location, and description, joined by `\n` (Decision 6). Each field is normalized with the same function used by the keyword matcher (Task 3) so the hash is invariant to whitespace and case.
2. `calculateFilterConfigContentHash(config)` — Stable JSON serialization of the normalized `JobFilterConfig` (sorted keys, no whitespace, similar to `calculateProfileContentHash` in `src/profile/content-hash.ts`) followed by SHA-256.

**Interfaces:**

```ts
// src/filter/content-hash.ts
import { createHash } from 'node:crypto';
import type { JobFilterConfig } from './schema.js';

export interface JobContentHashInput {
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
}

export function calculateJobContentHash(input: JobContentHashInput): string;
export function calculateFilterConfigContentHash(config: JobFilterConfig): string;
```

The normalization helper is exported (the keyword matcher in Task 3 reuses it):

```ts
export function normalizeForHashing(value: string | null): string;
```

Implementation mirrors `calculateProfileContentHash` (sorted keys, stable stringify, `node:crypto` SHA-256, lowercase hex digest). The job field hash concatenates the four normalized fields with `\n` and writes the result to `createHash('sha256').update(...)`. The config hash uses a `stableStringify` helper that is re-implemented in-place in `src/filter/content-hash.ts` (the small helper is intentionally duplicated to keep `src/filter/` self-contained per Decision 1; the Global Constraints forbid lifting from `src/profile/*` except for `SeniorityLevelSchema` and `normalizeLanguageName`).

**Tests:**
- `calculateJobContentHash` — Same fields in different orders yield the same hash (because the function defines a fixed order). Same fields with different whitespace / case yield the same hash. Different title yields a different hash. Null fields produce an empty string segment.
- `calculateFilterConfigContentHash` — Same config in different key order yields the same hash. Different `excludedCompanies` yields a different hash. Empty config (`excludedCompanies: []`, all keyword arrays empty, `maximum: null`) is a stable hash.
- Round-trip: `calculateFilterConfigContentHash({ ...config, ... })` is idempotent (the function does not include the hash inside the config — the schema has no `contentHash` field on `JobFilterConfig`; the hash is computed by the helper and stored on `filter_configuration_versions.contentHash`).

**Verification:**
- `pnpm test tests/filter/content-hash.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 3: Keyword normalization, alias map, and matcher

**Files:**
- Create: `src/filter/keyword-aliases.ts`
- Create: `src/filter/keyword-normalize.ts`
- Create: `src/filter/keyword-matcher.ts`
- Create: `tests/filter/keyword-normalize.test.ts`
- Create: `tests/filter/keyword-matcher.test.ts`

**Goal:** The shared deterministic keyword matcher (SPEC §18). Normalization is Unicode NFKC → lowercase → trim → collapse whitespace → fold `.`, `-`, `_`, and `/` separators to a single space. After normalization the matcher splits on whitespace and treats the resulting tokens as a stream. Word boundaries are token boundaries (`Java` is a single token, `JavaScript` is a single token — `Java` does NOT match `JavaScript`). Multi-word phrases are matched against the token stream (consecutive tokens, not substring). The versioned alias map (`keyword-aliases.ts`) is a frozen `Record<string, string>` parallel to `src/profile/name-aliases.ts`. Initial entries reflect the SPEC §18 examples (`node.js` → `nodejs`, `node js` → `nodejs`, `react.js` → `react`, `postgres` → `postgresql`) plus the same `js → javascript`, `ts → typescript`, `k8s → kubernetes` triplet from the profile alias map (kept independent so the filter can evolve separately).

**Decision reflected:** Decision 4 — alias map is a NEW module under `src/filter/`, versioned by the file itself (a git diff to `keyword-aliases.ts` is the version bump driver). Decision 3 — does NOT reuse `src/profile/name-aliases.ts`; the filter gets its own private alias registration because skill-dedup and filter-matching have different join semantics.

**`keyword-normalize.ts`:**

```ts
export function normalizeKeyword(value: string): string;

/**
 * Returns true when the token stream of `field` contains a token-stream
 * match of `keyword` (after normalization + alias resolution). The match
 * uses token boundaries on both sides, so:
 *   - "Java" matches "We use Java here" but NOT "JavaScript".
 *   - "node.js" matches "Node JS" (after normalization + alias).
 *   - "machine learning" matches "experience with machine learning".
 *   - "machine learning" does NOT match "machine unlearning".
 */
export function keywordMatches(field: string, keyword: string): boolean;
```

**`keyword-matcher.ts`:**

```ts
import type { JobFilterConfig } from './schema.js';

export interface KeywordMatchHit {
  readonly field: 'title' | 'description';
  readonly keyword: string;
  readonly matchedTokenIndex: number;
}

export interface KeywordMatchResult {
  readonly excludedHits: readonly KeywordMatchHit[];
  readonly requiredAnyHits: readonly KeywordMatchHit[];
  readonly requiredAnySatisfied: boolean;
}

export function matchKeywords(
  config: JobFilterConfig,
  job: { readonly title: string | null; readonly description: string | null },
): KeywordMatchResult;
```

Behavior (SPEC §17.5, §18):
- Excluded keywords: each match is a `hit`; if any excluded keyword produces a hit, the rule `failed` (the job is rejected).
- Required-any keywords: empty list ⇒ rule does NOT apply (`requiredAnySatisfied = true`). Non-empty list with at least one hit ⇒ `requiredAnySatisfied = true`. Non-empty list with zero hits ⇒ `requiredAnySatisfied = false` (the job is rejected).

**Tests:**
- `keyword-normalize.test.ts` — NFKC round-trip (`ﬁre` → `fire`), lowercase, trim, collapse whitespace, separator folding (`node.js`, `node-js`, `node_js`, `node/js`, `node js` all collapse to the same normalized form), alias resolution (`node.js` → `nodejs`, `postgres` → `postgresql`).
- `keyword-matcher.test.ts` — `Java` ≠ `JavaScript` (canonical boundary case from SPEC §18); `node.js` matches `Node JS`; multi-word phrase `machine learning` matches `experience with machine learning`; multi-word phrase does NOT match `machine unlearning`; required-any empty list does NOT apply; required-any with one match satisfies; required-any with no matches fails; punctuation variants (`react.js`, `react js`, `react-js`) all match.

**Verification:**
- `pnpm test tests/filter/keyword-normalize.test.ts tests/filter/keyword-matcher.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 4: Seniority detection + max-seniority rule

**Files:**
- Create: `src/filter/seniority-detector.ts`
- Create: `src/filter/seniority-rule.ts`
- Create: `tests/filter/seniority-detector.test.ts`
- Create: `tests/filter/seniority-rule.test.ts`

**Goal:** Title-only seniority detection (SPEC §19) and the max-seniority rule. The detector walks a normalized title against a versioned phrase map (the SPEC §19 example mapping table verbatim plus the `unknown` outcome for unlabelled titles). Highest detected level wins. The rule applies the SPEC §19 max-seniority rule: reject above, accept ≤, abstain on `unknown`.

**`seniority-detector.ts`:**

```ts
export type DetectedSeniority =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'lead'
  | 'manager'
  | 'director'
  | 'executive'
  | 'unknown';

export interface SeniorityDetectionResult {
  readonly detected: DetectedSeniority;
  readonly matchedPhrases: readonly { readonly phrase: string; readonly level: Exclude<DetectedSeniority, 'unknown'> }[];
}

export function detectSeniority(title: string | null): SeniorityDetectionResult;
```

`detectSeniority` normalizes the title (same `normalizeKeyword` from Task 3 — the helper is the shared normalization surface), then runs the SPEC §19 phrase map (kept inline as a frozen constant in this module — it is short enough to live with the detector). When multiple phrases collide, the highest detected level wins (the phrase map carries a numeric rank; the function returns the max rank). If no phrase matches, the result is `{ detected: 'unknown', matchedPhrases: [] }`.

**Inline vs. extracted dictionary (deviation from Decision 4):** SPEC §44 #5 leaves the exact dictionary to the implementer; the seniority phrase map is intentionally inline here. If the phrase map grows beyond ~10 entries, extract it to `src/filter/seniority-phrases.ts` keyed by `SENIORITY_PHRASE_VERSION` and follow the versioned-constant pattern established by Decision 4. The implementing agent for this task should NOT extract prematurely — the current size keeps the detector readable.

**`seniority-rule.ts`:**

```ts
export type SeniorityRuleOutcome = 'accepted' | 'abstained';

export interface SeniorityRuleResult {
  readonly outcome: SeniorityRuleOutcome;
  readonly detected: DetectedSeniority;
  readonly matchedAgainst: SeniorityLevel | null;
}

export function applySeniorityRule(
  maximum: SeniorityLevel | null,
  detection: SeniorityDetectionResult,
): SeniorityRuleResult;
```

Behavior (SPEC §19):
- `maximum === null` → the rule does NOT apply; result is `{ outcome: 'abstained', detected, matchedAgainst: null }`.
- `detected === 'unknown'` → the rule abstains; result is `{ outcome: 'abstained', detected: 'unknown', matchedAgainst: null }`.
- Otherwise compare ranks via `SENIORITY_LEVELS` (the existing order from `src/profile/schema.ts`). Reject (handled by the evaluator, not the rule helper) when `detected` rank > `maximum` rank. Accept when `detected` rank ≤ `maximum` rank.

**`src/filter/seniority-rule.ts` does NOT itself reject** — it returns `{ outcome: 'accepted' | 'abstained' }` and the evaluator (Task 6) translates the rejection surface. The decision mechanism is documented in the helper's JSDoc.

**Tests:**
- `seniority-detector.test.ts` — Each SPEC §19 example tested verbatim: `Software Engineer` → `unknown`, `Senior Software Engineer` → `senior`, `Tech Lead` → `lead`, `VP of Engineering` → `executive`, `Director of Engineering` → `director`, `Staff Engineer` → `staff`, `Engineering Manager` → `manager`, `Principal Engineer` → `principal`, `Intern` → `intern`, `Junior Developer` → `junior`, `Mid-level` → `mid`. Highest-wins: `Senior Engineering Manager` → `manager` (highest rank wins: `senior` rank vs `manager` rank — calculator picks the max). Empty title → `unknown`. Title with only symbols → `unknown`.
- `seniority-rule.test.ts` — `maximum: null` → `abstained` regardless of detected. `maximum: 'senior'`, `detected: 'unknown'` → `abstained` (never rejects unknown). `maximum: 'senior'`, `detected: 'junior'` → `accepted`. `maximum: 'senior'`, `detected: 'staff'` → evaluator marks it rejected (the helper returns `{ outcome: 'accepted' }` is wrong — see the abovementioned helper. The reject path is asserted via the evaluator test in Task 6.)

**Verification:**
- `pnpm test tests/filter/seniority-detector.test.ts tests/filter/seniority-rule.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 5: Language detection (versioned phrase patterns)

**Files:**
- Create: `src/filter/language-patterns.ts`
- Create: `src/filter/language-detector.ts`
- Create: `tests/filter/language-detector.test.ts`

**Goal:** Phrase-based language detection (SPEC §20). The phrase dictionary is split into two surfaces per the SPEC: required (e.g. "is required", "must speak", "professional proficiency in", "native-level", "excellent command of", "is mandatory") and reference (e.g. "is a plus", "preferred", "would be beneficial", "is desirable", "our team speaks"). The detector scans the job description for any required phrase + language pair, classifies it, and returns. Languages are matched by their name via `normalizeLanguageName` (Decision 3).

**`language-patterns.ts`:**

```ts
export const LANGUAGE_REQUIRED_PHRASES: readonly string[] = [
  'is required',
  'required',
  'must speak',
  'must have',
  'professional proficiency in',
  'native-level',
  'native',
  'excellent command of',
  'is mandatory',
  'mandatory',
  'fluent',
];

export const LANGUAGE_REFERENCE_PHRASES: readonly string[] = [
  'is a plus',
  'preferred',
  'would be beneficial',
  'is desirable',
  'desirable',
  'a bonus',
  'nice to have',
  'our team speaks',
];

export const LANGUAGE_PATTERN_VERSION = '1.0.0' as const;
```

**`language-detector.ts`:**

```ts
export type LanguageRequirement =
  | { readonly kind: 'required'; readonly language: string; readonly normalizedLanguage: string; readonly matchedPhrase: string }
  | { readonly kind: 'reference'; readonly language: string; readonly normalizedLanguage: string; readonly matchedPhrase: string }
  | { readonly kind: 'ambiguous'; readonly language: string; readonly normalizedLanguage: string; readonly matchedPhrase: string };

export interface LanguageDetectionResult {
  readonly requirements: readonly LanguageRequirement[];
  readonly acceptedLanguages: readonly string[];     // normalized
}

export function detectLanguageRequirements(input: {
  readonly description: string | null;
  readonly acceptedLanguages: readonly string[];
}): LanguageDetectionResult;
```

Behavior (SPEC §20.3):
- For each accepted language (the slug is the `normalizedName` produced by `normalizeLanguageName`), search the description for `<language>` + `<phrase>` (and `<phrase>` + `<language>`) within a tight window. Required phrases get `kind: 'required'`; reference phrases get `kind: 'reference'`. Phrases that are ambiguous (e.g. "fluent" as a standalone adjective) get `kind: 'ambiguous'`.
- The result is a list of `LanguageRequirement` (one per detected language + phrase). The evaluator (Task 6) consults the list against the config to decide accept/reject.

**Tests:**
- `detectLanguageRequirements` — Each SPEC §20.1 example produces `kind: 'required'` for the matched language. Each §20.2 example produces `kind: 'reference'`. A phrase that is ONLY in the reference list (`preferred`) does NOT produce a `required` entry even when the language is `French`. Ambiguous phrase `Our team speaks Spanish` → `reference`. Empty description → `requirements: []`. Language not in the description → no entry for it. Two required matches for the same language (e.g. "Fluent Dutch required" + "Dutch is mandatory") → one entry per matched phrase (the evaluator deduplicates).

**Verification:**
- `pnpm test tests/filter/language-detector.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 6: Filter evaluator (composite rules)

**Files:**
- Create: `src/filter/evaluate.ts`
- Create: `tests/filter/evaluate.test.ts`
- Extend: `tests/filter/boundaries.test.ts` (assert filter errors are not rejections)

**Goal:** The composite rule evaluator that combines the title/description keywords, the max-seniority rule, the language rule, and the excluded-companies rule into a single auditable decision. The evaluator NEVER throws — internal failures (e.g. malformed input) result in `overallOutcome: 'error'` (SPEC §24.1). Each rule emits a structured record (ruleId, passed/failed, reason) for the `rulesEvaluatedJson` / `rulesPassedJson` / `rulesFailedJson` columns.

**`evaluate.ts`:**

```ts
import type { JobFilterConfig } from './schema.js';
import type { FilterOutcome } from '../persistence/repositories/filter-results.js';

export interface JobInput {
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
}

export interface RuleEvaluation {
  readonly ruleId: string;
  readonly field: 'company' | 'title' | 'description' | 'seniority' | 'languages';
  readonly outcome: 'passed' | 'failed' | 'abstained';
  readonly details: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export interface FilterEvaluationResult {
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly RuleEvaluation[];
  readonly rulesPassed: readonly RuleEvaluation[];
  readonly rulesFailed: readonly RuleEvaluation[];
  readonly rejectionReasons: readonly string[];
}

export function evaluateJob(
  config: JobFilterConfig,
  job: JobInput,
): FilterEvaluationResult;
```

Rule order (matches SPEC §17 + §18 + §19 + §20):
1. `excluded-companies` — Normalized exact match (SPEC §17.4). If the company matches an excluded entry, `failed` with reason `excluded_company:<name>`.
2. `title-excluded-keywords` — Keyword matcher (Task 3). Any hit → `failed`.
3. `title-required-any-keywords` — Empty list ⇒ `abstained` (rule does not apply). Non-empty with at least one hit ⇒ `passed`. No hits ⇒ `failed`.
4. `description-excluded-keywords` — Same as rule 2.
5. `description-required-any-keywords` — Same as rule 3.
6. `max-seniority` — Seniority rule (Task 4). `detected === 'unknown'` → `abstained`. `maximum === null` → `abstained`. `detected rank > maximum rank` → `failed`. Otherwise → `passed`.
7. `language-rejection` — When `rejectWhenExplicitlyRequiresOtherLanguage === true`, the language detector (Task 5) returns a list of required phrases. If any required language is NOT in `accepted`, → `failed` with reason `unsupported_language:<language>`. If a required language IS in `accepted`, → `passed`. If no required phrase is detected, → `abstained`. When the config flag is `false`, the rule always `abstained`.

**Overall outcome mapping:**
- Any rule `failed` → `overallOutcome: 'rejected'`, `rejectionReasons` lists the rule's `reason` strings.
- Internal evaluator error (e.g. unexpected exception in a helper — caught, never thrown to the caller) → `overallOutcome: 'error'`, `rulesEvaluated` includes the error record, `rejectionReasons` is `[]` (errors are NOT rejections — SPEC §24.1).
- All rules `passed` or `abstained` → `overallOutcome: 'accepted'`.

**Tests:**
- `evaluate.test.ts` — End-to-end on every rule individually (one config per scenario) plus the no-rule-evaluates baseline (`overallOutcome: 'accepted'`, `rejectionReasons: []`). Each scenario asserts:
  - `rulesEvaluated` contains the rule with the right `outcome`.
  - `rulesPassed` / `rulesFailed` are partitioned correctly.
  - `overallOutcome` matches the expected value.
  - `rejectionReasons` lists the rule's reason string only when `rejected`.
- The "filter errors are not rejections" assertion: force a synthetic helper failure (e.g. monkey-patch `matchKeywords` to throw) and assert the capture yields `overallOutcome: 'error'`, `rejectionReasons: []`, the `rulesEvaluated` entry's `outcome: 'failed'` carries the error reason.
- Required-any empty list ⇒ rule `abstained` (does NOT apply), the overall outcome is unaffected by the absence of required keywords.
- Bilingual job: `Dutch required` + `French required` with an accepted-languages list missing both → `rejected` with two reasons (`unsupported_language:Dutch`, `unsupported_language:French`).
- Stale input with `null` title / `null` description does not crash; rules `abstained` for the affected sections.

**`boundaries.test.ts` (extension):** Add a test that scans `src/filter/evaluate.ts` and asserts the file does NOT import `@inquirer/prompts`, `commander`, `playwright`, `drizzle-orm`, `openai`, or `pino`. The skeleton added in Task 1 is updated to scan the full `src/filter/**` tree.

**Verification:**
- `pnpm test tests/filter/evaluate.test.ts tests/filter/boundaries.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 7: Filter fingerprint composer

**Files:**
- Create: `src/filter/fingerprint.ts`
- Create: `tests/filter/fingerprint.test.ts`

**Goal:** Stable SHA-256 fingerprint that composes the job content hash, the active config hash, the relevant effective profile values, and the filter implementation version (SPEC §24.3, Decision 7). The fingerprint is the cache key for `filter_results` (SPEC §27.1).

**`fingerprint.ts`:**

```ts
import { createHash } from 'node:crypto';
import type { JobFilterConfig } from './schema.js';
import type { ProfessionalProfile } from '../profile/schema.js';
import { FILTER_IMPLEMENTATION_VERSION } from './version.js';
import { calculateJobContentHash, calculateFilterConfigContentHash } from './content-hash.js';

export interface FilterFingerprintInput {
  readonly job: {
    readonly title: string | null;
    readonly company: string | null;
    readonly location: string | null;
    readonly description: string | null;
  };
  readonly config: JobFilterConfig;
  readonly profile: ProfessionalProfile | null;
}

export function calculateFilterFingerprint(input: FilterFingerprintInput): string;
```

The composer:
1. Builds `jobContentHash = calculateJobContentHash(input.job)`.
2. Builds `configContentHash = calculateFilterConfigContentHash(input.config)`.
3. Builds `profileSlice` from the relevant effective values (Decision 7):
   - `derived.likelySeniority.effectiveValue`
   - `derived.primaryRoles.effectiveValue` (sorted)
   - `derived.primaryDomains.effectiveValue` (sorted)
   - `derived.strongestSkills.effectiveValue` (sorted)
   - `languages[].normalizedName` (sorted, deduped)
   - `skills[].normalizedName` (sorted, deduped)
4. Serializes `{ jobContentHash, configContentHash, profileSlice, filterImplementationVersion }` via `stableStringify` (the same helper from Task 2).
5. Returns `createHash('sha256').update(...).digest('hex')`.

When `profile === null` (no active approved profile), the `profileSlice` is the literal string `null` (after `stableStringify`). The fingerprint is deterministic given the same inputs.

**Tests:**
- `calculateFilterFingerprint` — Same inputs in different order produce the same hash. Changing the job title produces a different hash. Changing the config (any field) produces a different hash. Changing a profile's `derived` value produces a different hash. Changing a profile's `languages` array produces a different hash. Changing unrelated profile fields (e.g. `basics.headline`) does NOT change the hash (those fields are not part of the slice). Bumping `FILTER_IMPLEMENTATION_VERSION` would change the hash (the test pins the version, so a refactor that touches the version produces a different hash).
- `null` profile produces a hash that does NOT equal a non-null profile with empty derived fields.

**Verification:**
- `pnpm test tests/filter/fingerprint.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 8: Repository extension — `filterResults.invalidateByFilterConfigVersion`

**Files:**
- Modify: `src/persistence/repositories/filter-results.ts`
- Modify: `tests/persistence/repositories/filter-results.test.ts`

**Goal:** A new repository method that mirrors `invalidateByProfileVersion` (Decision 8). Used by `FilterApplyService` to invalidate cached active rows when the active filter config changes (SPEC §27.1 / §16.3 step 9 analog).

**Interface:**

```ts
// inside FilterResultRepository
async invalidateByFilterConfigVersion(filterConfigVersionId: number): Promise<number> {
  return this.ctx.db.transaction((tx) => {
    const before = tx
      .select({ id: filterResults.id })
      .from(filterResults)
      .where(
        and(
          eq(filterResults.filterConfigVersionId, filterConfigVersionId),
          eq(filterResults.active, true),
        ),
      )
      .all();
    if (before.length === 0) return 0;
    tx.update(filterResults)
      .set({ active: false })
      .where(
        and(
          eq(filterResults.filterConfigVersionId, filterConfigVersionId),
          eq(filterResults.active, true),
        ),
      )
      .run();
    return before.length;
  });
}
```

The JSDoc explicitly notes the §27.4 "kept but inactive" rule and the relationship with `invalidateByProfileVersion`. The two methods are independent (each carries its own `where` clause) and can be called in either order.

**Test additions (extend `tests/persistence/repositories/filter-results.test.ts`):**
- A new `describe('invalidateByFilterConfigVersion', ...)` block scoped to the same `beforeEach` fixture.
- Three active rows tied to `filterConfigVersionId = 7`; `invalidateByFilterConfigVersion(7)` returns 3.
- Re-run; returns 0 (idempotent).
- A row tied to a different `filterConfigVersionId` is untouched.
- A row with `active = false` is left untouched.

**Verification:**
- `pnpm test tests/persistence/repositories/filter-results.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 9: `FilterApplyService` (cache + evaluate)

**Files:**
- Create: `src/filter/service.ts`
- Create: `tests/filter/service.test.ts`

**Goal:** The application service that:
1. Loads the active `filter_configuration_versions` row via `filterConfigurations.findActive()`.
2. Loads the active approved profile via `profileVersions.findActiveApproved()` (NULL is allowed — the fingerprint `profileSlice` becomes `null` per Task 7).
3. Loads the job record via `jobs.findById(jobId)` (the service accepts a pre-loaded job; the scraper layer above this is out of scope).
4. Computes the fingerprint via `calculateFilterFingerprint`.
5. Looks up the active result via `filterResults.findActiveByJob(jobId, fingerprint)`. If found, returns the existing row (cache hit).
6. Runs `evaluateJob(config, job)` to produce the result.
7. Persists the new active row via `filterResults.activateResult(...)` (which atomically deactivates the prior active row for the same job).
8. Returns the persisted row.

The service NEVER calls OpenAI (AGENTS.md §9). It does NOT touch the pipeline run / score-result / cache invalidation of OTHER configs — that is the responsibility of the caller (the orchestrator in TASK-011/014/015). The service does NOT call `filterResults.invalidateByFilterConfigVersion` from `apply` either. Invalidation is performed by `ConfigureFiltersService.run` after a successful save and by the orchestrator when the active config changes mid-run. The service is the cache ledger: it consults `findActiveByJob(jobId, fingerprint)` and re-activates when no match exists.

**API:**

```ts
export interface FilterApplyServiceOptions {
  readonly repositories: Repositories;
  readonly now?: () => Date;
}

export interface FilterApplyInput {
  readonly jobId: number;
  readonly job: JobInput;                     // pre-loaded from `jobs.findById`
  readonly pipelineRunId?: number | null;
}

export interface FilterApplyResult {
  readonly outcome: FilterOutcome;
  readonly filterResultId: number;
  readonly fingerprint: string;
  readonly ruleEvaluations: readonly RuleEvaluation[];
  readonly rejectionReasons: readonly string[];
  readonly reused: boolean;
}

export class FilterApplyService {
  constructor(options: FilterApplyServiceOptions) {}
  async apply(input: FilterApplyInput): Promise<FilterApplyResult>;
}
```

When the active config is missing (no `filter_configuration_versions` row has `active = true`), the service throws `NoActiveFilterConfigError` (separate class under `FilterLifecycleError`, `ExitCode.Fatal`, code `no_active_filter_config`) — the orchestrator should refuse to run a pipeline without an active filter config (SPEC §9.5 calls this out as a prerequisite). The detection of "no active config" is a distinct failure from the underlying `FilterStorageError` (which the base class retains for genuine storage failures).

**Tests:**
- Cache hit: pre-insert an active `filter_results` row with the same fingerprint; call `apply` again; assert `reused: true`, no new row inserted (`filterResults.listByJob` length unchanged).
- Cache miss: no prior row; call `apply`; assert `reused: false`, one new active row, the prior active row (if any) was deactivated.
- Config-version swap: insert a new config row, activate it as the active config, call `apply` again on the same job; assert the prior row is now `active = false` (the orchestrator's responsibility — the test simulates the workflow by calling `invalidateByFilterConfigVersion` after the swap, then asserting the next `apply` produces a fresh row).
- No active config → throws `FilterStorageError`.
- Title-only keyword match → `rejected` with the right reason.
- Seniority mismatch → `rejected`.
- Language unsupported → `rejected` (only when the config flag is `true`).
- All rules pass → `accepted`.
- Internal evaluator failure → `error` (synthetic). The service still persists the row with `overallOutcome: 'error'`.

**Verification:**
- `pnpm test tests/filter/service.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 10: `ConfigureFiltersService` (interactive flow)

**Files:**
- Create: `src/filter/prompts.ts`
- Create: `src/filter/prompts-inquirer.ts`
- Create: `src/filter/configure-service.ts`
- Create: `tests/filter/configure-service.test.ts`

**Goal:** The interactive flow that combines two existing patterns: the **prompt style** of `ConfigureSearchService` (collect → return → caller persists) and the **persistence style** of `ProfileApprovalService` (atomic version transition + invalidation). Concretely: the prompts walk the user through the configuration in the `ConfigureSearchService` form; the save step performs an atomic version transition (insert new row + activate + invalidate dependents in one transaction) in the `ProfileApprovalService` form. The workflow:

1. Read the existing active config (if any) via `filterConfigurations.findActive()`.
2. Read the active approved profile via `profileVersions.findActiveApproved()`. If no active profile, throw `NoActiveProfileError` (SPEC §17.3 first-run gate).
3. Initialize `acceptedLanguages` from the active profile's `languages[].normalizedName` (SPEC §17.6). The user may keep, remove, add, re-add.
4. Walk the prompts:
   - `askExcludedCompanies(existing)` — comma-separated free-text, deduped case-insensitively after normalization.
   - `askTitleExcludedKeywords(existing)` — multi-line keyword list.
   - `askTitleRequiredAnyKeywords(existing)` — multi-line keyword list.
   - `askDescriptionExcludedKeywords(existing)` — multi-line keyword list.
   - `askDescriptionRequiredAnyKeywords(existing)` — multi-line keyword list.
   - `askMaximumSeniority(existing)` — `@inquirer/select` over `SENIORITY_LEVELS` + `none`.
   - `askAcceptedLanguages(seeds)` — checkbox of the union (existing + profile-derived + a small "Other…" input) so the user can keep / remove / add.
   - `askRejectUnsupportedLanguages(existing)` — `@inquirer/confirm`.
   - `showPreview(filterConfigPreview)` — renders the chosen config.
   - `askConfirmation(filterConfigPreview)` — saves only on `true`.
5. On `save`:
   - Normalize the config via `normalizeJobFilterConfig` (Task 1).
   - Compute `contentHash` via `calculateFilterConfigContentHash` (Task 2).
   - Insert a new `filter_configuration_versions` row via `filterConfigurations.insert`.
   - Activate it via `filterConfigurations.activate(newId)`.
   - Invalidate every active `filter_results` row tied to the prior active config via `filterResults.invalidateByFilterConfigVersion(priorConfigId)`.
   - Return `{ kind: 'saved'; filterConfigVersionId; invalidatedFilterResults: number }`.
6. On `discard` or `exit`: return `{ kind: 'discarded' }` without writing.

**`prompts.ts` (seam):**

```ts
export interface FilterConfigurationPreview {
  readonly excludedCompanies: readonly string[];
  readonly titleExcludedKeywords: readonly string[];
  readonly titleRequiredAnyKeywords: readonly string[];
  readonly descriptionExcludedKeywords: readonly string[];
  readonly descriptionRequiredAnyKeywords: readonly string[];
  readonly maximumSeniority: SeniorityLevel | null;
  readonly acceptedLanguages: readonly string[];
  readonly rejectUnsupportedLanguages: boolean;
}

export interface FilterPrompts {
  askExcludedCompanies(existing: readonly string[]): Promise<readonly string[]>;
  askTitleExcludedKeywords(existing: readonly string[]): Promise<readonly string[]>;
  askTitleRequiredAnyKeywords(existing: readonly string[]): Promise<readonly string[]>;
  askDescriptionExcludedKeywords(existing: readonly string[]): Promise<readonly string[]>;
  askDescriptionRequiredAnyKeywords(existing: readonly string[]): Promise<readonly string[]>;
  askMaximumSeniority(existing: SeniorityLevel | null): Promise<SeniorityLevel | null>;
  // SPEC §17.6 requires the user to keep / remove / add / re-add languages,
  // including languages NOT in the profile. The default Inquirer adapter
  // renders a checkbox of `seeds` plus an "Other…" free-text input; the union
  // of toggled + entered languages is returned via `added`. The scripted
  // test adapter mirrors the same shape.
  askAcceptedLanguages(
    seeds: readonly string[],
  ): Promise<{ readonly chosen: readonly string[]; readonly added: readonly string[] }>;
  askRejectUnsupportedLanguages(existing: boolean): Promise<boolean>;
  showPreview(preview: FilterConfigurationPreview): Promise<void>;
  askConfirmation(preview: FilterConfigurationPreview): Promise<boolean>;
}

export function createFailingFilterPrompts(reason: string): FilterPrompts;
export class ScriptedFilterPrompts implements FilterPrompts { /* recorder */ }
```

**`prompts-inquirer.ts` (default):** The ONLY module that imports `@inquirer/prompts`. Each `ask*` method delegates to the appropriate `@inquirer/prompts` API (`input`, `checkbox`, `select`, `confirm`). The `showPreview` method writes a human-readable preview to `stderr` (matching `defaultInquirerPrompts.showPreview`'s convention).

**`configure-service.ts`:**

```ts
export interface ConfigureFiltersServiceOptions {
  readonly repositories: Repositories;
  readonly prompts: FilterPrompts;
  readonly now?: () => Date;
}

export type ConfigureFiltersOutcome =
  | { readonly kind: 'saved'; readonly filterConfigVersionId: number; readonly invalidatedFilterResults: number }
  | { readonly kind: 'discarded' };

export class ConfigureFiltersService {
  constructor(options: ConfigureFiltersServiceOptions) {}
  async run(): Promise<ConfigureFiltersOutcome>;
}
```

**Tests (use `ScriptedFilterPrompts` to drive every step):**
- Fresh config (no prior active) with one active profile (3 languages) → seeds accepted from profile, save → returns `kind: 'saved'`, new row inserted, prior active (none) untouched, `invalidateByFilterConfigVersion` returns 0.
- Editing the existing config → save → new version + `invalidateByFilterConfigVersion(priorId)` returns the count of active rows tied to the prior config.
- User declines `askConfirmation` → returns `kind: 'discarded'`, no new row.
- No active profile → throws `NoActiveProfileError`.
- No active config + no active profile → throws `NoActiveProfileError` (checked first).
- Discard after a handful of edits → no DB write, no invalidation.
- Failure paths: `InvalidFilterConfigError` if the persisted row fails `JobFilterConfigSchema.safeParse` (e.g. operator manually corrupted the JSON). `FilterStorageError` on persistence failure.

**Verification:**
- `pnpm test tests/filter/configure-service.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 11: CLI wiring — `configure filters` subcommand

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli/configure-filters.test.ts`

**Goal:** Add a single `configure filters` subcommand to the existing `configure` group. The handler opens the database, constructs `ConfigureFiltersService` with `defaultInquirerFilterPrompts`, calls `run()`, and prints the result. `--json` is deferred to TASK-016 (Decision 9).

**Subcommand:**

```text
jobhunter configure filters
```

The handler:
1. Resolves platform paths (existing helper).
2. Calls `initializeDatabase` + `createRepositories` (inside a `try/finally` that closes the handle).
3. Builds `ConfigureFiltersService` with `defaultInquirerFilterPrompts` (the default Inquirer adapter, mirroring the `defaultInquirerPrompts` naming used in `src/search/prompts.ts`).
4. Calls `service.run()`.
5. Renders the result:
   - On `saved`: `filter config saved: filters_<id>` and `invalidated filter results: <N>`.
   - On `discarded`: `filter config discarded`.
6. Error mapping: `NoActiveProfileError` → `ExitCode.MissingRequired` (3), `InvalidFilterConfigError` / `InvalidFilterPayloadError` → `ExitCode.InvalidUsage` (2), `UserCancelledFilterConfigError` → `ExitCode.UserCancellation` (130), `FilterStorageError` → `ExitCode.Fatal` (1) — all via the existing `exitWithError` helper.

**Tests (`tests/cli/configure-filters.test.ts`, mirror TASK-009 `tests/cli/profile-list.test.ts` pattern):**
- `beforeEach` captures `process.stdout.write`, `process.stderr.write`, `process.exit`.
- `HOME=/tmp/jh-task010-...` boots a fresh SQLite database.
- Seed `profile_sources` + `profile_versions` (one approved) + a prior `filter_configuration_versions` row.
- Drive the CLI with `createProgram({ filterPrompts: ScriptedFilterPrompts }).parseAsync(['node', 'jobhunter', 'configure', 'filters'])`. The `createProgram` factory gains an optional `filterPrompts: FilterPrompts` parameter as a backward-compatible extension to its existing `{ prompts?, openaiClient? }` shape; no existing caller breaks because the parameter is optional. The CLI test in `tests/cli/configure-filters.test.ts` also asserts that omitting the parameter falls back to `defaultInquirerFilterPrompts` cleanly.
- Three scenarios:
  1. **Save fresh config** → exit 0, stdout includes `filter config saved: filters_<id>`, new row in DB, prior row deactivated.
  2. **Discard** → exit 0, stdout includes `filter config discarded`, no new row.
  3. **No active profile** → exit 3, stderr includes `no_active_profile`.

**Verification:**
- `pnpm test tests/cli/configure-filters.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm build` — exit 0, `dist/cli.js` produced.

---

### Task 12: Final integration, public-surface barrel, and verification

**Files:**
- Create: `src/filter/index.ts`
- Create: `tests/filter/integration.test.ts`
- Modify: `docs/tasks/TASK-010-deterministic-filters.md` (mark Implemented, record results)
- Modify: `docs/tasks/INDEX.md` (one-line status update)

**Goal:** Wire the new public surface into `src/filter/index.ts`, add one end-to-end integration test that exercises the configure → apply → reuse flow on a real temporary SQLite database, and align the documentation.

**Barrel additions:**

```ts
// src/filter/index.ts
export { FILTER_SCHEMA_VERSION, JobFilterConfigSchema, normalizeJobFilterConfig, type JobFilterConfig } from './schema.js';
export { FILTER_IMPLEMENTATION_VERSION, type FilterImplementationVersion } from './version.js';
export {
  FilterLifecycleError,
  InvalidFilterConfigError,
  InvalidFilterPayloadError,
  NoActiveProfileError,
  UserCancelledFilterConfigError,
  FilterStorageError,
} from './errors.js';
export { calculateJobContentHash, calculateFilterConfigContentHash, normalizeForHashing } from './content-hash.js';
export { normalizeKeyword, keywordMatches } from './keyword-normalize.js';
export { matchKeywords, type KeywordMatchHit, type KeywordMatchResult } from './keyword-matcher.js';
export { KEYWORD_ALIAS_MAP, KEYWORD_ALIAS_VERSION } from './keyword-aliases.js';
export {
  detectSeniority,
  type DetectedSeniority,
  type SeniorityDetectionResult,
} from './seniority-detector.js';
export { applySeniorityRule, type SeniorityRuleOutcome, type SeniorityRuleResult } from './seniority-rule.js';
export {
  LANGUAGE_REQUIRED_PHRASES,
  LANGUAGE_REFERENCE_PHRASES,
  LANGUAGE_PATTERN_VERSION,
} from './language-patterns.js';
export {
  detectLanguageRequirements,
  type LanguageRequirement,
  type LanguageDetectionResult,
} from './language-detector.js';
export {
  evaluateJob,
  type JobInput,
  type RuleEvaluation,
  type FilterEvaluationResult,
} from './evaluate.js';
export { calculateFilterFingerprint, type FilterFingerprintInput } from './fingerprint.js';
export {
  FilterApplyService,
  type FilterApplyServiceOptions,
  type FilterApplyInput,
  type FilterApplyResult,
} from './service.js';
export {
  ConfigureFiltersService,
  type ConfigureFiltersServiceOptions,
  type ConfigureFiltersOutcome,
} from './configure-service.js';
export {
  createFailingFilterPrompts,
  ScriptedFilterPrompts,
  type FilterConfigurationPreview,
  type FilterPrompts,
} from './prompts.js';
```

The CLI's `cli.ts` re-exports the public surface through the same barrel (the `createProgram` function accepts an optional `filterPrompts` parameter for tests).

**`tests/filter/integration.test.ts`:** One end-to-end test on a temporary SQLite database:
1. Insert a `profile_sources` row + a `profile_versions` row + `approve` it.
2. Insert a `filter_configuration_versions` row.
3. Insert a `jobs` row (complete).
4. Call `ConfigureFiltersService.run()` with a scripted prompts adapter that:
   - keeps the existing excluded companies list empty,
   - accepts `["english"]` as the accepted languages (the seed profile has `english` already),
   - confirms the save.
5. Assert the new config is active (id DESC, `active: true`).
6. Call `FilterApplyService.apply()` with the job.
7. Assert the result is `accepted`, one new active row, `reused: false`.
8. Call `FilterApplyService.apply()` again with the same inputs.
9. Assert `reused: true`, no new row inserted.
10. Insert a new config version (different `excludedCompanies`), activate it, call `FilterApplyService.apply()` again.
11. Assert the prior active row was invalidated, the new active row references the new config version, `reused: false`.

**Verification (final, runs in CI):**
- `pnpm install --frozen-lockfile` → `Already up to date` (no new deps).
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm format:check` → exit 0 (run `pnpm format` first if any new files need reformatting).
- `pnpm build` → exit 0, `dist/cli.js` produced.
- `pnpm test` → all tests pass (existing baseline + new TASK-010 tests).
- `pnpm test:live` → empty live suite (correct — TASK-010 has no live LinkedIn surface).
- **Targeted boundary grep** (the implementing agent runs this in the shell, mirrors the `tests/filter/boundaries.test.ts` guarantee):
  ```bash
  rg -n --type ts 'from .openai|@inquirer/prompts|playwright|drizzle-orm|require\(.pino' src/filter/
  ```
  Expected output: no matches.

**Documentation updates:**
- Append an "Implementation results" section to `docs/tasks/TASK-010-deterministic-filters.md` (commit hashes, verification output, test inventory, deviations, known limitations).
- Add a row to `docs/tasks/INDEX.md` updating TASK-010 from `Planned` to `Implemented` with a one-line summary.

---

## Test strategy

The 10 expected test categories in `docs/tasks/TASK-010-deterministic-filters.md` §Expected tests map to the following files (the test categories themselves are mandated by SPEC §41.1). Each file name mentions the category it covers.

| # | Expected test category (from TASK-010 §Expected tests) | Test file |
|---|---|---|
| 1 | Validate configuration defaults, normalization, deduplication, versioning, and profile-derived language initialization | `tests/filter/schema.test.ts` (Zod defaults + dedup + sort), `tests/filter/configure-service.test.ts` (profile-derived initialization) |
| 2 | Keyword boundaries including `Java` vs `JavaScript`, phrase matching, punctuation aliases, Unicode, separator variants | `tests/filter/keyword-normalize.test.ts` (NFKC + separator folding), `tests/filter/keyword-matcher.test.ts` (Java ≠ JavaScript + phrase + punctuation) |
| 3 | Excluded/required-any rules and explicit audit reasons | `tests/filter/evaluate.test.ts` (every rule + the `rulesEvaluated` / `rulesPassed` / `rulesFailed` shape) |
| 4 | Seniority mappings, highest-level precedence, equality/maximum checks, unknown abstention | `tests/filter/seniority-detector.test.ts` (phrase map + highest-wins), `tests/filter/seniority-rule.test.ts` (max + equality + unknown abstention) |
| 5 | Language required/preferred/ambiguous classification and accepted/unsupported outcomes | `tests/filter/language-detector.test.ts` (classification), `tests/filter/evaluate.test.ts` (accepted/unsupported outcomes) |
| 6 | Filter errors remain errors rather than rejections | `tests/filter/evaluate.test.ts` (synthetic internal failure → `outcome: 'error'`, `rejectionReasons: []`) |
| 7 | Empty required-any rules do not apply and stale fingerprints preserve historical results | `tests/filter/evaluate.test.ts` (required-any empty list → rule abstained), `tests/filter/integration.test.ts` (stale rows preserved via `invalidateByFilterConfigVersion`) |
| 8 | No OpenAI client is invoked by the filter engine | `tests/filter/boundaries.test.ts` (scans `src/filter/**` for `openai` SDK imports) |
| 9 | Filter fingerprint stability (job content + config + profile + version) | `tests/filter/fingerprint.test.ts` (deterministic for same inputs, sensitive to each sub-input) |
| 10 | Domain boundaries (no Commander / Inquirer / Playwright / Drizzle / Pino in `src/filter/`; no schema migration; no new dependencies) | `tests/filter/boundaries.test.ts` (full import-graph scan across `src/filter/**`); also enforced by the **targeted grep** in the verification block |

The dedicated "no OpenAI" assertion test is `tests/filter/boundaries.test.ts` (the per-file grep; the runtime contract is also held by the absence of any `import 'openai'` statement in `src/filter/`, asserted via the AST scan in that file).

The domain-discipline boundary tests (Tasks 1, 6, 12) are:
- **(a) no OpenAI import in the filter engine** — `tests/filter/boundaries.test.ts` (runtime AST scan + the targeted grep at the end).
- **(b) no Commander / Inquirer / Playwright / Drizzle / Pino in `src/filter/`** — same file, plus the runtime separation of `prompts.ts` (interface only) from `prompts-inquirer.ts` (the only module allowed to import `@inquirer/prompts`).
- **(c) filter errors are not converted to rejections** — `tests/filter/evaluate.test.ts` (the synthetic internal-failure test asserts `overallOutcome: 'error'`, `rejectionReasons: []`).

## Verification commands

All commands from `AGENTS.md` §15 adapted to this task:

- `pnpm install --frozen-lockfile` → `Already up to date` (no new deps).
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm format:check` → exit 0 (run `pnpm format` first if any new files need reformatting).
- `pnpm build` → exit 0, `dist/cli.js` produced.
- `pnpm test` → all tests pass (existing baseline + new TASK-010 tests).
- `pnpm test:live` → empty live suite (correct — TASK-010 has no live LinkedIn surface).
- **Targeted boundary grep** — the implementing agent MUST run this in the shell:
  ```bash
  rg -n --type ts 'from .openai|@inquirer/prompts|playwright|drizzle-orm|"pino"' src/filter/
  ```
  Expected output: no matches. The `prompts-inquirer.ts` file is the ONLY module under `src/filter/` that imports `@inquirer/prompts`; that import is expected and is added in Task 10. The implementing agent confirms the boundary by listing all `src/filter/**` imports after Task 11 is complete. If the boundary violation surfaces the implementing agent must stop and re-architect.

## Completion criteria

Mirror SPEC.md §42 acceptance calls for filtering and TASK-010 §Completion criteria. The implementing agent confirms each item before reporting the task complete.

1. **Acceptance / rejection / error per job** — `evaluateJob` produces one of `accepted | rejected | error` for every input. Errors are not rejections (verified by `tests/filter/evaluate.test.ts`).
2. **Unknown seniority + uncertain language wording abstain** — `applySeniorityRule` returns `abstained` for `unknown`. `detectLanguageRequirements` returns empty `requirements` when only reference phrases are present, and the evaluator abstains the rule (no rejection).
3. **Fingerprint determinism + cache reuse** — `tests/filter/fingerprint.test.ts` asserts the hash is deterministic. `tests/filter/service.test.ts` asserts the cache hit path. `tests/filter/integration.test.ts` asserts the end-to-end fingerprint + reuse workflow.
4. **No OpenAI / no browser / no schema migration** — `tests/filter/boundaries.test.ts` (runtime AST scan) + the targeted grep in the verification block. The existing `filter_configuration_versions` and `filter_results` tables are unchanged; CI migrates against the existing schema.
5. **10 named test categories** — every category in TASK-010 §Expected tests is mapped to a specific test file in the §Test strategy table above. The implementing agent lists the test files in the implementation-results section of the task document.
6. **Versioned data + filters history preserved** — `invalidateByFilterConfigVersion` flips `active = false` (Task 8); `activateResult` deactivates the prior active row for the same job (TASK-004). The `tests/filter/integration.test.ts` end-to-end test asserts prior rows are visible in `filterResults.listByJob` with `active = false` after a config swap.
7. **CLI subcommand** — `jobhunter configure filters` runs, prompts, saves, exits 0 with a fresh config; exits 0 with `discarded` when the user declines; exits 3 when no active profile exists. `tests/cli/configure-filters.test.ts` covers all three scenarios.
8. **Strict TypeScript** — `pnpm typecheck` is exit 0; no `any` in `src/filter/`. The documented `as readonly unknown[]` cast in the JSON column decode path (mirroring the existing pattern in `src/persistence/repositories/filter-results.ts`) is NOT an `any` and is therefore allowed.
9. **Public surface + barrel** — `src/filter/index.ts` re-exports every public symbol. The CLI consumes them via the barrel.
10. **Documentation** — `docs/tasks/TASK-010-deterministic-filters.md` has an "Implementation results" section; `docs/tasks/INDEX.md` lists TASK-010 as `Implemented`.

## Known limitations / follow-ups for downstream tasks

1. **Scoring invalidation by profile version is still deferred.** The new `invalidateByFilterConfigVersion` covers the filter half of §16.3 step 9. `score_results` does not carry a `filter_config_version_id` column either; when TASK-015 adds a score-result invalidation path, it will need to either consult the active filter config or add a fresh column. The implementing agent for TASK-015 must call this out in its plan and ask for approval (per AGENTS.md §12) if it adds a column.
2. **No `--json` flag on `configure filters`.** Decision 9 defers this to TASK-016. The CLI handler stays human-readable; the persisted config is reachable via `db_inspect` or the SQLite file.
3. **Alias map and language phrase patterns are versioned constants that may need to grow.** They are tracked as `KEYWORD_ALIAS_VERSION` and `LANGUAGE_PATTERN_VERSION` (Tasks 3 and 5). Adding a new alias or phrase is a one-line edit + a test; bumping the version is a separate concern (the filter implementation version is what enters the fingerprint, not the dict version).
4. **Filter implementation version is bumped manually.** Decision 5 sets `FILTER_IMPLEMENTATION_VERSION = '1.0.0'`. A future task may add a curated test that forces the version bump and re-evaluates a snapshot to confirm the new version emits a different fingerprint. Out of scope for TASK-010.
5. **Job normalization duplicates skill / language normalization primitives.** Decision 1 keeps `src/filter/` self-contained — the keyword normalization is a thin variation of the profile name normalization. The implementing agent should NOT extract a shared `src/text-normalize/` module; the duplication is intentional and small.
6. **`filter_results` history grows over time.** Like `score_results`, the table accumulates one row per (job, fingerprint) cycle. The MVP does not garbage-collect; future tasks may add a cleanup hook.
7. **Integration points with downstream tasks (TASK-011, 014, 015, 017) are documented in the `FilterApplyService` API + `FilterApplyResult` shape.** The orchestrator in those tasks is responsible for:
   - calling `FilterApplyService.apply` per job;
   - persisting a `pipeline_runs` row + `jobs` row (preceding the filter call);
   - calling `filterResults.invalidateByFilterConfigVersion` when the active config changes (mid-run or otherwise);
   - carrying the `filterResultId` forward into `score_results` (TASK-015 inserts that FK).
8. **No live `pnpm test:live` coverage.** The filter engine is purely deterministic and unit-tested; the live tests target LinkedIn scraper behavior in TASK-014. The implementing agent confirms `pnpm test:live` is empty and exits 0.

(End of plan — total sub-tasks: 12; total new test files: 15 (14 in `tests/filter/`, 1 in `tests/cli/`); total modified test files: 1 (`tests/persistence/repositories/filter-results.test.ts`); total modified source files: 2 (`src/persistence/repositories/filter-results.ts`, `src/cli.ts`).)
