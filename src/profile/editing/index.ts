/**
 * Public surface for the profile editor.
 *
 * Re-exports the pure reducer, the prompts seam (interface + failing /
 * scripted test adapters), and the field validators the reducer relies
 * on. Application services pull everything they need from this barrel;
 * nothing else in the project should reach into the individual files
 * directly.
 */

export {
  reduce,
  reduceAll,
  emptyDraftState,
  sectionFromKey,
  type DraftState,
  type EditorOperation,
  type SectionKey,
  type SectionHandler,
  type SectionKind,
  type PendingRevision,
  type RevisionSource,
  type CollectionEditOperation,
  type CollectionEntry,
  type CollectionPatch,
  type OverrideState,
} from './state-machine.js';

export {
  validateScalar,
  validateOverrideValue,
  isValidYearMonthOrNull,
  getValidatedFieldPath,
  type ValidationResult,
  type ScalarSection,
  type CollectionSection,
  type ValidationSection,
} from './validation.js';

export {
  FailingProfileEditorPrompts,
  ScriptedProfileEditorPrompts,
  createFailingEditorPrompts,
  isScalarEditResult,
  type ProfileEditorPrompts,
  type ScalarEditPrompt,
  type ScalarEditResult,
  type CollectionEditPrompt,
  type CollectionEditResult,
  type ConflictResolutionPrompt,
  type OverridePrompt,
  type OverridePromptResult,
  type ReviewPrompt,
  type ReviewPromptResult,
  type SavePrompt,
  type SaveConfirmation,
  type DiscardPrompt,
  type DiscardConfirmation,
  type DerivedOverrideRow,
} from './prompts.js';
