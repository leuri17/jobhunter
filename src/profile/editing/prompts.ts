/**
 * Editor prompts interface and test-only adapters.
 *
 * The state-machine reducer in `state-machine.ts` is pure and prompts-free.
 * The interactive editor in `prompts-inquirer.ts` is the only module allowed
 * to import `@inquirer/prompts`. This module defines the seam between the
 * two: `ProfileEditorPrompts` is the interface every adapter implements,
 * and the two test-only adapters below give integration tests full control
 * over what the editor "asks the user".
 *
 * The two test adapters mirror the `createFailingPrompts` /
 * scripted-recorder pattern used by `src/search/prompts.ts`:
 *
 *   - `FailingProfileEditorPrompts` — every method rejects with a
 *     configured reason. Used by sanity tests that just want to assert
 *     the seam is wired.
 *
 *   - `ScriptedProfileEditorPrompts` — each method returns the next
 *     scripted response (FIFO per method). The class also records every
 *     invocation so tests can assert which prompts were issued in what
 *     order. Used by the editor / approval / rejection integration tests
 *     in subsequent tasks.
 */

import type {
  DerivedOverrideRow,
  ProfileConflictRow,
} from '../../persistence/repositories/profile-versions.js';
import type { DerivedFieldKey, DraftState, OverrideState, SectionKey } from './state-machine.js';
import type { ConflictResolutionChoice } from '../review/conflict-resolution.js';
import type { CollectionSection } from './validation.js';

/* ----------------------------- Prompt inputs ----------------------------- */

/** Input passed to `editScalar`. Mirrors  scalar editing rules. */
export interface ScalarEditPrompt {
  readonly section: 'basics' | 'derived';
  readonly field: string;
  readonly currentValue: unknown;
  readonly nullable: boolean;
}

/**
 * Result of a scalar edit prompt. `keep` preserves the existing value
 * without writing a revision. `set` writes the supplied value. `cleared`
 * nulls out a nullable field ( "Allow nullable fields to be
 * cleared explicitly"). `cancelled` aborts the operation.
 */
export type ScalarEditResult =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly value: unknown }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'cancelled' };

/** Input passed to `editCollection`. */
export interface CollectionEditPrompt {
  readonly section: CollectionSection;
  readonly entries: readonly { readonly id: string; readonly summary: string }[];
  readonly supportsReorder: boolean;
}

/** Result of a collection edit prompt. */
export type CollectionEditResult =
  | { readonly kind: 'list' }
  | { readonly kind: 'view'; readonly entityId: string }
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly entityId: string }
  | { readonly kind: 'delete'; readonly entityId: string }
  | { readonly kind: 'reorder' }
  | { readonly kind: 'back' };

/** Input passed to `resolveConflict`. Carries both source values + provisional. */
export interface ConflictResolutionPrompt {
  readonly conflict: ProfileConflictRow;
  readonly entityId: string;
  readonly provisionalValue: unknown;
}

/** Input passed to `manageOverrides`. */
export interface OverridePrompt {
  readonly field: DerivedFieldKey;
  readonly generatedValue: unknown;
  readonly currentEffective: unknown;
  readonly overrideActive: boolean;
}

/** Result of `manageOverrides`. */
export type OverridePromptResult =
  | { readonly kind: 'set'; readonly field: DerivedFieldKey; readonly value: unknown }
  | { readonly kind: 'change'; readonly field: DerivedFieldKey; readonly value: unknown }
  | { readonly kind: 'clear'; readonly field: DerivedFieldKey }
  | { readonly kind: 'keep' };

/** Input passed to `showReview`. */
export interface ReviewPrompt {
  readonly state: DraftState;
  readonly rendered: string;
}

export type ReviewPromptResult = { readonly kind: 'continue' } | { readonly kind: 'back' };

/** Input passed to `confirmSave`. */
export interface SavePrompt {
  readonly state: DraftState;
  readonly remainingWarnings: number;
}

export type SaveConfirmation = { readonly kind: 'save' } | { readonly kind: 'cancel' };

/** Input passed to `confirmDiscard`. */
export interface DiscardPrompt {
  readonly state: DraftState;
}

export type DiscardConfirmation = { readonly kind: 'discard' } | { readonly kind: 'cancel' };

/* ------------------------------- Interface ------------------------------- */

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

/* --------------------------- Test adapters -------------------------------- */

/**
 * A `ProfileEditorPrompts` implementation that rejects every method with
 * a configured reason. Used by tests that just want to assert the seam is
 * wired without driving the editor.
 */
export class FailingProfileEditorPrompts implements ProfileEditorPrompts {
  constructor(private readonly reason: string) {}

  selectSection(_currentSection: SectionKey | null): Promise<SectionKey> {
    return Promise.reject(new Error(this.reason));
  }
  editScalar(_input: ScalarEditPrompt): Promise<ScalarEditResult> {
    return Promise.reject(new Error(this.reason));
  }
  editCollection(_input: CollectionEditPrompt): Promise<CollectionEditResult> {
    return Promise.reject(new Error(this.reason));
  }
  resolveConflict(_input: ConflictResolutionPrompt): Promise<ConflictResolutionChoice> {
    return Promise.reject(new Error(this.reason));
  }
  manageOverrides(_input: OverridePrompt): Promise<OverridePromptResult> {
    return Promise.reject(new Error(this.reason));
  }
  showReview(_input: ReviewPrompt): Promise<ReviewPromptResult> {
    return Promise.reject(new Error(this.reason));
  }
  confirmSave(_input: SavePrompt): Promise<SaveConfirmation> {
    return Promise.reject(new Error(this.reason));
  }
  confirmDiscard(_input: DiscardPrompt): Promise<DiscardConfirmation> {
    return Promise.reject(new Error(this.reason));
  }
}

type PromptMethodName = keyof ProfileEditorPrompts;

/**
 * A `ProfileEditorPrompts` implementation that replays scripted responses
 * FIFO per method and records every call site + argument. The constructor
 * accepts a partial record; methods not supplied default to an empty queue
 * (and will reject when called unless callers pre-populate).
 */
export class ScriptedProfileEditorPrompts implements ProfileEditorPrompts {
  private readonly queues: Record<PromptMethodName, unknown[]>;
  public readonly calls: Record<PromptMethodName, unknown[]> = {
    selectSection: [],
    editScalar: [],
    editCollection: [],
    resolveConflict: [],
    manageOverrides: [],
    showReview: [],
    confirmSave: [],
    confirmDiscard: [],
  };

  constructor(scripted: Partial<Record<PromptMethodName, readonly unknown[]>> = {}) {
    this.queues = {
      selectSection: [...(scripted.selectSection ?? [])],
      editScalar: [...(scripted.editScalar ?? [])],
      editCollection: [...(scripted.editCollection ?? [])],
      resolveConflict: [...(scripted.resolveConflict ?? [])],
      manageOverrides: [...(scripted.manageOverrides ?? [])],
      showReview: [...(scripted.showReview ?? [])],
      confirmSave: [...(scripted.confirmSave ?? [])],
      confirmDiscard: [...(scripted.confirmDiscard ?? [])],
    };
  }

  private next(method: PromptMethodName, args: unknown): unknown {
    this.calls[method].push(args);
    const queue = this.queues[method];
    if (queue.length === 0) {
      return Promise.reject(
        new Error(`ScriptedProfileEditorPrompts: no scripted response for "${String(method)}"`),
      );
    }
    const value = queue.shift();
    return Promise.resolve(value);
  }

  selectSection(currentSection: SectionKey | null): Promise<SectionKey> {
    return this.next('selectSection', currentSection) as Promise<SectionKey>;
  }

  editScalar(input: ScalarEditPrompt): Promise<ScalarEditResult> {
    return this.next('editScalar', input) as Promise<ScalarEditResult>;
  }

  editCollection(input: CollectionEditPrompt): Promise<CollectionEditResult> {
    return this.next('editCollection', input) as Promise<CollectionEditResult>;
  }

  resolveConflict(input: ConflictResolutionPrompt): Promise<ConflictResolutionChoice> {
    return this.next('resolveConflict', input) as Promise<ConflictResolutionChoice>;
  }

  manageOverrides(input: OverridePrompt): Promise<OverridePromptResult> {
    return this.next('manageOverrides', input) as Promise<OverridePromptResult>;
  }

  showReview(input: ReviewPrompt): Promise<ReviewPromptResult> {
    return this.next('showReview', input) as Promise<ReviewPromptResult>;
  }

  confirmSave(input: SavePrompt): Promise<SaveConfirmation> {
    return this.next('confirmSave', input) as Promise<SaveConfirmation>;
  }

  confirmDiscard(input: DiscardPrompt): Promise<DiscardConfirmation> {
    return this.next('confirmDiscard', input) as Promise<DiscardConfirmation>;
  }
}

/* --------------------------------- Helpers -------------------------------- */

/**
 * Convenience: build a `FailingProfileEditorPrompts` whose reason string
 * matches the search-config pattern (`createFailingPrompts(reason)`).
 */
export function createFailingEditorPrompts(reason: string): ProfileEditorPrompts {
  return new FailingProfileEditorPrompts(reason);
}

/**
 * Type guard: did the prompt return a "set / change / keep / list / back"
 * continuation, or did it ask for cancellation?
 */
export function isScalarEditResult(value: unknown): value is ScalarEditResult {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'keep' || kind === 'set' || kind === 'cleared' || kind === 'cancelled';
}

/* ---------------------------- Override re-export ------------------------- */

/**
 * Re-export the `DerivedOverrideRow` shape so consumers of this module
 * can construct scripted fixtures without reaching into the persistence
 * layer directly.
 */
export type { DerivedOverrideRow };

/** Re-export so consumers don't need a second import for `OverrideState`. */
export type { OverrideState };
