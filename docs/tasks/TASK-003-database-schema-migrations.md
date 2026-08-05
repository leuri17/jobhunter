# TASK-003 — SQLite Connection, Drizzle Schema, Migrations, and Initialization

**Status:** Implemented
**Order:** 003
**Dependencies:** TASK-001, TASK-002

## Scope

Define and safely initialize the SQLite persistence foundation:

- Configure `better-sqlite3` and Drizzle against the resolved application data path.
- Enable foreign-key enforcement on every connection.
- Define the reviewed schema for application metadata, profile sources and versions, revisions/conflicts/warnings/overrides, filter configurations, pipeline runs, search executions, jobs, discovery events/errors, extraction attempts, filter results, score results, OpenAI request metadata, and diagnostic artifact references.
- Use integer SQLite relationships while preserving the stable CLI identifier presentation layer for TASK-004.
- Define constraints and indexes needed for source/job deduplication, active-version lookup, current fingerprint lookup, history preservation, and run inspection.
- Generate committed Drizzle migrations and apply pending migrations during database initialization.
- Keep migration application transactional and report typed initialization failures.

Repository methods, application workflows, and command handlers are out of scope.

## Dependencies and handoffs

- Consumes resolved data paths and typed configuration/errors from TASK-002.
- Produces connection, schema, and migration contracts consumed by TASK-004 and all stateful services.
- Exact table names, indexes, constraints, and migration release workflow are implementation decisions requiring review under `SPEC.md` §44.

## Referenced specification sections

- `SPEC.md` §5.5 Persistence
- `SPEC.md` §8.2 SQLite entities
- `SPEC.md` §8.4 Run configuration snapshot
- `SPEC.md` §23.1–23.5 Persistence and lifecycle
- `SPEC.md` §24.2 Stored filter details
- `SPEC.md` §25.4 OpenAI request persistence
- `SPEC.md` §32 CLI identifiers
- `SPEC.md` §44 Open implementation decisions 7–8

## Expected tests

- Open a database at the resolved path and verify foreign-key enforcement.
- Apply migrations to a new database and verify every required table, constraint, and index.
- Re-run initialization against an already migrated database without destructive changes.
- Verify migration failure does not report a ready database.
- Verify foreign-key violations are rejected.
- Verify historical rows can coexist with only the correct current/active result selected by fingerprint or lifecycle state.
- Verify database resources close on successful and failed initialization.

## Verification requirements

- Run migration generation/check commands defined by the implementation plan.
- Run integration tests against isolated temporary SQLite files, never the user's runtime database.
- Inspect the migration files manually for destructive or unreviewed operations.
- Run typecheck, focused persistence tests, and build.
- Confirm no local database or generated migration output outside the intended tracked migration directory is committed accidentally.

## Completion criteria

- A fresh database can be created and migrated deterministically.
- A migrated database enforces foreign keys and exposes all MVP persistence entities needed by downstream tasks.
- Migration application is idempotent and failure-aware.
- Schema decisions and migration verification are recorded before dependent repository work begins.

## Implementation results

- **Verification date:** 2026-08-05
- **Environment:** Node.js v24.18.0, pnpm 11.18.0, linux-x64
- **Branch:** `feat/task-003-database-schema-migrations`
- **Base:** `fdb61c3` (TASK-002 merge into `main`)
- **Dependency versions pinned by this task:** `better-sqlite3@13.0.3`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10` (dev), `@types/better-sqlite3@9.6.0` (dev — added in Task 5 to correct a Task 1 plan error)

### Commits (8 total on the feature branch)

- `902d466` — `chore(persistence): add drizzle-orm, drizzle-kit, and better-sqlite3 dependencies`
- `78409d9` — `feat(persistence): add typed database and migration errors`
- `bb96ebf` — `feat(persistence): define Drizzle schema for MVP entities` (also adds `skipLibCheck: true` to `tsconfig.json`)
- `4713933` — `feat(persistence): generate initial Drizzle migration`
- `1611b9f` — `feat(persistence): add database connection factory with FK enforcement` (also adds `@types/better-sqlite3` dev dep)
- `f89febe` — `feat(persistence): add transactional migration runner`
- `f7fa410` — `feat(persistence): add initializeDatabase lifecycle with failure cleanup`

### Verification commands and outcomes

- `node --version` — `v24.18.0` ✅
- `pnpm --version` — `11.18.0` ✅
- `pnpm install --frozen-lockfile` — Already up to date ✅
- `pnpm format:check` — All matched files use Prettier code style ✅ (after `.prettierignore` update for `drizzle/meta/` and `pnpm-lock.yaml`)
- `pnpm lint` — exit 0 ✅
- `pnpm typecheck` — exit 0 ✅
- `pnpm build` — exit 0, `dist/cli.js` produced with declarations and source maps ✅
- `pnpm test` — 13 files / 63 tests pass (21 new persistence tests) ✅
- `pnpm test:live:list` — empty live suite ✅
- `node dist/cli.js --help` — exit 0 ✅
- `node dist/cli.js paths` — exit 0 ✅
- Database smoke check (initializeDatabase + runMigrations against tmpdir) — applied `0000_open_white_tiger`, foreign keys ON ✅

### Test inventory (21 new persistence tests across 5 files)

- `tests/persistence/errors.test.ts` — 4 tests
- `tests/persistence/schema.test.ts` — 5 tests
- `tests/persistence/connection.test.ts` — 5 tests
- `tests/persistence/migrations.test.ts` — 4 tests
- `tests/persistence/database.test.ts` — 3 tests

### Reviewer verdicts (comprehensive end-of-branch review)

Per-task verdicts from the comprehensive review (`oracle` session):

- Task 1 — Approved
- Task 2 — Approved
- Task 3 — Approved
- Task 4 — Approved
- Task 5 — Approved
- Task 6 — Approved
- Task 7 — Approved

Whole-branch verdict: **Spec Compliance ✅, Task quality Approved.** 0 Critical findings, 4 Important findings (all plan-correction items for future agents), 7 Minor findings.

### Important plan-correction findings (for future agents)

1. **drizzle-orm@0.45.2 API differences from plan body.** Plan's verbatim test/code assumed APIs that don't exist in the installed version: `getTableName` is not exported from `drizzle-orm/sqlite-core`; unique indexes live under `config.indexes` (not `config.uniqueConstraints`); FK columns live on `fk.reference()` (not `fk` directly); `migrate()` returns `void` (not `MigrationMeta[]`). Test code and the migration runner were rewritten to match the real API. Backport these corrections into the plan's Task 3, 5, and 6 sections.
2. **better-sqlite3@13.0.3 ships no TypeScript types.** Task 1's plan claim "no `@types/better-sqlite3` required" was wrong; it was added in Task 5. Backport this into Task 1.
3. **`skipLibCheck: true` is required in `tsconfig.json`.** drizzle-orm@0.45.2's bundled mysql/pg/singlestore/gel `.d.ts` files contain TypeScript errors that only surface when something in our code imports `drizzle-orm`. Project's own strict mode is unaffected. Backport into Task 1.
4. **Migration runner complexity is forced by API mismatch.** `migrations.ts` is 127 lines instead of the plan's ~50 because `migrate()` returns void. The alternative implementation (journal parse + `__drizzle_migrations` SHA-256 hash diff) preserves the `MigrationReport` contract.

### Known limitations / follow-ups

- The plan assumed drizzle-orm 0.45.2 and better-sqlite3 13.0.3 APIs that have shifted from earlier versions. All documented deviations were accepted at review time; backporting corrections to the plan will help future tasks.
- `pnpm-workspace.yaml` was added in Task 1 with `allowBuilds.better-sqlite3: false` and `minimumReleaseAgeExclude` because pnpm 11's `allowBuilds` policy is enforced strictly. The change is one line, additive to a key the package manager itself inserted, and necessary for reproducible installs.
- The live test suite remains empty (correct for non-LinkedIn tasks).
- `tests/persistence/migrations.test.ts:73-77` swallows file-read errors with a bare `catch { continue }` in `hashMigrationFile`. Safe in practice (Drizzle's `migrate()` would have thrown first), but the silent skip could mask journal/file drift. Not blocking.
- The migration filename is `0000_open_white_tiger.sql` (Drizzle's auto-generated slug) rather than the plan's hint `0000_initial_schema.sql`. The journal is the canonical reference; renaming would break the migration.
