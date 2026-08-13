import { buildLinkedInSearchURL, type LinkedInSearchURLInput } from './url-builder.js';
import type { DatePostedSeconds, WorkplaceTypeValue } from './labels.js';
import type { SearchExecutionInsert } from '../persistence/repositories/pipeline-runs.js';

export interface SearchMatrixEntry {
  readonly query: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
}

export interface GenerateMatrixInput {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { readonly name: string; readonly geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
  readonly startTimestamp: string;
}

export function countSearches(
  queries: readonly unknown[],
  locations: readonly unknown[],
): number {
  return queries.length * locations.length;
}

export function generateSearchMatrix(input: GenerateMatrixInput): readonly SearchMatrixEntry[] {
  const out: SearchMatrixEntry[] = [];
  if (input.searchQueries.length === 0 || input.locations.length === 0) return out;
  for (const query of input.searchQueries) {
    for (const location of input.locations) {
      const urlInput: LinkedInSearchURLInput = {
        query,
        geoId: location.geoId,
        datePosted: input.datePosted,
        workplaceTypes: input.workplaceTypes,
      };
      out.push({
        query,
        locationName: location.name,
        geoId: location.geoId,
        generatedUrl: buildLinkedInSearchURL(urlInput),
        startTimestamp: input.startTimestamp,
      });
    }
  }
  return out;
}

export function matrixEntryToSearchExecutionInsert(
  pipelineRunId: number,
  entry: SearchMatrixEntry,
): SearchExecutionInsert {
  return {
    pipelineRunId,
    searchQuery: entry.query,
    locationName: entry.locationName,
    geoId: entry.geoId,
    generatedUrl: entry.generatedUrl,
    startTimestamp: entry.startTimestamp,
  };
}
