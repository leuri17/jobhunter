# TASK-008 — OpenAI Profile Extraction and Structured Validation

**Status:** Implemented
**Order:** 008
**Dependencies:** TASK-002, TASK-004, TASK-007

## Scope

Implement the profile-extraction OpenAI operation as a separately testable application service:

- Define the canonical professional-profile Zod schema and versioned structured-output schema.
- Build the extraction request from normalized stored source text with distinct source IDs and no unsupported facts.
- Keep profile extraction configuration independent from job scoring configuration.
- Validate every structured response with Zod and deterministically post-process normalized names, aliases, dates, enums, references, durations, deduplication, warnings, conflicts, and content hash.
- Calculate an extraction fingerprint from source hashes, schema/prompt/model/configuration versions, and extractor implementation version.
- Reuse a matching valid draft when appropriate; create a new draft for changed fingerprints without overwriting history.
- Persist OpenAI request metadata without raw prompts/responses by default.
- Implement up to three total attempts with the specified retry categories, corrective invalid-output retry limit, exponential jitter, and server retry delay handling.
- Preserve imported sources and the current approved profile when extraction fails.

Interactive review and approval are out of scope for this task.

## Dependencies and handoffs

- Uses validated configuration and OpenAI credential lookup from TASK-002.
- Uses profile/source/request repositories from TASK-004.
- Consumes normalized source text from TASK-007.
- Produces versioned draft profiles and extraction metadata for TASK-009 and TASK-011.

## Referenced specification sections

- `SPEC.md` §12.1–12.2 canonical profile schema and normalized names
- `SPEC.md` §14.1–14.5 profile extraction flow, behavior, post-processing, metadata, and fingerprint
- `SPEC.md` §15 multiple-source merging and conflicts
- `SPEC.md` §25.1–25.5 model, structured output, retry, request persistence, and concurrency
- `SPEC.md` §40 Reliability requirements
- `SPEC.md` §41.2 OpenAI structured-response integration expectations
- `SPEC.md` §44 open decisions 2 and 8

## Expected tests

- Validate complete, sparse, malformed, enum-invalid, date-invalid, and reference-invalid model outputs.
- Verify missing scalars become `null`, missing collections become empty arrays, and unsupported invented facts are rejected or warned according to the schema.
- Verify normalized aliases and equivalent skill/language deduplication are deterministic.
- Verify two-source complementary facts merge while conflicting claims remain explicit and unresolved.
- Verify matching fingerprints reuse valid drafts and changed fingerprints create new versions.
- Verify retryable/non-retryable failures, corrective invalid-output retry, rate-limit delays, and attempt metadata.
- Verify no request is made when local extraction marked a required source unusable.
- Verify raw prompt and raw response persistence is disabled by default.

## Verification requirements

- Run OpenAI operation tests exclusively with fakes; no live API call in normal verification.
- Run profile schema/post-processing unit tests and repository integration tests.
- Inspect request payload tests to confirm only allowed source/profile data is included.
- Run typecheck, build, and focused tests.

## Completion criteria

- A valid normalized source set can produce a persisted draft profile through a fake OpenAI client.
- Every structured result is validated and fingerprinted before persistence.
- Retry and failure behavior preserves source/history state and leaves the active approved profile unchanged.

## Implementation results

- **Verification date:** 2026-08-14
- **Environment:** Node.js v24.18.0, pnpm 11.18.0
- **Branch:** `feat/task-008-openai-profile-extraction`
- **Worktree:** `/home/leuri/Projects/dev/jobhunter/.worktrees/task-008`
- **Base:** `de1ed83` (post-TASK-007 main)
- **Dependency additions:** `openai@6.7.1` (Apache-2.0) — confined to `src/profile/openai/client.ts`.

### Commits landed

| Task | Commit  | Subject |
|------|---------|---------|
| 1    | c231ba7 | `feat(profile): add openai SDK and typed profile-extraction errors` |
| 2    | 30edd5a | `feat(profile): add canonical profile and structured-output Zod schemas` |
| 3    | fd4c6a9 | `feat(profile): add pure post-processing helpers for profile extraction` |
| 3    | 1c5bf4b | `fix(profile): address Task 3 reviewer Important findings` |
| 4    | b02ef74 | `feat(profile): add extraction fingerprint calculator (Task 4)` |
| 5    | 5434eff | `feat(profile): add OpenAI client interface, retry policy, prompt builder, and FakeOpenAIClient` |
| 5    | d430c33 | `fix(profile): address Task 5 reviewer Critical and Important findings` |
| 5    | d7c4fff | `fix(profile): accept null for Skill.category and Language.level in structured-output schema` |
| 6    | cbc37b2 | `feat(profile): add post-processor that turns ExtractedProfile into ProfessionalProfile` |
| 6    | c0dfe87 | `fix(profile): address Task 6 reviewer Important findings (date cascade + cert/project warnings + lang dedup)` |
| 6    | 6be8aa1 | `fix(profile): make calculateProfileContentHash self-consistent (exclude contentHash from input)` |
| 7    | 585d0d6 | `feat(profile): add ProfileExtractionService orchestrator (Task 7)` |
| 8    | fd190a8 | `feat(cli): wire 'profile extract' subcommand (Task 8)` |
| 9    | (this)  | `chore(profile): align public exports (Task 9)` |

### Verification commands and outcomes (final)

- `pnpm typecheck` — exit 0 ✅
- `pnpm lint` — exit 0 ✅
- `pnpm format:check` — exit 0 ✅ (one round-trip through `pnpm format` was needed for the new barrel)
- `pnpm build` — exit 0, `dist/cli.js` produced ✅
- `pnpm test` — 516/516 tests pass across 71 files ✅
  - The 4 pre-existing `tests/cli/smoke.test.ts` failures noted in the progress ledger fire only when `dist/cli.js` is missing; `pnpm build` resolves them. They are out of scope for TASK-008 and were intentionally left untouched.

### Module layout (final)

```
src/profile/
  errors.ts                          # TASK-007 import-flow errors
  source-types.ts, hashing.ts, file-system.ts, file-copy.ts,
  text-normalize.ts, extractors/, importer.ts   # TASK-007 imports
  schema.ts                          # canonical ProfessionalProfile (+ enums, dates)
  name-aliases.ts                    # starter ALIAS_MAP (Open decision #8)
  name-normalize.ts                  # normalizeSkillName / normalizeLanguageName
  dates.ts                           # parseYearMonth / isValidYearMonth / calculateDurationMonths
  conflicts.ts                       # detectProfileConflicts (multi-source comparator)
  content-hash.ts                    # calculateProfileContentHash (self-consistent)
  post-process.ts                    # postProcessExtractionResponse (pure)
  extraction-service.ts              # ProfileExtractionService orchestrator
  openai/
    errors.ts                        # typed ProfileExtractionError family
    types.ts                         # OpenAIClient interface and request/response types
    client.ts                        # createDefaultOpenAIClient (only openai SDK importer)
    fake-client.ts                   # FakeOpenAIClient for tests
    retry.ts                         # runWithRetry + RetryOptions + AttemptRecord
    prompt.ts                        # buildProfileExtractionPrompt + STRUCTURED_OUTPUT_SCHEMA
    fingerprint.ts                   # calculateExtractionFingerprint + version constants
    structured-output.ts             # versioned Zod schemas + createExtractedProfileSchema
    index.ts                         # PUBLIC BARREL for the OpenAI surface (Task 9)
  index.ts                           # PUBLIC BARREL for the profile module (Task 9)
```

### Decisions and notable deviations

- **Single source of truth for `PROFILE_EXTRACTION_PROMPT_VERSION`.** Lives in
  `src/profile/openai/fingerprint.ts` because the prompt version is one of the
  fingerprint inputs (`Spec §14.5`). The `openai/index.ts` barrel re-exports it
  from the fingerprint module so callers reach a single definition.
- **`openai` SDK is confined.** Only `src/profile/openai/client.ts` imports from
  the `openai` package; every other module sees the `OpenAIClient` interface
  only. This keeps the SDK behind one boundary and makes fakes trivial.
- **Corrective retry limit.** `OpenAIInvalidOutputError` is retryable exactly once
  via the retry policy (`retry.ts`). A second invalid output aborts.
- **Quota/billing precedence.** 429 responses whose body carries a quota
  code (`insufficient_quota`, etc.) are translated to `OpenAIBillingError`
  (non-retryable) rather than `OpenAIRateLimitError` so we do not burn the
  retry budget on a permanent billing failure.
- **Profile history is preserved.** The service only ever inserts new
  `profile_versions` rows with `status = 'draft'`. Approved and historical
  versions are never mutated.
- **`calculated contentHash is empty before finalizing`.** The post-processor
  inserts a profile with `contentHash = ''` and then replaces it via
  `calculateProfileContentHash` so the helper can be self-consistent
  (`hash(profile with its own hash) === hash`); regression-tested in
  `tests/profile/content-hash.test.ts`.

### Known limitations

- Interactive review and approval are out of scope here and belong to TASK-009.
- Live LinkedIn dependencies are untouched; the OpenAI call path is the only
  network surface introduced by this task.
- **`ProfileExtractionService.loadSourceText` does not compare the recomputed
  `extractedTextHash` against the value stored at import time.** The orchestrator
  re-runs the extractor and re-normalizes the text every time the profile
  fingerprint changes, so a drift between the import-time hash and the
  extraction-time hash would silently change the fingerprint without being
  detected. The drift path is currently impractical (the import pipeline uses
  the same `normalizeExtractedText` and extractor), so we accept the
  asymmetry for now and earmark the verification step for TASK-009 (or a
  later hardening pass) per the final-branch review's F7 finding.
- **Plan §10.5 manual smoke checks (`HOME=/tmp/jh-final-... node dist/cli.js
  profile extract …`) require a real `OPENAI_API_KEY` and a non-zero source
  list.** They are excluded from CI per SPEC §40. The corresponding
  programmatic coverage lives in `tests/cli/profile-extract.test.ts` (no
  sources → exit 2, missing key with imported source → exit 2,
  `openai_authentication` 401 → exit 5, draft reuse on second call → exit 0).
  These tests fully exercise the wiring the manual smoke was meant to
  validate; the manual checks remain documented for an operator with a real
  API key who wants to confirm against the live API.

### Final-review follow-up commits

Whole-branch review (`de1ed83..c1dd59a`) returned verdict "With fixes".
Applied locally:

| Finding | Commit | Subject |
|---------|--------|---------|
| F1 (input-too-large) | `ac5cad3` | `fix(profile): raise ProfileExtractionInputTooLargeError when source text exceeds limit` |
| F2 (correctiveAttemptUsed) | `33971e8` | `fix(profile): remove correctiveAttemptUsed in favor of retry-loop counter` |
| F3 (attemptCount in failed) | `0fc500e` | `fix(profile): include attemptCount in ProfileExtractionStatus failed branch` |
| F4 (schema asymmetry) | `a2b83e8` | `chore(profile): document schema asymmetry between strict-mode JSON and Zod` |
| F5 (nodejs self-mapping) | `3625b72` | `chore(profile): document intentional no-op self-mapping in ALIAS_MAP` |
| F6 (dedupeLanguages) | `cde2809` | `chore(profile): document intentional sourceReference preservation in dedupeLanguages` |
| F7 (loadSourceText drift) | (this doc) | Deferred to TASK-009 / later hardening |
| F8 (manual smoke checks) | (this doc) | Excluded from CI per SPEC §40; programmatic coverage in `tests/cli/profile-extract.test.ts` |

After these commits the suite is at 519/519 passing (516 baseline + 2 new
`profile extract` rendering tests + 1 new `profile_extraction_input_too_large`
orchestrator test).

