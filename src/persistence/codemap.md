# src/persistence/

## Responsibility

SQLite persistence layer for the jobhunter monorepo. Owns `better-sqlite3` lifecycle,
drizzle schema definitions, migration execution, transaction primitives, and the typed
error hierarchy surfaced to upper layers. Composed exclusively of stateless modules —
no class instances persist across calls — and re-exports the repository surface from
`repositories/` so callers depend on a single barrel.

## Design

- **Connection factory** (`connection.ts`): `createDatabaseConnection(filePath)` opens
  `better-sqlite3`, sets `foreign_keys = ON`, wraps it with `drizzle(sqlite, { schema })`,
  and returns a `DatabaseConnection` exposing both `db: BetterSQLite3Database<Schema>`
  and the raw `sqlite: BetterSqliteDatabase` for migration introspection.
- **Database bootstrap** (`database.ts`): `initializeDatabase(paths, options)` ensures
  the data directory via `ensureDirectory`, resolves `paths.data.file('jobhunter.sqlite')`,
  creates the connection, and runs migrations in one step. On migration failure the
  connection is closed before re-throwing to avoid leaking handles. Returns a
  `DatabaseHandle` extending `DatabaseConnection` with `filePath` and `report: MigrationReport`.
- **Migrations** (`migrations.ts`): `runMigrations(connection, { migrationsFolder })`
  parses `meta/_journal.json`, snapshots SHA-256 hashes from `__drizzle_migrations`,
  delegates to drizzle's `migrate(...)`, then diffs before/after hashes via
  `hashMigrationFile` to derive which journal entries were newly applied. All failures
  are wrapped as `MigrationError('migration_apply_failed', ...)`.
- **Path resolution** (`resolve-migrations.ts`): `resolveRepoRootForMigrations()`
  computes `<repoRoot>/drizzle` from `import.meta.url` for sidecar migration loaders.
- **Transaction wrapper** (`transactions.ts`): `withTransaction(connection, fn)` is a
  thin synchronous wrapper over `connection.db.transaction`. The `DrizzleTransaction`
  type is extracted via `Parameters<Parameters<...['transaction']>[0]>[0]`. Async
  callbacks are explicitly unsupported — better-sqlite3 rejects them. Multi-repo atomic
  work goes through `Repositories.transact()` instead.
- **Schema** (`schema.ts`): 18 `sqliteTable` exports (`applicationMetadata`,
  `profileSources`, `profileVersions`, `profileRevisions`, `profileConflicts`,
  `profileWarnings`, `derivedOverrides`, `filterConfigurationVersions`, `pipelineRuns`,
  `searchExecutions`, `jobs`, `discoveryEvents`, `discoveryErrors`, `extractionAttempts`,
  `filterResults`, `scoreResults`, `openaiRequestMetadata`, `diagnosticArtifacts`)
  with explicit indexes/uniques (e.g. `profile_sources_sha256_idx`,
  `profile_versions_active_approved_idx` partial unique). Timestamps are stored as TEXT.
- **Identifier system** (`identifiers.ts` + `identifier-errors.ts`): Centralizes
  kind-prefixed IDs (`IdentifierKind` union: `job`, `run`, `profile`, `source`, `search`,
  `filters`, `extraction`, `score`, `discovery_error`). `formatId` builds, `resolveId`
  parses a known kind, `parsePrefixedId` auto-detects kind and validates against
  `expectedKind`. `resolveJobIdentifier` accepts either `job_<n>` or a numeric LinkedIn
  `sourceJobId`. All failures throw `InvalidIdentifierError` (exit code `InvalidUsage`).
- **Error taxonomy** (`errors.ts`, `repository-errors.ts`): `DatabaseError` and
  `MigrationError` use `ExitCode.Fatal`; `InvalidIdentifierError`, `RecordNotFoundError`
  use `ExitCode.InvalidUsage`; `DuplicateSha256Error` is `Fatal` and signals that
  `ProfileSourceRepository.insert` hit a sha256 collision (deduplication is owned by
  `ProfileImportService` upstream).
- **Barrel** (`index.ts`): Re-exports `DatabaseError`, `MigrationError`,
  `createDatabaseConnection`, `runMigrations`, `initializeDatabase`,
  `resolveRepoRootForMigrations`, `schema`, the identifier API, the repository surface
  (`Repositories`, `createRepositories`, every `*Repository` class, `RepositoryContext`,
  `DrizzleDB`), `withTransaction`, and `RecordNotFoundError` / `DuplicateSha256Error`.

## Flow

1. Caller resolves `PlatformPaths` and a `migrationsFolder` (typically via
   `resolveRepoRootForMigrations()`).
2. `initializeDatabase(paths, { migrationsFolder })` ensures the data dir, opens the
   SQLite file through `createDatabaseConnection`, and invokes `runMigrations`.
3. `runMigrations` reads the drizzle journal, snapshots applied hashes, applies pending
   migrations, and computes the set of newly applied tags for the `MigrationReport`.
4. The resulting `DatabaseHandle` is passed to `createRepositories(connection)` which
   constructs typed repositories bound to `connection.db`.
5. Service-layer callers use `Repositories` for normal reads/writes and `withTransaction`
   (or `Repositories.transact()`) when multiple repositories must commit atomically.
6. Identifier strings flow through `formatId` (outbound) and `resolveId` / `parsePrefixedId`
   / `resolveJobIdentifier` (inbound) so prefix discipline is enforced at module
   boundaries.

## Integration

- **Direct consumers**: `src/init/init-service.ts` calls `initializeDatabase` to
  bootstrap the handle; `src/persistence/repositories/index.ts` consumes `DatabaseConnection`,
  `schema`, `withTransaction`, and the error classes to build per-table repository classes.
- **Repository consumers (via `Repositories` / row types)**:
  `src/profile/{importer,extraction-service,approval-service,editing-service,review-service,rejection-service,identifier-resolution}.ts`,
  `src/pipeline/orchestrator.ts`, `src/scoring/service.ts`,
  `src/filter/{service,evaluate,configure-service}.ts`,
  `src/linkedin/{discovery-service,extraction/service,state,log}.ts`,
  `src/diagnostics/{manager,manager-default}.ts`, `src/reevaluation/{service,fingerprint}.ts`,
  `src/inspection/services/{runs-list-service,runs-show-service,jobs-list-service,jobs-show-service}.ts`,
  `src/search/matrix.ts`. Several also import schema tables (`profileVersions`,
  `scoreResults`, `jobs`, `discoveryEvents`, `extractionAttempts`) for direct queries.
- **Identifier consumers**: `profile/identifier-resolution.ts` uses `parsePrefixedId`;
  `inspection/services/runs-show-service.ts` uses `parsePrefixedId`;
  `inspection/services/jobs-show-service.ts` uses `resolveJobIdentifier`.
- **Migration source**: the `drizzle/` folder at the repo root is the canonical
  migration directory; `resolveRepoRootForMigrations()` locates it for external
  loaders (e.g. sidecars).
- **Cross-cutting**: every error inherits from `ApplicationError` (`src/errors/`)
  and re-exports `ExitCode`, so process-level error handling stays uniform.
