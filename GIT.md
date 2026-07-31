# GIT.md — JobHunter Git workflow

This file defines the Git rules for the JobHunter repository.

## 1. Branches

- `main` is the only long-lived branch.
- Use one branch for each non-trivial task.
- Branch from an up-to-date `main`.
- Do not combine multiple JobHunter macro tasks in one branch.

Recommended branch format:

```text
<type>/task-<nnn>-<scope>
```

Examples:

```text
chore/task-001-repository-foundation
feat/task-006-profile-extraction
fix/task-011-job-page-fallback
```

For small work outside the task ledger, use `<type>/<scope>`.

## 2. Worktrees

Worktrees are optional.

They are useful when Superpowers or OpenCode creates an isolated workspace for one task.

- Keep them under `.worktrees/`.
- Use one worktree per task branch.
- Do not remove a worktree without checking for uncommitted changes.
- Creating or removing a worktree requires user approval.

## 3. Commits

Use Conventional Commits:

```text
<type>(<scope>): <subject>
```

Examples:

```text
chore(tooling): create repository foundation
feat(profile): add structured profile extraction
test(scraper): cover dedicated-page fallback
fix(filters): preserve unknown-seniority abstention
```

Rules:

- Use imperative mood.
- Use a clear scope.
- Keep commits logically coherent.
- Do not create empty commits.
- Do not use `wip` commits on `main`.

## 4. Approval before Git mutations

An agent must ask before:

- Staging files for a commit
- Creating a commit
- Pushing
- Opening or merging a pull request
- Rebasing
- Resetting
- Force-pushing
- Deleting a branch
- Removing a worktree
- Rewriting published history

Before a commit, show:

- Current branch
- Files to stage
- Proposed commit message
- Verification results

Do not use `git add -A` without reviewing the full status first.

## 5. Verification before a commit

Run the checks defined by the current task plan.

As the project grows, these normally include:

1. Configuration checks
2. Typecheck
3. Lint
4. Tests
5. Formatting check
6. Build
7. Migration or schema checks when applicable
8. CLI smoke checks when applicable

Do not create fake files or placeholder tests only to make a check exist.

When GitNexus is available, its change-impact analysis may support the review. It does not replace tests.

## 6. Merge strategy

Use squash merges into `main`.

- Keep `main` linear at the task level.
- Use a Conventional Commit message for the squash commit.
- Do not create merge commits on `main`.
- Never force-push `main`.
- Merging requires user approval.

## 7. Tracked files

Track source code, tests, migrations, project documentation, task plans, and project configuration that is intentionally shared.

Typical tracked paths include:

```text
SPEC.md
AGENTS.md
GIT.md
README.md
docs/tasks/
src/
tests/
drizzle/
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig*.json
eslint.config.*
prettier.config.*
.env.example
.gitignore
.github/
```

Only add files that the approved tasks actually require.

## 8. Ignored files

The repository `.gitignore` should include at least:

```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo

.env
.env.*.local
*.log

.gitnexus/
.worktrees/
.superpowers/
.slim/

data/
diagnostics/
logs/
cache/
profile-sources/

playwright-report/
test-results/

.DS_Store
Thumbs.db
.idea/
.vscode/
```

Do not commit:

- API keys or secrets
- CVs or imported profile files
- SQLite databases
- Job descriptions or scraped HTML
- Screenshots, traces, logs, or diagnostics
- GitNexus indexes
- Local OpenCode or plugin configuration
- Worktrees or agent scratch data

`.env.example` may be tracked.

## 9. Pull requests

When pull requests are used, include:

- Task ID and goal
- Specification sections covered
- Summary of changes
- Tests and verification
- Migrations, when applicable
- Known limitations
- Documentation changes

A pull request must not include unrelated future-task work.

## 10. Destructive operations

Always stop and ask before destructive Git operations.

When uncertain, show:

```text
git status
git branch --show-current
```

Then explain the exact proposed operation and its effect.
