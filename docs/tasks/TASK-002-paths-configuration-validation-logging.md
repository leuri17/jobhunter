# TASK-002 — OS Paths, Configuration, Validation, Logging, and Typed Errors

**Status:** Planned; not approved for implementation
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
