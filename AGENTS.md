# AGENTS.md — JobHunter development rules

This file contains the main rules for humans and coding agents working on JobHunter.

## 1. Read the specification first

`SPEC.md` is the source of truth for product behavior.

When instructions conflict, use this order:

1. `SPEC.md`
2. Explicit user decisions
3. The approved plan for the current task
4. `AGENTS.md`
5. `GIT.md`
6. Existing code

Do not change product behavior to make implementation easier.

## 2. Work on one task at a time

Do not implement the whole specification in one pass.

Before coding:

1. Select one task from `docs/tasks/INDEX.md`.
2. Read its referenced specification sections.
3. Create a detailed plan with sub-tasks, tests, and verification commands.
4. Ask for approval.

After approval:

1. Implement only that task.
2. Run its tests and verification.
3. Update the task document.
4. Stop before starting another task.

oh-my-opencode-slim and Superpowers may help inside the selected task, but delegated work must stay inside that task.

## 3. Approved technical foundation

Use:

- Node.js `24.18.0`
- pnpm `11.18.0`
- TypeScript
- Native ESM
- Commander.js
- `@inquirer/prompts`
- SQLite
- Drizzle ORM
- `better-sqlite3`
- Zod
- Playwright with Chromium
- OpenAI
- Pino
- Vitest

Do not add another LLM provider, job source, UI framework, hosted service, or authentication system.

Exact dependency versions beyond Node.js and pnpm are chosen in the relevant approved task.

## 4. TypeScript rules

- Use strict TypeScript.
- Do not use `any` unless generated or vendor code requires it.
- Prefer `unknown` with explicit checks.
- Use `import` and `export`, not `require`.
- Use Node's `node:` imports where appropriate.
- Keep relative imports compatible with NodeNext ESM output.
- Use `for...of` for sequential asynchronous work.
- Do not use `await` inside `Array.prototype.forEach`.

## 5. Keep responsibilities separate

Keep these areas separate:

- CLI arguments, prompts, and terminal rendering
- Application use cases
- Domain rules and validation
- Database access
- LinkedIn browser automation and parsing
- OpenAI requests and response validation
- Logging and diagnostics
- OS-specific path resolution

CLI handlers should be thin. They should parse input, call an application service, render the result, and map errors to exit codes.

Domain code must not depend directly on Commander, Inquirer, Playwright, Drizzle, or Pino.

Do not add abstractions for future providers, sources, users, or UIs unless the current task requires them.

## 6. Validation and persistence

Use Zod at external and persisted boundaries:

- Configuration
- CLI and prompt input
- OpenAI structured output
- Profiles
- Filter versions
- Structured database JSON
- JSON CLI output

Reject unknown configuration fields.

Use SQLite and Drizzle through persistence modules. Enable foreign keys. Use reviewed migrations and transactions for related writes.

Preserve historical profiles, filter results, extraction attempts, and scores. Do not mutate approved or historical records in place.

Runtime data must use the OS-specific paths defined in `SPEC.md`, not repository-local default paths.

## 7. OpenAI rules

OpenAI is the only LLM provider in the MVP.

Profile extraction and job scoring are separate operations with separate configuration, schemas, prompts, and fingerprints.

- Validate every structured response.
- Follow the retry policy in `SPEC.md`.
- Do not persist raw prompts or raw responses by default.
- Do not silently truncate input.
- Use one job per scoring request.
- Calculate the final weighted score in JobHunter, not in the model.

Keep OpenAI calls behind testable operation-focused interfaces.

## 8. LinkedIn scraper rules

- Use public, unauthenticated LinkedIn jobs pages only.
- Use Playwright Chromium headlessly by default.
- Run searches and job extraction sequentially.
- Try the embedded detail panel first.
- Use the dedicated job page as fallback.
- Use bounded waits and bounded retries.
- Isolate failures by job where possible.
- Preserve partial and failed diagnostics.
- Do not add login automation or credential storage.
- Do not automatically retry partial jobs.
- Do not rescrape complete jobs.

Keep selectors and parsing logic replaceable and test them with saved fixtures.

## 9. Filtering, scoring, and ranking

Deterministic filters must:

- Be auditable
- Preserve explicit reasons
- Abstain when a rule cannot decide reliably
- Never call OpenAI

Scoring must follow the rubric and fingerprint rules in `SPEC.md`.

Ranking must use the full-precision calculated score and the documented tie-breaker. Do not add hidden ranking factors.

## 10. Errors, logs, and JSON output

Use typed application errors.

Map them to the exit codes in `SPEC.md` at the CLI boundary. Do not call `process.exit()` inside domain or application services.

Use Pino for structured logs. Never log secrets.

When `--json` is used:

- stdout must contain exactly one valid JSON document
- logs and human-readable errors must go elsewhere
- values must not be truncated

Always close Playwright and database resources on success, error, and cancellation.

## 11. Testing

Use Vitest.

Tests should cover:

- Pure domain rules
- Configuration and validation
- Database repositories and migrations
- OpenAI structured-output handling with fakes
- LinkedIn parsers using fixtures
- CLI output and exit codes
- Failure and cancellation paths

Live LinkedIn tests must be opt-in and excluded from normal CI.

Do not weaken a correct passing test to accommodate incorrect code.

## 12. Dependencies and file changes

Ask before:

- Adding or removing a direct dependency
- Changing a public command or JSON contract
- Changing a database schema or migration
- Expanding the selected task
- Deleting tracked non-generated code
- Changing approved product behavior

Normal edits already covered by an approved task plan do not require repeated confirmation.

Do not edit generated output, `node_modules/`, local databases, logs, diagnostics, or GitNexus indexes.

## 13. Documentation

Keep these files aligned:

- `SPEC.md` — product behavior
- `AGENTS.md` — development rules
- `GIT.md` — Git workflow
- `README.md` — setup and usage
- `docs/tasks/` — task plans and results

A user-visible behavior change is incomplete until its documentation is updated.

## 14. Development tools

OpenCode, oh-my-opencode-slim, Superpowers, and GitNexus are local development tools, not JobHunter dependencies.

They may be configured manually.

Do not commit local tool configuration or indexes unless the user explicitly chooses to track them.

### 14.1. GitNexus

When GitNexus is available:

- Use it to understand existing code before making structural changes.
- Use `query` or `context` when exploring unfamiliar modules.
- Use `impact` before changing an established public function, class, command,
  database contract, or shared type.
- Use `detect_changes` before reporting a task complete.
- If GitNexus is unavailable or its index is stale, state that and inspect the
  repository normally.
- GitNexus output does not override SPEC.md, the approved task plan, or tests.

## 15. Completion check

Before reporting a task complete:

1. Re-read changed files.
2. Run the approved verification commands.
3. Check for dead code, unused imports, debug output, and unresolved TODOs.
4. Confirm documentation is aligned.
5. Confirm no future-task work was added.
6. Report failures and limitations honestly.
7. Stop before committing or starting another task unless the user approves it.
