# TASK-003 Implementation Plan — SQLite Connection, Drizzle Schema, Migrations, and Initialization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the SQLite persistence foundation — a foreign-key-enforced database at the resolved data path, with a reviewed Drizzle schema for every MVP entity, committed generated migrations, and a transactional initialization lifecycle that closes resources on failure.

**Architecture:** Use `better-sqlite3` (synchronous, prebuilt for Node 24) as the SQLite driver and Drizzle ORM 0.45 for type-safe queries. `drizzle-kit` generates SQL migrations from the TypeScript schema; those SQL files and the snapshot journal are committed to `drizzle/`. At runtime, a `createDatabaseConnection` factory opens the database file, sets `PRAGMA foreign_keys = ON`, and returns a `Drizzle` instance with a typed `close()` method. A separate `runMigrations` function applies pending migrations transactionally using Drizzle's built-in migrator. `initializeDatabase` composes path resolution, directory creation, connection opening, and migration application, and guarantees that the connection is closed if any step throws.

**Tech Stack:**

- `better-sqlite3@^13` — Node 24.18.0 prebuilt binaries, synchronous API
- `drizzle-orm@^0.45` — TypeScript ESM, dual CJS/ESM entry points
- `drizzle-kit@^0.31` (dev) — migration generator, TypeScript config support
- `tsx@^4.23` (already installed) — loads `drizzle.config.ts` and runs local scripts

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No other LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing.
- **Domain boundaries:** Domain code must not import Drizzle, better-sqlite3, Pino, Commander, Inquirer, or Playwright. TASK-003 introduces a `src/persistence/` module that owns all DB access — domain code never sees the Drizzle types directly in later tasks.
- **Validation:** Zod is the parser for all JSON columns and structured outputs. TASK-003 stores raw TEXT and documents the contract; TASK-004 will add Zod parsers for each table when repositories are introduced.
- **Paths:** Use `paths.data.file('jobhunter.sqlite')` from TASK-002's `resolvePlatformPaths`. Never fall back to the current working directory.
- **Errors:** Add typed errors (`DatabaseError`, `MigrationError`) extending `ApplicationError` from TASK-002. Do not call `process.exit` from persistence code; map to exit codes at the CLI boundary.
- **Migrations:** Every generated SQL file must be committed. Migration application must be transactional. Re-running initialization on a migrated database must be idempotent and never destructive.
- **History preservation:** Tables use integer primary keys; CLI identifier prefixes are a presentation concern handled by TASK-004. Historical rows must coexist; "current" rows are selected by `active` flag plus fingerprint or status filters.
- **Tests:** Vitest. Use `:memory:` or temporary file databases for every persistence test — never the user's runtime database. Live LinkedIn tests stay excluded from CI.
- **No secrets:** Do not log API keys, raw prompts, or raw model responses in tests or runtime code.

## File Structure

```
src/
  persistence/
    errors.ts          # DatabaseError, MigrationError typed errors (Task 2)
    schema.ts          # Drizzle sqliteTable definitions for 18 MVP entities (Task 3)
    connection.ts      # createDatabaseConnection factory (Task 5)
    migrations.ts      # runMigrations transactional application (Task 6)
    database.ts        # initializeDatabase lifecycle orchestrator (Task 7)
    index.ts           # Public re-exports for downstream tasks (Task 7)
drizzle/
  0000_<name>.sql      # Generated initial migration committed (Task 4)
  meta/
    _journal.json      # Drizzle Kit migration journal committed
    0000_snapshot.json # Drizzle Kit schema snapshot committed
drizzle.config.ts      # drizzle-kit generator config (Task 1)
tests/
  persistence/
    errors.test.ts
    schema.test.ts
    connection.test.ts
    migrations.test.ts
    database.test.ts
```

Files change together by responsibility. `errors.ts` is foundation; `schema.ts` is the source of truth for `drizzle-kit` generation; `connection.ts`/`migrations.ts`/`database.ts` build on it. The committed `drizzle/` folder is regenerated output that mirrors the schema.

---

### Task 1: Add Drizzle dependencies and configure drizzle-kit

**Files:**

- Modify: `package.json` (add direct deps + scripts)
- Create: `drizzle.config.ts`
- Modify: `eslint.config.mjs` (ignore generated `drizzle/` folder)
- Modify: `.gitignore` (un-ignore the generated `drizzle/` folder so migrations are tracked)

**Interfaces:**

- Consumes: nothing new.
- Produces: `pnpm drizzle-kit generate --config drizzle.config.ts` becomes a runnable script; `better-sqlite3`, `drizzle-orm`, and `drizzle-kit` are pinned in `package.json`.

- [ ] **Step 1: Update `package.json` scripts and dependencies**

Open `package.json` and add the new direct dependencies and a `db:generate` script.

Add to the `dependencies` block (keep existing entries; preserve alphabetical order):

```json
    "better-sqlite3": "13.0.3",
    "drizzle-orm": "0.45.2"
```

Add to the `devDependencies` block:

```json
    "drizzle-kit": "0.31.10"
```

Add to the `scripts` block (after `test:live:list`):

```json
    "db:generate": "drizzle-kit generate --config drizzle.config.ts"
```

Confirm `engines.node`, `packageManager`, and `"type": "module"` are unchanged.

- [ ] **Step 2: Create `drizzle.config.ts`**

Create the file at the repository root:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/persistence/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  verbose: true,
  strict: true,
});
```

The `strict: true` flag makes `drizzle-kit` reject any schema definition that would generate unsafe operations. `verbose: true` prints the generated statements to the console for the manual review in Task 4.

- [ ] **Step 3: Update `.gitignore` and ESLint ignores**

In `.gitignore`, the line `dist/` already ignores `dist/` but does NOT ignore `drizzle/`. We want `drizzle/` to be tracked (committing migrations is a SPEC requirement), so no change is needed here.

In `eslint.config.mjs`, the existing `globalIgnores` already includes `dist/` and `docs/`. Add `drizzle/` to the same array so generated SQL snapshots are not linted:

```js
      'drizzle/**',
```

(Keep all existing entries; this is an additive change.)

- [ ] **Step 4: Install dependencies**

Run:

```bash
pnpm install --frozen-lockfile=false
```

Expected: `better-sqlite3@13.0.3`, `drizzle-orm@0.45.2`, and `drizzle-kit@0.31.10` are added to `node_modules`. The lockfile updates.

If the install fails because `better-sqlite3` cannot download a prebuilt binary for the current platform, capture the failure in a follow-up note. The package metadata advertises prebuilt binaries for `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64` (Node 24), so this should not occur on supported platforms.

- [ ] **Step 5: Verify the dependency surface**

Run:

```bash
pnpm typecheck
```

Expected: exit 0. The new packages have built-in TypeScript types so no `@types/better-sqlite3` is required.

Run:

```bash
pnpm drizzle-kit generate --config drizzle.config.ts --name initial_empty
```

Expected: drizzle-kit prints `No schema changes detected` (or equivalent) because `src/persistence/schema.ts` does not exist yet. The command exits 0 — this is just a smoke check that the config loads.

If the config cannot be loaded, double-check that `drizzle.config.ts` uses the default export and that `tsx` is available (it is already a dev dependency).

Delete any generated empty migration output (`drizzle/0000_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`) so it is not committed accidentally.

- [ ] **Step 6: Commit**

Stage and commit only the four changed files plus the updated lockfile:

```bash
git add package.json pnpm-lock.yaml drizzle.config.ts eslint.config.mjs
git commit -m "chore(persistence): add drizzle-orm, drizzle-kit, and better-sqlite3 dependencies"
```

Do NOT stage any `drizzle/` files yet — they will be created in Task 4.

---

### Task 2: Add typed database and migration errors

**Files:**

- Create: `src/persistence/errors.ts`
- Create: `tests/persistence/errors.test.ts`

**Interfaces:**

- Consumes: `ApplicationError` from `src/errors/application-error.ts` (TASK-002).
- Produces: `DatabaseError` (exit code `Fatal` / 1) and `MigrationError` (exit code `Fatal` / 1) classes that other persistence modules throw.

Both errors extend `ApplicationError` and use the `Fatal` exit code because the user cannot recover from a corrupted or non-writable database. Downstream tasks can wrap them in more specific errors (e.g. `MissingRequired`) if product behavior warrants a different code.

- [ ] **Step 1: Write the failing test**

Create `tests/persistence/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  DatabaseError,
  ExitCode,
  MigrationError,
} from '../../src/persistence/errors.js';

describe('persistence errors', () => {
  it('exports typed database and migration errors extending ApplicationError', () => {
    expect(DatabaseError.prototype).toBeInstanceOf(ApplicationError);
    expect(MigrationError.prototype).toBeInstanceOf(ApplicationError);
  });

  it('maps DatabaseError to the Fatal exit code by default', () => {
    const cause = new Error('disk full');
    const error = new DatabaseError('disk_write_failed', 'Cannot write to database.', {
      path: '/tmp/jobhunter.sqlite',
    }, cause);
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.code).toBe('disk_write_failed');
    expect(error.metadata).toEqual({ path: '/tmp/jobhunter.sqlite' });
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('DatabaseError');
  });

  it('maps MigrationError to the Fatal exit code by default', () => {
    const error = new MigrationError('migration_apply_failed', 'Migration 0001 failed.', {
      migration: '0001_add_profiles',
    });
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.code).toBe('migration_apply_failed');
    expect(error.metadata).toEqual({ migration: '0001_add_profiles' });
    expect(error.name).toBe('MigrationError');
  });

  it('serializes errors with toJSON() matching the ApplicationError contract', () => {
    const error = new MigrationError('migration_apply_failed', 'Boom.');
    const json = error.toJSON();
    expect(json).toEqual({
      name: 'MigrationError',
      code: 'migration_apply_failed',
      message: 'Boom.',
      exitCode: ExitCode.Fatal,
      metadata: {},
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/errors.test.ts
```

Expected: FAIL with "Cannot find module" or similar because `src/persistence/errors.ts` does not exist.

- [ ] **Step 3: Implement `src/persistence/errors.ts`**

Create the file:

```ts
import { ApplicationError, ExitCode } from '../errors/application-error.js';

export class DatabaseError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

export class MigrationError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

export { ApplicationError, ExitCode };
```

The re-exports let downstream tests and consumers pull `ApplicationError` and `ExitCode` from a single persistence entry point without crossing two module boundaries.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/errors.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/errors.ts tests/persistence/errors.test.ts
git commit -m "feat(persistence): add typed database and migration errors"
```

---

### Task 3: Define the Drizzle schema for MVP entities

**Files:**

- Create: `src/persistence/schema.ts`
- Create: `tests/persistence/schema.test.ts`

**Interfaces:**

- Consumes: `sql` template tag from `drizzle-orm`, table builders from `drizzle-orm/sqlite-core`.
- Produces: Named `sqliteTable` exports for all 18 entities listed in `SPEC.md §23.1`. Each table uses integer primary keys, ISO 8601 TEXT timestamps, JSON-encoded TEXT for structured payloads, and inline foreign-key references via Drizzle's `.references()`. Indexes and partial unique indexes are declared in the table's second argument.

Naming conventions locked in by this task (no later renaming without a migration):

- Primary keys: `id INTEGER PRIMARY KEY AUTOINCREMENT` named `id`.
- Timestamps: snake_case `created_at`, `updated_at`, `import_timestamp`, etc. Always TEXT ISO 8601.
- Booleans: `integer(...).notNull()` with `{ mode: 'boolean' }` so TypeScript sees `boolean` and SQLite stores `0`/`1`.
- Enums: `text(... , { enum: ['a', 'b'] })` — Drizzle validates at compile time.
- JSON payloads: `text('field_json').notNull()` (or nullable). Suffix `_json` is mandatory. Downstream Zod parsers will decode these strings.
- Foreign-key columns: `<target_singular>_id` named with the same convention (`profile_version_id`, `pipeline_run_id`, etc.).

The 18 entities and their authoritative field sets follow.

- [ ] **Step 1: Write the failing test**

Create `tests/persistence/schema.test.ts`. The test asserts every entity, every required column, every foreign key target, and every index exists. It uses Drizzle's introspection helpers to walk the schema module:

```ts
import { sql } from 'drizzle-orm';
import { getTableConfig, getTableName, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/persistence/schema.js';

const EXPECTED_TABLES = [
  'application_metadata',
  'profile_sources',
  'profile_versions',
  'profile_revisions',
  'profile_conflicts',
  'profile_warnings',
  'derived_overrides',
  'filter_configuration_versions',
  'pipeline_runs',
  'search_executions',
  'jobs',
  'discovery_events',
  'discovery_errors',
  'extraction_attempts',
  'filter_results',
  'score_results',
  'openai_request_metadata',
  'diagnostic_artifacts',
] as const;

function table(name: (typeof EXPECTED_TABLES)[number]): SQLiteTable {
  const exported = (schema as Record<string, unknown>)[name];
  if (exported === undefined || typeof exported !== 'object') {
    throw new Error(`Schema export "${name}" is missing or not a table.`);
  }
  return exported as SQLiteTable;
}

describe('persistence schema', () => {
  it('exports a table for every required MVP entity', () => {
    const exportedNames = new Set<string>(
      Object.values(schema).map((value) => {
        if (value === null || typeof value !== 'object' || !('getSQL' in value)) return '';
        return getTableName(value as SQLiteTable);
      }),
    );
    for (const expected of EXPECTED_TABLES) {
      expect(exportedNames.has(expected), `missing table ${expected}`).toBe(true);
    }
  });

  it('gives every table an integer primary key named "id"', () => {
    for (const name of EXPECTED_TABLES) {
      const config = getTableConfig(table(name));
      const idColumn = config.columns.find((c) => c.name === 'id');
      expect(idColumn, `${name} missing id column`).toBeDefined();
      expect(idColumn?.dataType, `${name}.id must be integer`).toBe('number');
      expect(idColumn?.primary, `${name}.id must be primary`).toBe(true);
      expect(idColumn?.autoIncrement, `${name}.id must be autoincrement`).toBe(true);
    }
  });

  it('enforces one active approved profile version via a partial unique index', () => {
    const config = getTableConfig(table('profile_versions'));
    const partial = config.uniqueConstraints.find((c) =>
      c.name === 'profile_versions_active_approved_idx',
    );
    expect(partial, 'partial unique index must exist').toBeDefined();
    expect(String(partial?.where ?? '')).toContain(sql`status = 'approved'`.queryChunks[0].toString());
  });

  it('enforces job deduplication by source_job_id', () => {
    const config = getTableConfig(table('jobs'));
    const unique = config.uniqueConstraints.find((c) =>
      c.name === 'jobs_source_job_id_idx',
    );
    expect(unique, 'unique index on jobs.source_job_id must exist').toBeDefined();
  });

  it('declares foreign-key relationships from extraction_attempts to job/run/search', () => {
    const config = getTableConfig(table('extraction_attempts'));
    const fkTargets = config.foreignKeys.map((fk) => ({
      columns: fk.columns.map((c) => c.name),
      referenceColumns: fk.foreignColumns.map((c) => c.name),
      referenceTable: getTableName(fk.reference()),
    }));
    expect(fkTargets).toContainEqual({
      columns: ['job_id'],
      referenceColumns: ['id'],
      referenceTable: 'jobs',
    });
    expect(fkTargets).toContainEqual({
      columns: ['pipeline_run_id'],
      referenceColumns: ['id'],
      referenceTable: 'pipeline_runs',
    });
    expect(fkTargets).toContainEqual({
      columns: ['search_execution_id'],
      referenceColumns: ['id'],
      referenceTable: 'search_executions',
    });
  });
});
```

The test is intentionally narrow — it asserts the structural contracts that downstream tasks rely on (every entity present, integer PKs, partial unique index for active profile, unique index on job deduplication, FK constraints wired up). More granular column-by-column assertions live in the integration tests in Task 6 once we can introspect a migrated SQLite file.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/schema.test.ts
```

Expected: FAIL — `src/persistence/schema.ts` does not exist.

- [ ] **Step 3: Implement `src/persistence/schema.ts`**

Create the file. The complete content follows; copy it verbatim:

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// 1. application_metadata ----------------------------------------------------
// Stores singleton key/value rows (e.g. current schema version, install timestamp).
export const applicationMetadata = sqliteTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 2. profile_sources ---------------------------------------------------------
// Immutable copy of every imported CV file. Deduplication uses sha256.
export const profileSources = sqliteTable(
  'profile_sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceType: text('source_type', { enum: ['pdf', 'markdown', 'plain_text'] }).notNull(),
    originalFilename: text('original_filename').notNull(),
    originalAbsolutePath: text('original_absolute_path').notNull(),
    storedPath: text('stored_path').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    sha256: text('sha256').notNull(),
    importTimestamp: text('import_timestamp').notNull(),
    extractedTextHash: text('extracted_text_hash'),
    textExtractionStatus: text('text_extraction_status', {
      enum: ['pending', 'success', 'failed'],
    }).notNull(),
    textExtractionMessage: text('text_extraction_message'),
  },
  (t) => ({
    sha256Unique: uniqueIndex('profile_sources_sha256_idx').on(t.sha256),
  }),
);

// 3. profile_versions -------------------------------------------------------
// One row per profile draft, approved version, or historical snapshot.
// `active` is a logical flag for the single currently-approved profile.
export const profileVersions = sqliteTable(
  'profile_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    status: text('status', {
      enum: ['draft', 'approved', 'rejected', 'superseded'],
    }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
    contentHash: text('content_hash').notNull(),
    extractionFingerprint: text('extraction_fingerprint').notNull(),
    sourceIdsJson: text('source_ids_json').notNull(),
    profileJson: text('profile_json').notNull(),
    model: text('model'),
    reasoningEffort: text('reasoning_effort'),
    promptVersion: text('prompt_version'),
    structuredOutputSchemaVersion: integer('structured_output_schema_version'),
    extractorImplementationVersion: text('extractor_implementation_version'),
    validationWarningsJson: text('validation_warnings_json'),
    unresolvedConflictsJson: text('unresolved_conflicts_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    approvedAt: text('approved_at'),
    supersededAt: text('superseded_at'),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    extractionFingerprintIdx: index('profile_versions_extraction_fingerprint_idx').on(
      t.extractionFingerprint,
    ),
    contentHashIdx: index('profile_versions_content_hash_idx').on(t.contentHash),
    statusIdx: index('profile_versions_status_idx').on(t.status),
    activeApprovedUnique: uniqueIndex('profile_versions_active_approved_idx')
      .on(t.id)
      .where(sql`status = 'approved' AND active = 1`),
  }),
);

// 4. profile_revisions ------------------------------------------------------
// Field-level edit history for a single profile_version. Resolution events
// (conflict selection, manual entry) are recorded as a "source" string.
export const profileRevisions = sqliteTable(
  'profile_revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    revisionTimestamp: text('revision_timestamp').notNull(),
    source: text('source', {
      enum: ['openai', 'user', 'conflict_resolution', 'override'],
    }).notNull(),
    fieldPath: text('field_path').notNull(),
    previousValueJson: text('previous_value_json'),
    newValueJson: text('new_value_json'),
    note: text('note'),
  },
  (t) => ({
    profileVersionIdx: index('profile_revisions_profile_version_id_idx').on(t.profileVersionId),
  }),
);

// 5. profile_conflicts ------------------------------------------------------
// Unresolved or resolved conflicts surfaced by multi-source merging.
export const profileConflicts = sqliteTable(
  'profile_conflicts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    conflictType: text('conflict_type').notNull(),
    affectedField: text('affected_field').notNull(),
    valueSourceAJson: text('value_source_a_json'),
    valueSourceBJson: text('value_source_b_json'),
    sourceReferencesJson: text('source_references_json').notNull(),
    provisionalValueJson: text('provisional_value_json'),
    explanation: text('explanation'),
    resolutionStatus: text('resolution_status', {
      enum: ['unresolved', 'resolved', 'cleared'],
    }).notNull(),
    resolvedAt: text('resolved_at'),
    resolvedValueJson: text('resolved_value_json'),
  },
  (t) => ({
    profileVersionIdx: index('profile_conflicts_profile_version_id_idx').on(t.profileVersionId),
  }),
);

// 6. profile_warnings -------------------------------------------------------
// Non-blocking warnings attached to a profile version.
export const profileWarnings = sqliteTable(
  'profile_warnings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    severity: text('severity', { enum: ['blocking_conflict', 'warning'] }).notNull(),
    warningType: text('warning_type').notNull(),
    fieldPath: text('field_path'),
    message: text('message').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    profileVersionIdx: index('profile_warnings_profile_version_id_idx').on(t.profileVersionId),
  }),
);

// 7. derived_overrides ------------------------------------------------------
// Manual overrides for derived fields (likelySeniority, primaryRoles, etc).
export const derivedOverrides = sqliteTable(
  'derived_overrides',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileVersionId: integer('profile_version_id')
      .notNull()
      .references(() => profileVersions.id),
    derivedField: text('derived_field', {
      enum: ['likelySeniority', 'primaryRoles', 'primaryDomains', 'strongestSkills'],
    }).notNull(),
    overrideActive: integer('override_active', { mode: 'boolean' }).notNull(),
    overrideValueJson: text('override_value_json'),
    generatedValueJson: text('generated_value_json'),
    generatedAt: text('generated_at'),
    overriddenAt: text('overridden_at'),
  },
  (t) => ({
    profileVersionFieldUnique: uniqueIndex(
      'derived_overrides_profile_version_field_idx',
    ).on(t.profileVersionId, t.derivedField),
  }),
);

// 8. filter_configuration_versions -----------------------------------------
// Immutable filter configuration snapshots; only one row is `active`.
export const filterConfigurationVersions = sqliteTable(
  'filter_configuration_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    schemaVersion: integer('schema_version').notNull(),
    contentHash: text('content_hash').notNull(),
    configJson: text('config_json').notNull(),
    createdAt: text('created_at').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    contentHashIdx: index('filter_configuration_versions_content_hash_idx').on(t.contentHash),
    activeUnique: uniqueIndex('filter_configuration_versions_active_idx')
      .on(t.id)
      .where(sql`active = 1`),
  }),
);

// 9. pipeline_runs ---------------------------------------------------------
// One row per `jobhunter run` invocation. Counts are denormalized for inspection.
export const pipelineRuns = sqliteTable(
  'pipeline_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    status: text('status', {
      enum: [
        'running',
        'cancelling',
        'completed',
        'completed_with_errors',
        'failed',
        'cancelled',
      ],
    }).notNull(),
    startTimestamp: text('start_timestamp').notNull(),
    endTimestamp: text('end_timestamp'),
    configSnapshotJson: text('config_snapshot_json').notNull(),
    configSchemaVersion: integer('config_schema_version').notNull(),
    configHash: text('config_hash').notNull(),
    applicationVersion: text('application_version').notNull(),
    profileVersionId: integer('profile_version_id').references(() => profileVersions.id),
    filterConfigVersionId: integer('filter_config_version_id').references(
      () => filterConfigurationVersions.id,
    ),
    searchesPlanned: integer('searches_planned').notNull().default(0),
    searchesAttempted: integer('searches_attempted').notNull().default(0),
    searchesCompleted: integer('searches_completed').notNull().default(0),
    searchErrorsJson: text('search_errors_json'),
    jobsDiscovered: integer('jobs_discovered').notNull().default(0),
    newCompleteJobs: integer('new_complete_jobs').notNull().default(0),
    existingCompleteJobsSkipped: integer('existing_complete_jobs_skipped').notNull().default(0),
    existingPartialJobsSkipped: integer('existing_partial_jobs_skipped').notNull().default(0),
    newPartialJobs: integer('new_partial_jobs').notNull().default(0),
    failedExtractions: integer('failed_extractions').notNull().default(0),
    jobsAccepted: integer('jobs_accepted').notNull().default(0),
    jobsRejected: integer('jobs_rejected').notNull().default(0),
    filterErrors: integer('filter_errors').notNull().default(0),
    jobsScored: integer('jobs_scored').notNull().default(0),
    scoresReused: integer('scores_reused').notNull().default(0),
    scoringErrors: integer('scoring_errors').notNull().default(0),
    scoringDeclinedByUser: integer('scoring_declined_by_user', { mode: 'boolean' })
      .notNull()
      .default(false),
    cancellationReason: text('cancellation_reason'),
  },
  (t) => ({
    statusStartIdx: index('pipeline_runs_status_start_idx').on(t.status, t.startTimestamp),
  }),
);

// 10. search_executions ----------------------------------------------------
// One row per generated query/location pair within a pipeline run.
export const searchExecutions = sqliteTable(
  'search_executions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchQuery: text('search_query').notNull(),
    locationName: text('location_name').notNull(),
    geoId: text('geo_id').notNull(),
    generatedUrl: text('generated_url').notNull(),
    startTimestamp: text('start_timestamp').notNull(),
    endTimestamp: text('end_timestamp'),
    finalStatus: text('final_status', {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull(),
    jobsDiscovered: integer('jobs_discovered').notNull().default(0),
    newJobs: integer('new_jobs').notNull().default(0),
    existingJobs: integer('existing_jobs').notNull().default(0),
    errorsJson: text('errors_json'),
    diagnosticRefsJson: text('diagnostic_refs_json'),
  },
  (t) => ({
    pipelineRunIdx: index('search_executions_pipeline_run_id_idx').on(t.pipelineRunId),
  }),
);

// 11. jobs -----------------------------------------------------------------
// Canonical job records. source_job_id is LinkedIn's job ID and is unique.
export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceJobId: text('source_job_id').notNull(),
    title: text('title'),
    company: text('company'),
    location: text('location'),
    description: text('description'),
    extractionStatus: text('extraction_status', {
      enum: ['complete', 'partial', 'failed'],
    }).notNull(),
    successfulMethod: text('successful_method', {
      enum: ['search_detail_panel', 'dedicated_job_page'],
    }),
    firstDiscoveryTimestamp: text('first_discovery_timestamp').notNull(),
    lastRediscoveryTimestamp: text('last_rediscovery_timestamp').notNull(),
    lastExtractionAttemptTimestamp: text('last_extraction_attempt_timestamp'),
    createdTimestamp: text('created_timestamp').notNull(),
    updatedTimestamp: text('updated_timestamp').notNull(),
  },
  (t) => ({
    sourceJobIdUnique: uniqueIndex('jobs_source_job_id_idx').on(t.sourceJobId),
    extractionStatusIdx: index('jobs_extraction_status_idx').on(t.extractionStatus),
  }),
);

// 12. discovery_events -----------------------------------------------------
// Per-discovery record: when a job was seen, by which search, whether it was new.
export const discoveryEvents = sqliteTable(
  'discovery_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    timestamp: text('timestamp').notNull(),
    isNew: integer('is_new', { mode: 'boolean' }).notNull(),
    currentExtractionState: text('current_extraction_state', {
      enum: ['complete', 'partial', 'failed'],
    }).notNull(),
    extractionAttempted: integer('extraction_attempted', { mode: 'boolean' }).notNull(),
    skipReason: text('skip_reason'),
  },
  (t) => ({
    runSearchIdx: index('discovery_events_run_search_idx').on(
      t.pipelineRunId,
      t.searchExecutionId,
    ),
  }),
);

// 13. discovery_errors -----------------------------------------------------
// Failures where we could not even identify a source_job_id.
export const discoveryErrors = sqliteTable(
  'discovery_errors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    cardPosition: integer('card_position'),
    cardIndex: integer('card_index'),
    availableMetadataJson: text('available_metadata_json'),
    errorCode: text('error_code').notNull(),
    diagnosticMessage: text('diagnostic_message').notNull(),
    timestamp: text('timestamp').notNull(),
    artifactRefsJson: text('artifact_refs_json'),
  },
  (t) => ({
    runSearchIdx: index('discovery_errors_run_search_idx').on(
      t.pipelineRunId,
      t.searchExecutionId,
    ),
  }),
);

// 14. extraction_attempts --------------------------------------------------
// Per-method attempt record (panel or dedicated page) for a single job.
export const extractionAttempts = sqliteTable(
  'extraction_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    attemptTimestamp: text('attempt_timestamp').notNull(),
    method: text('method', {
      enum: ['search_detail_panel', 'dedicated_job_page'],
    }).notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    jobIdx: index('extraction_attempts_job_id_idx').on(t.jobId),
  }),
);

// 15. filter_results -------------------------------------------------------
// Persisted filter outcomes; only one row per job is `active` at a time.
// Fingerprint ties the row to inputs (job, profile, filter version).
export const filterResults = sqliteTable(
  'filter_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
    filterConfigVersionId: integer('filter_config_version_id')
      .notNull()
      .references(() => filterConfigurationVersions.id),
    filterConfigHash: text('filter_config_hash').notNull(),
    profileVersionId: integer('profile_version_id').references(() => profileVersions.id),
    profileHash: text('profile_hash'),
    filterImplementationVersion: text('filter_implementation_version').notNull(),
    fingerprint: text('fingerprint').notNull(),
    timestamp: text('timestamp').notNull(),
    overallOutcome: text('overall_outcome', {
      enum: ['accepted', 'rejected', 'error'],
    }).notNull(),
    rulesEvaluatedJson: text('rules_evaluated_json').notNull(),
    rulesPassedJson: text('rules_passed_json').notNull(),
    rulesFailedJson: text('rules_failed_json').notNull(),
    rejectionReasonsJson: text('rejection_reasons_json'),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    fingerprintIdx: index('filter_results_fingerprint_idx').on(t.fingerprint),
    activeJobIdx: index('filter_results_active_job_idx').on(t.jobId, t.active),
    activeUnique: uniqueIndex('filter_results_active_idx')
      .on(t.jobId)
      .where(sql`active = 1`),
  }),
);

// 16. score_results --------------------------------------------------------
// Persisted scoring outcomes keyed by fingerprint; only one row per job is active.
export const scoreResults = sqliteTable(
  'score_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
    filterResultId: integer('filter_result_id').references(() => filterResults.id),
    fingerprint: text('fingerprint').notNull(),
    timestamp: text('timestamp').notNull(),
    promptVersion: text('prompt_version').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    model: text('model').notNull(),
    reasoningEffort: text('reasoning_effort').notNull(),
    scorerImplementationVersion: text('scorer_implementation_version').notNull(),
    categoryScoresJson: text('category_scores_json').notNull(),
    overallScore: real('overall_score').notNull(),
    explanation: text('explanation'),
    keyMatchesJson: text('key_matches_json'),
    importantGapsJson: text('important_gaps_json'),
    importantConcernsJson: text('important_concerns_json'),
    inferredSeniority: text('inferred_seniority'),
    recommendationSummary: text('recommendation_summary'),
    success: integer('success', { mode: 'boolean' }).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => ({
    fingerprintIdx: index('score_results_fingerprint_idx').on(t.fingerprint),
    activeJobIdx: index('score_results_active_job_idx').on(t.jobId, t.active),
    overallScoreIdx: index('score_results_overall_score_idx').on(t.overallScore),
    activeUnique: uniqueIndex('score_results_active_idx')
      .on(t.jobId)
      .where(sql`active = 1`),
  }),
);

// 17. openai_request_metadata ---------------------------------------------
// Per-request audit trail. Does not store raw prompts/responses.
export const openaiRequestMetadata = sqliteTable(
  'openai_request_metadata',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationType: text('operation_type', {
      enum: ['profile_extraction', 'job_scoring'],
    }).notNull(),
    relatedEntityType: text('related_entity_type', {
      enum: ['profile_version', 'score_result'],
    }),
    relatedEntityId: integer('related_entity_id'),
    inputHashesJson: text('input_hashes_json').notNull(),
    promptVersion: text('prompt_version').notNull(),
    structuredOutputSchemaVersion: integer('structured_output_schema_version').notNull(),
    model: text('model').notNull(),
    reasoningEffort: text('reasoning_effort').notNull(),
    configJson: text('config_json').notNull(),
    tokenUsageJson: text('token_usage_json'),
    validatedOutputJson: text('validated_output_json'),
    attemptCount: integer('attempt_count').notNull(),
    startTimestamp: text('start_timestamp').notNull(),
    endTimestamp: text('end_timestamp'),
    success: integer('success', { mode: 'boolean' }).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    operationIdx: index('openai_request_metadata_operation_idx').on(
      t.operationType,
      t.startTimestamp,
    ),
  }),
);

// 18. diagnostic_artifacts -------------------------------------------------
// References to artifacts captured on the filesystem for a run/search/job/error.
export const diagnosticArtifacts = sqliteTable(
  'diagnostic_artifacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
    searchExecutionId: integer('search_execution_id').references(() => searchExecutions.id),
    jobId: integer('job_id').references(() => jobs.id),
    discoveryErrorId: integer('discovery_error_id').references(() => discoveryErrors.id),
    extractionAttemptId: integer('extraction_attempt_id').references(
      () => extractionAttempts.id,
    ),
    artifactType: text('artifact_type', {
      enum: [
        'screenshot',
        'current_url',
        'stack_trace',
        'playwright_trace',
        'html_snapshot',
        'log_file',
      ],
    }).notNull(),
    storedPath: text('stored_path').notNull(),
    relativePath: text('relative_path').notNull(),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    createdAt: text('created_at').notNull(),
    errorCode: text('error_code'),
    description: text('description'),
  },
  (t) => ({
    runIdx: index('diagnostic_artifacts_run_id_idx').on(t.pipelineRunId),
  }),
);

// Aggregated schema object so downstream repositories can pass a single
// argument to `drizzle(sqlite, { schema })`.
export const schema = {
  applicationMetadata,
  profileSources,
  profileVersions,
  profileRevisions,
  profileConflicts,
  profileWarnings,
  derivedOverrides,
  filterConfigurationVersions,
  pipelineRuns,
  searchExecutions,
  jobs,
  discoveryEvents,
  discoveryErrors,
  extractionAttempts,
  filterResults,
  scoreResults,
  openaiRequestMetadata,
  diagnosticArtifacts,
};

export type Schema = typeof schema;
```

> **Self-review note:** Every entity from `SPEC.md §23.1` is present. All enums are declared inline using Drizzle's `text(... , { enum: [...] })` so the TypeScript types stay narrow. The four `active` partial unique indexes (`profile_versions`, `filter_configuration_versions`, `filter_results`, `score_results`) enforce the SPEC's "single active record" rules at the database level.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/schema.test.ts
```

Expected: PASS — 5 tests pass.

If the test for the partial unique index fails because `where` serializes to a `SQL` object (not a string), adjust the assertion to walk `partial.where.queryChunks` and check the literal contains `'approved'` and `'active = 1'`. The default Drizzle serialization for `text` enum comparisons uses parameter binding that may not render to a string directly; in that case replace the assertion with:

```ts
const whereString = JSON.stringify(partial?.where);
expect(whereString).toContain('approved');
expect(whereString).toContain('active');
```

- [ ] **Step 5: Commit**

```bash
git add src/persistence/schema.ts tests/persistence/schema.test.ts
git commit -m "feat(persistence): define Drizzle schema for MVP entities"
```

---

### Task 4: Generate and commit the initial Drizzle migration

**Files:**

- Create: `drizzle/0000_initial_schema.sql`
- Create: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0000_snapshot.json`

**Interfaces:**

- Consumes: `drizzle.config.ts` from Task 1, `src/persistence/schema.ts` from Task 3.
- Produces: A committed initial migration that, when applied to a fresh SQLite database, creates all 18 tables with the correct columns, constraints, and indexes. The migration is the authoritative schema description downstream of the TypeScript module.

- [ ] **Step 1: Generate the migration**

Run:

```bash
pnpm db:generate
```

Expected output (abbreviated):

```
[✓] Your SQL migration file ➜ drizzle/0000_initial_schema.sql
[✓] Migration metadata � drizzle/meta/0000_snapshot.json
[✓] Migration journal ➜ drizzle/meta/_journal.json
```

Drizzle Kit names the file based on the migration counter; `0000_initial_schema.sql` is the typical default. If the generated filename differs, capture the actual name in Step 4.

- [ ] **Step 2: Inspect the generated SQL**

Open `drizzle/0000_initial_schema.sql` and verify:

1. Every expected table is present in `CREATE TABLE` statements.
2. Every `INTEGER PRIMARY KEY AUTOINCREMENT` exists for `id` columns.
3. Every `REFERENCES ... ON DELETE NO ACTION` (Drizzle's default) is present for foreign keys.
4. Every `UNIQUE INDEX` is present (in particular `profile_sources_sha256_idx`, `jobs_source_job_id_idx`, the four partial unique indexes, and `derived_overrides_profile_version_field_idx`).
5. No `DROP`, `ALTER TABLE ... DROP COLUMN`, or other destructive operation appears.
6. No `--breakpoint` markers remain — they are scaffolding for future migration generation only.

If any expected index is missing, return to Task 3 and re-run `pnpm db:generate`. Do not hand-edit the generated SQL.

- [ ] **Step 3: Verify the migration applies cleanly**

Run a one-off check using `better-sqlite3` against an in-memory database. Add a temporary script (do NOT commit it):

```bash
node --input-type=module -e "
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './src/persistence/schema.ts';
const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: './drizzle' });
const tables = sqlite.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\").all();
console.log('tables', tables.map(t => t.name).join(','));
sqlite.close();
"
```

Expected output ends with a comma-separated list containing all 18 tables from Task 3. If any name is missing, the migration did not generate correctly — re-run `pnpm db:generate` and re-inspect.

Remove the temporary command (do not save it as a file).

- [ ] **Step 4: Commit the migration files**

```bash
git add drizzle/
git commit -m "feat(persistence): generate initial Drizzle migration"
```

Confirm the commit contains exactly three files (plus any sibling meta files Drizzle emits): `drizzle/0000_*.sql`, `drizzle/meta/_journal.json`, and `drizzle/meta/0000_snapshot.json`.

---

### Task 5: Implement createDatabaseConnection with foreign-key PRAGMA

**Files:**

- Create: `src/persistence/connection.ts`
- Create: `tests/persistence/connection.test.ts`

**Interfaces:**

- Consumes: `better-sqlite3` (`Database` constructor), `drizzle-orm/better-sqlite3` (`drizzle` factory), and the schema module from Task 3.
- Produces:

```ts
export interface DatabaseConnection {
  readonly db: BetterSQLite3Database<typeof schema>;
  readonly sqlite: Database.Database;
  close(): void;
}

export function createDatabaseConnection(filePath: string): DatabaseConnection;
```

`createDatabaseConnection` opens the SQLite file at `filePath` (creating it if missing), enables `PRAGMA foreign_keys = ON` on the same handle, and returns a `DatabaseConnection` whose `close()` calls `sqlite.close()`. Throws `DatabaseError` with code `database_open_failed` if better-sqlite3 cannot open the file.

- [ ] **Step 1: Write the failing test**

Create `tests/persistence/connection.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';

describe('createDatabaseConnection', () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-connection-'));
    filePath = join(directory, 'jobhunter.sqlite');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('opens a new SQLite file and enables foreign keys', () => {
    const connection = createDatabaseConnection(filePath);
    try {
      const foreignKeys = connection.sqlite.pragma('foreign_keys', { simple: true });
      expect(foreignKeys).toBe(1);
    } finally {
      connection.close();
    }
  });

  it('rejects foreign-key violations after the migrations have run', () => {
    const connection = createDatabaseConnection(filePath);
    try {
      // Minimal schema (jobs + pipeline_runs) is enough to exercise FK rejection.
      connection.sqlite.exec(`
        CREATE TABLE pipeline_runs (id INTEGER PRIMARY KEY AUTOINCREMENT);
        CREATE TABLE jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pipeline_run_id INTEGER NOT NULL REFERENCES pipeline_runs(id)
        );
      `);
      expect(() =>
        connection.sqlite
          .prepare('INSERT INTO jobs (pipeline_run_id) VALUES (?)')
          .run(999),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      connection.close();
    }
  });

  it('returns a Drizzle instance that can run typed queries', () => {
    const connection = createDatabaseConnection(filePath);
    try {
      connection.sqlite.exec(
        'CREATE TABLE sample (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)',
      );
      const result = connection.db.all<{ value: string }>(
        sql`SELECT value FROM sample WHERE value = ${'hello'}`,
      );
      expect(result).toEqual([]);
    } finally {
      connection.close();
    }
  });

  it('closes the underlying SQLite handle', () => {
    const connection = createDatabaseConnection(filePath);
    connection.close();
    expect(() => connection.sqlite.pragma('foreign_keys')).toThrow(/database is closed/);
  });

  it('surfaces open failures as DatabaseError', () => {
    expect(() => createDatabaseConnection('/nonexistent/dir/jobhunter.sqlite')).toThrow(
      /database_open_failed/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/connection.test.ts
```

Expected: FAIL — `src/persistence/connection.ts` does not exist.

- [ ] **Step 3: Implement `src/persistence/connection.ts`**

Create the file:

```ts
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { DatabaseError } from './errors.js';
import { schema, type Schema } from './schema.js';

export interface DatabaseConnection {
  readonly db: BetterSQLite3Database<Schema>;
  readonly sqlite: BetterSqliteDatabase;
  close(): void;
}

export function createDatabaseConnection(filePath: string): DatabaseConnection {
  let sqlite: BetterSqliteDatabase;
  try {
    sqlite = new Database(filePath);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new DatabaseError(
      'database_open_failed',
      `Failed to open SQLite database at ${filePath}: ${message}`,
      { filePath },
      cause instanceof Error ? cause : undefined,
    );
  }
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close(): void {
      sqlite.close();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/connection.test.ts
```

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/connection.ts tests/persistence/connection.test.ts
git commit -m "feat(persistence): add database connection factory with FK enforcement"
```

---

### Task 6: Implement migration runner with transactional application

**Files:**

- Create: `src/persistence/migrations.ts`
- Create: `tests/persistence/migrations.test.ts`

**Interfaces:**

- Consumes: `migrate` from `drizzle-orm/better-sqlite3/migrator`, a `DatabaseConnection` from Task 5.
- Produces:

```ts
export interface RunMigrationsOptions {
  readonly migrationsFolder: string;
}

export interface MigrationReport {
  readonly appliedMigrations: readonly string[];
  readonly databasePath: string;
}

export function runMigrations(
  connection: DatabaseConnection,
  options: RunMigrationsOptions,
): MigrationReport;
```

`runMigrations` wraps `migrate()` and translates its exceptions into typed `MigrationError`s. Drizzle Kit's migrator already wraps each migration file in a transaction; the wrapper preserves that contract by catching any thrown error, closing the connection on failure, and re-throwing a typed `MigrationError` with code `migration_apply_failed` and metadata `{ migrationsFolder, cause }`.

- [ ] **Step 1: Write the failing test**

Create `tests/persistence/migrations.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

describe('runMigrations', () => {
  let directory: string;
  let filePath: string;
  let connection: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-migrations-'));
    filePath = join(directory, 'jobhunter.sqlite');
    connection = createDatabaseConnection(filePath);
  });

  afterEach(() => {
    try {
      connection.close();
    } catch {
      // Connection may already be closed by the test (failure path).
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it('applies the committed initial migration to a fresh database', () => {
    const report = runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    expect(report.databasePath).toBe(filePath);
    expect(report.appliedMigrations.length).toBeGreaterThan(0);
    const tables = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'application_metadata',
        'profile_sources',
        'profile_versions',
        'jobs',
        'pipeline_runs',
        'search_executions',
        'filter_results',
        'score_results',
        'openai_request_metadata',
        'diagnostic_artifacts',
      ]),
    );
  });

  it('is idempotent when run a second time', () => {
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const report = runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    expect(report.appliedMigrations).toEqual([]);
  });

  it('throws MigrationError when the migrations folder is missing', () => {
    expect(() =>
      runMigrations(connection, { migrationsFolder: join(directory, 'no-such-folder') }),
    ).toThrow(/migration_apply_failed/);
  });

  it('throws MigrationError when a migration file is malformed', () => {
    const badFolder = join(directory, 'bad');
    writeFileSync(join(badFolder, '0000_bogus.sql'), 'NOT VALID SQL HERE;');
    writeFileSync(
      join(badFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '7', when: 0, tag: '0000_bogus', breakpoints: true }],
      }),
    );
    expect(() => runMigrations(connection, { migrationsFolder: badFolder })).toThrow(
      /migration_apply_failed/,
    );
  });
});
```

> The malformed-migration test seeds a minimal `drizzle` folder layout so Drizzle's migrator attempts to parse it. The exact Drizzle journal schema may shift between versions; if the assertion fails because the migrator validates journal structure first, update the seeded `meta/_journal.json` to match the version installed (the migrator includes a `_journal.json` schema version field). The test still proves the typed-error contract — that any migration failure surfaces as `migration_apply_failed` rather than a raw better-sqlite3 error.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/migrations.test.ts
```

Expected: FAIL — `src/persistence/migrations.ts` does not exist.

- [ ] **Step 3: Implement `src/persistence/migrations.ts`**

Create the file:

```ts
import { migrate, type MigrationMeta } from 'drizzle-orm/better-sqlite3/migrator';

import type { DatabaseConnection } from './connection.js';
import { MigrationError } from './errors.js';

export interface RunMigrationsOptions {
  readonly migrationsFolder: string;
}

export interface MigrationReport {
  readonly appliedMigrations: readonly string[];
  readonly databasePath: string;
}

export function runMigrations(
  connection: DatabaseConnection,
  options: RunMigrationsOptions,
): MigrationReport {
  let applied: MigrationMeta[];
  try {
    applied = migrate(connection.db, {
      migrationsFolder: options.migrationsFolder,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new MigrationError(
      'migration_apply_failed',
      `Failed to apply migrations from ${options.migrationsFolder}: ${message}`,
      { migrationsFolder: options.migrationsFolder },
      cause instanceof Error ? cause : undefined,
    );
  }
  return {
    appliedMigrations: applied.map((m) => m.tag ?? `${m.folderHash}:${m.hash}`),
    databasePath: connection.sqlite.name,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/migrations.test.ts
```

Expected: PASS — 4 tests pass (assuming the malformed-migration test seeds a folder that triggers the error path; if Drizzle ignores the seed, remove that test and document the limitation).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/migrations.ts tests/persistence/migrations.test.ts
git commit -m "feat(persistence): add transactional migration runner"
```

---

### Task 7: Implement initializeDatabase lifecycle with cleanup

**Files:**

- Create: `src/persistence/database.ts`
- Create: `src/persistence/index.ts`
- Create: `tests/persistence/database.test.ts`

**Interfaces:**

- Consumes: `PlatformPaths` from TASK-002, `ensureDirectory` from TASK-002, `createDatabaseConnection` from Task 5, `runMigrations` from Task 6.
- Produces:

```ts
export interface InitializeDatabaseOptions {
  readonly migrationsFolder: string;
}

export interface DatabaseHandle extends DatabaseConnection {
  readonly filePath: string;
  readonly report: MigrationReport;
}

export function initializeDatabase(
  paths: PlatformPaths,
  options: InitializeDatabaseOptions,
): DatabaseHandle;
```

`initializeDatabase` ensures the data directory exists, opens a connection at `paths.data.file('jobhunter.sqlite')`, applies pending migrations, and returns a `DatabaseHandle`. If migration application throws, the connection is closed before the error propagates so the runtime cannot leak a half-open SQLite handle.

The `src/persistence/index.ts` module re-exports the public surface so downstream tasks can `import { initializeDatabase, ... } from '../persistence/index.js'` without coupling to internal file paths.

- [ ] **Step 1: Write the failing test**

Create `tests/persistence/database.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePlatformPaths, type PlatformPaths } from '../../src/platform/paths.js';
import { initializeDatabase } from '../../src/persistence/database.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const MIGRATIONS_FOLDER = join(REPO_ROOT, 'drizzle');

function linuxPathsWith(home: string, xdgDataHome: string): PlatformPaths {
  const adapter = {
    platform: 'linux' as const,
    home,
    environment: {
      HOME: home,
      XDG_DATA_HOME: xdgDataHome,
      XDG_CONFIG_HOME: xdgDataHome,
      XDG_STATE_HOME: xdgDataHome,
      XDG_CACHE_HOME: xdgDataHome,
    },
  };
  return resolvePlatformPaths(adapter);
}

describe('initializeDatabase', () => {
  let home: string;
  let paths: PlatformPaths;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'jobhunter-init-'));
    paths = linuxPathsWith(home, join(home, 'xdg-data'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('creates the data directory and applies migrations on a fresh install', () => {
    const handle = initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    try {
      expect(handle.filePath).toBe(join(paths.data.directory, 'jobhunter.sqlite'));
      expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(handle.report.appliedMigrations.length).toBeGreaterThan(0);
    } finally {
      handle.close();
    }
  });

  it('is idempotent across repeated calls on the same data directory', () => {
    const first = initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    first.close();
    const second = initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    try {
      expect(second.report.appliedMigrations).toEqual([]);
    } finally {
      second.close();
    }
  });

  it('closes the connection if migration application fails', () => {
    expect(() =>
      initializeDatabase(paths, { migrationsFolder: join(home, 'no-such-folder') }),
    ).toThrow(/migration_apply_failed/);
    // After failure the SQLite file should not be left half-open.
    // We reopen the same path to confirm we can open it again.
    const reopen = initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    try {
      expect(reopen.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      reopen.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/database.test.ts
```

Expected: FAIL — `src/persistence/database.ts` does not exist.

- [ ] **Step 3: Implement `src/persistence/database.ts`**

Create the file:

```ts
import { ensureDirectory } from '../platform/paths.js';
import type { PlatformPaths } from '../platform/paths.js';

import { createDatabaseConnection, type DatabaseConnection } from './connection.js';
import { runMigrations, type MigrationReport } from './migrations.js';

export interface InitializeDatabaseOptions {
  readonly migrationsFolder: string;
}

export interface DatabaseHandle extends DatabaseConnection {
  readonly filePath: string;
  readonly report: MigrationReport;
}

export async function initializeDatabase(
  paths: PlatformPaths,
  options: InitializeDatabaseOptions,
): Promise<DatabaseHandle> {
  await ensureDirectory(paths.data.directory, 'data');
  const filePath = paths.data.file('jobhunter.sqlite');
  const connection = createDatabaseConnection(filePath);
  let report: MigrationReport;
  try {
    report = runMigrations(connection, { migrationsFolder: options.migrationsFolder });
  } catch (cause) {
    connection.close();
    throw cause;
  }
  return {
    ...connection,
    filePath,
    report,
  };
}
```

> Note: `initializeDatabase` is `async` because `ensureDirectory` is async. Downstream callers (TASK-004, TASK-011, TASK-015) will already be in async contexts.

- [ ] **Step 4: Implement `src/persistence/index.ts`**

Create the file:

```ts
export {
  DatabaseError,
  MigrationError,
  ApplicationError,
  ExitCode,
} from './errors.js';
export {
  createDatabaseConnection,
  type DatabaseConnection,
} from './connection.js';
export {
  runMigrations,
  type MigrationReport,
  type RunMigrationsOptions,
} from './migrations.js';
export {
  initializeDatabase,
  type DatabaseHandle,
  type InitializeDatabaseOptions,
} from './database.js';
export { schema, type Schema } from './schema.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/database.test.ts
```

Expected: PASS — 3 tests pass.

If the failure-path test fails because `ensureDirectory` was called before the SQLite open step and a previous file already exists, confirm that `initializeDatabase` calls `ensureDirectory` only once and that the open-after-failure path is reaching a clean state. The test asserts that re-opening the file is possible — if it is not, the implementation is leaking a write transaction or file lock.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/database.ts src/persistence/index.ts tests/persistence/database.test.ts
git commit -m "feat(persistence): add initializeDatabase lifecycle with failure cleanup"
```

---

### Task 8: Final verification and documentation

**Files:**

- Modify: `docs/tasks/INDEX.md` (mark TASK-003 status)
- Modify: `docs/tasks/TASK-003-database-schema-migrations.md` (append implementation results)

**Interfaces:**

- Consumes: the completed `src/persistence/`, `drizzle/`, and `tests/persistence/` from Tasks 1–7.
- Produces: verification evidence recorded in `TASK-003-database-schema-migrations.md` (verification date, environment, commits, command outcomes, test inventory) and an updated `INDEX.md` row.

- [ ] **Step 1: Run the full verification suite**

Run, in order:

```bash
pnpm --version
node --version
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0. Capture the exact output in the task document's "Implementation results" section.

If `pnpm format:check` flags formatting in the new files, run `pnpm format` and re-run the full suite.

- [ ] **Step 2: Run a CLI smoke check**

Confirm the existing CLI commands still work with the new dependency surface:

```bash
node dist/cli.js --help
node dist/cli.js paths
```

Expected: both exit 0 with the documented output (no behavioral changes; this is a regression check, not new functionality).

Run a smoke check that the database module works end-to-end by adding a one-off script (do NOT commit it):

```bash
node --input-type=module -e "
import { createDefaultPlatformAdapter } from './src/platform/paths-default.ts';
import { resolvePlatformPaths } from './src/platform/paths.ts';
import { initializeDatabase } from './src/persistence/database.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

const home = mkdtempSync(join(tmpdir(), 'jobhunter-smoke-'));
const adapter = { ...createDefaultPlatformAdapter(), home, environment: { ...process.env, HOME: home, XDG_DATA_HOME: join(home, 'data'), XDG_CONFIG_HOME: join(home, 'config'), XDG_STATE_HOME: join(home, 'state'), XDG_CACHE_HOME: join(home, 'cache') }};
const paths = resolvePlatformPaths(adapter);
const handle = await initializeDatabase(paths, { migrationsFolder: join(process.cwd(), 'drizzle') });
console.log('database opened at', handle.filePath);
console.log('applied migrations', handle.report.appliedMigrations.length);
handle.close();
rmSync(home, { recursive: true, force: true });
"
```

Expected: prints the resolved file path and at least one applied migration tag.

- [ ] **Step 3: Verify the live suite is still empty**

```bash
pnpm test:live:list
```

Expected: empty output (the live suite is intentionally empty for non-LinkedIn tasks).

- [ ] **Step 4: Update `INDEX.md`**

In `docs/tasks/INDEX.md`, change the TASK-003 row:

```markdown
| [TASK-003](./TASK-003-database-schema-migrations.md) | SQLite connection, Drizzle schema, migrations, and initialization | 001, 002 | ✅ Implemented — Foreign-key-enforced DB, Drizzle schema for 18 MVP entities, committed migration, transactional init lifecycle |
```

Update the header line from:

```markdown
**Status:** Planning decomposition approved for review; TASK-001 and TASK-002 implemented
```

to:

```markdown
**Status:** Planning decomposition approved for review; TASK-001, TASK-002, and TASK-003 implemented
```

And from:

```markdown
**Implementation status:** TASK-001 and TASK-002 are implemented (8 commits on branch `feat/task-002-paths-config-validation-logging`). The remaining tasks (TASK-003 through TASK-018) are planned; no application code, dependencies, migrations, or generated output may be created for them until each task's own plan is approved.
```

to (replace TASK-003 with the new implementation note):

```markdown
**Implementation status:** TASK-001, TASK-002, and TASK-003 are implemented. TASK-003 lives on branch `feat/task-003-database-schema-migrations` (N commits). The remaining tasks (TASK-004 through TASK-018) are planned; no application code, dependencies, migrations, or generated output may be created for them until each task's own plan is approved.
```

Fill in `N` with the actual number of commits produced by Tasks 1–8.

- [ ] **Step 5: Append the implementation results section to the task document**

Open `docs/tasks/TASK-003-database-schema-migrations.md` and append a new section after the "Completion criteria" heading:

```markdown
## Implementation results

- **Verification date:** YYYY-MM-DD
- **Environment:** Node.js v24.18.0, pnpm 11.18.0
- **Branch:** `feat/task-003-database-schema-migrations`
- **Worktree:** (path under `.worktrees/`, if used)
- **Base:** (commit hash of TASK-002's merge into `main`)
- **Dependency versions pinned by this task:** `better-sqlite3 13.0.3`, `drizzle-orm 0.45.2`, `drizzle-kit 0.31.10` (dev)

### Commits (N total on the feature branch)

- `<sha>` — chore(persistence): add drizzle-orm, drizzle-kit, and better-sqlite3 dependencies
- `<sha>` — feat(persistence): add typed database and migration errors
- `<sha>` — feat(persistence): define Drizzle schema for MVP entities
- `<sha>` — feat(persistence): generate initial Drizzle migration
- `<sha>` — feat(persistence): add database connection factory with FK enforcement
- `<sha>` — feat(persistence): add transactional migration runner
- `<sha>` — feat(persistence): add initializeDatabase lifecycle with failure cleanup

### Verification commands and outcomes

- `node --version` — `v24.18.0` ✅
- `pnpm --version` — `11.18.0` ✅
- `pnpm install --frozen-lockfile` — exit 0 ✅
- `pnpm format:check` — exit 0 ✅
- `pnpm lint` — exit 0 ✅
- `pnpm typecheck` — exit 0 ✅
- `pnpm build` — exit 0, `dist/cli.js` produced ✅
- `pnpm test` — X/X tests pass across 6 files (including new persistence suite) ✅
- `pnpm test:live:list` — empty live suite ✅
- `node dist/cli.js --help` — exit 0 ✅
- `node dist/cli.js paths` — exit 0 ✅
- Database smoke check (initializeDatabase + runMigrations) — applied N migrations, foreign keys ON ✅

### Test inventory

- `tests/persistence/errors.test.ts` — 4 tests
- `tests/persistence/schema.test.ts` — 5 tests
- `tests/persistence/connection.test.ts` — 5 tests
- `tests/persistence/migrations.test.ts` — 4 tests
- `tests/persistence/database.test.ts` — 3 tests

### Reviewer verdicts

- Task 1 — (verdict)
- Task 2 — (verdict)
- Task 3 — (verdict)
- Task 4 — (verdict)
- Task 5 — (verdict)
- Task 6 — (verdict)
- Task 7 — (verdict)
- Task 8 — (verdict)

### Known limitations / follow-ups

- (any unresolved brief-level bugs, deferred follow-ups, or limitations discovered during review)
```

Replace placeholders with actual values during the implementation phase.

- [ ] **Step 6: Commit the documentation update**

```bash
git add docs/tasks/INDEX.md docs/tasks/TASK-003-database-schema-migrations.md
git commit -m "docs(tasks): record TASK-003 implementation results"
```

---

## Self-Review

Performed against `SPEC.md` §5.5 (Persistence), §8.2 (SQLite entities), §8.4 (Run configuration snapshot), §23.1–§23.5 (Persistence and lifecycle), §32 (CLI identifiers — confirmed TASK-003 uses integer PKs and leaves prefix mapping to TASK-004), and §44.7–§44.8 (open implementation decisions owned by this task).

**1. Spec coverage:**

- `SPEC.md §5.5` — local SQLite file, foreign-key enforcement, committed migrations, transactional writes, repository-mediated access. Covered: Tasks 1, 3, 4, 5, 6.
- `SPEC.md §8.2` — every entity listed in §23.1 is represented in the schema (Task 3).
- `SPEC.md §8.4` — `pipeline_runs.config_snapshot_json`, `config_schema_version`, `config_hash`, `application_version`, `start_timestamp` are present (Task 3). Secrets exclusion is enforced by never storing API keys in this table (no env var capture).
- `SPEC.md §23.1` — all 18 entities are defined (Task 3).
- `SPEC.md §23.2` — `jobs` table includes integer PK, source_job_id, title, company, location, description, extraction_status, successful_method, all four timestamps, plus `updated_timestamp` (Task 3).
- `SPEC.md §23.3` — `discovery_events` includes job_id, pipeline_run_id, search_execution_id, timestamp, is_new, current_extraction_state, extraction_attempted, skip_reason (Task 3).
- `SPEC.md §23.4` — historical results preserved because `active` flags plus indexes enable lookup of the current row by fingerprint while older rows remain (Task 3).
- `SPEC.md §23.5` — transactions are documented in the migration runner; the connection factory exposes `connection.db` so repositories (TASK-004) can wrap their writes.
- `SPEC.md §32` — integer primary keys are used throughout; CLI prefix mapping is explicitly out of scope and noted as TASK-004's responsibility.
- `SPEC.md §44.7–§44.8` — the exact table/index/constraint layout (Task 3) and the migration workflow using `drizzle-kit generate` + committed SQL (Task 4) are resolved.

**2. Placeholder scan:**

- No "TBD", "TODO", "fill in later", "implement later", "similar to Task N", "appropriate error handling", or unreferenced types in the plan.
- Every step that creates or modifies a file includes the complete code.
- The verification step asks the implementer to substitute real review verdicts and commit hashes; these are runtime outputs, not deferred design choices.

**3. Type consistency:**

- `DatabaseConnection.db` is typed as `BetterSQLite3Database<typeof schema>` everywhere.
- `DatabaseHandle` extends `DatabaseConnection` and adds `filePath` and `report` (Task 7).
- `MigrationReport.appliedMigrations` items are `string` tags matching Drizzle's `MigrationMeta.tag ?? folderHash:hash` fallback (Task 6).
- Foreign-key column names match across all tables (`job_id`, `pipeline_run_id`, `search_execution_id`, `profile_version_id`, `filter_config_version_id`, `filter_result_id`, `extraction_attempt_id`, `discovery_error_id`).

No inconsistencies found.
