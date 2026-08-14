# TASK-008 Implementation Plan — OpenAI Profile Extraction and Structured Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OpenAI profile-extraction application service that turns normalized CV source text into a versioned, fingerprinted, validated draft `ProfessionalProfile`, with retry/backoff, deterministic post-processing, and immutable persistence — without ever approving the draft automatically. Interactive review/approval remains TASK-009.

**Architecture:** A new pure-domain `src/profile/` layer (already started by TASK-007) gains: the canonical `ProfessionalProfile` Zod schema, a versioned OpenAI structured-output schema, deterministic post-processing helpers (name normalization, date validation, content-hash, conflict detection), a thin `OpenAIClient` interface with a retry policy implementing SPEC §25.3, a `FakeOpenAIClient` for tests, and a `ProfileExtractionService` orchestrator that loads stored sources, calculates the extraction fingerprint, reuses a matching valid draft when present, otherwise invokes OpenAI, validates the response with Zod, post-processes it, and persists a `profile_version` row plus `openai_request_metadata`, `profile_conflicts`, and `profile_warnings` rows. The CLI gains a `profile extract` subcommand. No new database tables or migrations are required — TASK-003 already created `profile_versions`, `profile_conflicts`, `profile_warnings`, and `openai_request_metadata`.

**Tech Stack:** Adds the official `openai` Node.js SDK (default provider for the new `OpenAIClient`; all tests use the `FakeOpenAIClient`, no live API call). Reuses `zod`, Node built-ins, the existing `Repositories` facade, `pino`, `vitest`, and the existing profile-import + repository plumbing from TASK-002/004/007. No new LLM provider, job source, UI framework, hosted service, or auth system.

## Open decisions to confirm before implementation

These map directly to SPEC §44 items that this task resolves. The plan is designed around the recommendations below; if any is rejected the plan needs revision.

| # | SPEC §44 item | Recommendation |
|---|---|---|
| 2 | Exact profile-extraction prompt contents and prompt versioning strategy | Single versioned prompt `profile-extraction-prompt@v1`, defined in `src/profile/openai/prompt.ts`. Bump the suffix (`@v2`, …) on any prompt change. Stored verbatim in the module so the audit trail is the git history. |
| 4 | Exact deterministic alias dictionary | Small starter map (`nodejs → nodejs`, `reactjs → react`, `postgres/postgresql → postgresql`, `typescript → typescript`, …) committed at `src/profile/name-aliases.ts`. Treated as version-controlled; updates are future tasks. |
| 8 | Exact Drizzle migration commands and release workflow | No new migration for TASK-008; the version is tracked in code (`STRUCTURED_OUTPUT_SCHEMA_VERSION`) and recorded in `profile_versions.structuredOutputSchemaVersion`. If a column is later required, the team's standard `pnpm db:generate` workflow applies. |
| 14 | Exact OpenAI SDK integration details | Use the official `openai` npm package. The SDK is hidden behind an `OpenAIClient` interface so all tests run against `FakeOpenAIClient` and no network call is made in normal verification. |

The implementing agent must stop and ask the user to confirm all four recommendations before any file in `src/` is edited.

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §6):** Files under `src/profile/` that are pure domain (`schema.ts`, `name-normalize.ts`, `dates.ts`, `conflicts.ts`, `content-hash.ts`, `openai/prompt.ts`, `openai/structured-output.ts`, `openai/fingerprint.ts`, `openai/retry.ts`) **must not** import Commander, Inquirer, Playwright, Drizzle, the `openai` SDK, or Pino. They may import `zod`, Node built-ins (`node:crypto`), and each other. `extraction-service.ts` is the only file that depends on both the pure modules and the persistence repositories.
- **OpenAI client isolation:** `src/profile/openai/client.ts` is the only file that may import the `openai` package. Production code resolves the live `OpenAI` via `createDefaultOpenAIClient`; tests pass `new FakeOpenAIClient(…)` directly. This keeps the `openai` SDK out of the dependency graph of every other file (so vitest never accidentally loads it).
- **Validation:** Zod at every external boundary. The structured-output schema is parsed with `safeParse`; on failure the error is reclassified as `OpenAIInvalidOutputError` and a corrective retry is allowed (max one). The canonical `ProfessionalProfile` is parsed again at the persistence boundary.
- **Errors:** Typed errors extending `ApplicationError` with the documented exit code (default `ExitCode.OpenAIFailure` = 5). CLI exits non-zero when the extraction operation reports failure; recoverable post-processing warnings (e.g., `unsupported_skill_category`) remain warnings, not errors.
- **Determinism:** SHA-256 hashing, name normalization, date validation, content-hash calculation, and the extraction fingerprint are all deterministic. The extraction fingerprint is what guards draft reuse; a matching fingerprint with a still-`draft` row causes the service to return that row instead of calling OpenAI.
- **Tests:** Vitest. Pure-domain tests are deterministic. The OpenAI client is replaced with `FakeOpenAIClient` in every test. CLI smoke tests use the same `cliFileSystem` pattern as TASK-007. No live network. No live terminal.
- **Request persistence:** SPEC §25.4 forbids persisting raw prompts/responses by default. The `OpenAIRequestMetadataRow` already records hashes and metadata, not raw bytes. `validatedOutputJson` stores the **parsed Zod output** (not the raw JSON returned by OpenAI). This is the same model used for `score_results` in TASK-014.
- **No silent truncation:** SPEC §25.8 is a scoring-only rule, but the same posture applies here: when a payload cannot fit, fail loud with `profile_extraction_input_too_large` rather than trimming.

## File Structure

```
src/profile/
  schema.ts                        # ProfessionalProfile + nested Zod schemas (Task 2)
  openai/
    types.ts                       # Shared OpenAI operation types (Task 5)
    structured-output.ts           # Versioned extraction response schema (Task 2)
    prompt.ts                      # Versioned prompt + request payload builder (Task 5)
    fingerprint.ts                 # calculateExtractionFingerprint (Task 4)
    client.ts                      # OpenAIClient interface + default impl wrapping openai SDK (Task 5)
    fake-client.ts                 # FakeOpenAIClient for tests (Task 5)
    retry.ts                       # Retry policy per SPEC §25.3 (Task 5)
    errors.ts                      # ProfileExtractionError + retryable/non-retryable subclasses (Task 1)
    index.ts                       # public re-exports (Task 9)
  name-normalize.ts                # normalizeSkillName + normalizeLanguageName (Task 3)
  name-aliases.ts                  # ALIAS_MAP (Task 3)
  dates.ts                         # YearMonth validation + duration math (Task 3)
  conflicts.ts                     # detectProfileConflicts (Task 3)
  content-hash.ts                  # calculateProfileContentHash (Task 3)
  post-process.ts                  # postProcessExtractionResponse (Task 6)
  extraction-service.ts            # ProfileExtractionService orchestrator (Task 7)
  index.ts                         # MODIFIED: re-export new public surface (Task 9)
src/persistence/repositories/
  openai-metadata.ts               # unchanged (already supports operationType + relatedEntityId)
  profile-versions.ts              # unchanged (already has insert + findByExtractionFingerprint + insertConflict + insertWarning)
  profile-sources.ts               # unchanged (read-only access via existing methods)
src/cli.ts                         # MODIFIED: profile extract subcommand (Task 8)
package.json                       # MODIFIED: add `openai` SDK (Task 1)
pnpm-lock.yaml                     # regenerated by pnpm install

tests/profile/
  schema.test.ts                   # (Task 2)
  openai/
    structured-output.test.ts      # (Task 2)
    fingerprint.test.ts            # (Task 4)
    retry.test.ts                  # (Task 5)
    client.test.ts                 # (Task 5) — fake-client behavior + interface conformance
    fake-client.test.ts            # (Task 5) — fake-client dispatch helpers
  name-normalize.test.ts           # (Task 3)
  dates.test.ts                    # (Task 3)
  conflicts.test.ts                # (Task 3)
  content-hash.test.ts             # (Task 3)
  post-process.test.ts             # (Task 6)
  extraction-service.test.ts       # (Task 7) — uses FakeOpenAIClient
tests/cli/profile-extract.test.ts  # (Task 8)
tests/foundation.test.ts           # unchanged (no new top-level commands)
```

Files change together by responsibility. The pure-domain modules (`schema.ts`, `name-normalize.ts`, `dates.ts`, `conflicts.ts`, `content-hash.ts`, `openai/{structured-output,prompt,fingerprint,retry}.ts`) share no runtime dependencies apart from `zod`, `node:crypto`, and each other. `extraction-service.ts` is the only file that depends on both the pure modules and the persistence repositories. `client.ts` is the only file that imports the `openai` SDK.

---

### Task 1: Add `openai` SDK and typed profile-extraction errors

**Files:**
- Modify: `package.json` (add `openai` to `dependencies`)
- Modify: `pnpm-lock.yaml` (regenerated by `pnpm install`)
- Create: `src/profile/openai/errors.ts`
- Create: `tests/profile/openai/errors.test.ts`

**Open decision to confirm:** SDK version. Recommendation: latest stable `openai` Node.js SDK (verify version via `pnpm view openai version` at implementation time; SPEC §44 #9 leaves the exact version to the implementer).

**Interfaces:**

```ts
// src/profile/openai/errors.ts
export class ProfileExtractionError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata?: ApplicationErrorMetadata,
    cause?: Error,
  ) {
    super(code, message, ExitCode.OpenAIFailure, metadata ?? {}, cause);
  }
}

// Retryable — network, timeout, rate limit, server error, invalid output (one corrective)
export class OpenAITransientError extends ProfileExtractionError {
  readonly retryAfterMs: number | null;
  constructor(
    code: string,
    message: string,
    retryAfterMs: number | null,
    metadata?: ApplicationErrorMetadata,
    cause?: Error,
  ) {
    super(code, message, metadata, cause);
    this.retryAfterMs = retryAfterMs;
  }
}

export class OpenAIRateLimitError extends OpenAITransientError {
  constructor(retryAfterMs: number | null, metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_rate_limit', 'OpenAI rate limit reached.', retryAfterMs, metadata, cause);
  }
}

export class OpenAIServerError extends OpenAITransientError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_server_error', 'OpenAI server error.', null, metadata, cause);
  }
}

export class OpenAITimeoutError extends OpenAITransientError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_timeout', 'OpenAI request timed out.', null, metadata, cause);
  }
}

export class OpenAINetworkError extends OpenAITransientError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_network_error', 'OpenAI network failure.', null, metadata, cause);
  }
}

export class OpenAIInvalidOutputError extends OpenAITransientError {
  readonly correctiveAttemptUsed: boolean;
  constructor(
    correctiveAttemptUsed: boolean,
    metadata?: ApplicationErrorMetadata,
    cause?: Error,
  ) {
    super('openai_invalid_output', 'OpenAI returned output that failed Zod validation.', null, metadata, cause);
    this.correctiveAttemptUsed = correctiveAttemptUsed;
  }
}

// Non-retryable
export class OpenAIAuthenticationError extends ProfileExtractionError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_authentication', 'OpenAI authentication failed.', metadata, cause);
  }
}

export class OpenAIPermissionError extends ProfileExtractionError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_permission', 'OpenAI permission denied.', metadata, cause);
  }
}

export class OpenAIBillingError extends ProfileExtractionError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_billing', 'OpenAI billing or quota configuration error.', metadata, cause);
  }
}

export class OpenAIInvalidRequestError extends ProfileExtractionError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_invalid_request', 'OpenAI rejected the request as invalid.', metadata, cause);
  }
}

export class OpenAIUnsupportedModelError extends ProfileExtractionError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('openai_unsupported_model', 'OpenAI rejected the model or configuration.', metadata, cause);
  }
}

export class ProfileExtractionInputTooLargeError extends ProfileExtractionError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('profile_extraction_input_too_large', 'Source text exceeds the OpenAI request size limit.', metadata, cause);
  }
}

export class ProfileExtractionSourceUnusableError extends ProfileExtractionError {
  constructor(metadata?: ApplicationErrorMetadata, cause?: Error) {
    super('profile_extraction_source_unusable', 'One or more required sources have unusable extracted text.', metadata, cause);
  }
}
```

**Behavior rules:**

- All errors extend `ProfileExtractionError` → exit code 5 (`ExitCode.OpenAIFailure`).
- Retryable errors carry an optional `retryAfterMs` for server-provided delays (e.g., `Retry-After` header on a 429).
- `OpenAIInvalidOutputError` carries `correctiveAttemptUsed: boolean` so the retry loop can refuse a second corrective retry per SPEC §25.3.

**Steps:**

- [ ] **Step 1.1: Confirm open decisions 2, 4, 8, 14 with the user before adding any dependency.**

  Implementer must stop and surface the four open decisions to the user using the `question` tool. Do not proceed until all four are explicitly approved (or revised). The plan revision is required if any decision is rejected.

- [ ] **Step 1.2: Add `openai` to `package.json` dependencies**

  ```json
  "dependencies": {
    "openai": "<resolved-at-implementation-time>",
    ...
  }
  ```

  Then run `pnpm install` to regenerate `pnpm-lock.yaml`.

- [ ] **Step 1.3: Write `src/profile/openai/errors.ts`** with the class hierarchy above. Add `OPENAI_RETRYABLE_ERROR_CODES = new Set(['openai_rate_limit', 'openai_server_error', 'openai_timeout', 'openai_network_error', 'openai_invalid_output'])` so the retry policy can test membership without `instanceof`.

- [ ] **Step 1.4: Run typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0

- [ ] **Step 1.5: Write `tests/profile/openai/errors.test.ts`** (8 tests)
  - `code`, `exitCode`, and `metadata` for each subclass.
  - `retryAfterMs` is preserved on `OpenAIRateLimitError`.
  - `OPENAI_RETRYABLE_ERROR_CODES` membership for the retryable set.
  - `correctiveAttemptUsed` is round-tripped on `OpenAIInvalidOutputError`.

- [ ] **Step 1.6: Run tests**

  Run: `pnpm test -- tests/profile/openai/errors.test.ts`
  Expected: 8 pass

---

### Task 2: Canonical `ProfessionalProfile` Zod schema and versioned structured-output schema

**Files:**
- Create: `src/profile/schema.ts`
- Create: `src/profile/openai/structured-output.ts`
- Create: `tests/profile/schema.test.ts`
- Create: `tests/profile/openai/structured-output.test.ts`

**Interfaces:**

```ts
// src/profile/schema.ts
export const PROFILE_SCHEMA_VERSION = 1;
export const YearMonthSchema: z.ZodEffects<z.ZodString, string, string>; // "YYYY" or "YYYY-MM"; refuses impossible months (00, 13+)
export const SkillCategorySchema: z.ZodEnum<[…13 values…]>;
export const SkillProficiencySchema: z.ZodEnum<['beginner','intermediate','advanced','expert']>;
export const LanguageLevelSchema: z.ZodEnum<['basic','conversational','professional','fluent','native']>;
export const SeniorityLevelSchema: z.ZodEnum<[…10 values…]>;
export const SourceReferenceSchema: z.ZodObject<…>;
export const WorkExperienceSchema: z.ZodObject<…>;
export const SkillEvidenceSchema: z.ZodObject<…>;
export const SkillSchema: z.ZodObject<…>;
export const LanguageSchema: z.ZodObject<…>;
export const EducationSchema: z.ZodObject<…>;
export const CertificationSchema: z.ZodObject<…>;
export const ProjectSchema: z.ZodObject<…>;
// DerivedValueSchema is a generic factory: SPEC §12.1's DerivedValue<T> is generic
// over four payload types (SeniorityLevel | null, string[] × 3), so a non-generic
// ZodObject cannot express it without losing type safety. Tasks 6 and 7 call it
// (e.g., DerivedValueSchema(z.array(z.string()))) to build a schema for each field.
// `ProfileDerivedSchema` is the composed ready-made schema for the whole `derived`
// block on ProfessionalProfile — most consumers use it directly.
export function DerivedValueSchema<Value extends z.ZodTypeAny>(value: Value): z.ZodObject<…>;
export const ProfileDerivedSchema: z.ZodObject<…>;
export const ProfessionalProfileSchema: z.ZodObject<…>;
export type ProfessionalProfile = z.infer<typeof ProfessionalProfileSchema>;
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
// …and other inferred types.

// src/profile/openai/structured-output.ts
export const STRUCTURED_OUTPUT_SCHEMA_VERSION = 1;
export const ExtractedBasicsSchema: z.ZodObject<{
  headline: z.ZodNullable<z.ZodString>;
  professionalSummary: z.ZodNullable<z.ZodString>;
  currentLocation: z.ZodNullable<z.ZodString>;
  totalYearsOfExperience: z.ZodNullable<z.ZodNumber>;
}>;
export const ExtractedWorkExperienceSchema: z.ZodObject<{
  company: z.ZodString;
  title: z.ZodString;
  location: z.ZodNullable<z.ZodString>;
  startDate: z.ZodNullable<YearMonthSchema>;
  endDate: z.ZodNullable<YearMonthSchema>;
  isCurrent: z.ZodBoolean;
  summary: z.ZodNullable<z.ZodString>;
  responsibilities: z.ZodArray<z.ZodString>;
  achievements: z.ZodArray<z.ZodString>;
  technologies: z.ZodArray<z.ZodString>;
  domains: z.ZodArray<z.ZodString>;
  sourceReferences: z.ZodArray<SourceReferenceSchema>;
}>;
// …one schema per entity, each WITHOUT `id`, `normalizedName`, and other server-generated fields.
export const ExtractedProfileSchema: z.ZodObject<{
  basics: ExtractedBasicsSchema;
  experience: z.ZodArray<ExtractedWorkExperienceSchema>;
  skills: z.ZodArray<ExtractedSkillSchema>;
  languages: z.ZodArray<ExtractedLanguageSchema>;
  education: z.ZodArray<ExtractedEducationSchema>;
  certifications: z.ZodArray<ExtractedCertificationSchema>;
  projects: z.ZodArray<ExtractedProjectSchema>;
  warnings: z.ZodArray<z.ZodString>;
}>;
export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;
// createExtractedProfileSchema(knownSourceIds) returns ExtractedProfileSchema wrapped
// in a `.superRefine` that walks every `sourceReferences` array on experience /
// language / education / certification / project entries and rejects any `sourceId`
// value that does not appear in `knownSourceIds`. Task 7 MUST opt in via this factory
// when it has the request's source IDs. Skills carry `SkillEvidence` (with
// `sourceEntityId`, not `SourceReference`), so the refinement does not walk them.
export function createExtractedProfileSchema(
  knownSourceIds: readonly string[],
): z.ZodType<ExtractedProfile>;
```

**Behavior rules:**

- `ProfessionalProfileSchema` is the **canonical, on-disk** shape: it includes `schemaVersion`, `id`, `createdAt`, `updatedAt`, `contentHash`, `sourceIds`, `derived`, and `normalizedName` everywhere required.
- `ExtractedProfileSchema` is the **structured-output** shape returned by OpenAI: it omits server-generated fields (`id`, `createdAt`, `updatedAt`, `contentHash`, `derived`, `normalizedName`), uses `sourceId` strings instead of source integer IDs, and accepts nullable scalars/empty arrays per SPEC §14.2.
- Both schemas use `.strict()` so unknown keys are rejected.
- `YearMonthSchema` is a `z.string().regex(/^\d{4}(-\d{2})?$/)`.
- All enum fields use `z.enum(…)` exactly matching SPEC §12.1.

**Steps:**

- [ ] **Step 2.1: Write `tests/profile/schema.test.ts`** (10 tests)
  - Minimal valid profile parses successfully.
  - Each enum rejects unknown values.
  - `derived.likelySeniority` accepts the full SPEC enum.
  - `YearMonth` accepts `"1990"`, `"1990-01"`, rejects `"1990-13"`, `"90"`, `"abc"`.
  - Unknown top-level keys are rejected.
  - `schemaVersion` must equal `1`.

- [ ] **Step 2.2: Implement `src/profile/schema.ts`** using `z.enum([…])` for each enum and `z.object({…}).strict()` for every object.

- [ ] **Step 2.3: Write `tests/profile/openai/structured-output.test.ts`** (8 tests)
  - `ExtractedProfileSchema` accepts a complete, valid extracted profile.
  - It rejects `id`, `createdAt`, `updatedAt`, `contentHash`, `derived`, `normalizedName` keys anywhere.
  - Missing scalars are nullable, missing collections are empty arrays (not `null`).
  - Enum-invalid fields fail with a precise Zod issue path.
  - Date-invalid fields fail (`"1990-13"`, `"abc"`).
  - A `SourceReference.sourceId` referencing a `sourceIds` not in the request is rejected by a custom refinement (only if present in the request).

- [ ] **Step 2.4: Implement `src/profile/openai/structured-output.ts`** with the schemas and types above.

- [ ] **Step 2.5: Run tests**

  Run: `pnpm test -- tests/profile/schema.test.ts tests/profile/openai/structured-output.test.ts`
  Expected: 18 pass

---

### Task 3: Pure post-processing helpers (name normalization, dates, conflicts, content hash)

**Files:**
- Create: `src/profile/name-aliases.ts`
- Create: `src/profile/name-normalize.ts`
- Create: `src/profile/dates.ts`
- Create: `src/profile/conflicts.ts`
- Create: `src/profile/content-hash.ts`
- Create: `tests/profile/name-normalize.test.ts`
- Create: `tests/profile/dates.test.ts`
- Create: `tests/profile/conflicts.test.ts`
- Create: `tests/profile/content-hash.test.ts`

**Open decision to confirm:** Alias dictionary scope (open decision #4). Recommendation: starter map at `src/profile/name-aliases.ts` covering the SPEC §12.2 examples plus a small set of common CV terms. Updates are future tasks; the file is the single source of truth.

**Interfaces:**

```ts
// src/profile/name-aliases.ts
export const ALIAS_MAP: Readonly<Record<string, string>>; // e.g., { 'react.js': 'react', 'node.js': 'nodejs', 'postgresql': 'postgresql', 'type script': 'typescript', 'gcp': 'googlecloud' }

// src/profile/name-normalize.ts
export function normalizeSkillName(name: string): { name: string; normalizedName: string };
export function normalizeLanguageName(name: string): { name: string; normalizedName: string };

// src/profile/dates.ts
export function parseYearMonth(value: string): { year: number; month: number | null };
export function isValidYearMonth(value: string): boolean;
export function calculateDurationMonths(start: string, end: string | null, isCurrent: boolean): number | null;

// src/profile/conflicts.ts
export interface DetectedConflict {
  readonly conflictType: string;     // e.g., 'work_experience.end_date', 'skill.proficiency', 'education.qualification'
  readonly affectedField: string;
  readonly valueSourceA: unknown;
  readonly valueSourceB: unknown;
  readonly sourceReferences: readonly SourceReference[];
  readonly provisionalValue: unknown | null;
  readonly explanation: string;
}
export function detectProfileConflicts(
  profile: ExtractedProfile,
  knownSourceIds: readonly string[],
): readonly DetectedConflict[];

// src/profile/content-hash.ts
export function calculateProfileContentHash(profile: ProfessionalProfile): string;
```

**Behavior rules (SPEC §12.2 + §14.3):**

- `normalizeSkillName` and `normalizeLanguageName`:
  1. Trim whitespace; collapse inner whitespace.
  2. Lowercase.
  3. Strip combining diacritics (NFKD + remove `Mn`).
  4. Remove `.`, `_`, `-`, `/`, `+` (separators).
  5. If the resulting key exists in `ALIAS_MAP`, return the alias value as `normalizedName`.
  6. Otherwise, return the cleaned key as `normalizedName`.
  7. Preserve the original `name` value.
- `calculateDurationMonths`:
  - If `end === null && isCurrent === true`, calculate from `start` to the **current year-month** (injected, defaults to `now()` in production, fixed in tests).
  - If `start > end`, return `null` (invalid range).
  - Returns the duration in months (negative-capable input is impossible because we validate first).
- `detectProfileConflicts`:
  - For two-source inputs, any field where the two sources disagree on a non-empty value produces a `DetectedConflict`.
  - For one-source inputs, returns `[]`.
  - `provisionalValue` is the **first source's** value when both sources are non-null and non-equal.
  - `explanation` is a concise human-readable string.
- `calculateProfileContentHash`:
  - Builds a stable JSON serialization of the profile with sorted keys and no whitespace.
  - Returns the hex-encoded SHA-256 digest (64 lowercase chars).

**Steps:**

- [ ] **Step 3.1: Write `src/profile/name-aliases.ts`** with the starter `ALIAS_MAP` covering SPEC §12.2 examples and a small extension (e.g., `{ 'gcp': 'googlecloud', 'amazon web services': 'aws', 'k8s': 'kubernetes' }`).

- [ ] **Step 3.2: Write `tests/profile/name-normalize.test.ts`** (8 tests)
  - SPEC §12.2 table rows (`Node.js → nodejs`, `Type Script → typescript`, …).
  - Whitespace-only input → empty trimmed name + empty normalized.
  - Alias map applies after normalization (`react.js → react`).
  - `name` is preserved verbatim.

- [ ] **Step 3.3: Implement `src/profile/name-normalize.ts`** per the behavior rules.

- [ ] **Step 3.4: Write `tests/profile/dates.test.ts`** (10 tests)
  - `parseYearMonth('1990')` → `{ year: 1990, month: null }`.
  - `parseYearMonth('1990-01')` → `{ year: 1990, month: 1 }`.
  - `isValidYearMonth('1990-13')` → false.
  - `isValidYearMonth('90')` → false.
  - `calculateDurationMonths('2020-01', '2022-01', false)` → 24.
  - `calculateDurationMonths('2020', null, true)` with `now()` injected as `'2026-08-01'` → 80.
  - `calculateDurationMonths('2022-01', '2020-01', false)` → null (invalid range).

- [ ] **Step 3.5: Implement `src/profile/dates.ts`**.

- [ ] **Step 3.6: Write `tests/profile/conflicts.test.ts`** (6 tests)
  - One source → no conflicts.
  - Two sources with identical `endDate` for the same `company + title` → no conflict.
  - Two sources with different `endDate` for the same `company + title` → 1 conflict with `valueSourceA` and `valueSourceB`.
  - Two sources with different `location` for the same `company + title` → 1 conflict.
  - Two sources with no overlapping `company + title` → no conflicts (different experiences).
  - Conflict includes `sourceReferences` from both sides.

- [ ] **Step 3.7: Implement `src/profile/conflicts.ts`**.

- [ ] **Step 3.8: Write `tests/profile/content-hash.test.ts`** (4 tests)
  - Same input → same hash (deterministic).
  - Different `basics.headline` → different hash.
  - Hash is 64 lowercase hex chars.
  - Hash is invariant to key ordering of any object.

- [ ] **Step 3.9: Implement `src/profile/content-hash.ts`** using `node:crypto` `createHash('sha256')` and a stable `JSON.stringify` with sorted keys (custom serializer or a recursive key-sort helper).

- [ ] **Step 3.10: Run tests**

  Run: `pnpm test -- tests/profile/name-normalize.test.ts tests/profile/dates.test.ts tests/profile/conflicts.test.ts tests/profile/content-hash.test.ts`
  Expected: 28 pass

---

### Task 4: Extraction fingerprint calculator

**Files:**
- Create: `src/profile/openai/fingerprint.ts`
- Create: `tests/profile/openai/fingerprint.test.ts`

**Interfaces:**

```ts
// src/profile/openai/fingerprint.ts
export const EXTRACTOR_IMPLEMENTATION_VERSION = '1.0.0';
export const PROFILE_EXTRACTION_PROMPT_VERSION = 'profile-extraction-prompt@v1';

export interface ExtractionFingerprintInputs {
  readonly sourceHashes: readonly string[];     // sha256 of stored source content, sorted lexicographically
  readonly schemaVersion: number;               // PROFILE_SCHEMA_VERSION (1)
  readonly promptVersion: string;               // PROFILE_EXTRACTION_PROMPT_VERSION
  readonly model: string;                       // e.g., 'gpt-5.6-sol'
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly structuredOutputSchemaVersion: number;
  readonly extractorImplementationVersion?: string; // defaults to EXTRACTOR_IMPLEMENTATION_VERSION
}

export function calculateExtractionFingerprint(inputs: ExtractionFingerprintInputs): string;
```

**Behavior rules (SPEC §14.5):**

- Sort `sourceHashes` lexicographically (so order of sources on the CLI does not change the fingerprint).
- Build a stable serialization: `JSON.stringify({ … })` with sorted keys.
- Return the lowercase hex SHA-256 digest (64 chars).

**Steps:**

- [ ] **Step 4.1: Write `tests/profile/openai/fingerprint.test.ts`** (6 tests)
  - Same inputs → same hash.
  - Reordering source hashes → same hash.
  - Different `model` → different hash.
  - Different `reasoningEffort` → different hash.
  - Different `schemaVersion` → different hash.
  - Different `promptVersion` → different hash.

- [ ] **Step 4.2: Implement `src/profile/openai/fingerprint.ts`** with the function and the two version constants exported.

- [ ] **Step 4.3: Run tests**

  Run: `pnpm test -- tests/profile/openai/fingerprint.test.ts`
  Expected: 6 pass

---

### Task 5: OpenAI client interface, retry policy, prompt builder, and FakeOpenAIClient

**Files:**
- Create: `src/profile/openai/types.ts`
- Create: `src/profile/openai/client.ts`
- Create: `src/profile/openai/fake-client.ts`
- Create: `src/profile/openai/retry.ts`
- Create: `src/profile/openai/prompt.ts`
- Create: `tests/profile/openai/retry.test.ts`
- Create: `tests/profile/openai/client.test.ts`
- Create: `tests/profile/openai/fake-client.test.ts`

**Interfaces:**

```ts
// src/profile/openai/types.ts
export interface OpenAIExtractionRequest {
  readonly promptVersion: string;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly sources: readonly {
    readonly sourceId: string;          // 'source_<int>' per SPEC §32
    readonly originalFilename: string;
    readonly extractedText: string;
  }[];
  readonly responseSchemaName: string;  // 'professional_profile_extraction_v1'
  readonly structuredOutputSchemaVersion: number;
}

export interface OpenAIExtractionRawResponse {
  readonly rawJsonText: string;
  readonly tokenUsage: { readonly promptTokens: number; readonly completionTokens: number } | null;
}

export interface OpenAIClient {
  extract(request: OpenAIExtractionRequest): Promise<OpenAIExtractionRawResponse>;
}

// src/profile/openai/client.ts
export function createDefaultOpenAIClient(options: {
  readonly apiKey: string;
  readonly timeoutMs?: number;          // default 60_000
}): OpenAIClient;

// src/profile/openai/fake-client.ts
export interface FakeOpenAIClientScript {
  // Either provide a `responses` array (queued in order) or an `error` to throw.
  readonly responses?: readonly OpenAIExtractionRawResponse[];
  readonly error?: Error;
  // Optional delay (ms) before each response resolves.
  readonly delayMs?: number;
}
export class FakeOpenAIClient implements OpenAIClient {
  readonly requests: readonly OpenAIExtractionRequest[];
  constructor(script: FakeOpenAIClientScript | readonly FakeOpenAIClientScript[]);
  extract(request: OpenAIExtractionRequest): Promise<OpenAIExtractionRawResponse>;
  getRequestCount(): number;
}

// src/profile/openai/retry.ts
export interface RetryOptions {
  readonly maxAttempts: number;          // default 3
  readonly baseDelayMs: number;          // default 500
  readonly maxDelayMs: number;           // default 8_000
  readonly jitter: 'full' | 'equal' | 'none'; // default 'full'
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}
export interface AttemptRecord {
  readonly attemptNumber: number;
  readonly succeeded: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryAfterMs: number | null;
}
export async function runWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<{ readonly value: T; readonly attempts: readonly AttemptRecord[] }>;
```

**Behavior rules (SPEC §25.3):**

- A maximum of **3 total attempts**.
- Retryable failures: `OpenAITransientError` (any subclass) and `OpenAIInvalidOutputError` **only on the first corrective retry**.
- Non-retryable failures abort immediately.
- Backoff is exponential with **full jitter** by default: `delay = random(0, min(maxDelay, base * 2^(attempt-1)))`.
- Server-provided `retryAfterMs` overrides the computed delay when present and is honored once.
- The corrective-retry counter is reset by `OpenAIInvalidOutputError` only: a second invalid output aborts.
- `sleep` and `now` are injectable for deterministic tests.

**`createDefaultOpenAIClient`:**

- Constructs an `OpenAI` instance from `openai` package with `apiKey` and `timeout`.
- `extract` calls `client.chat.completions.create({ …, response_format: { type: 'json_schema', json_schema: { name: responseSchemaName, schema: STRUCTURED_OUTPUT_SCHEMA } } })`.
- Returns `{ rawJsonText, tokenUsage }`.
- Translates SDK errors into the typed `ProfileExtractionError` subclasses:
  - `401` / `AuthenticationError` → `OpenAIAuthenticationError`.
  - `403` / `PermissionDeniedError` → `OpenAIPermissionError`.
  - `429` / `RateLimitError` → `OpenAIRateLimitError(retryAfterMs)`.
  - `400 invalid_request` → `OpenAIInvalidRequestError`.
  - `400 unsupported_model` / `404 model_not_found` → `OpenAIUnsupportedModelError`.
  - `402 / quota` → `OpenAIBillingError`.
  - `408 / 5xx` → `OpenAITimeoutError` / `OpenAIServerError`.
  - Network/transport failures → `OpenAINetworkError`.
- Re-throws existing `ProfileExtractionError` subclasses unchanged.

**`prompt.ts`:**

- Exports `PROFILE_EXTRACTION_PROMPT_VERSION = 'profile-extraction-prompt@v1'`.
- Exports `buildProfileExtractionPrompt(request: OpenAIExtractionRequest): { systemMessage: string; userMessage: string; }`.
- The system message instructs the model to return JSON matching the `ExtractedProfileSchema`, to use `null` for missing scalars and empty arrays for missing collections, to never invent facts, and to attach source references using the provided `sourceId` values.
- The user message includes the JSON-encoded source manifest and each source's normalized text prefixed by `--- sourceId: source_<int> () ---`.
- `STRUCTURED_OUTPUT_SCHEMA` is the JSON-Schema projection of `ExtractedProfileSchema` (built once at module load via `z.toJSONSchema(ExtractedProfileSchema)` if available, or hand-written if not). **Strict-mode conversion:** OpenAI's structured-output `strict: true` mode requires every property to be `required`. `ExtractedSkill.category` and `ExtractedLanguage.level` are `.nullable().optional()` in the Zod schema (post-processor substitutes `'other'` for `category` and `null` for `level` when the model emits either omission or explicit `null`), so the JSON-Schema projection must convert these to required-with-nullable-type and append `null` to the enum before being sent to OpenAI. This conversion happens at the request boundary inside `buildProfileExtractionPrompt` (or a sibling helper) — not by mutating the Zod schema.

**Steps:**

- [ ] **Step 5.1: Write `src/profile/openai/types.ts`** with the request/response types above.

- [ ] **Step 5.2: Write `tests/profile/openai/fake-client.test.ts`** (4 tests)
  - Queued responses resolve in order.
  - `script.error` rejects the call.
  - All `extract` calls are recorded in `.requests`.
  - After all queued responses are consumed, subsequent calls resolve with the last queued response.

- [ ] **Step 5.3: Implement `src/profile/openai/fake-client.ts`** with the script queue.

- [ ] **Step 5.4: Write `tests/profile/openai/retry.test.ts`** (12 tests)
  - Succeeds on first attempt → 1 attempt record, `succeeded: true`.
  - Succeeds on second attempt after a retryable error → 2 attempt records.
  - Succeeds on third attempt → 3 attempt records.
  - Throws after the third attempt on a persistent retryable error.
  - Aborts immediately on a non-retryable error (no retry).
  - Invalid-output retry: succeeds on the first corrective retry, fails on the second (per SPEC §25.3).
  - Honors `retryAfterMs` exactly once (assert `sleep` called with the injected value).
  - Full jitter: `delay ≤ min(maxDelay, base * 2^(attempt-1))` for each attempt.
  - Default `maxAttempts === 3`.
  - Default `baseDelayMs === 500`.
  - Default `maxDelayMs === 8_000`.
  - Deterministic test mode: `jitter: 'none'` produces `base * 2^(attempt-1)` exactly.

- [ ] **Step 5.5: Implement `src/profile/openai/retry.ts`** with `runWithRetry`. Use `crypto.randomInt` for jitter so the implementation is testable with a fixed `now` and a custom `sleep`.

- [ ] **Step 5.6: Write `src/profile/openai/prompt.ts`** with the versioned prompt builder. The system message should be ~250 tokens and the user message template should clearly delimit each source.

- [ ] **Step 5.7: Implement `src/profile/openai/client.ts`** with `createDefaultOpenAIClient`. The implementation imports `openai` and maps SDK errors to the typed errors above. The translation table is unit-tested by mocking the `openai` SDK (not by hitting the network).

- [ ] **Step 5.8: Write `tests/profile/openai/client.test.ts`** (8 tests, all with a mocked SDK)
  - 401 → `OpenAIAuthenticationError`.
  - 403 → `OpenAIPermissionError`.
  - 429 with `Retry-After: 2` → `OpenAIRateLimitError` with `retryAfterMs === 2000`.
  - 400 `invalid_request_error` → `OpenAIInvalidRequestError`.
  - 404 `model_not_found` → `OpenAIUnsupportedModelError`.
  - 402 → `OpenAIBillingError`.
  - 500 → `OpenAIServerError`.
  - Transport failure → `OpenAINetworkError`.

- [ ] **Step 5.9: Run tests**

  Run: `pnpm test -- tests/profile/openai/retry.test.ts tests/profile/openai/client.test.ts tests/profile/openai/fake-client.test.ts`
  Expected: 24 pass

---

### Task 6: Post-processor (turns `ExtractedProfile` into a `ProfessionalProfile`)

**Files:**
- Create: `src/profile/post-process.ts`
- Create: `tests/profile/post-process.test.ts`

**Interfaces:**

```ts
// src/profile/post-process.ts
export interface PostProcessInputs {
  readonly extracted: ExtractedProfile;
  readonly knownSourceIds: readonly string[]; // 'source_<int>' values from the request
  readonly now: () => Date;
}

export interface PostProcessResult {
  readonly profile: ProfessionalProfile;
  readonly conflicts: readonly DetectedConflict[];
  readonly warnings: readonly string[];
}

export function postProcessExtractionResponse(inputs: PostProcessInputs): PostProcessResult;
```

**Behavior rules (SPEC §14.3):**

1. For each `WorkExperience`:
   - Generate `id` as `exp_<8-hex>` using `crypto.randomBytes(4).toString('hex')`.
   - Validate `startDate` / `endDate` via `isValidYearMonth`; on failure, set both to `null` and add a warning.
   - Validate `endDate >= startDate`; on failure, set `endDate = null` and add a warning.
   - Set `isCurrent = endDate === null && startDate !== null` only when the extractor indicated `isCurrent: true`; otherwise preserve the extractor's value.
   - Recompute `summary`, `responsibilities`, `achievements`, `technologies`, `domains` (drop empty strings).
2. For each `Skill`:
   - Apply `normalizeSkillName(name)` → `{ name, normalizedName }`.
   - Set `id` deterministically: `skill_<8-hex>` based on `normalizedName`.
   - Default `category` to `'other'` when the extractor omits it.
   - Deduplicate by `normalizedName`: keep the first occurrence, merge `evidence` arrays (combine `sourceReferences`).
3. For each `Language`:
   - Apply `normalizeLanguageName(name)`.
   - Default `level` to `null` when missing.
   - Deduplicate by `normalizedName`.
4. For `Education`, `Certification`, `Project`: validate dates, assign `id`s, drop empty fields.
5. Build `derived`:
   - `likelySeniority`: heuristic that returns `'mid'` for `totalYearsOfExperience >= 3 && < 6`, `'senior'` for `>= 6 && < 10`, `'staff'` for `>= 10`. `null` otherwise. (`overrideActive: false`, `generatedValue`, `effectiveValue = generatedValue`, `generatedAt = now().toISOString()`, `overriddenAt = null`.)
   - `primaryRoles`: derived from the most recent experience titles (top 3 unique). Same shape.
   - `primaryDomains`: derived from the union of `domains` across experiences (top 5 unique).
   - `strongestSkills`: top 5 skills by frequency across `experience[].technologies` and `projects[].technologies`.
6. Call `detectProfileConflicts(extracted, knownSourceIds)` to populate `conflicts`.
7. Compute `contentHash = calculateProfileContentHash(profile)`.
8. The `warnings` array is the union of: extractor's `warnings`, the post-processor's validation warnings, plus `profile_extraction_source_unusable` when any source had `textExtractionStatus !== 'success'` (handled at the service layer; the post-processor returns `[]` for warnings that come from the response itself).
9. Return `{ profile, conflicts, warnings }`.

**Steps:**

- [ ] **Step 6.1: Write `tests/profile/post-process.test.ts`** (10 tests)
  - Complete extracted profile → profile with `id`, `normalizedName`, `derived` populated; `contentHash` is a 64-char hex.
  - Skill with `category: 'other'` (omitted) → defaults to `'other'`.
  - Duplicate skill `Node.js` + `NodeJS` → one entry with merged `evidence`.
  - Invalid `endDate < startDate` → warning, `endDate = null`.
  - Invalid `startDate: '1990-13'` → warning, `startDate = null`.
  - Two-source conflict → conflict row present, `provisionalValue` is `valueSourceA`.
  - Empty `warnings` array from extractor → no spurious warnings.
  - `derived.likelySeniority.generatedValue === 'senior'` when `totalYearsOfExperience === 7`.
  - `derived.primaryRoles` is a non-empty array of unique titles from the most recent experience.
  - `id` fields are unique within the profile (no collisions across entities).

- [ ] **Step 6.2: Implement `src/profile/post-process.ts`** per the rules above. Use `node:crypto.randomBytes` for ID generation; pass through the injected `now()` for timestamps.

- [ ] **Step 6.3: Run tests**

  Run: `pnpm test -- tests/profile/post-process.test.ts`
  Expected: 10 pass

---

### Task 7: `ProfileExtractionService` orchestrator

**Files:**
- Create: `src/profile/extraction-service.ts`
- Create: `tests/profile/extraction-service.test.ts`

**Interfaces:**

```ts
// src/profile/extraction-service.ts
export interface ProfileExtractionLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}
export const noopProfileExtractionLogger: ProfileExtractionLogger;

export interface ProfileExtractionSourceInput {
  readonly internalId: number;             // primary key
  readonly sourceId: string;               // 'source_<int>'
  readonly extractedText: string;          // stored text (the normalized version, per TASK-007)
  readonly originalFilename: string;
  readonly textExtractionStatus: 'pending' | 'success' | 'failed';
}

export interface ProfileExtractionConfig {
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
}

export type ProfileExtractionStatus =
  | { readonly kind: 'reused'; readonly profileVersionId: number; readonly contentHash: string }
  | { readonly kind: 'created'; readonly profileVersionId: number; readonly contentHash: string; readonly conflicts: readonly number; readonly warnings: readonly string[] }
  | { readonly kind: 'failed'; readonly errorCode: string; readonly message: string };

export interface ProfileExtractionServiceOptions {
  readonly repositories: Repositories;
  readonly openaiClient: OpenAIClient;
  readonly config: ProfileExtractionConfig;
  readonly retry?: Partial<RetryOptions>;
  readonly now?: () => Date;
  readonly logger?: ProfileExtractionLogger;
}

export class ProfileExtractionService {
  constructor(options: ProfileExtractionServiceOptions);
  async extract(sourceIds: readonly number[]): Promise<ProfileExtractionStatus>;
}
```

**Behavior rules (SPEC §13.2, §14.5, §15.1, §15.2, §25.3, §25.4, §40):**

1. Load `ProfileSourceRow` for every `sourceIds[i]` via `repositories.profileSources.findById`. If any row is missing, abort with `ProfileExtractionSourceUnusableError`.
2. If any source has `textExtractionStatus !== 'success'`, abort with `ProfileExtractionSourceUnusableError` before any OpenAI call.
3. Compute `extractionFingerprint` from `{ sourceHashes: rows.map(r => r.sha256).sort(), schemaVersion, promptVersion, model, reasoningEffort, structuredOutputSchemaVersion, extractorImplementationVersion }`.
4. Look up an existing `profile_versions` row by fingerprint via `repositories.profileVersions.findByExtractionFingerprint`.
   - If a row exists with `status: 'draft'`, return `{ kind: 'reused', profileVersionId, contentHash }` **without** calling OpenAI.
   - If a row exists with any other status, fall through to OpenAI (a new draft is created; history is preserved per SPEC §40).
5. Build the `OpenAIExtractionRequest` from the loaded sources (use `source.sourceId` strings, `originalFilename`, `extractedText`).
6. Call `runWithRetry(() => openaiClient.extract(request), retry)`. On final failure, persist a single `openai_request_metadata` row with `success: false` and the typed error code/message, then return `{ kind: 'failed', errorCode, message }`.
7. Parse `rawJsonText` with `JSON.parse`, then `ExtractedProfileSchema.safeParse`. On failure, raise `OpenAIInvalidOutputError(correctiveAttemptUsed: true)`. The retry loop translates this into a corrective retry if the attempt budget allows.
8. Call `postProcessExtractionResponse({ extracted, knownSourceIds: source.sourceId, now })`.
9. In a single transaction:
   - Insert the `profile_versions` row (`status: 'draft'`, `active: false`).
   - Insert each `profile_conflicts` row (using `repositories.profileVersions.insertConflict`).
   - Insert each `profile_warnings` row.
   - Insert the `openai_request_metadata` row with `success: true`, `relatedEntityType: 'profile_version'`, `relatedEntityId: profileVersionId`, `validatedOutput: extracted` (parsed Zod shape, not raw).
10. Return `{ kind: 'created', profileVersionId, contentHash, conflicts: N, warnings: [...] }`.
11. The `active` approved profile is **never** mutated by this service — approval is TASK-009.

**Steps:**

- [ ] **Step 7.1: Write `tests/profile/extraction-service.test.ts`** (12 tests)
  - Two successful sources → `created` with the right `sourceIds`.
  - One source with `textExtractionStatus: 'failed'` → `failed` with `errorCode: 'profile_extraction_source_unusable'`, no OpenAI call.
  - Fingerprint reuse: pre-seed a draft row with the matching fingerprint → `reused`, no OpenAI call.
  - Fingerprint reuse but the existing row is `rejected` → falls through, `created` (history preserved).
  - OpenAI returns invalid JSON → corrective retry succeeds → `created`.
  - OpenAI returns invalid JSON twice → `failed` with `errorCode: 'openai_invalid_output'`.
  - OpenAI returns 429 then 200 → `created`, 2 attempts.
  - OpenAI returns 500 three times → `failed` with `errorCode: 'openai_server_error'`, `attemptCount === 3` in metadata.
  - Non-retryable 401 → `failed` immediately with `attemptCount === 1`.
  - Two-source complementary facts → profile merges skills; one conflict row inserted for a conflicting `endDate`.
  - `openai_request_metadata` row exists with `success: true`, `relatedEntityType: 'profile_version'`.
  - `active` approved profile is **not** touched: `repositories.profileVersions.findActiveApproved()` still returns the same row it had before the call.

- [ ] **Step 7.2: Implement `src/profile/extraction-service.ts`** per the rules above. Use `repositories.transact(...)` for the persistence block.

- [ ] **Step 7.3: Run tests**

  Run: `pnpm test -- tests/profile/extraction-service.test.ts`
  Expected: 12 pass

---

### Task 8: CLI wiring for `profile extract`

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli/profile-extract.test.ts`

**`src/cli.ts` changes:**

- Register a new subcommand `profile extract`:
  - `--json` flag (default `false`).
  - No positional arguments. The extraction service operates on the **imported sources** stored in the database. The user is expected to have run `profile import` first.
  - If no imported sources exist, fail with a typed error (`profile_extraction_no_sources`).
- `profileExtractCommand(options)`:
  1. Resolve platform paths and initialize the database.
  2. Load the configuration via `loadConfig` and read `config.openai.profileExtraction`.
  3. Read `OPENAI_API_KEY` from the environment (do **not** persist it).
  4. Construct `createDefaultOpenAIClient({ apiKey })`.
  5. Build `ProfileExtractionService` and call `extract(sourceIds)`.
  6. Print a human-readable summary:
     ```
     status: created
     profile_version_id: 42
     profile_id: profile_42
     content_hash: <64-char hex>
     conflicts: 1
     warnings: 2
     ```
     or
     ```
     status: reused
     profile_version_id: 42
     profile_id: profile_42
     content_hash: <64-char hex>
     ```
     or
     ```
     status: failed
     error_code: openai_invalid_output
     message: OpenAI returned output that failed Zod validation.
     ```
  7. When `--json` is supplied, emit a single JSON document with the same shape plus `schemaVersion: 1`.

**Steps:**

- [ ] **Step 8.1: Write `tests/cli/profile-extract.test.ts`** (8 tests)
  - No sources imported → exit 2, `error_code: profile_extraction_no_sources`.
  - Successful creation with a `FakeOpenAIClient` injected via a hidden `--inject-client` test hook → exit 0, summary printed.
  - Successful reuse → exit 0, summary shows `status: reused`.
  - JSON output → exit 0, single JSON document with `schemaVersion: 1`.
  - OpenAI 401 (via fake) → exit 5, `error_code: openai_authentication`.
  - Missing `OPENAI_API_KEY` (env not set) → exit 2, `error_code: openai_api_key_missing`.
  - `--json` + reuse → JSON document with `status: 'reused'`.
  - Approved profile untouched after extraction.

- [ ] **Step 8.2: Implement the new subcommand in `src/cli.ts`**. Inject the `OpenAIClient` via an optional `__testOpenAIClient` parameter on `createProgram` (the existing pattern for Inquirer prompts); the production code calls `createDefaultOpenAIClient` and tests pass a `FakeOpenAIClient`.

- [ ] **Step 8.3: Run all CLI tests**

  Run: `pnpm test -- tests/cli/`
  Expected: all pass (existing `profile-import.test.ts` and the new `profile-extract.test.ts`)

---

### Task 9: Public exports + documentation alignment

**Files:**
- Modify: `src/profile/index.ts`
- Modify: `src/profile/openai/index.ts`
- Modify: `src/cli.ts` (re-exports)

**Steps:**

- [ ] **Step 9.1: Write `src/profile/openai/index.ts`** re-exporting:
  - All error classes from `errors.ts`.
  - `OpenAIClient`, `OpenAIExtractionRequest`, `OpenAIExtractionRawResponse` from `types.ts`.
  - `createDefaultOpenAIClient` from `client.ts`.
  - `FakeOpenAIClient` from `fake-client.ts`.
  - `runWithRetry`, `RetryOptions`, `AttemptRecord` from `retry.ts`.
  - `buildProfileExtractionPrompt`, `PROFILE_EXTRACTION_PROMPT_VERSION` from `prompt.ts`.
  - `calculateExtractionFingerprint`, `EXTRACTOR_IMPLEMENTATION_VERSION` from `fingerprint.ts`.
  - `ExtractedProfile`, `STRUCTURED_OUTPUT_SCHEMA_VERSION`, all `Extracted*` schemas from `structured-output.ts`.

- [ ] **Step 9.2: Extend `src/profile/index.ts`** with:
  - `ProfessionalProfile`, all related types, and `ProfessionalProfileSchema` from `schema.ts`.
  - `PROFILE_SCHEMA_VERSION`.
  - `normalizeSkillName`, `normalizeLanguageName` from `name-normalize.ts`.
  - `parseYearMonth`, `isValidYearMonth`, `calculateDurationMonths` from `dates.ts`.
  - `detectProfileConflicts`, `DetectedConflict` from `conflicts.ts`.
  - `calculateProfileContentHash` from `content-hash.ts`.
  - `postProcessExtractionResponse`, `PostProcessInputs`, `PostProcessResult` from `post-process.ts`.
  - `ProfileExtractionService`, all related types and the `noopProfileExtractionLogger` from `extraction-service.ts`.

- [ ] **Step 9.3: Extend `src/cli.ts` re-exports** at the bottom of the file with the new types so external test files (and `tests/foundation.test.ts` if needed) can reach them.

- [ ] **Step 9.4: Update `tests/foundation.test.ts`** only if the new subcommand changes the top-level command list. `profile extract` lives under the existing `profile` group, so no change is required.

- [ ] **Step 9.5: Run typecheck and full suite**

  Run: `pnpm typecheck`
  Expected: exit 0

  Run: `pnpm test`
  Expected: 100% pass (existing + new tests)

---

### Task 10: Run full verification suite

**Steps:**

- [ ] **Step 10.1: `pnpm lint`**
  Expected: exit 0

- [ ] **Step 10.2: `pnpm typecheck`**
  Expected: exit 0

- [ ] **Step 10.3: `pnpm build`**
  Expected: exit 0, `dist/cli.js` produced

- [ ] **Step 10.4: `pnpm test`**
  Expected: all tests pass (existing + ~110 new tests across 13 files)

- [ ] **Step 10.5: Manual CLI smoke checks** (each command run from a clean temporary `HOME`)

  ```bash
  HOME=/tmp/jh-final-$$ node dist/cli.js profile extract
  # expected (no sources imported): exit 2, error_code: profile_extraction_no_sources

  HOME=/tmp/jh-final-$$ node dist/cli.js profile import <valid.md>  # from TASK-007
  HOME=/tmp/jh-final-$$ OPENAI_API_KEY=sk-fake node dist/cli.js profile extract
  # expected (with stub API key, fake client wired via env hook in tests):
  #   exit 0, summary printed with status: created

  HOME=/tmp/jh-final-$$ OPENAI_API_KEY=sk-fake node dist/cli.js profile extract --json
  # expected: exit 0, single JSON document with schemaVersion: 1

  HOME=/tmp/jh-final-$$ OPENAI_API_KEY=sk-fake node dist/cli.js profile extract
  # expected (re-run): exit 0, summary with status: reused, content_hash unchanged

  HOME=/tmp/jh-final-$$ node dist/cli.js profile extract
  # expected (missing API key): exit 2, error_code: openai_api_key_missing
  ```

  All live-API smoke checks require a real `OPENAI_API_KEY` and are **excluded** from normal CI per SPEC §40.

---

## Test inventory (≈110 new tests across 13 files for TASK-008)

- `tests/profile/openai/errors.test.ts` — 8 tests (code, exit code, retryable set, corrective flag)
- `tests/profile/schema.test.ts` — 10 tests (canonical schema + enums)
- `tests/profile/openai/structured-output.test.ts` — 8 tests (extracted schema + strictness)
- `tests/profile/name-normalize.test.ts` — 8 tests (SPEC §12.2 examples + alias map)
- `tests/profile/dates.test.ts` — 10 tests (YearMonth + durations)
- `tests/profile/conflicts.test.ts` — 6 tests (one-source vs two-source + overlap)
- `tests/profile/content-hash.test.ts` — 4 tests (deterministic + sorted-keys)
- `tests/profile/openai/fingerprint.test.ts` — 6 tests (sorted sources + version sensitivity)
- `tests/profile/openai/retry.test.ts` — 12 tests (SPEC §25.3 + jitter + corrective retry)
- `tests/profile/openai/client.test.ts` — 8 tests (SDK error mapping with mock)
- `tests/profile/openai/fake-client.test.ts` — 4 tests (queue + recording)
- `tests/profile/post-process.test.ts` — 10 tests (ids, dedup, warnings, derived)
- `tests/profile/extraction-service.test.ts` — 12 tests (full orchestration with FakeOpenAIClient)
- `tests/cli/profile-extract.test.ts` — 8 tests (CLI smoke including `--json` and missing key)

Total: ≈114 new tests. Plus any minimal extension to existing CLI tests if the new subcommand needs help text changes.

## Notes for the implementer

- The official `openai` SDK is imported **only** in `src/profile/openai/client.ts`. Every other file in `src/profile/` and every test file interacts with `OpenAIClient` as an interface; do not leak the SDK import through barrel re-exports.
- `FakeOpenAIClient` is the test seam. Every extraction-service test passes a `FakeOpenAIClient` with a queued response or error. The retry tests use `runWithRetry` directly with an inline operation function.
- `ProfileExtractionService.extract` is a single async call. The orchestrator handles its own transaction; callers do not need to wrap it.
- The `active` approved profile is **never** mutated by this service. Approval is TASK-009. The post-review audit of TASK-007 explicitly tracks this invariant.
- `OPENAI_API_KEY` is read from `process.env` at the CLI boundary. It is never logged, never persisted, and never passed through a typed repository. The redact list in `src/logging/logger.ts` already covers `OPENAI_API_KEY` and `openai.key`.
- `STRUCTURED_OUTPUT_SCHEMA_VERSION` and `PROFILE_EXTRACTION_PROMPT_VERSION` are exported. Any change to either is a deliberate version bump; the tests assert the current value so a future bump requires updating both the constant and the tests.
- `EXTRACTOR_IMPLEMENTATION_VERSION` defaults to `'1.0.0'`. Bump it on any change to the post-processor or extraction service that could change the output for the same input.
- `ProfessionalProfile.id` is generated by the post-processor as `profile_<8-hex>`. This is a different ID space from `profile_versions.id` (which is the integer primary key). The CLI surfaces both (`profile_version_id` and `profile_id`).
- `textExtractionStatus !== 'success'` triggers an immediate abort with `profile_extraction_source_unusable`. This matches SPEC §13.5 and §40.
