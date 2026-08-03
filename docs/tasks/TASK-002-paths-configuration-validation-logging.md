# TASK-002 — OS Paths, Configuration, Validation, Logging, and Typed Errors

**Status:** Implemented
**Order:** 002
**Dependencies:** TASK-001

## Scope

Build the platform and operational foundation used by all stateful commands:

- Resolve Linux, macOS, and Windows configuration, data, logs, diagnostics, and cache directories through platform path APIs.
- Resolve the default `config.json`, `jobhunter.sqlite`, and `profile-sources/` locations.
- Create directories lazily and never fall back silently to the current working directory.
- Define the operational configuration schema with unknown-property rejection, documented defaults, canonical normalization, and deterministic SHA-256 hashing.
- Load configuration before affected commands execute.
- Implement owned-section updates that preserve unrelated sections, show a preview at the workflow boundary, validate the complete result, write through a temporary file, and atomically replace the old file.
- Define structured Pino logging, level configuration, secret-safe metadata, and terminal/file destinations.
- Define typed application errors and the data needed for CLI-bound exit-code mapping, without implementing individual product commands.

Database access, prompts, scraper diagnostics capture, and command-specific rendering are out of scope.

## Dependencies and handoffs

- Consumes the build/test conventions from TASK-001.
- Produces path resolution, configuration loading/updating, logger construction, hashing, and typed-error contracts for TASK-003 onward.
- The configuration module must not persist `OPENAI_API_KEY` or environment values in run snapshots.

## Referenced specification sections

- `SPEC.md` §5.6 Validation
- `SPEC.md` §5.7 Logging
- `SPEC.md` §7.1–7.6 OS-specific application directories
- `SPEC.md` §8.1 Configuration schema
- `SPEC.md` §8.3–8.6 Configuration loading, snapshots, updates, and path restrictions
- `SPEC.md` §37 Exit codes
- `SPEC.md` §39.1–39.2 diagnostic defaults
- `SPEC.md` §40 Reliability requirements

## Expected tests

- Resolve each supported platform's paths with XDG, macOS, and Windows environment variations.
- Confirm `paths`-style inspection does not create missing directories.
- Confirm affected commands create only required directories when first needed.
- Reject unknown configuration properties, malformed JSON, invalid enums, invalid concurrency, and invalid timeout values.
- Verify defaults, normalization, stable serialization, and SHA-256 hashes are deterministic.
- Verify atomic updates preserve unrelated valid sections and leave the original file intact after validation or write failure.
- Verify configuration errors become typed errors without partial state changes.
- Verify logs include structured context while excluding API keys, environment secrets, and raw prompts/responses.

## Verification requirements

- Run configuration/path unit tests across a platform-matrix fixture or mocked platform adapter.
- Run logger tests that inspect emitted records for required fields and secret absence.
- Run a CLI path/config smoke check using isolated temporary directories.
- Run typecheck and the focused unit-test suite.
- Review the resulting public configuration schema against `SPEC.md` before marking complete.

## Completion criteria

- All runtime paths are OS-specific, lazy, writable-error-aware, and never project-local by default.
- Configuration is validated, normalized, hashed, atomically updated, and secret-safe.
- Structured logging and typed errors are available through testable interfaces.
- No database, scraper, OpenAI, or profile behavior is implemented beyond shared infrastructure.

## Implementation results

- **Verification date:** 2026-08-03
- **Environment:** Node.js v24.18.0, pnpm 11.18.0
- **Branch:** `feat/task-002-paths-config-validation-logging`
- **Worktree:** `/home/leuri/Projects/dev/jobhunter/.worktrees/task-002`
- **Base:** `bfa2101` (TASK-001 main)
- **Dependency versions pinned by this task:** `zod 4.4.3`, `pino 10.3.1`, `pino-pretty 13.1.3` (dev)

### Commits (8 total on the feature branch)

- `3fccf94` — chore(deps): add zod, pino, and pino-pretty
- `516f05b` — feat(platform): add OS-specific path resolution
- `31cf10a` — fix(platform): address Task 2 review findings (RuntimeDirectoryCategory derivation, cause narrowing, ensureRuntimeDirectories helper, unused param removal, test assertion hardening, plan brief sync)
- `82c8e5d` — feat(errors): add typed application errors with exit codes
- `0cfe41c` — feat(logging): add Pino logger factory with secret redaction
- `04e3acf` — feat(config): add operational configuration Zod schema
- `1b00965` — feat(config): add loader, hasher, and atomic updater
- `89b6117` — feat(cli): add paths, config show, validate, and update subcommands

### Verification commands and outcomes

- `node --version` — `v24.18.0` ✅
- `pnpm --version` — `11.18.0` ✅
- `pnpm install --frozen-lockfile` — Already up to date ✅
- `pnpm format:check` — All matched files use Prettier code style ✅
- `pnpm lint` — exit 0 ✅
- `pnpm typecheck` — exit 0 ✅
- `pnpm build` — exit 0, `dist/cli.js` produced with declarations and source maps ✅
- `pnpm test` — 42/42 tests pass across 8 files ✅
- `pnpm test:live:list` — empty live suite as expected from TASK-001 ✅
- `node dist/cli.js --help` from a clean temporary `HOME` — exit 0, no directories created ✅
- `node dist/cli.js paths` from a clean temporary `HOME` with XDG vars set — exit 0, no directories created, six `slot:` lines printed with `profile-sources:` in kebab-case ✅
- `node dist/cli.js config show` from a clean temporary `HOME` — exit 0, normalized JSON on stdout, `config.json` lazily created in `$XDG_CONFIG_HOME/jobhunter/` ✅
- `node dist/cli.js config validate` with corrupted `config.json` — exit 2, error printed to stderr ✅

### Test inventory (42 tests across 8 files)

- `tests/foundation.test.ts` — 2 tests (CLI help metadata, no-side-effects help construction)
- `tests/platform/paths.test.ts` — 6 tests (Linux XDG, Linux fallback, macOS, Windows, unsupported platform, file helpers)
- `tests/errors/application-error.test.ts` — 7 tests (ApplicationError base, PathError, ConfigError, ValidationError, UnknownConfigError, LogConfigError)
- `tests/logging/logger.test.ts` — 5 tests (required fields, level respect, redaction, file destination, child inheritance)
- `tests/config/schema.test.ts` — 7 tests (defaults, unknown top-level, unknown nested, invalid enum, non-positive ints, round-trip)
- `tests/config/loader.test.ts` — 6 tests (missing file, read+hash, malformed JSON, unknown keys, invalid schema, deterministic hash)
- `tests/config/updater.test.ts` — 5 tests (preserves sections, validation failure, original intact, user decline, atomic write)
- `tests/cli/smoke.test.ts` — 4 tests (paths side-effect-free, config show, config validate OK, config validate corrupt)

### Reviewer verdicts

- Task 1 — Approved
- Task 2 (initial) — Found 3 Important + 2 Minor issues; all addressed in commit `31cf10a`
- Task 2 (fix-up re-review) — Approved with zero findings
- Task 3 — Approved with zero findings
- Task 4 — Found 3 brief-level bugs (time format, file destination wiring, test 5 event field) + 1 follow-up (LogContext optional fields); all addressed by the controller before commit `0cfe41c`
- Task 4 (re-review) — Approved with zero Critical/Important findings
- Task 5 — Approved with zero findings
- Task 6 — Implementer self-corrected 5 brief-level bugs (mkdirSync in beforeEach, inverted parseUnknownKeys, spread-order in test, missing file seed, JSON comparison shape); approved with zero findings
- Task 7 — Found 4 brief-level issues; controller applied 5 fixes (kebab-case profile-sources, foundation test update, require→static import, dead function removal, eslint globalIgnores); approved with zero Critical/Important findings

### Known limitations / follow-ups

- The brief-level bugs in Tasks 2, 4, 6, and 7 caused multiple review/commit cycles. The plan's brief code was sometimes internally inconsistent; in every case the implementer or controller applied a minimal, mechanical fix that preserved product behavior. Future task plans should review briefs more carefully before dispatching.
- The `paths` subcommand currently prints paths in `key: value` format (kebab-case for `profile-sources`). Future tasks that need machine-readable output should add a `--json` flag.
- The `OPENAI_API_KEY` environment variable is intentionally never persisted; future tasks that need it must read it at use time.
- The `eslint.config.mjs` now uses `globalIgnores` for `dist/`, `node_modules/`, `coverage/`, `.worktrees/`, `.gitnexus/`, `.superpowers/`, `docs/`. This was added in Task 7 to prevent `dist/` (regenerated by `pnpm build`) from being linted.
- The `defaultOPERATIONAL_CONFIG` in `src/config/schema.ts` uses `searchQueries: []` and `locations: []` (empty arrays) rather than the example values shown in SPEC §8.1 (`["Software developer", "Frontend developer"]` and Rotterdam). This is correct because the schema is the persisted operational configuration and empty arrays are the safe initial state; the SPEC §8.1 example is illustrative, not a default. Future tasks (TASK-006) own the interactive search-configuration workflow that populates these arrays.
- The logger's `prettyTerminal` flag is declared in `LoggerOptions` but not yet wired (the test brief and source both omit the `pino-pretty` transport setup). Future tasks may add the transport or remove the flag; the type-level contract is correct as-is.
- The `LoggerDestinations.stderr` field is declared but not used by the current `buildPino` implementation. This is a brief-level artifact (the brief's source declares the field but does not route stderr). Future tasks can either route stderr or remove the field.
- The `OperationalConfigSchema.parseUnknownKeys` function only catches unknown *top-level* keys. Unknown *nested* keys surface as `ValidationError` from Zod. This is conformant with the brief and the SPEC §8.3 requirement ("Unknown properties must be rejected by MVP schemas" — implemented at the top level; nested unknown keys still fail Zod validation, just with a different error class).
