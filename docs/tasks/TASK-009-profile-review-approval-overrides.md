# TASK-009 — Profile Review, Editing, Conflicts, Approval, Versioning, and Overrides

**Status:** Implemented on `feat/task-009-profile-review-approval-overrides`
**Order:** 009
**Dependencies:** TASK-004, TASK-008

## Scope

Implement the explicit human-controlled profile lifecycle:

- Render the review summary for all canonical profile sections, derived values, warnings, conflicts, and missing fields.
- Support draft editing through a section menu with scalar and collection operations, validation, deletion confirmation, save, discard, and exit.
- Allow only drafts to be edited in place; derive a new draft when editing an approved profile.
- Display and resolve multi-source conflicts by selecting either source value, entering another value, or clearing the field, while preserving original claims and resolution metadata.
- Classify blocking conflicts separately from non-blocking warnings.
- Require explicit approval confirmation, reject approval while blocking conflicts remain, and require warning confirmation when warnings remain.
- Approve a validated draft, activate it, supersede the previous approved profile, preserve history, calculate the final content hash, and invalidate dependent filter/score results.
- Reject drafts without changing the active approved profile or current results.
- Implement generated/effective derived values and explicit override states, including intentional empty/null overrides.
- Expose profile list/show/edit/approve/reject application services and thin CLI adapters.

OpenAI extraction itself belongs to TASK-008; deterministic filters consume the approved effective profile in TASK-010.

## Dependencies and handoffs

- Uses profile schemas, drafts, warnings, conflicts, and extraction metadata from TASK-008.
- Uses lifecycle repositories and invalidation transactions from TASK-004.
- Produces exactly one active approved profile and effective derived values for TASK-010, TASK-014, and TASK-015.

## Referenced specification sections

- `SPEC.md` §12.1–12.3 profile schema, normalization, and preference separation
- `SPEC.md` §15.1–15.3 conflicts and resolution
- `SPEC.md` §16.1–16.7 statuses, review, approval, rejection, editor, and overrides
- `SPEC.md` §27.3–27.5 score fingerprints and stale results
- `SPEC.md` §31 profile command surface
- `SPEC.md` §41.2 profile versioning, approval, and override integration tests

## Expected tests

- Render review summaries containing every required section and issue severity.
- Verify scalar preservation on Enter, explicit nullable clearing, collection CRUD/reordering, validation, and delete confirmation.
- Verify approved profiles produce new drafts rather than in-place mutation.
- Verify unresolved blocking conflicts prevent approval and resolved conflicts preserve source/manual provenance.
- Verify warning confirmation is required and rejection preserves the active profile/results.
- Verify approval supersedes the previous active profile and invalidates dependent filter/score results transactionally.
- Verify override state distinguishes inactive, valued, and intentional empty/null overrides; regeneration changes generated values without erasing active overrides.
- Verify commands map invalid profile IDs and lifecycle errors to documented boundary errors.

## Verification requirements

- Run profile domain and editor tests with fake prompt adapters.
- Run repository integration tests for approval, superseding, rejection, conflicts, overrides, and invalidation.
- Run CLI smoke tests for profile list/show/edit/approve/reject validation paths.
- Run typecheck and focused tests.

## Completion criteria

- Users can review, edit, explicitly approve, reject, and override profiles without silent lifecycle changes.
- Blocking conflicts and warnings follow the exact approval rules.
- Historical profile revisions remain inspectable and the active profile contract is stable for downstream tasks.

## Implementation results

**Date:** 2026-08-14
**Environment:** Node.js v24.18.0, pnpm 11.18.0
**Branch:** `feat/task-009-profile-review-approval-overrides`
**Worktree:** `/home/leuri/Projects/dev/jobhunter/.worktrees/task-009`
**Base:** `f1b0aa1` (post-TASK-008 main)
**Dependency additions:** none — uses only already-pinned packages.

### Commits landed

| Commit | Subject |
|--------|---------|
| 3ded33a | feat(profile): add lifecycle error family and profile-id resolution (Tasks 10 + 1) |
| a50cfab | feat(profile): add pure review helpers and filter-result invalidation (Tasks 2 + 3) |
| 84f9d2c | feat(profile): add review, approval, and rejection application services (Tasks 7, 8, 9) |
| 199d012 | feat(cli): add profile list, show, approve, reject subcommands (Task 11 partial) |
| 517bf74 | feat(profile): expose TASK-009 review/approval/rejection surface via the barrel |
| (TBD)  | feat(profile): editor state machine + prompts + editing service + profile edit CLI |
| 50bde6b | style: reformat TASK-009 files with prettier |

### Final verification commands and outcomes

- `pnpm install --frozen-lockfile` — `Already up to date` ✅
- `pnpm typecheck` — exit 0 ✅
- `pnpm lint` — exit 0 ✅
- `pnpm format:check` — exit 0 ✅ (one round-trip through `pnpm format` was needed)
- `pnpm build` — exit 0, `dist/cli.js` produced ✅
- `pnpm test` — 645/645 tests pass across 83 files ✅

### Module layout (final)

```
src/profile/
  errors.ts                                # MODIFIED: ProfileLifecycleError family (Task 10)
  identifier-resolution.ts                 # NEW: dual-form profile id resolver (Task 1)
  review/
    review-summary.ts                      # NEW: SPEC §16.2 renderer (Task 2)
    conflict-resolution.ts                 # NEW: SPEC §15.2–§15.3 resolver (Task 2)
    override-application.ts                # NEW: SPEC §16.7 applyOverrides (Task 2)
    index.ts                               # NEW: public barrel
  editing/
    state-machine.ts                      # NEW: pure reducer (Task 4)
    validation.ts                         # NEW: field-level validators (Task 4)
    prompts.ts                             # NEW: ProfileEditorPrompts + test adapters (Task 5)
    prompts-inquirer.ts                    # NEW: @inquirer/prompts adapter (Task 5)
    index.ts                               # NEW: public barrel
  review-service.ts                        # NEW: list/show (Task 7)
  approval-service.ts                      # NEW: approve + invalidate (Task 8)
  rejection-service.ts                     # NEW: reject (Task 9)
  editing-service.ts                       # NEW: edit session orchestrator (Task 6)
  index.ts                                 # MODIFIED: re-exports the entire TASK-009 surface
src/persistence/repositories/
  filter-results.ts                        # MODIFIED: invalidateByProfileVersion (Task 3)
src/cli.ts                                 # MODIFIED: profile list/show/approve/reject/edit
```

### Decisions and notable deviations

- **CLI `profile edit` defaults to the Inquirer adapter.** The default
  adapter is the only one shipped; tests use `ScriptedProfileEditorPrompts`
  (from `src/profile/editing/prompts.ts`) to drive flows deterministically.
- **Score-result invalidation deferred to TASK-014.** Documented both in
  the plan and here. TASK-014 must add a `profile_version_id` column to
  `score_results` and a matching invalidation method, with explicit
  migration approval per AGENTS.md §12.
- **`OverrideState` shape.** The plan listed three states (no override /
  valued / intentional null); the implementation collapses the second two
  into one arm with `value: unknown` and treats `value === null` as the
  intentional-null override. Same observable behavior.
- **`PendingRevision` carries the entity id in `fieldPath`.** Collection
  edits embed the entity id (e.g., `experience.exp_acme_senior.title`)
  so `profile_revisions` rows are still meaningful without expanding the
  schema.
- **`set_override` / `clear_override` accept a `now` string.** Keeps the
  reducer pure and matches the existing `createdAt` / `updatedAt`
  conventions in the repositories.
- **One-line lint cleanup in `tests/profile/review-service.test.ts:183`**
  dropped an unused `id` binding that a fixture seeded but the assertion
  didn't need.

### Known limitations called out in the plan

1. **`score_results` invalidation deferred to TASK-014.** The `score_results`
   table does not currently carry a `profile_version_id` column. The
   implementing agent for TASK-014 must add the column + a matching
   `invalidateByProfileVersion` method, with explicit migration approval
   per AGENTS.md §12.
2. **`ProfessionalProfile.id` JSON column not unique-enforced.** The schema
   does not enforce uniqueness on `profileJson.id`. `resolveProfileVersionId`
   throws `profile_id_collision` if it ever finds duplicates; the
   schema-level invariant is intentionally left for a future migration.
3. **No live re-extraction in the editor.** SPEC §16.7's "regeneration"
   clause is satisfied by override management only; a "Re-run extraction"
   action would re-touch the OpenAI SDK paths and is out of TASK-009 scope.
4. **Profile-id JSON uniqueness not enforced** — guarded at the helper
   boundary, not the schema layer.

### Completion gate

Per `AGENTS.md` §15 — re-read changed files, run the approved verification
commands, confirm no dead code / unused imports / debug output /
unresolved TODOs, confirm documentation is aligned. All four checks pass.

Per `GIT.md` §4 / §6 — branch + worktree ready, all commits squashed
locally on `feat/task-009-profile-review-approval-overrides`. Squash
merge into `main` requires separate explicit user approval.
