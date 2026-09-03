/**
 * Prompts seam for the search configuration flow.
 *
 * This module defines the `SearchPrompts` interface that the
 * `ConfigureSearchService` depends on, plus the `createFailingPrompts`
 * test adapter. Desktop-side prompt wiring is owned by the sidecar; no
 * default prompt adapter is exported from this package.
 */
import type { DatePostedSeconds, WorkplaceTypeValue } from './labels.js';

export interface SearchConfigurationPreview {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { readonly name: string; readonly geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export interface SearchPrompts {
  askSearchQueries(existing: readonly string[]): Promise<readonly string[]>;
  askDatePosted(existing: DatePostedSeconds | null): Promise<DatePostedSeconds>;
  askWorkplaceTypes(
    existing: readonly WorkplaceTypeValue[],
  ): Promise<readonly WorkplaceTypeValue[]>;
  askLocationURLs(
    existing: readonly { readonly name: string; readonly geoId: string }[],
  ): Promise<
    readonly { readonly name: string; readonly geoId: string; readonly originalUrl: string }[]
  >;
  askLocationName(geoId: string): Promise<string>;
  askRenameLabel(geoId: string, existingLabel: string, originalUrl: string): Promise<boolean>;
  showPreview(preview: SearchConfigurationPreview, matrixSize: number): Promise<void>;
  askConfirmation(preview: SearchConfigurationPreview, matrixSize: number): Promise<boolean>;
}

export function createFailingPrompts(reason: string): SearchPrompts {
  const fail = (): Promise<never> => Promise.reject(new Error(reason));
  return {
    askSearchQueries: () => fail(),
    askDatePosted: () => fail(),
    askWorkplaceTypes: () => fail(),
    askLocationURLs: () => fail(),
    askLocationName: () => fail(),
    askRenameLabel: () => fail(),
    showPreview: async () => undefined,
    askConfirmation: () => fail(),
  };
}
