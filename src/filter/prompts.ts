/**
 * Filter configuration prompt seam (TASK-010 Task 10, SPEC §17.3 + §17.6).
 *
 * Every method of `FilterPrompts` corresponds to one question the
 * `ConfigureFiltersService` asks the user. The seam keeps the
 * `ConfigureFiltersService` prompt-free so its flow can be tested with
 * a `ScriptedFilterPrompts` fixture; the Inquirer CLI implementation
 * lives in `prompts-inquirer.ts` and is the ONLY module under
 * `src/filter/` permitted to import `@inquirer/prompts`.
 *
 * The two test adapters mirror the `createFailingPrompts` /
 * scripted-recorder pattern used by `src/search/prompts.ts` and
 * `src/profile/editing/prompts.ts`:
 *
 *   - `createFailingFilterPrompts(reason)` — every method rejects with
 *     a configured reason. Sanity-check wiring.
 *   - `ScriptedFilterPrompts` — each method returns the next scripted
 *     response (FIFO per method) and records every invocation so tests
 *     can assert which prompts were issued in what order.
 *
 * The preview shape (`FilterConfigurationPreview`) intentionally mirrors
 * `JobFilterConfig` 1:1 so the rendered preview is a literal JSON
 * reflection of what gets persisted. The Inquirer adapter writes the
 * preview to `stderr`; the service treats `showPreview` as fire-and-forget
 * (no error path).
 */

import type { SeniorityLevel } from '../profile/schema.js';

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
  /**
   * SPEC §17.6 requires the user to keep / remove / add / re-add languages,
   * including languages NOT in the profile. The default Inquirer adapter
   * renders a checkbox of `seeds` plus an "Other…" free-text input; the
   * union of toggled + entered languages is returned via `added`. The
   * scripted test adapter mirrors the same shape.
   */
  askAcceptedLanguages(
    seeds: readonly string[],
  ): Promise<{ readonly chosen: readonly string[]; readonly added: readonly string[] }>;
  askRejectUnsupportedLanguages(existing: boolean): Promise<boolean>;
  showPreview(preview: FilterConfigurationPreview): Promise<void>;
  askConfirmation(preview: FilterConfigurationPreview): Promise<boolean>;
}

type FilterPromptMethodName = keyof FilterPrompts;

/**
 * A `FilterPrompts` implementation that rejects every method with a
 * configured reason. Used by tests that just want to assert the seam is
 * wired.
 */
export function createFailingFilterPrompts(reason: string): FilterPrompts {
  const fail = (): Promise<never> => Promise.reject(new Error(reason));
  return {
    askExcludedCompanies: () => fail(),
    askTitleExcludedKeywords: () => fail(),
    askTitleRequiredAnyKeywords: () => fail(),
    askDescriptionExcludedKeywords: () => fail(),
    askDescriptionRequiredAnyKeywords: () => fail(),
    askMaximumSeniority: () => fail(),
    askAcceptedLanguages: () => fail(),
    askRejectUnsupportedLanguages: () => fail(),
    showPreview: async () => undefined,
    askConfirmation: () => fail(),
  };
}

/**
 * A `FilterPrompts` implementation that replays scripted responses FIFO
 * per method and records every call site + argument. Methods not supplied
 * in the constructor default to an empty queue and reject when called.
 */
export class ScriptedFilterPrompts implements FilterPrompts {
  private readonly queues: Record<FilterPromptMethodName, unknown[]>;
  public readonly calls: Record<FilterPromptMethodName, unknown[]> = {
    askExcludedCompanies: [],
    askTitleExcludedKeywords: [],
    askTitleRequiredAnyKeywords: [],
    askDescriptionExcludedKeywords: [],
    askDescriptionRequiredAnyKeywords: [],
    askMaximumSeniority: [],
    askAcceptedLanguages: [],
    askRejectUnsupportedLanguages: [],
    showPreview: [],
    askConfirmation: [],
  };

  constructor(scripted: Partial<Record<FilterPromptMethodName, readonly unknown[]>> = {}) {
    this.queues = {
      askExcludedCompanies: [...(scripted.askExcludedCompanies ?? [])],
      askTitleExcludedKeywords: [...(scripted.askTitleExcludedKeywords ?? [])],
      askTitleRequiredAnyKeywords: [...(scripted.askTitleRequiredAnyKeywords ?? [])],
      askDescriptionExcludedKeywords: [...(scripted.askDescriptionExcludedKeywords ?? [])],
      askDescriptionRequiredAnyKeywords: [...(scripted.askDescriptionRequiredAnyKeywords ?? [])],
      askMaximumSeniority: [...(scripted.askMaximumSeniority ?? [])],
      askAcceptedLanguages: [...(scripted.askAcceptedLanguages ?? [])],
      askRejectUnsupportedLanguages: [...(scripted.askRejectUnsupportedLanguages ?? [])],
      showPreview: [...(scripted.showPreview ?? [])],
      askConfirmation: [...(scripted.askConfirmation ?? [])],
    };
  }

  private next(method: FilterPromptMethodName, args: unknown): unknown {
    this.calls[method].push(args);
    const queue = this.queues[method];
    if (queue.length === 0) {
      // `showPreview` is fire-and-forget (the service renders it but
      // doesn't read the return value). Default to a no-op when the
      // caller didn't script a response, so tests don't have to add
      // an empty `showPreview: [undefined]` to every fixture.
      if (method === 'showPreview') {
        return Promise.resolve(undefined);
      }
      return Promise.reject(
        new Error(`ScriptedFilterPrompts: no scripted response for "${String(method)}"`),
      );
    }
    const value = queue.shift();
    return Promise.resolve(value);
  }

  askExcludedCompanies(existing: readonly string[]): Promise<readonly string[]> {
    return this.next('askExcludedCompanies', existing) as Promise<readonly string[]>;
  }

  askTitleExcludedKeywords(existing: readonly string[]): Promise<readonly string[]> {
    return this.next('askTitleExcludedKeywords', existing) as Promise<readonly string[]>;
  }

  askTitleRequiredAnyKeywords(existing: readonly string[]): Promise<readonly string[]> {
    return this.next('askTitleRequiredAnyKeywords', existing) as Promise<readonly string[]>;
  }

  askDescriptionExcludedKeywords(existing: readonly string[]): Promise<readonly string[]> {
    return this.next('askDescriptionExcludedKeywords', existing) as Promise<readonly string[]>;
  }

  askDescriptionRequiredAnyKeywords(existing: readonly string[]): Promise<readonly string[]> {
    return this.next('askDescriptionRequiredAnyKeywords', existing) as Promise<readonly string[]>;
  }

  askMaximumSeniority(existing: SeniorityLevel | null): Promise<SeniorityLevel | null> {
    return this.next('askMaximumSeniority', existing) as Promise<SeniorityLevel | null>;
  }

  askAcceptedLanguages(
    seeds: readonly string[],
  ): Promise<{ readonly chosen: readonly string[]; readonly added: readonly string[] }> {
    return this.next('askAcceptedLanguages', seeds) as Promise<{
      readonly chosen: readonly string[];
      readonly added: readonly string[];
    }>;
  }

  askRejectUnsupportedLanguages(existing: boolean): Promise<boolean> {
    return this.next('askRejectUnsupportedLanguages', existing) as Promise<boolean>;
  }

  showPreview(preview: FilterConfigurationPreview): Promise<void> {
    return this.next('showPreview', preview) as Promise<void>;
  }

  askConfirmation(preview: FilterConfigurationPreview): Promise<boolean> {
    return this.next('askConfirmation', preview) as Promise<boolean>;
  }
}
