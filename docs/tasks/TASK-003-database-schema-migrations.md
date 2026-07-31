# TASK-003 — SQLite Connection, Drizzle Schema, Migrations, and Initialization

**Status:** Planned; not approved for implementation
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
