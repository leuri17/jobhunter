# src/filter/

## Responsibility

Global deterministic filter engine for the job-search pipeline. It decides whether a job should advance past the search stage by combining four pure rule families — `excluded-companies`, title/description `excludedKeywords`, title/description `requiredAnyKeywords`, `max-seniority`, and `language-rejection` — into a single auditable decision (`accepted` | `rejected` | `error`). No LLM is invoked; the evaluator is pure and synchronous given a `JobFilterConfig` + `JobInput`. The same folder owns the user-facing configuration flow (`ConfigureFiltersService`) that persists a new `filter_configuration_versions` row and invalidates the dependent `filter_results` rows.

The evaluator is total: helper exceptions are caught by `safeEvaluate` and surfaced as `overallOutcome: 'error'` rather than thrown. Internal errors are NOT rejections (`rejectionReasons` stays empty on internal failure).

## Design

- **Service layer.** Two application services own the public surface:
  - `FilterApplyService` (`src/filter/service.ts`) is the cache ledger. It consults `filterResults.findActiveByJob(jobId, fingerprint)` and only writes a new active row on a cache miss.
  - `ConfigureFiltersService` (`src/filter/configure-service.ts`) drives the interactive configuration flow and performs the atomic version transition (`insert` inactive → `activate`).
  Both accept `now?` for test-time wall-clock injection and depend only on the `Repositories` facade.
- **Deterministic rule primitives.**
  - Keyword matching: `matchKeywords` (`src/filter/keyword-matcher.ts`) drives `evaluateJob`'s four keyword rules. Underlying helpers are `normalizeKeyword`, `keywordMatches`, and `findKeywordMatchIndex` in `keyword-normalize.ts`, plus the frozen `ALIAS_MAP` (`KEYWORD_ALIAS_VERSION`) in `keyword-aliases.ts`. The matcher folds `.`, `-`, `_`, `/` to spaces, collapses whitespace, applies per-token alias resolution (`js → javascript`, `k8s → kubernetes`, `postgres → postgresql`, …), and walks a token-window match.
  - Seniority: `detectSeniority` in `seniority-detector.ts` matches the normalized title against an inline phrase map (`intern`/`junior`/`mid`/`senior`/`staff`/`principal`/`lead`/`manager`/`director`/`executive`, with multi-word keys `entry level`, `tech lead`, `head of`, `vice president`, …) using `SENIORITY_LEVELS` rank order with highest-rank-wins. `applySeniorityRule` in `seniority-rule.ts` compares the detected rank against the configured `maximum` (`null` ⇒ abstained).
  - Language: `detectLanguageRequirements` in `language-detector.ts` scans a ±5-token window around language occurrences (union of `acceptedLanguages` + `KNOWN_LANGUAGES`) against the versioned phrase dictionaries `LANGUAGE_REQUIRED_PHRASES` / `LANGUAGE_REFERENCE_PHRASES` (`LANGUAGE_PATTERN_VERSION`) in `language-patterns.ts`. The longest match wins at each offset; `ambiguous` matches (`fluent`, `native`) are tracked but treated as abstentions by the evaluator.
- **Composite evaluator.** `evaluateJob(config, job)` runs the seven SPEC-mandated rules in fixed order (`excluded-companies`, `title-excluded-keywords`, `title-required-any-keywords`, `description-excluded-keywords`, `description-required-any-keywords`, `max-seniority`, `language-rejection`), each wrapped in `safeEvaluate(ruleId, field, producer)`. Any rule with `reason === 'evaluator_internal_error'` collapses the whole result to `overallOutcome: 'error'`; otherwise the partition of `rulesFailed` drives `rejectionReasons`.
- **Schema + versioning.** `JobFilterConfigSchema` (Zod, `.strict()`, `schemaVersion: 1` literal) is the on-disk shape. `normalizeJobFilterConfig` trims, case-fold-dedupes, and deterministically sorts the six string-array paths (`excludedCompanies`, `title.excludedKeywords`, `title.requiredAnyKeywords`, `description.excludedKeywords`, `description.requiredAnyKeywords`, `languages.accepted`). `FILTER_IMPLEMENTATION_VERSION` (`'1.0.0'`) bumps on behavioural changes and feeds the fingerprint; `FILTER_SCHEMA_VERSION = 1` is the on-disk shape version.
- **Content hash + fingerprint.**
  - `calculateJobContentHash` and `calculateFilterConfigContentHash` in `content-hash.ts` produce SHA-256 lowercase hex digests. Job hash normalizes via `normalizeForHashing` (NFKC → lowercase → trim → whitespace collapse) over a fixed 4-tuple (`title`, `company`, `location`, `description`) joined by `\n`. Config hash goes through `stableStringify` (alphabetically sorted keys, no whitespace) on the normalized config.
  - `calculateFilterFingerprint` in `fingerprint.ts` composes `{ jobContentHash, configContentHash, profileSlice, filterImplementationVersion }` and SHA-256s the `stableStringify` output. The `profileSlice` extracts `derived.likelySeniority.effectiveValue` plus sorted/deduped `primaryRoles`, `primaryDomains`, `strongestSkills`, `languages[].normalizedName`, `skills[].normalizedName` (or literal `null` when no active approved profile exists).
- **UI seam.** `FilterPrompts` (`src/filter/prompts.ts`) is the prompt-style interface consumed by `ConfigureFiltersService`: `askExcludedCompanies`, `askTitleExcludedKeywords`, `askTitleRequiredAnyKeywords`, `askDescriptionExcludedKeywords`, `askDescriptionRequiredAnyKeywords`, `askMaximumSeniority`, `askAcceptedLanguages` (`{ chosen, added }`), `askRejectUnsupportedLanguages`, `showPreview`, `askConfirmation`. Test adapters `ScriptedFilterPrompts` (FIFO per method, records every call) and `createFailingFilterPrompts(reason)` mirror the `src/search/prompts.ts` / `src/profile/editing/prompts.ts` pattern. The `FilterConfigurationPreview` shape mirrors `JobFilterConfig` 1:1.
- **Domain-boundary invariants.** No Playwright, Drizzle-direct, OpenAI, or Pino imports are allowed inside `src/filter/`; the `tests/filter/boundaries.test.ts` guard enforces this. The public surface is the `src/filter/index.ts` barrel.

## Flow

`configure → evaluate → persisted filter result`.

1. **Configure** (`ConfigureFiltersService.run`)
   - Gate on `profileVersions.findActiveApproved()`; throw `NoActiveProfileError` if missing.
   - Load `filterConfigurations.findActive()`; on a hit, `JobFilterConfigSchema.safeParse` the persisted `configJson` and throw `InvalidFilterConfigError` on failure.
   - Walk the nine `FilterPrompts` calls (in a fixed order; languages sourced from the active profile's `languages[].normalizedName`).
   - Build the preview via `FilterConfigurationPreview`; `showPreview(preview)` is fire-and-forget; `askConfirmation(preview)` ⇒ `false` returns `{ kind: 'discarded' }` without writes.
   - On confirm: `JobFilterConfigSchema.parse(builtConfig)` → `normalizeJobFilterConfig` → `calculateFilterConfigContentHash` → `filterConfigurations.insert({ schemaVersion: 1, contentHash, configJson: normalized, createdAt, active: false })` → `activate(newId)` (atomic deactivate-then-activate). Persistence failures wrap as `FilterStorageError`.
   - Call `filterResults.invalidateByFilterConfigVersion(priorId ?? -1)` and return `{ kind: 'saved', filterConfigVersionId: newId, invalidatedFilterResults }`.

2. **Evaluate** (`FilterApplyService.apply`)
   - Throw `NoActiveFilterConfigError` when `filterConfigurations.findActive()` returns `null`; the orchestrator must refuse to run the pipeline without an active config.
   - Read the active approved profile (`profileVersions.findActiveApproved()` may be `null`) and compute `fingerprint = calculateFilterFingerprint({ job, config: configRow.configJson as JobFilterConfig, profile: ProfessionalProfile | null })`.
   - **Cache hit** (`filterResults.findActiveByJob(jobId, fingerprint) !== null`): return `{ outcome: existing.overallOutcome, filterResultId, fingerprint, ruleEvaluations: existing.rulesEvaluated, rejectionReasons: existing.rejectionReasons ?? [], reused: true }` — no writes.
   - **Cache miss**: `evaluation = evaluateJob(configRow.configJson as JobFilterConfig, job)` → outcome mapping:
     - any rule `failed` ⇒ `overallOutcome: 'rejected'`, `rejectionReasons = rulesFailed.map(r => r.reason)`.
     - any `reason === 'evaluator_internal_error'` ⇒ `overallOutcome: 'error'`, `rejectionReasons: []`.
     - otherwise ⇒ `overallOutcome: 'accepted'`, `rejectionReasons: []`.
   - Persist via `filterResults.activateResult({ jobId, pipelineRunId, filterConfigVersionId: configRow.id, filterConfigHash: configRow.contentHash, profileVersionId: profileVersion?.id ?? null, profileHash: profileVersion?.contentHash ?? null, filterImplementationVersion: FILTER_IMPLEMENTATION_VERSION, fingerprint, timestamp: now().toISOString(), overallOutcome, rulesEvaluated, rulesPassed, rulesFailed, rejectionReasons })`.
   - Return `{ outcome, filterResultId, fingerprint, ruleEvaluations, rejectionReasons, reused: false }`.

## Integration

- **`src/pipeline/orchestrator.ts`** — imports `FilterApplyService, type FilterApplyResult`. Per `run()`, after extraction completes it calls `filterApplyService.apply({ jobId, job, pipelineRunId })` for each complete job, aggregates `filterResult.outcome` into `summary.jobsAccepted` / `jobsRejected` / `filterErrors`, and forwards the accepted rows to the LLM scoring stage. The orchestrator's pre-flight also enforces an active filter config (raising `'no_active_filter'` when missing).
- **`src/reevaluation/`** — `reevaluation/fingerprint.ts` reuses `calculateFilterFingerprint`, `calculateJobContentHash`, `FILTER_IMPLEMENTATION_VERSION`, and the `JobFilterConfig` type to gate re-evaluation batches. `reevaluation/service.ts` imports `FilterApplyResult` and `FilterApplyInput` and invokes `FilterApplyService.apply` to refresh stale results after a profile / config swap.
- **`src/persistence/repositories/filter-configurations.ts`** — owns `findActive`, `insert`, `activate`, and the `contentHash` lookup consumed by both services. The `configJson` column is `unknown` at the persistence boundary; the schema layer (re)validates on read.
- **`src/persistence/repositories/filter-results.ts`** — owns `findActiveByJob`, `activateResult` (atomic deactivate-then-activate for the same `jobId`), `invalidateByFilterConfigVersion`, and the `FilterOutcome` type alias (`'accepted' | 'rejected' | 'error'`) re-imported by `evaluate.ts` and `service.ts`.
- **`src/profile/schema.ts`** — re-exports `SeniorityLevelSchema` / `SeniorityLevel` and the `SENIORITY_LEVELS` rank order consumed by `schema.ts`, `seniority-detector.ts`, `seniority-rule.ts`, and `prompts.ts`.
- **`src/profile/name-normalize.ts`** — `normalizeLanguageName` is consumed by `language-detector.ts` to canonicalize the original-case language text recovered from the description.
- **Desktop sidecar / HTTP layer** — wires `ConfigureFiltersService` against a real `FilterPrompts` adapter at composition time. The `FilterLifecycleError` subclasses (`InvalidFilterConfigError`, `InvalidFilterPayloadError`, `NoActiveProfileError`, `UserCancelledFilterConfigError`, `FilterStorageError`, `NoActiveFilterConfigError`) carry the documented exit codes (`InvalidUsage` / `MissingRequired` / `UserCancellation` / `Fatal`) and are mapped to HTTP status responses by `src/errors/application-error.ts`.
