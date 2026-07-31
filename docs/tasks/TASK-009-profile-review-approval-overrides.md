# TASK-009 — Profile Review, Editing, Conflicts, Approval, Versioning, and Overrides

**Status:** Planned; not approved for implementation
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
