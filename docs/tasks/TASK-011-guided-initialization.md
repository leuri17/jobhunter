# TASK-011 — Guided Initialization and Resumable Setup Orchestration

**Status:** Planned; not approved for implementation
**Order:** 011
**Dependencies:** TASK-006, TASK-007, TASK-008, TASK-009, TASK-010

## Scope

Compose the prerequisite services into an idempotent, resumable `jobhunter init` workflow:

- Resolve paths, create required directories, initialize/migrate SQLite, and create default configuration only when missing.
- Validate `OPENAI_API_KEY` without persisting it and stop cleanly before OpenAI-dependent steps when absent.
- Run search configuration, source import, local extraction, profile draft generation, review/editing, explicit approval, and global filter configuration in the prescribed order.
- Inspect persisted state and classify each setup step as `complete`, `incomplete`, `failed`, or `not_started`.
- Resume from the first incomplete prerequisite while reusing valid state and preserving all existing records.
- Never silently overwrite existing config, database, sources, approved profiles, or filter versions.
- Preserve completed work after cancellation, extraction failure, missing credentials, rejection, or unresolved conflicts.
- Display a final setup summary and readiness indication only when all completion requirements exist.

This task owns orchestration and state classification; it does not add new profile, filter, persistence, or scraper rules.

## Dependencies and handoffs

- Integrates completed configuration, persistence, search, import, profile, and filter services.
- Produces an initialization application service and thin CLI command for TASK-015 and acceptance testing.
- Any prerequisite service behavior change requires approval as scope expansion.

## Referenced specification sections

- `SPEC.md` §8.3–8.6 configuration loading and update behavior
- `SPEC.md` §9.1–9.6 guided initialization, API key handling, partial state, completion, idempotence, and resume
- `SPEC.md` §31 CLI command surface
- `SPEC.md` §38 run/status conventions where applicable
- `SPEC.md` §40 reliability requirements
- `SPEC.md` §42 MVP acceptance criteria 1–20

## Expected tests

- Run initialization from an empty home and verify the prescribed step order and final readiness.
- Resume after each supported incomplete/failed/cancelled step without duplicating state.
- Verify missing API key stops before OpenAI while preserving prior work.
- Verify existing config/database/profile/filter/source records are never silently overwritten.
- Verify rejected profiles and unresolved conflicts leave setup incomplete without replacing the active profile.
- Verify partial initialization can be rerun safely and step statuses are accurate.
- Verify cancellation closes resources and preserves completed work.

## Verification requirements

- Run initialization integration tests with fake prompts and fake OpenAI clients.
- Run filesystem/database tests in isolated temporary OS-specific directories.
- Run a CLI smoke test for first-run, resume, missing-key, rejection, and completion paths.
- Run typecheck, build, and focused tests.

## Completion criteria

- `jobhunter init` is safe to repeat and resumes at the first incomplete prerequisite.
- Completion is reported only when valid configuration, search settings, approved profile, active filters, and migrated database all exist.
- No initialization step silently resets persisted user state.
