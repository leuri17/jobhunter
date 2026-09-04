## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.

## Workflow preferences

- **Ask, don't infer.** When a decision has a real fork, use the `question` tool with the recommendation as option 1. Don't ask bare yes/no — explain what is recommended and why.
- **Branch-per-issue, PR-per-issue.** Multi-fix workflows get one branch per issue (`fix/<N>-<slug>`), one PR per issue. Don't cluster related issues into one PR even when they touch the same file — the user reviews them individually.
- **Wait for user review before merging.** Create the PR, the user closes it. Never auto-merge.
- **Update docs inline during fixes.** When a fix changes user-visible behavior, `README.md` / `docs/architecture.md` / `CONTRIBUTING.md` updates go in the same PR.
- **Direct push to `main` is OK for housekeeping only** — gitignore updates, codemap updates, AGENTS.md itself. Code changes go through a branch + PR.
- **Session state lives at `.slim/deepwork/<slug>.md`.** Gitignored locally, OpenCode-readable via `.ignore` allowlist. Never push to a public remote.