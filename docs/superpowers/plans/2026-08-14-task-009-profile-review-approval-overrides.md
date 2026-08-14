# TASK-009 Implementation Plan — Profile Review, Editing, Conflicts, Approval, Versioning, and Overrides

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the explicit, human-controlled profile review/edit/approve/reject lifecycle on top of the draft `ProfessionalProfile` rows TASK-008 already persists — turning one approved draft into the single active approved profile, with conflict resolution, derived-value overrides, audit-trail revisions, and dependent-result invalidation, while preserving every historical version.

**Architecture:** Five pure-domain helpers live under `src/profile/review/`: a review-summary renderer (SPEC §16.2), conflict-resolution helpers (SPEC §15.2–§15.3), override-application helpers (SPEC §16.7), and an editor state machine plus a prompts adapter. Three application services compose those helpers: `ProfileReviewService` (read-side list/show), `ProfileEditingService` (edit a draft or derive a new draft from an approved profile), and `ProfileApprovalService` (approve with invalidation) + `ProfileRejectionService` (reject). All four services are reachable through thin CLI subcommands (`profile list`, `profile show`, `profile edit`, `profile approve`, `profile reject`) that reuse the same `@inquirer/prompts`-style adapter the search-config workflow already uses (a fake-prompt adapter exists for tests). `profileVersions.approve` (TASK-004) already does the active-row swap inside one transaction; TASK-009 wraps it with the SPEC §16.3 step-9 dependent-result invalidation in the same transaction. A new `invalidateByProfileVersion` method on `FilterResultRepository` flips `active = false` for rows tied to the prior approved profile.

**Tech Stack:** No new dependencies. Reuses `@inquirer/prompts`, `zod`, `drizzle-orm@0.45.2`, `better-sqlite3@13.0.3`, Node.js `24.18.0`, pnpm `11.18.0`, the `Repositories` facade, and the existing `ProfileVersionRepository` / `ProfileExtractionService` from TASK-004 / TASK-008. No new database tables or migrations are required — TASK-003 already created `profile_versions`, `profile_revisions`, `profile_conflicts`, `profile_warnings`, and `derived_overrides` with the indices TASK-009 needs.

## Open decisions confirmed before implementation

These map to SPEC §44 items and to the four UX questions resolved with the user on 2026-08-14.

| # | Decision | Resolution |
|---|---|---|
| 1 | CLI profile identifier form (`profile_<int>` vs `profile_<ProfessionalProfile.id>`) | **Both, PK canonical.** `profile show/edit/approve/reject` accepts either form. The integer-PK form is the authoritative lookup; the `ProfessionalProfile.id` string (from the stored JSON) is accepted as a convenience. A new `resolveProfileVersionId(repositories, raw)` helper tries the PK prefix first and falls back to a `findByExtractionFingerprint`-style scan of all drafts. |
| 2 | `--json` output scope on profile subcommands | **`list` + `show` only.** `profile list --json` emits a version table (id, status, active, contentHash, sourceIds, createdAt, updatedAt, approvedAt). `profile show --json --id=<…>` emits the full `ProfessionalProfile` plus conflicts, warnings, overrides, and revisions. `edit/approve/reject` stay human-readable (interactive or terse confirmation). |
| 3 | SPEC §16.3 step 9 invalidation scope | **Only results tied to the prior approved `profile_version_id`.** Adds `FilterResultRepository.invalidateByProfileVersion(id)` (sets `active = false` on rows whose `profileVersionId === id` AND `active = true`). `score_results` invalidation is **deferred to TASK-014** because the `score_results` table does not currently carry a `profile_version_id` column; the plan records this as a known limitation so TASK-014 can resolve it (add the FK + invalidation by profile_version_id). |
| 4 | Regenerate derived values inside the editor? | **Override management only, no regenerate.** Derived values are computed by `postProcessExtractionResponse` (TASK-008) once per draft. The editor's "Derived profile information" section supports view, set, change, and clear of overrides per SPEC §16.7; no "regenerate" action is added (re-generation requires re-running extraction, which is out of TASK-009 scope). |

The implementing agent must stop and ask the user to confirm all four resolutions before any file in `src/` is edited.

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §6):** Files under `src/profile/review/` and the new `src/profile/editing/` pure modules **must not** import Commander, Inquirer, Playwright, Drizzle, the `openai` SDK, or Pino. They may import `zod`, Node built-ins, and the existing `src/profile/*.js` siblings. Application services (`src/profile/{review,editing,approval,rejection}-service.ts`) are the only files that may import both the pure helpers and the persistence repositories.
- **Editor / Inquirer isolation:** The default `ProfileEditorPrompts` adapter lives in `src/profile/editing/prompts-inquirer.ts` and is the only module that imports `@inquirer/prompts`. The `ProfileEditorPrompts` interface in `src/profile/editing/prompts.ts` is the seam; tests inject a `FailingProfileEditorPrompts` (or scripted per-call recorder). The default CLI uses the Inquirer adapter; the CLI never invokes `@inquirer/prompts` directly.
- **Validation:** Zod at every external boundary. The stored `profileJson` is parsed through `ProfessionalProfileSchema.safeParse` at the editor / approval boundary. `profile_conflicts.valueSourceAJson` and `valueSourceBJson` are decoded against a permissive schema (`z.unknown()`) and re-encoded via `jsonColumn` (TASK-004 codec) — domain validation lives in the pure helpers, not at the repository boundary.
- **Errors:** Typed errors extending `ApplicationError`. New lifecycle error codes are added to `src/profile/errors.ts`. Approval errors map to `ExitCode.InvalidUsage` (2) for blocking conflicts, `ExitCode.UserCancellation` (130) for user-cancelled confirmations, and `ExitCode.Fatal` (1) for storage failures. CLI exits non-zero for every typed lifecycle error.
- **History preservation (AGENTS.md §6):** Approval never mutates an existing draft in place — it flips status/active flags and inserts a fresh revision row per field change. Rejection only sets `status = 'rejected', active = false`. `profile_sources` and historical `profile_versions` are never deleted.
- **Determinism:** Override application, conflict resolution, content-hash recalculation, and review-summary rendering are pure functions of their inputs. The new `applyOverrides(profile, overrides)` is referentially transparent; `resolveConflict(conflict, choice)` does not mutate; the editor state machine is a pure reducer.
- **Tests:** Vitest. Pure-domain tests are deterministic and unit-style. Editor / approval tests use a fake `ProfileEditorPrompts` recorder to drive every decision. Repository tests use temporary SQLite databases (`mkdtempSync(join(tmpdir(), 'jobhunter-...'))`). CLI smoke tests use `process.exit`/`stdout`/`stderr` capture as in TASK-008. No live network, no live LinkedIn, no live OpenAI.
- **JSON output discipline (AGENTS.md §10):** When `--json` is set the command writes exactly one valid JSON document to stdout and nothing else; logs and human-readable errors go to stderr.
- **No secrets:** Repositories and services must not log API keys, raw prompts, raw model responses, or any user-typed conflict-resolution value beyond the field path and resolution type.

## File Structure

```
src/profile/
  errors.ts                             # MODIFIED: add ProfileLifecycleError family
  review/                               # NEW pure helpers (Task 2)
    review-summary.ts                   # renderReviewSummary + formatter
    conflict-resolution.ts              # applyConflictResolution + preserved-claims logic
    override-application.ts             # applyOverrides + recomputeEffectiveValue
    index.ts                            # public re-exports
  editing/                              # NEW pure state machine + prompts (Task 4-6)
    prompts.ts                          # ProfileEditorPrompts interface + FailingProfileEditorPrompts
    prompts-inquirer.ts                 # default @inquirer/prompts adapter
    state-machine.ts                    # pure reducer: edit operations → DraftState
    validation.ts                       # field-level validation for scalar/collection edits
    index.ts                            # public re-exports
  identifier-resolution.ts              # NEW: resolveProfileVersionId (dual-form) (Task 1)
  review-service.ts                     # NEW: ProfileReviewService (list/show) (Task 7)
  editing-service.ts                    # NEW: ProfileEditingService (edit flow + save) (Task 8)
  approval-service.ts                   # NEW: ProfileApprovalService (approve + invalidate) (Task 9)
  rejection-service.ts                  # NEW: ProfileRejectionService (reject) (Task 10)
  index.ts                              # MODIFIED: re-export new public surface (Task 12)
src/persistence/repositories/
  filter-results.ts                     # MODIFIED: add invalidateByProfileVersion (Task 3)
src/cli.ts                              # MODIFIED: profile list/show/edit/approve/reject (Task 11)
tests/profile/
  review/
    review-summary.test.ts              # (Task 2)
    conflict-resolution.test.ts         # (Task 2)
    override-application.test.ts        # (Task 2)
  editing/
    state-machine.test.ts               # (Task 4)
    validation.test.ts                  # (Task 5)
  identifier-resolution.test.ts         # (Task 1)
  review-service.test.ts                # (Task 7)
  editing-service.test.ts               # (Task 8)
  approval-service.test.ts              # (Task 9)
  rejection-service.test.ts             # (Task 10)
tests/persistence/repositories/
  filter-results.test.ts                # MODIFIED: add invalidateByProfileVersion test (Task 3)
tests/cli/
  profile-list.test.ts                  # (Task 11)
  profile-show.test.ts                  # (Task 11)
  profile-edit.test.ts                  # (Task 11)
  profile-approve.test.ts               # (Task 11)
  profile-reject.test.ts                # (Task 11)
```

Files change together by responsibility. The pure helpers (`review/*.ts`, `editing/{state-machine,validation}.ts`, `identifier-resolution.ts`) have no Drizzle, no Commander, no Inquirer imports. Application services are the only layer that touches both the helpers and the `Repositories` facade. The CLI layer is a thin shell that resolves identifiers, opens the database, calls the services, and renders output.

---

### Task 1: Profile identifier resolution helper (dual-form)

**Files:**
- Create: `src/profile/identifier-resolution.ts`
- Create: `tests/profile/identifier-resolution.test.ts`

**Goal:** One helper, `resolveProfileVersionId(repositories, raw)`, that accepts either form (`profile_<int>` or `profile_<ProfessionalProfile.id>`) and returns the integer PK, or throws a typed `InvalidProfileIdentifierError`.

**Behavior:**
- If `raw` matches the `profile_` prefix and a positive integer: parse the integer with the existing `parsePrefixedId(raw, 'profile')` from `src/persistence/identifiers.js`. If a `profile_versions` row exists with that PK, return its id.
- Otherwise: scan all `profile_versions` rows (cheap in MVP — there will be at most a handful), find the one whose `profileJson.id` (decoded as `unknown`) is a string equal to `raw`, return its PK. Reject if multiple rows share the same `ProfessionalProfile.id` (this should never happen — `ProfessionalProfile.id` is intended to be unique within a user, but the schema does not enforce it; the helper must guard).
- Otherwise: throw `InvalidProfileIdentifierError(code: 'profile_not_found', exitCode: 2)` carrying both the attempted raw input and the resolved-or-null PK.

**Interfaces:**

```ts
// src/profile/identifier-resolution.ts
import type { Repositories } from '../persistence/repositories/index.js';

export class InvalidProfileIdentifierError extends ApplicationError {
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(code, message, ExitCode.InvalidUsage, metadata ?? {});
  }
}

export async function resolveProfileVersionId(
  repositories: Repositories,
  raw: string,
): Promise<number>;
```

**Tests:**
- Resolve valid PK form (`profile_7`) returns 7.
- Resolve valid JSON-id form returns the PK whose JSON id matches.
- Mixed form: `profile_X` where `X` happens to be both a PK and a JSON id resolves to the PK (deterministic precedence).
- Unknown PK form throws `InvalidProfileIdentifierError` with code `profile_not_found`.
- Unknown JSON-id form throws the same error.
- Multiple rows sharing the same JSON id throw `InvalidProfileIdentifierError` with code `profile_id_collision`.
- Empty/whitespace input throws with code `invalid_identifier`.

**Verification:**
- `pnpm test tests/profile/identifier-resolution.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 2: Pure review-summary, conflict-resolution, and override-application helpers

**Files:**
- Create: `src/profile/review/review-summary.ts`
- Create: `src/profile/review/conflict-resolution.ts`
- Create: `src/profile/review/override-application.ts`
- Create: `src/profile/review/index.ts`
- Create: `tests/profile/review/review-summary.test.ts`
- Create: `tests/profile/review/conflict-resolution.test.ts`
- Create: `tests/profile/review/override-application.test.ts`

**Goal:** Three small, pure modules the application services compose. No Drizzle, no Commander, no Inquirer.

#### 2a. `review-summary.ts`

Renders a `ProfessionalProfile` plus its warnings/conflicts/overrides into a human-readable text block suitable for the `profile show` default output (and for the editor's "Review changes" entry). The function is pure: it takes a profile, an array of `ProfileWarningRow`, an array of `ProfileConflictRow`, and an array of `DerivedOverrideRow`, and returns a string. The `JSON.stringify` of the same inputs is used by `profile show --json`.

Exports:
```ts
export interface ReviewSummaryInputs {
  readonly profile: ProfessionalProfile;
  readonly warnings: readonly ProfileWarningRow[];
  readonly conflicts: readonly ProfileConflictRow[];
  readonly overrides: readonly DerivedOverrideRow[];
}
export function renderReviewSummary(inputs: ReviewSummaryInputs): string;
```

The renderer iterates every required SPEC §16.2 section: headline, summary, total years, work experience, skills, languages, education, certifications, projects, generated + effective derived values, blocking conflicts, non-blocking warnings, missing-or-unresolved fields. Sections with `null`/`[]` render as `(none)` so the review never silently drops a section.

#### 2b. `conflict-resolution.ts`

Pure helpers that apply a user's conflict decision to a `ProfessionalProfile`. SPEC §15.2 / §15.3 require the resolution to preserve original claims, the resolution timestamp, and the source/manual provenance.

Exports:
```ts
export type ConflictResolutionChoice =
  | { readonly kind: 'select_source_a'; readonly resolvedAt: string }
  | { readonly kind: 'select_source_b'; readonly resolvedAt: string }
  | { readonly kind: 'manual'; readonly value: unknown; readonly resolvedAt: string }
  | { readonly kind: 'clear'; readonly resolvedAt: string };

export function resolveConflictOnProfile(
  profile: ProfessionalProfile,
  conflict: ProfileConflictRow,
  choice: ConflictResolutionChoice,
): ProfessionalProfile;
```

The function returns a NEW profile (never mutates). It is implemented with a per-entity-type switch that walks the structured-output fields the `ProfileConflictRow.affectedField` describes (e.g., `work_experience.<company>::<title>.startDate`) and updates the corresponding scalar/collection. The original claim is recorded in a `preservedClaims` map keyed by field path so downstream renderers can show what was overridden.

#### 2c. `override-application.ts`

Pure helpers for SPEC §16.7 derived-value overrides.

Exports:
```ts
export type DerivedFieldKey =
  | 'likelySeniority'
  | 'primaryRoles'
  | 'primaryDomains'
  | 'strongestSkills';

export type OverrideState =
  | { readonly active: false }
  | { readonly active: true; readonly value: never }   // valued override (value may be `null` for intentional null)
  | { readonly active: true; readonly value: null };    // intentional null/empty override

export function applyOverrides(
  profile: ProfessionalProfile,
  overrides: readonly DerivedOverrideRow[],
): ProfessionalProfile;
```

`applyOverrides` walks the four `derived.*` fields, computes `effectiveValue` per SPEC §16.7 (`overrideActive ? overrideValue : generatedValue`), and returns a NEW profile with the effective values updated. The function preserves `generatedValue`, `overrideActive`, `overrideValue`, `generatedAt`, and `overriddenAt` exactly as stored — it only touches `effectiveValue`. This lets the editor render `generated: X | effective: Y` side-by-side.

#### Tests

- **`review-summary.test.ts`** — Asserts that every SPEC §16.2 section header appears in the rendered string for a representative profile, that warnings/conflicts are grouped under their severity headings, and that an empty/null section renders as `(none)`.
- **`conflict-resolution.test.ts`** — Round-trips a profile through every `ConflictResolutionChoice` kind and asserts (a) the profile is immutable (input object unchanged), (b) the affected field is updated correctly, (c) `preservedClaims` records the original value, (d) `effectiveValue` for derived fields is recomputed by `applyOverrides`.
- **`override-application.test.ts`** — Asserts the three override states (no override, valued, intentional null) produce the correct `effectiveValue` and that `applyOverrides` does NOT mutate the input profile or its nested derived entries.

**Verification:**
- `pnpm test tests/profile/review/` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 3: Filter-result invalidation by profile version

**Files:**
- Modify: `src/persistence/repositories/filter-results.ts`
- Modify: `tests/persistence/repositories/filter-results.test.ts`

**Goal:** A repository method that, given a `profile_version_id`, flips `active = false` on every active `filter_results` row tied to that profile. Used by `ProfileApprovalService` inside the same approval transaction so the invalidation is atomic with the active-flag swap.

**Interface:**

```ts
// inside FilterResultRepository
async invalidateByProfileVersion(profileVersionId: number): Promise<number> {
  return this.ctx.db.transaction((tx) => {
    const before = tx
      .select({ id: filterResults.id })
      .from(filterResults)
      .where(
        and(
          eq(filterResults.profileVersionId, profileVersionId),
          eq(filterResults.active, true),
        ),
      )
      .all();
    tx.update(filterResults)
      .set({ active: false })
      .where(
        and(
          eq(filterResults.profileVersionId, profileVersionId),
          eq(filterResults.active, true),
        ),
      )
      .run();
    return before.length;
  });
}
```

The method is intentionally synchronous through `better-sqlite3` (the sub-repository is `async`-shaped for consistency; the body runs sync inside the transaction wrapper). Returns the count of rows invalidated so the approval service can include it in audit output.

**Test additions:**
- Insert three active `filter_results` rows tied to `profile_version_id = 7`; assert `invalidateByProfileVersion(7)` returns 3.
- Re-run `invalidateByProfileVersion(7)`; returns 0 (idempotent).
- Insert an active row tied to `profile_version_id = 8`; assert `invalidateByProfileVersion(7)` does NOT touch it.
- A `filter_results` row with `active = false` already is left untouched.

**Verification:**
- `pnpm test tests/persistence/repositories/filter-results.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

**Known limitation called out:** `score_results` does not have a `profile_version_id` column and is therefore not invalidated by TASK-009. SPEC §16.3 step 9 mentions both filter and score invalidation; the score half is documented in the `docs/tasks/TASK-009-profile-review-approval-overrides.md` final-results section and left for TASK-014, which will add the FK column and a matching `invalidateByProfileVersion` method (the implementing agent for TASK-014 must ask for approval per AGENTS.md §12 if it adds the column).

---

### Task 4: Editor state machine (pure reducer)

**Files:**
- Create: `src/profile/editing/state-machine.ts`
- Create: `src/profile/editing/validation.ts`
- Create: `src/profile/editing/index.ts`
- Create: `tests/profile/editing/state-machine.test.ts`
- Create: `tests/profile/editing/validation.test.ts`

**Goal:** A pure reducer that turns a stream of editor operations into a new `DraftState`. The reducer is testable without any prompts and produces deterministic output for any scripted operation sequence.

**`DraftState` shape:**

```ts
export interface DraftState {
  readonly profile: ProfessionalProfile;
  readonly pendingRevisions: readonly PendingRevision[];
  readonly sectionHistory: readonly SectionKey[];   // for "Back" navigation
}

export type SectionKey =
  | 'basics'
  | 'experience'
  | 'skills'
  | 'languages'
  | 'education'
  | 'certifications'
  | 'projects'
  | 'derived'
  | 'warnings'
  | 'review'
  | 'save'
  | 'discard'
  | 'exit';

export type EditorOperation =
  | { readonly kind: 'select_section'; readonly section: SectionKey }
  | { readonly kind: 'edit_scalar'; readonly section: ScalarSection; readonly field: string; readonly value: unknown }
  | { readonly kind: 'edit_collection'; readonly section: CollectionSection; readonly operation: CollectionEditOperation }
  | { readonly kind: 'resolve_conflict'; readonly conflictId: number; readonly choice: ConflictResolutionChoice }
  | { readonly kind: 'set_override'; readonly field: DerivedFieldKey; readonly state: OverrideState; readonly now: string }
  | { readonly kind: 'clear_override'; readonly field: DerivedFieldKey }
  | { readonly kind: 'discard'; }
  | { readonly kind: 'back' };
```

`PendingRevision` carries `fieldPath`, `previousValue`, `newValue`, and `source` (`'user' | 'conflict_resolution' | 'override'`). When the editor's save step is reached, `ProfileEditingService.saveDraft` walks `pendingRevisions` and inserts one `profile_revisions` row per entry via `ProfileVersionRepository.insertRevision`.

**Collection operations** (`CollectionEditOperation`) cover SPEC §16.6's required list: `list`, `view`, `add`, `edit`, `delete` (with `confirm: true`), and `reorder` (where meaningful — experience, education, certifications, projects, languages; skills are deduped by `normalizedName`, no reorder needed).

**Validation** in `validation.ts` is a small per-section validator (basics, experience, skills, languages, education, certifications, projects, derived) that returns either `{ ok: true; value: unknown }` or `{ ok: false; issues: readonly string[] }`. Year-month strings, enums (skill category, language level, seniority), URL shapes (`credentialUrl`, project `url`), and required string fields are validated with the existing Zod schemas from `src/profile/schema.js`.

#### Tests

- **`state-machine.test.ts`** —
  - `select_section` updates `sectionHistory` and does not mutate the profile.
  - `edit_scalar` updates the targeted field, records a `PendingRevision`, and the input profile is unchanged.
  - `edit_collection` `add` appends to the collection; `edit` replaces by id; `delete` requires a confirmed operation; `reorder` swaps two entries by id.
  - `resolve_conflict` delegates to `resolveConflictOnProfile` and records a revision with source `'conflict_resolution'`.
  - `set_override` and `clear_override` produce the right `DerivedOverrideRow` shape and are reflected by `applyOverrides` on the in-memory profile.
  - `back` pops the last section from `sectionHistory` and does not mutate the profile.
  - `discard` returns the original profile (the reducer itself does not need to "drop" revisions — the editor session consumes them).
- **`validation.test.ts`** — Asserts every section's validator accepts a valid payload and rejects malformed payloads with stable, human-readable messages (e.g., "Year-month must be YYYY or YYYY-MM").

**Verification:**
- `pnpm test tests/profile/editing/` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 5: Editor prompts interface + default Inquirer adapter + fake prompts

**Files:**
- Create: `src/profile/editing/prompts.ts`
- Create: `src/profile/editing/prompts-inquirer.ts`
- Modify: `src/profile/editing/index.ts` (re-export)
- Create: `tests/profile/editing/prompts-inquirer.test.ts`

**Goal:** The seam between the state machine and the human. Mirrors the search-config `SearchPrompts` / `createFailingPrompts` pattern.

**Interface:**

```ts
export interface ProfileEditorPrompts {
  selectSection(currentSection: SectionKey | null): Promise<SectionKey>;
  editScalar(input: ScalarEditPrompt): Promise<ScalarEditResult>;
  editCollection(input: CollectionEditPrompt): Promise<CollectionEditResult>;
  resolveConflict(input: ConflictResolutionPrompt): Promise<ConflictResolutionChoice>;
  manageOverrides(input: OverridePrompt): Promise<OverridePromptResult>;
  showReview(input: ReviewPrompt): Promise<ReviewPromptResult>;
  confirmSave(input: SavePrompt): Promise<SaveConfirmation>;
  confirmDiscard(input: DiscardPrompt): Promise<DiscardConfirmation>;
}
```

`FailingProfileEditorPrompts` is exported from `prompts.ts` (same pattern as `createFailingPrompts` in search) and is what tests inject when they do not want to drive the editor. `ScriptedProfileEditorPrompts` (also in `prompts.ts`) records calls and replays a scripted response list — used by every editor/approval/rejection integration test.

The default adapter (`prompts-inquirer.ts`) is the only module that imports `@inquirer/prompts`. It renders:

- `selectSection` — a `@inquirer/select` menu whose choices map directly to the SPEC §16.6 list.
- `editScalar` — `@inquirer/input` with the current value as `default`, with validation rules from `validation.ts`. Empty input on a nullable field returns `{ kind: 'cleared' }`. A literal sentinel `(clear)` clears nullable fields explicitly (SPEC §16.6 "Allow nullable fields to be cleared explicitly").
- `editCollection` — a `@inquirer/select` sub-menu (`list | view <id> | add | edit <id> | delete <id> | reorder | back`) per SPEC §16.6. Delete prompts an `@inquirer/confirm`.
- `resolveConflict` — shows both source values + source references + provisional, then `@inquirer/select` between `use source A`, `use source B`, `enter another value` (followed by `@inquirer/input` with current provisional as default), `clear the field`.
- `manageOverrides` — for each of the four derived fields, shows `generated` vs current `effective`, and offers `set override`, `change override`, `clear override`, `keep`. The intentional-null case (override to empty/null) is supported explicitly: when the user picks "set override" on `primaryRoles`, the next prompt accepts a free-text list with a "(clear — set to empty)" sentinel.
- `showReview` — calls `renderReviewSummary` and waits for the user to press enter.
- `confirmSave` — only invoked when warnings remain or blocking conflicts were resolved inline. Confirmation text is human-readable: "Save draft, then exit editor? (yes/no)".
- `confirmDiscard` — only invoked when `pendingRevisions.length > 0`. "Discard N pending changes? (yes/no)".

**Tests:**
- `prompts-inquirer.test.ts` — Smoke tests that every prompt method exists and forwards to the right `@inquirer/prompts` API (using Vitest module-mocks for `@inquirer/prompts`). The full interactive flows are covered by the `editing-service` integration tests with the scripted adapter.
- `editing-service.test.ts` (Task 8) drives the full editor flow with the scripted adapter and asserts that the produced `DraftState` + revisions match the scripted prompt sequence.

**Verification:**
- `pnpm test tests/profile/editing/` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 6: ProfileEditingService (edit a draft or derive a new draft)

**Files:**
- Create: `src/profile/editing-service.ts`
- Create: `tests/profile/editing-service.test.ts`

**Goal:** The application service that runs the interactive edit session. Thin orchestrator over the state machine + prompts + repositories.

**Behavior:**

1. `startEdit(repositories, options)` resolves the target profile id via `resolveProfileVersionId`.
2. If the target row has `status === 'approved'`, derive a new draft row:
   - Compute `newProfileId` as a fresh UUID-ish string (reuse the existing `crypto.randomUUID()` shape — TASK-008's post-processor uses `prf_<12 hex>`; reuse that helper or extract it).
   - Insert a NEW `profile_versions` row with `status = 'draft'`, `active = false`, a fresh `contentHash`, the prior row's `profileJson` (with `id` swapped to the new value, `createdAt`/`updatedAt` refreshed).
   - Insert a `profile_revisions` row with `source = 'user'`, `fieldPath = 'derivedFrom'`, `note = `approved_${prior.id}``.
   - Return the new draft id for the editor to open.
3. If the target row is `draft`, open the editor directly on it.
4. If the target row is `rejected` or `superseded`, refuse with `InvalidProfileStateError(code: 'profile_not_editable', exitCode: 2)`.
5. Initialize `DraftState` from the row's `profileJson`, run the editor loop (selectSection → apply → repeat) until the user picks `save`, `discard`, or `exit`.
6. On `save`:
   - Persist `profileJson` update to the draft row (rewrite `profileJson`, refresh `updatedAt`, and `contentHash` via `calculateProfileContentHash`).
   - For each `pendingRevision`, call `profileVersions.insertRevision` with the right `source` and `fieldPath`.
   - For each override touched, call `profileVersions.upsertOverride`.
   - Return `{ kind: 'saved'; profileVersionId: number }`.
7. On `discard`: return `{ kind: 'discarded'; profileVersionId: number }` without persisting.
8. On `exit`: ask `confirmDiscard` if revisions are pending; behaves like save or discard accordingly.

The service does NOT call `approve` — that is `ProfileApprovalService`'s job. The service just saves the edited draft.

**Tests:**

- Editing a `draft` row updates `profileJson`, inserts `profile_revisions` rows, returns the right id.
- Editing an `approved` row creates a NEW `draft` row and returns its id without mutating the approved row's `profileJson` or `contentHash`.
- Editing a `rejected` / `superseded` row throws `InvalidProfileStateError`.
- Disposing a draft with `discard` does not insert revisions.
- Saving with no pending revisions still updates `updatedAt` + `contentHash` (idempotent save).
- `set_override` calls `upsertOverride` with the right row shape; `clear_override` sets `overrideActive = false, overrideValue = null`.
- Multiple sequential operations accumulate into one `pendingRevisions` array, written in one transaction via `repositories.transact`.

**Verification:**
- `pnpm test tests/profile/editing-service.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 7: ProfileReviewService (list + show)

**Files:**
- Create: `src/profile/review-service.ts`
- Create: `tests/profile/review-service.test.ts`

**Goal:** Read-only application service for `profile list` and `profile show`.

**API:**

```ts
export interface ProfileListEntry {
  readonly profileVersionId: number;
  readonly profileId: string;                  // from profileJson.id
  readonly status: ProfileStatus;
  readonly active: boolean;
  readonly contentHash: string;
  readonly sourceIds: readonly number[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt: string | null;
}

export interface ProfileShowPayload {
  readonly profile: ProfessionalProfile;
  readonly status: ProfileStatus;
  readonly active: boolean;
  readonly contentHash: string;
  readonly extractionFingerprint: string;
  readonly warnings: readonly ProfileWarningRow[];
  readonly conflicts: readonly ProfileConflictRow[];
  readonly overrides: readonly DerivedOverrideRow[];
  readonly revisions: readonly ProfileRevisionRow[];
}

export class ProfileReviewService {
  constructor(private readonly repositories: Repositories) {}
  async list(opts?: { status?: ProfileStatus }): Promise<readonly ProfileListEntry[]>;
  async show(rawId: string): Promise<ProfileShowPayload>;     // accepts dual-form
}
```

`list()` reads every `profile_versions` row (or filters by `status`) and projects each into `ProfileListEntry` (decoding `profileJson.id` from the stored JSON via the permissive `z.unknown()` codec). Ordering is `id DESC` (most recent first).

`show()` resolves the id via `resolveProfileVersionId`, fetches the row + its warnings/conflicts/overrides/revisions, parses `profileJson` through `ProfessionalProfileSchema.safeParse` (throws `InvalidProfilePayloadError` if the row's JSON fails Zod), and assembles `ProfileShowPayload`.

**Tests:**
- `list()` returns rows in id-DESC order with status filtering honored.
- `list({ status: 'approved' })` returns only approved rows.
- `show('profile_3')` returns the payload for PK 3.
- `show('profile_<json-id>')` returns the payload for the matching JSON id.
- Unknown id throws `InvalidProfileIdentifierError`.
- A row whose `profileJson` fails Zod throws `InvalidProfilePayloadError`.

**Verification:**
- `pnpm test tests/profile/review-service.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 8: ProfileApprovalService (approve + invalidate)

**Files:**
- Create: `src/profile/approval-service.ts`
- Create: `tests/profile/approval-service.test.ts`

**Goal:** Implement SPEC §16.3 approval in one transaction. Steps from the spec:

1. Validate the profile again (re-parse the stored JSON through `ProfessionalProfileSchema.safeParse`; throw `InvalidProfilePayloadError` on failure).
2. Read `profile_conflicts` for the draft id; count `resolutionStatus = 'unresolved'`. If > 0 and any `severity = 'blocking_conflict'`, throw `BlockingConflictsUnresolvedError(code: 'blocking_conflicts_unresolved', exitCode: 2)`.
3. Read `profile_warnings` for the draft id; if any remain (`severity = 'warning'`), call `prompts.confirmApprovalWithWarnings(warnings)` and throw `UserCancelledApprovalError(code: 'approval_cancelled', exitCode: 130)` if the user declines. (When `prompts` is omitted the service is being driven by the CLI's non-interactive path; the CLI always supplies prompts.)
4. Compute the final `contentHash` via `calculateProfileContentHash` from the parsed profile.
5. Run `repositories.transact` to:
   - `profileVersions.approve(draftId, { approvedAt, supersededAt })` — the existing TASK-004 method flips the prior active row to `superseded` and promotes the new row to active.
   - `filterResults.invalidateByProfileVersion(priorApprovedId)` — the new Task 3 method.
6. Return the new active profile id and a summary `{ approvedProfileVersionId, supersededProfileVersionId, invalidatedFilterResults, remainingWarnings }`.

**API:**

```ts
export interface ProfileApprovalServiceOptions {
  readonly repositories: Repositories;
  readonly prompts?: ProfileApprovalPrompts;
  readonly now?: () => Date;
}

export interface ProfileApprovalSummary {
  readonly approvedProfileVersionId: number;
  readonly supersededProfileVersionId: number | null;  // null when there was no prior approved
  readonly invalidatedFilterResults: number;
  readonly remainingWarnings: number;
}

export class ProfileApprovalService {
  constructor(options: ProfileApprovalServiceOptions) {}
  async approve(rawId: string): Promise<ProfileApprovalSummary>;
}
```

**`ProfileApprovalPrompts`** is a small interface (one method) that the CLI implements with `@inquirer/confirm`. The service does not depend on `@inquirer/prompts` directly.

**Tests:**

- Approving a draft with no blocking conflicts and no warnings returns a summary with `supersededProfileVersionId: null` and `invalidatedFilterResults: 0`.
- Approving when a prior approved profile exists sets the prior row's status to `superseded` and `supersededAt`.
- Approval invalidates filter results tied to the prior profile (verified with the new Task 3 method).
- Approving with unresolved `blocking_conflict` rows throws `BlockingConflictsUnresolvedError` and does NOT modify the active row.
- Approving with warnings and the user declining throws `UserCancelledApprovalError`; no state change.
- Approving with warnings and the user accepting succeeds; `remainingWarnings` matches the warning count.
- `contentHash` on the new approved row matches `calculateProfileContentHash` for the parsed profile.
- A draft whose stored `profileJson` fails Zod validation throws `InvalidProfilePayloadError`; no state change.

**Verification:**
- `pnpm test tests/profile/approval-service.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 9: ProfileRejectionService (reject)

**Files:**
- Create: `src/profile/rejection-service.ts`
- Create: `tests/profile/rejection-service.test.ts`

**Goal:** Implement SPEC §16.4. Behavior:

1. Resolve the target id.
2. If `status === 'draft'`: confirm via `prompts.confirmRejection()`, call `profileVersions.reject(draftId, { now })`, return `{ rejectedProfileVersionId }`. Do not touch any other row.
3. If `status === 'approved' | 'rejected' | 'superseded'`: throw `InvalidProfileStateError(code: 'profile_not_rejectable', exitCode: 2)`.
4. `active` row is never touched; the previously active approved profile remains active.
5. No dependent-result invalidation (per SPEC §16.4: "Avoid invalidating existing results").

**API:**

```ts
export interface ProfileRejectionServiceOptions {
  readonly repositories: Repositories;
  readonly prompts?: ProfileRejectionPrompts;
  readonly now?: () => Date;
}

export class ProfileRejectionService {
  constructor(options: ProfileRejectionServiceOptions) {}
  async reject(rawId: string): Promise<{ readonly rejectedProfileVersionId: number }>;
}
```

**`ProfileRejectionPrompts`** has one method (`confirmRejection(profile: ProfessionalProfile)`) the CLI implements with `@inquirer/confirm`.

**Tests:**

- Rejecting a draft with the user confirming flips status to `rejected`, leaves `active` false, leaves the prior approved profile untouched.
- Rejecting with the user declining throws `UserCancelledRejectionError`.
- Rejecting a non-draft row throws `InvalidProfileStateError`.
- Rejection does NOT touch `filter_results` or `score_results`.

**Verification:**
- `pnpm test tests/profile/rejection-service.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 10: Profile lifecycle error codes (single source of truth)

**Files:**
- Modify: `src/profile/errors.ts`
- Create: `tests/profile/errors.test.ts` (extend existing file)

**Goal:** Centralize the new lifecycle error family in `src/profile/errors.ts` next to the existing import-flow errors. All new errors extend `ApplicationError` with the right `exitCode`.

New exports:

```ts
export class ProfileLifecycleError extends ApplicationError { /* default Fatal */ }
export class InvalidProfileIdentifierError extends ProfileLifecycleError { /* InvalidUsage */ }
export class InvalidProfilePayloadError extends ProfileLifecycleError { /* InvalidUsage */ }
export class InvalidProfileStateError extends ProfileLifecycleError { /* InvalidUsage */ }
export class BlockingConflictsUnresolvedError extends ProfileLifecycleError { /* InvalidUsage */ }
export class UserCancelledApprovalError extends ProfileLifecycleError { /* UserCancellation */ }
export class UserCancelledRejectionError extends ProfileLifecycleError { /* UserCancellation */ }
```

All have stable `code` strings (`invalid_profile_identifier`, `invalid_profile_payload`, `profile_not_editable`, `profile_not_rejectable`, `blocking_conflicts_unresolved`, `approval_cancelled`, `rejection_cancelled`).

**Tests:**
- Each error maps to the documented `exitCode` and `code`.

**Verification:**
- `pnpm test tests/profile/errors.test.ts` — all green.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.

---

### Task 11: CLI subcommands (list, show, edit, approve, reject)

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli/profile-list.test.ts`
- Create: `tests/cli/profile-show.test.ts`
- Create: `tests/cli/profile-edit.test.ts`
- Create: `tests/cli/profile-approve.test.ts`
- Create: `tests/cli/profile-reject.test.ts`

**Goal:** Five thin CLI adapters. The CLI opens the database, constructs the appropriate service, calls it, and renders the result.

**Subcommands:**

```text
jobhunter profile list [--json]
jobhunter profile show <profile-id> [--json]
jobhunter profile edit <profile-id>
jobhunter profile approve <profile-id>
jobhunter profile reject <profile-id>
```

Each subcommand:

- Parses and validates arguments before opening the database (Commander-side validation).
- Opens the DB via `initializeDatabase` + `createRepositories`, and closes it in `finally`.
- Calls the corresponding service.
- Renders the result:
  - `list` (default): human-readable table with id, status, active, created, approved columns. `--json` emits the `ProfileListEntry[]` array as a single JSON document.
  - `show` (default): `renderReviewSummary` output. `--json` emits `ProfileShowPayload` as a single JSON document.
  - `edit`: runs the editor session; on save prints `profile_<id> saved`; on discard prints `discarded`; on cancel prints `cancelled`.
  - `approve`: runs the approval flow; prints `approved: profile_<id>` (and `superseded: profile_<id>` when applicable, and `invalidated filter results: N`).
  - `reject`: runs the rejection flow; prints `rejected: profile_<id>`.

Invalid identifiers are caught at the CLI boundary (`try { ... } catch (err) { exitWithError(err); }`) and exit with `ExitCode.InvalidUsage` (2).

**Test approach (mirrors `tests/cli/profile-extract.test.ts`):**

- Capture `process.stdout.write` / `process.stderr.write` and `process.exit` in `beforeEach`.
- Boot the CLI with `HOME=/tmp/jh-task009-...` so a temp SQLite DB is created.
- Seed `profile_sources`, `profile_versions`, `profile_conflicts`, `profile_warnings`, `derived_overrides`, `profile_revisions`, `filter_results` rows directly via `Repositories` to set up scenarios (one-liner helpers per test).
- Drive the CLI with `createProgram().parseAsync(['node', 'jobhunter', 'profile', 'list', '--json'])` and assert stdout/stderr/exit.
- For the interactive commands (`edit`, `approve`, `reject`), inject the `FailingProfileEditorPrompts` for the basic wiring tests and the `ScriptedProfileEditorPrompts` for the flow tests (a tiny test-only constructor accepts a scripted array).

**Tests (per subcommand):**

- `profile-list.test.ts` —
  - No profiles → empty list output, exit 0.
  - Two profiles (one draft, one approved) → both appear; ordering is `id DESC`.
  - `--json` emits exactly one valid JSON document with two entries.
  - Invalid flag combination exits 2.
- `profile-show.test.ts` —
  - `show profile_3` with a seeded draft → renders `renderReviewSummary` output, exit 0.
  - `show profile_3 --json` → emits one JSON document containing profile, warnings, conflicts, overrides, revisions.
  - `show profile_999` → exits 2 with `profile_not_found`.
  - `show profile_<json-id>` (the dual-form) resolves correctly.
- `profile-edit.test.ts` —
  - `edit profile_3` on a draft with `FailingProfileEditorPrompts` → exits non-zero with the failing reason (sanity test that the seam is wired).
  - `edit profile_3` on an approved row with scripted prompts (select `basics`, edit `headline`, save) → exits 0, new draft created with edited headline, prior approved row unchanged.
  - `edit profile_3` with a row in `superseded` status → exits 2 with `profile_not_editable`.
- `profile-approve.test.ts` —
  - `approve profile_3` on a clean draft → exits 0, prints `approved: profile_<id>`, prior approved (if any) marked `superseded`.
  - `approve profile_3` with a `blocking_conflict` row → exits 2 with `blocking_conflicts_unresolved`.
  - `approve profile_3` with warnings and scripted `confirmApprovalWithWarnings = false` → exits 130.
  - `approve profile_999` → exits 2 with `profile_not_found`.
  - Approving when a prior approved profile exists invalidates the prior profile's filter results (asserted via `filterResults.listByRun` / `filterResults.listByJob`).
- `profile-reject.test.ts` —
  - `reject profile_3` on a draft → exits 0, prior approved row stays active.
  - `reject profile_3` with scripted confirm = false → exits 130.
  - `reject profile_<approved-id>` → exits 2 with `profile_not_rejectable`.

**Verification:**
- `pnpm test tests/cli/` — all green (the four pre-existing smoke-test failures that fire when `dist/cli.js` is missing remain out of scope; `pnpm build` resolves them).
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm build` — exit 0, `dist/cli.js` produced.

---

### Task 12: Final integration, public-surface barrel, and verification

**Files:**
- Modify: `src/profile/index.ts` (re-export new public surface)
- Modify: `docs/tasks/TASK-009-profile-review-approval-overrides.md` (mark implemented, record results)
- Create: `tests/profile/integration.test.ts` (cross-service end-to-end)

**Goal:** Wire the new public surface into the existing `src/profile/index.ts` barrel, and add one end-to-end integration test that exercises list → extract-equivalent seeded draft → edit → approve → show on a real temporary SQLite database.

**Barrel additions:**

```ts
// src/profile/index.ts (additions)
export * from './identifier-resolution.js';
export * from './review/index.js';
export * from './editing/index.js';
export {
  ProfileReviewService,
  type ProfileListEntry,
  type ProfileShowPayload,
} from './review-service.js';
export { ProfileEditingService } from './editing-service.js';
export {
  ProfileApprovalService,
  type ProfileApprovalSummary,
  type ProfileApprovalServiceOptions,
  type ProfileApprovalPrompts,
} from './approval-service.js';
export {
  ProfileRejectionService,
  type ProfileRejectionServiceOptions,
  type ProfileRejectionPrompts,
} from './rejection-service.js';
```

The CLI's `cli.ts` re-exports the public surface through the same barrel (same pattern as TASK-008 Task 9).

**`tests/profile/integration.test.ts`:**

- Open a temporary SQLite database.
- Insert one `profile_sources` row with `textExtractionStatus = 'success'` (to anchor the foreign-key chain).
- Insert a `profile_versions` draft row with a valid `ProfessionalProfile` JSON (containing one unresolved `blocking_conflict` row + one `warning` row + one `derived_overrides` row), seeded directly via `Repositories`.
- Call `ProfileReviewService.list()` → asserts the draft appears.
- Call `ProfileEditingService.startEdit(...)` with a scripted adapter that selects `basics`, edits `headline`, then `save`. Assert the new draft's `profileJson.basics.headline` changed and a `profile_revisions` row was inserted.
- Call `ProfileApprovalService.approve(...)` with scripted `confirmApprovalWithWarnings = true`. Assert: prior active row (none) untouched, draft now `approved`+`active`, new `contentHash` matches `calculateProfileContentHash`, filter invalidation count is 0 (no filter results seeded).
- Call `ProfileReviewService.show(newId)` → payload includes the edited headline, no blocking conflicts (they were already resolved inline), 1 warning preserved, 1 override preserved.

**Verification (final, runs in CI):**

- `pnpm install --frozen-lockfile` → `Already up to date` (no new deps).
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm format:check` → exit 0 (run `pnpm format` first if any new files need reformatting).
- `pnpm build` → exit 0, `dist/cli.js` produced.
- `pnpm test` → all tests pass (existing 519 baseline + new TASK-009 tests).
- `pnpm test:live:list` → empty live suite (correct — TASK-009 has no live LinkedIn surface).

**Documentation updates:**

- Append an "Implementation results" section to `docs/tasks/TASK-009-profile-review-approval-overrides.md` (commit hashes, verification output, test inventory, deviations, known limitations).
- Add a row to `docs/tasks/INDEX.md` updating TASK-009 from `Planned` to `Implemented` with a one-line summary.

---

## Risks and known limitations

1. **`score_results` invalidation is deferred.** SPEC §16.3 step 9 mentions both filter and score invalidation; TASK-009 implements the filter half (the column exists in `filter_results`). `score_results` does not currently carry a `profile_version_id` column. TASK-014 (scoring) must resolve this — likely by adding the column and a matching `invalidateByProfileVersion` method, with an explicit migration approval per AGENTS.md §12. The implementing agent for TASK-014 must call this out in its plan.
2. **Profile-id JSON column is not unique-enforced.** The schema does not enforce uniqueness on `ProfessionalProfile.id` inside `profileJson`. `resolveProfileVersionId` (Task 1) throws `profile_id_collision` if it ever finds duplicates, which prevents ambiguous CLI behavior, but the schema-level invariant is intentionally left for a future migration (per AGENTS.md §12, schema changes require explicit approval).
3. **Live re-extraction is out of scope.** SPEC §16.7's "regeneration" clause is satisfied by the override-management surface; a "Re-run extraction" UI action is intentionally not added (would re-touch OpenAI SDK paths and the extraction fingerprint).
4. **`profile show --json` payload size.** A profile with many conflicts/warnings/revisions could be large. SPEC §36's "values must not be truncated" rule is followed (full payload is emitted). No streaming or pagination is added in TASK-009.
5. **Editor prompts adapter coverage.** `@inquirer/prompts` is the only interactive UI library approved for the MVP (SPEC §5). The default adapter is the only one shipped. A custom terminal UI is intentionally not added.

## Completion gate

Per `AGENTS.md` §15, before reporting TASK-009 complete the implementing agent must:

1. Re-read the changed files (`src/profile/{review,editing}/*.ts`, `src/profile/{review,editing,approval,rejection,identifier-resolution}-service.ts` / `.ts`, `src/profile/index.ts`, `src/cli.ts`, `src/persistence/repositories/filter-results.ts`).
2. Run all verification commands in Task 12 and confirm green.
3. Confirm no dead code, unused imports, debug output, or unresolved TODOs remain.
4. Confirm `docs/tasks/TASK-009-profile-review-approval-overrides.md` and `docs/tasks/INDEX.md` are updated.
5. Stop before committing, merging, or starting another task. The user owns the merge and squash commit (per `GIT.md` §6).
