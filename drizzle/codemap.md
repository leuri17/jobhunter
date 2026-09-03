# drizzle/

## Responsibility

Drizzle ORM migration files (SQLite dialect) emitted by `drizzle-kit`. Each `NNNN_*.sql` file is an immutable, ordered schema revision applied sequentially against the SQLite database. `drizzle.config.ts` declares `out: './drizzle'` and `schema: './src/persistence/schema.ts'`, so this folder is the authoritative migration ledger while `src/persistence/schema.ts` is the live TypeScript mirror.

## Design

Migrations are named `NNNN_<slug>.sql` (lexicographic ordinals: `0000_open_white_tiger`, `0001_nebulous_bloodstorm`, `0002_noisy_madame_web`) and separated by `--> statement-breakpoint` markers so `drizzle-kit` can parse each statement independently.

- **0000 — baseline schema** (18 tables): `application_metadata`, `derived_overrides`, `diagnostic_artifacts`, `discovery_errors`, `discovery_events`, `extraction_attempts`, `filter_configuration_versions`, `filter_results`, `jobs`, `openai_request_metadata`, `pipeline_runs`, `profile_conflicts`, `profile_revisions`, `profile_sources`, `profile_versions`, `profile_warnings`, `score_results`, `search_executions`. All use `integer PRIMARY KEY AUTOINCREMENT` for surrogate ids and `text` (ISO-8601) for timestamps.
- **Foreign-key graph** roots in `pipeline_runs`, `jobs`, `profile_versions`, and `filter_configuration_versions`; child tables (`discovery_events`, `extraction_attempts`, `search_executions`, `filter_results`, `score_results`, `diagnostic_artifacts`, `derived_overrides`, `profile_conflicts`, `profile_revisions`, `profile_warnings`) reference these via `ON UPDATE no action ON DELETE no action`.
- **Indexes**: unique constraints on natural keys (`jobs.source_job_id`, `profile_sources.sha256`), composite indexes for hot lookups (`jobs.extraction_status`, `pipeline_runs.status+start_timestamp`, `openai_request_metadata.operation_type+start_timestamp`), and partial unique indexes enforcing singleton-active rows (`filter_configuration_versions` WHERE `active = 1`, `profile_versions` WHERE `status = 'approved' AND active = 1`, `filter_results`/`score_results` WHERE `active = 1`).
- **0001 — partial-index fix**: drops and recreates the partial uniques on `filter_configuration_versions_active_idx` and `profile_versions_active_approved_idx` using the `((1))` constant expression, the SQLite-accepted form for conditional unique constraints.
- **0002 — additive column**: `ALTER TABLE profile_sources ADD COLUMN warnings text NOT NULL DEFAULT '[]'`.

## Flow

`drizzle-kit generate` reads `src/persistence/schema.ts`, diffs against the previous snapshot, and writes a new `NNNN_*.sql` here. At runtime, `src/persistence/migrations.ts` is invoked with the resolved migration list (sorted by ordinal) supplied by `src/persistence/resolve-migrations.ts`, which scans this folder and embeds the SQL. Statements are executed in order inside a transaction; the SQLite `__drizzle_migrations` journal marks each applied revision so already-applied files are skipped on subsequent boots.

## Integration

- **Source of truth**: `src/persistence/schema.ts` — TS table definitions (`sqliteTable`, indexes, foreign keys) that must stay in lock-step with the SQL here.
- **Generator**: `drizzle.config.ts` (`dialect: 'sqlite'`, `strict: true`, `verbose: true`).
- **Consumers**: persistence layer (`src/persistence/*.ts`) using `better-sqlite3`/`drizzle-orm/better-sqlite3`; all pipeline domain tables (`jobs`, `pipeline_runs`, `search_executions`, `discovery_*`, `extraction_attempts`, `filter_results`, `score_results`, `profile_*`) are read/written by the corresponding pipeline stages.
