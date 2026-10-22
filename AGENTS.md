## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:

- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.

## Workflow

### Cycle

Plan, confirm, execute, report. Every non-trivial task follows this cycle. The user approves each step before code is touched.

- **Plan** — propose an approach, list the concrete changes.
- **Confirm** — wait for user approval of the plan.
- **Execute** — make the agreed change in the smallest reasonable unit.
- **Report** — show the diff, run the verification commands, summarize.

### Trivial vs non-trivial

Trivial (proceed without asking):

- Variable renames inside a function.
- Formatting, comment improvements, fixing a typo.
- Adding an import.
- Local state mirrors of an existing prop.
- Renaming a file to match a convention already in the codebase.

Non-trivial (ask first):

- Renaming a public API (exported function, type, schema, action, route).
- Adding or removing a dependency.
- Changing or deleting a test that currently passes.
- Deleting code — even "obvious" deletions deserve confirmation.
- Changing a database schema or running a migration.
- Choosing between two equivalent-looking patterns when the codebase has no established convention.
- Refactoring code that was not part of the request.

### What "go" means

- "Go" / "let's go" / "proceed" → do the next concrete step in the agreed plan, then report.
- "Implement" / "commit" / "go ahead" (with a specific step) → execute that step.
- None of the above → default to proposing, not implementing.

### Final audit

After completing a multi-step plan, before declaring work done:

1. Re-read every changed file.
2. Check for: dead imports, commented-out code, leftover debug logs, unowned TODO comments, unused types, typecheck/lint warnings.
3. Report findings and ask whether to fix or defer.
4. Do not consider work "done" until the user signs off on the audit.

## Workflow preferences

- **Ask, don't infer.** When a decision has a real fork, use the `question` tool with the recommendation as option 1. Don't ask bare yes/no — explain what is recommended and why.
- **One thing at a time.** Do not bundle unrelated fixes, refactors, or "while I'm here" changes into a single commit or PR.
- **Branch-per-issue, PR-per-issue.** Multi-fix workflows get one branch per issue (`fix/<N>-<slug>`), one PR per issue. Don't cluster related issues into one PR even when they touch the same file — the user reviews them individually.
- **Stay on the current branch by default** for related work. The branch name already encodes the scope; commit boundaries separate phases.
- **Create a new branch before starting work** if the current branch is `main`. Use git-flow naming: `feat/<scope>`, `fix/<scope>`, `refactor/<scope>`, `chore/<scope>`, `docs/<scope>`.
- **Follow the PR template.** Use `.github/PULL_REQUEST_TEMPLATE.md` when creating a PR; fill in every section (Summary, Files changed, Tests, Verification, Documentation, Known limitations, Linked issues) and link the issue with `Closes #N` or `Refs #N`.
- **Follow the issue templates.** When opening a new issue, choose the right template from `.github/ISSUE_TEMPLATE/` (`bug_report.yml` / `feature_request.yml` / `documentation.yml` / `responsible-use-concern.yml`), use the matching title prefix (`[Bug]:` / `[Feature]:` / `[Documentation]:` / `[Responsible-use]:`), and fill in every required section.
- **Wait for user review before merging.** Create the PR, the user closes it. Never auto-merge.
- **Update docs inline during fixes.** When a fix changes user-visible behavior, `README.md` / `docs/architecture.md` / `CONTRIBUTING.md` updates go in the same PR.
- **Direct push to `main` is OK for housekeeping only** — gitignore updates, codemap updates, AGENTS.md itself. Code changes go through a branch + PR.
- **Session state lives at `.slim/deepwork/<slug>.md`.** Gitignored locally, OpenCode-readable via `.ignore` allowlist. Never push to a public remote.
- **Comments only when they earn it.** Default to no inline narration of what the code does — the code says that. Keep TS-Doc on the exported API surface where it documents non-obvious behavior (type-variance, contract pre/post-conditions, side-effects). Drop inline narration like "this is a smoke check," "we can't observe X from the public API," or "X happens next" — it drifts out of sync and adds noise. If something genuinely needs explaining, lift it into TS-Doc on the function, not a comment above it.

- **Add shadcn/ui components through the CLI only.** Never hand-write or copy-paste `components/ui` primitives — generate with `pnpx shadcn@latest add <component>` and customize only the generated file's className/props seams.

## Commits

- One commit per logical step. Each commit is independently buildable (typecheck + lint + format all pass; the codebase still runs).
- Conventional Commits format: `<type>(<scope>): <subject>`.
  - Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`, `build`, `ci`.
  - Scope: the affected area (e.g. `(scoring)`, `(persistence)`, `(pipeline)`, `(linkedin)`, `(types)`, `(docs)`).
  - Subject: imperative mood, present tense, lowercase first letter, no trailing period, 72 chars or fewer.
- Body (optional) explains why, not what. Reference the relevant section of an in-progress plan if the commit is part of a multi-step plan.

## Pre-commit verification

Before every commit, run in order:

```
pnpm typecheck
pnpm lint
pnpm format
```

All three must pass. Format last so it never trips lint/typecheck on stale output. Do not commit if any check fails.

## Things to avoid

- Do not refactor code that was not part of the request.
- Do not invent APIs, libraries, or imports that do not exist.
- Do not add a dependency without asking.
- Do not commit debug prints, commented-out code, or dead code.
- Do not bundle unrelated fixes into a single commit or PR.
- Do not skip the pre-commit verification (typecheck, lint, format).
- Do not auto-merge PRs.
- Do not push session notes or local state to a public remote.
- Do not edit generated code by hand (e.g. `drizzle/`, `desktop/tauri/target/`, `dist/`, `coverage/`). The only allowed modification is from the project's code-generation tooling (e.g. `pnpm db:generate`).
- Do not write inline comments that restate what the code does.
- Do not add fallbacks for impossible error cases.
- Do not call `setState` (or equivalent) during render. Use effects for derived state.
