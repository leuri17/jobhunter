# src/search/

## Responsibility

Search query construction and result preparation for LinkedIn job discovery. Owns the full pipeline from user-supplied preferences (queries, locations, date filter, workplace types) through to the canonical URL matrix that downstream fetcher/extractor stages consume. Encapsulates LinkedIn-specific URL shape, query/location normalization, and label enums (Zod-validated) so the rest of the system treats search config as pure data.

## Design

- **Query matrix pattern**: Cartesian product of deduped `searchQueries × locations`, joined with shared `datePosted` and `workplaceTypes` filters. Each cell becomes a `SearchMatrixEntry` carrying `query`, `locationName`, `geoId`, `generatedUrl`, `startTimestamp`.
- **URL builder/parser pair**: `buildLinkedInSearchURL` composes `URLSearchParams` (`f_TPR`, `f_WT`, `geoId`, `keywords`, `sortBy=DD`) against the `LINKEDIN_JOBS_SEARCH_BASE` constant; `parseLinkedInJobsSearchURL` is the strict inverse, validating scheme/host/path and extracting `geoId`.
- **Normalization as a value transform**: `dedupeQueries` collapses whitespace and case; `dedupeLocationsByGeoId` keys on `geoId` and re-canonicalizes names. Both are pure and idempotent, suitable for re-running on persisted config.
- **Prompt seam**: `SearchPrompts` interface injects interactive I/O (queries, date, workplace types, location URLs, confirmation) so `ConfigureSearchService` is testable; `createFailingPrompts` is the test default. No default prompt adapter ships from this package — the desktop sidecar owns wiring.
- **Error taxonomy**: `SearchConfigError` (invalid usage), `LinkedInURLParseError` (subclass carrying `url`+`reason` metadata), `SearchCancelledError` (user cancellation exit code).

## Flow

1. `ConfigureSearchService.run()` orchestrates `SearchPrompts.askSearchQueries` → `askWorkplaceTypes` → `askDatePosted` → `askLocationURLs`, normalizing each step via `dedupeQueries` and `dedupeLocationsByGeoId`. Empty result sets raise `SearchConfigError`.
2. `prompts.showPreview(preview, matrixSize)` displays the proposed configuration; `prompts.askConfirmation` finalizes or raises `SearchCancelledError`.
3. `generateSearchMatrix` iterates `queries × locations`, calling `buildLinkedInSearchURL` per cell to produce the readonly `SearchMatrixEntry[]`.
4. Each entry is converted via `matrixEntryToSearchExecutionInsert(pipelineRunId, entry)` to a `SearchExecutionInsert` for persistence.
5. Persisted configs rehydrate through `normalizePersistedSearchConfig`, which validates `datePosted` against `DatePostedSecondsSchema` literals and filters `workplaceTypes` against `WorkplaceTypeSchema` before re-dedup.

## Integration

- **Consumer**: `src/pipeline/orchestrator.ts` imports `generateSearchMatrix` from `../search/index.js` and invokes it with `searchConfiguration` plus `startTimestamp`, then maps entries through `matrixEntryToSearchExecutionInsert` for `SearchExecution` persistence before handing off to the fetcher.
- **Downstream**: `src/linkedin/extraction/` consumes the generated `searchUrl` from each `SearchExecution` row (via `detail-url.ts`, `panel-parser.ts`) to fetch and parse individual job postings.
- **Surface**: All public API is re-exported from `index.ts`; consumers should import only from the barrel. The `SearchPrompts` interface is implemented by the desktop sidecar.
