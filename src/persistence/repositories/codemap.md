# src/persistence/repositories/

## Responsibility

Concrete SQLite repository implementations for every domain entity in the
job-search pipeline: profile sources + versioned profiles, filter configurations,
pipeline runs + search executions, jobs + discovery events/errors + extraction
attempts, filter results, score results, OpenAI request metadata, diagnostic
artifacts, and application-level metadata key/value rows. One file per
entity, plus a shared codec layer and a `Repositories` facade that composes
them.

## Design

- **Repository pattern**: each entity exposes a class (`JobRepository`,
  `ProfileVersionRepository`, `PipelineRunRepository`, `FilterResultRepository`,
  `ScoreResultRepository`, `FilterConfigurationRepository`,
  `ProfileSourceRepository`, `OpenAIRequestMetadataRepository`,
  `DiagnosticArtifactRepository`, `ApplicationMetadataRepository`) constructed
  against a `RepositoryContext { db: DrizzleDB }` where
  `DrizzleDB = BetterSQLite3Database<Schema>`.
- **Drizzle ORM over better-sqlite3**: typed queries built from the schema in
  `../schema.ts` (`jobs`, `discoveryEvents`, `discoveryErrors`,
  `extractionAttempts`, `filterResults`, `scoreResults`, `pipelineRuns`,
  `searchExecutions`, `profileVersions`, `profileRevisions`, `profileConflicts`,
  `profileWarnings`, `derivedOverrides`, `profileSources`,
  `filterConfigurationVersions`, `openaiRequestMetadata`, `diagnosticArtifacts`,
  `applicationMetadata`). Helpers `eq / and / or / gte / inArray / like /
  asc / desc` from `drizzle-orm`.
- **Codec layer (`codecs.ts`)**: `jsonColumn<T>(zodSchema)` produces a
  `JsonColumnCodec<T>` with `encode / decode / decodeRequired`. Decoded JSON is
  Zod-validated; failures throw `DatabaseError('persisted_json_invalid', ...)`
  or `DatabaseError('persisted_json_missing', ...)` from the parent layer.
  Re-exports `z` for repositories that build inline schemas.
- **Row shapes are `readonly`**: every repository returns `T | null` /
  `readonly T[]` so callers cannot mutate returned data.
- **Common error types**: `RecordNotFoundError` (`getById` on
  `ProfileVersionRepository`), `DuplicateSha256Error` (translates the SQLite
  `UNIQUE constraint failed` from `profileSources.sha256`), `DatabaseError`
  (codec failures).
- **Facade (`index.ts`)**: `Repositories` composes all 10 repositories and
  exposes the underlying `db` handle plus `transact(fn)` which opens a sync
  better-sqlite3 savepoint and re-binds every sub-repository to the
  transaction's `tx` handle. `createRepositories(connection)` is the DI entry
  point.

## Flow

1. Service layer receives `Repositories` via constructor injection and calls
   e.g. `repos.jobs.recordNewJob({ job, discoveryEvent, extractionAttempt })`.
2. The method opens `this.ctx.db.transaction((tx) => { ... })` when it must
   atomically combine several writes (insert job + discovery event +
   optional extraction attempt; activate filter/score result; approve a
   profile version; deactivate-then-activate filter configuration).
3. Drizzle `insert(...).returning({ id }).all()` / `select().from(...).where(...)`
   runs against `tx` (or `db` for single-statement reads).
4. JSON columns are `unknownJson.encode(value)` on write and
   `unknownJson.decodeRequired` / `unknownJson.decode` on read; non-JSON
   columns are validated by inline Zod enums (e.g. `sourceType`,
   `textExtractionStatus`).
5. **Active-row caching**: filter results and score results use a single
   `active` boolean per `(jobId, fingerprint)`; `activateResult` flips the
   previous active row to `false` then inserts the new row inside one
   transaction. `invalidateByProfileVersion`,
   `invalidateByFilterConfigVersion`, `invalidateActiveByJob` flip matching
   active rows to `false` and return the count flipped; rows are never
   deleted, preserving the audit trail.
6. **SHA-256 deduplication**: `ProfileSourceRepository.insert` is strict
  INSERT-OR-ERROR — dedup is owned upstream by `ProfileImportService` via
  `findBySha256`; bypassing it raises `DuplicateSha256Error`.
7. Sync `db.transaction` callbacks are mandatory because better-sqlite3
   rejects Promise returns; async sub-repository methods are awaited *after*
   the surrounding transaction returns.

## Integration

- `src/pipeline/orchestrator.ts` — uses `pipelineRuns`, `jobs`,
  `filterResults`, `scoreResults`, `openaiMetadata`.
- `src/linkedin/discovery-service.ts`, `src/linkedin/extraction/service.ts` —
  use `jobs`, `pipelineRuns`, `diagnostics`, `openaiMetadata`.
- `src/filter/service.ts`, `src/filter/configure-service.ts` — use
  `filterConfigurations`, `filterResults`, `jobs`, `profileVersions`.
- `src/scoring/service.ts` — uses `scoreResults`, `jobs`, `filterResults`,
  `openaiMetadata`.
- `src/profile/{importer,extraction-service,approval-service,editing-service,
  review-service,rejection-service,identifier-resolution}.ts` — full profile
  pipeline, including `ProfileApprovalService.approve` which invalidates stale
  `filterResults` via `Repositories.transact`.
- `src/reevaluation/service.ts` — uses `jobs`, `filterConfigurations`,
  `filterResults`, `profileVersions`, `pipelineRuns`.
- `src/diagnostics/manager.ts`, `src/diagnostics/manager-default.ts` — use
  `diagnostics`.
- `src/inspection/services/{jobs-list,jobs-show,runs-list,runs-show}-service.ts`
  — read-only inspection; `JobsListService` leans on `JobRepository.listByState`
  + state-specific ID helpers, `RunsShowService` on `PipelineRunRepository.
  findWithDetails`.
- `src/init/init-service.ts` — uses `applicationMetadata` for the
  `initialized_at` marker.
- Re-exported from `src/persistence/index.ts` and instantiated by
  `createRepositories(connection)`; raw repository classes are also exported
  for tests that prefer direct instantiation.