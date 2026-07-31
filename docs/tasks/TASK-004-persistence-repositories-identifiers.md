# TASK-004 — Persistence Repositories, Transactions, Lifecycle Rules, and CLI Identifiers

**Status:** Planned; not approved for implementation
**Order:** 004
**Dependencies:** TASK-003

## Scope

Provide application-facing persistence interfaces so domain and infrastructure implementations do not access Drizzle directly:

- Define repositories/storage interfaces for profiles, sources, filters, runs, searches, jobs, discoveries, extraction attempts, filter results, score results, OpenAI request metadata, errors, and diagnostics.
- Implement stable integer-to-prefix identifier formatting and resolution for jobs, runs, profiles, sources, searches, filters, extraction attempts, scoring attempts, and discovery errors.
- Implement transaction boundaries for related writes: run/search creation, job/extraction persistence, active filter results, active score results, and run finalization.
- Enforce lifecycle rules for immutable sources, historical result retention, active approved profiles, immutable filter versions, and current fingerprint selection.
- Keep repositories independent from Commander, Inquirer, Playwright, OpenAI, and Pino.
- Expose queries required by later pipeline and inspection tasks without embedding presentation logic.

The concrete database schema/migration changes belong to TASK-003; filters, scoring, scraping, and CLI rendering belong to later tasks.

## Dependencies and handoffs

- Consumes the Drizzle schema and database connection from TASK-003.
- Produces typed repository contracts used by TASK-005 through TASK-017.
- Repository methods must accept domain-shaped validated values and return domain/persistence DTOs, not Commander or terminal objects.

## Referenced specification sections

- `SPEC.md` §8.2–8.4 configuration/run persistence
- `SPEC.md` §16.1–16.5 profile lifecycle and approval consequences
- `SPEC.md` §17.3 filter version immutability
- `SPEC.md` §23.2–23.5 canonical jobs, discovery events, history, and transactions
- `SPEC.md` §24.2–24.3 filter results and fingerprints
- `SPEC.md` §27.4 stale-result retention
- `SPEC.md` §32 CLI identifiers and job identifier resolution
- `AGENTS.md` §6 Validation and persistence

## Expected tests

- Repository integration tests for create/read/update lifecycle operations using a temporary SQLite database.
- Verify immutable source records and historical profile/filter/score rows are preserved.
- Verify only one active approved profile and one active global filter configuration can be selected.
- Verify current result lookup requires a matching fingerprint.
- Verify all required transaction groups commit atomically and roll back on injected failure.
- Verify every stable identifier prefix formats and resolves correctly, including invalid formats and missing records.
- Verify numeric-only job identifiers resolve as LinkedIn source IDs while `job_<integer>` resolves as local IDs.

## Verification requirements

- Run the focused repository integration suite with foreign keys enabled.
- Review transaction coverage against `SPEC.md` §23.5.
- Run identifier CLI/service tests for valid and invalid inputs.
- Run typecheck and build.
- Confirm no repository contains direct terminal, browser, ORM, or logger dependencies outside its persistence adapter boundary.

## Completion criteria

- Downstream tasks can persist and query all required MVP lifecycle records through typed repositories.
- History, immutability, active-state, stale-state, and transaction rules are covered by tests.
- Stable CLI identifiers are deterministic, case-sensitive, and never reused.
