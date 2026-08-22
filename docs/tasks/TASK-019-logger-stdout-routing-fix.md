# TASK-019 — Logger → stderr routing fix (SPEC §40 reliability)

**Status:** Planned; not approved for implementation
**Order:** 019
**Dependencies:** TASK-002 (logging), TASK-018 (surfaced the production finding)
**Tracked from:** TASK-018 production finding — see `docs/tasks/TASK-018-integration-acceptance-verification.md` "Production findings" section + `.superpowers/sdd/progress.md` T3-Prod-1

## Scope

Fix the SPEC §40 reliability violation surfaced during TASK-018 verification: the root Pino logger writes to `process.stdout`, polluting `--json` output for `jobhunter jobs reevaluate`, `jobhunter run`, and any future `--json` command. Route the root logger to `process.stderr` (Unix convention: stdout = data, stderr = diagnostics) so stdout is reserved for output.

- Modify `src/cli.ts:148` to pass `destinations: { stdout: process.stderr }` to `createLogger`. One-line production change.
- Drop the regex-based JSON extraction workaround in `tests/acceptance/cli-adapters.test.ts:677` (the workaround was added during TASK-018 T3 to compensate for the leak). Restore plain `JSON.parse(result.stdout)`.
- Strengthen `tests/acceptance/reliability.test.ts` R-17 from a positive-content-only check to a behavioral check (logs go to stderr, JSON goes to stdout).
- Add a behavioral assertion in `tests/acceptance/cli-adapters.test.ts` that proves the routing works end-to-end (e.g., `pnpm jobs reevaluate --json` produces stderr log lines + a clean stdout JSON document).

This task ships one production-code change (`src/cli.ts` line 148) + one test-cleanup change (`cli-adapters.test.ts` drops the regex) + reliability matrix R-17 strengthening. No new schema, no migration, no new dependency.

## Dependencies and handoffs

- Consumes TASK-002's `createLogger(options, destinations?)` API (already supports `LoggerDestinations`).
- Consumes TASK-018's `tests/acceptance/cli-adapters.test.ts` (the regex workaround at line 677 was added to work around this exact bug; the workaround must be dropped now that the bug is fixed).
- Consumes TASK-018's `tests/acceptance/reliability.test.ts` R-17 stronger check (currently a positive-content regex on `src/cli.ts`; should become a behavioral check).
- Produces a clean stdout guarantee for ALL `--json` subcommands (paths, config show, configure search, profile import/list/show/extract, run, jobs list/show/reevaluate, runs list/show).
- Produces an updated reliability matrix where R-17 ("Keep JSON stdout valid and isolated from logs") is verified behaviorally, not just by content pattern.

## Referenced specification sections

- `SPEC.md` §40 reliability requirement: "Keep JSON stdout valid and isolated from logs."
- `SPEC.md` §36 machine-readable output: every `--json` subcommand emits exactly one valid JSON document to stdout.
- `AGENTS.md` §10 JSON output discipline: "logs + human-readable errors must go elsewhere" when `--json` is used.
- `AGENTS.md` §15 completion check: re-read changed files, run verification, confirm no debug output, confirm documentation is aligned.

## Expected tests

- Existing `tests/acceptance/cli-adapters.test.ts` (28 tests) continues to pass with the regex workaround dropped.
- New behavioral assertion in `cli-adapters.test.ts` proves: when `jobs reevaluate --json` runs, stdout is exactly one valid JSON document AND stderr contains the expected Pino log records.
- `tests/acceptance/reliability.test.ts` R-17 stronger check strengthened to assert the actual behavioral split (logs on stderr, JSON on stdout) rather than a content regex on `src/cli.ts`.
- All existing tests (1854 pass / 7 skip pre-fix) continue to pass.

## Verification requirements

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:acceptance`, `pnpm build`, `pnpm test:live` all clean.
- Manual verification: run `pnpm jobs reevaluate --dry-run --json` (or equivalent `--json` command) in an isolated environment and confirm stdout is exactly one JSON document.
- Document the change in this task doc + the TASK-018 production finding (mark resolved).

## Completion criteria

- `src/cli.ts:148` routes the root logger to stderr.
- `tests/acceptance/cli-adapters.test.ts:677` regex workaround is dropped; plain `JSON.parse(result.stdout)` works.
- A new behavioral assertion proves the routing is correct end-to-end.
- `tests/acceptance/reliability.test.ts` R-17 stronger check is behavioral (asserts the actual stdout/stderr split), not just a content pattern.
- Full verification suite passes.
- No new migration, no new schema, no new dependency.
- User explicitly approves the merge per `GIT.md` §4.
