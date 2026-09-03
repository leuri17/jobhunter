# src/profile/editing/

## Responsibility

Interactive profile editing subsystem: a pure reducer drives an edit session
over a `DraftState`, a `ProfileEditorPrompts` seam mediates user interaction,
and Zod-backed validators gate every write. Persistence and IO (database,
OpenAI, Playwright) live outside this folder; modules here are
deterministic and prompts-free except for the seam declaration.

## Design

- **Pure reducer** (`state-machine.ts`). `reduce(state, op)` is the only
  state-transition entry point. Never mutates input, never calls IO, throws
  `InvalidProfileStateError` on irrecoverable input (unknown field, duplicate
  id, unconfirmed delete, unknown conflict type). `reduceAll` folds a
  sequence of operations.
- **Operation algebra** (`EditorOperation` union). Eight kinds —
  `select_section`, `edit_scalar`, `edit_collection`, `resolve_conflict`,
  `set_override`, `clear_override`, `discard`, `back` — each mapped to one
  reducer branch.
- **Section routing** (`sectionFromKey`). Classifies a `SectionKey` into
  `scalar` (`basics`, `derived`), `collection` (six entity types), or `meta`
  (`warnings`, `review`, `save`, `discard`, `exit`).
- **Prompts seam** (`prompts.ts`). `ProfileEditorPrompts` declares the eight
  async methods the service must implement (`selectSection`, `editScalar`,
  `editCollection`, `resolveConflict`, `manageOverrides`, `showReview`,
  `confirmSave`, `confirmDiscard`). Test adapters:
  `FailingProfileEditorPrompts` (rejects everything) and
  `ScriptedProfileEditorPrompts` (FIFO per method, records every call).
- **Validation gate** (`validation.ts`). `validateScalar(section, field,
  value)` resolves a Zod schema from `src/profile/schema.ts`, returns
  `{ ok, value | issues }` without throwing. `validateOverrideValue`,
  `isValidYearMonthOrNull`, `getValidatedFieldPath` are sibling helpers.
- **Barrel** (`index.ts`). Re-exports the reducer, validators, prompts, and
  every public type. Application services import only from this barrel.

## Flow

1. `ProfileEditingService.startEdit` (`src/profile/editing-service.ts`)
   builds the initial `DraftState` via `emptyDraftState(profile, overrides)`,
   which folds existing override rows through `applyOverrides`.
2. The service drives the session loop (`runSession` / `dispatchSection`),
   asks `ProfileEditorPrompts` for the next intent, and translates each
   answer into an `EditorOperation`.
3. `reduce` applies it: scalar and collection edits flow through
   `validateScalar` first; collection edits dispatch through
   `applyCollectionEdit` (list / view / add / edit / delete / reorder).
4. Conflict resolution and derived-field overrides mutate the profile via
   `resolveConflictOnProfile` and `applyOverrideStateToProfile`, appending
   to `pendingRevisions` and `pendingOverrides`.
5. `select_section` / `back` push and pop `sectionHistory`; `discard`
   clears `pendingRevisions`. `saveDraft` walks both pending arrays to
   write the persistence layer.

## Integration

- **Consumers**: `src/profile/editing-service.ts` (`ProfileEditingService`,
  `startEdit`, `runSession`, `dispatchSection`, `saveDraft`).
- **Prompt implementations**: production adapter in `src/profile/openai/`
  (`prompt.ts`, `client.ts`); tests use `FailingProfileEditorPrompts` /
  `ScriptedProfileEditorPrompts`.
- **Persistence**: writes `profile_revisions` and `derived_overrides` via
  `src/persistence/repositories/profile-versions.ts` (`ProfileConflictRow`,
  `DerivedOverrideRow`).
- **Schema / conflict logic**: reads `ProfessionalProfile` and entity
  shapes from `src/profile/schema.ts`; delegates conflict mutation to
  `src/profile/review/conflict-resolution.ts` and override projection to
  `src/profile/review/override-application.ts`.
