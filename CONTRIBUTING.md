# Contributing to JobHunter

Thanks for your interest in JobHunter. This document covers how to set up
the project locally, run the tests, and submit a pull request.

## Project rules

Before contributing, read:

- [`README.md`](./README.md) — quick start, commands, and architecture overview.
- [`docs/architecture.md`](./docs/architecture.md) — canonical architecture reference.
- [`docs/responsible-use.md`](./docs/responsible-use.md) — LinkedIn ToS posture.
- [`SECURITY.md`](./SECURITY.md) — how to report vulnerabilities.

## Public-anonymous access rule

JobHunter accesses **only public, unauthenticated** LinkedIn job-search
pages. Contributions must preserve this rule:

- No credential storage.
- No login automation.
- No authenticated content access.
- No rate-limit bypass.

If a contribution would change this rule, open an issue first. Do not
submit it as a PR.

## Development setup

Requires Node.js `24.18.0` (pinned via `.node-version`) and pnpm `11.18.0`.

```bash
pnpm install --frozen-lockfile
pnpm dev -- --help         # confirm CLI runs
```

## Architecture boundaries

The project enforces a few hard rules so it stays maintainable. These
are checked by automated tests; do not relax them in a PR without first
opening an issue:

- **`process.exit` lives only in `src/cli.ts`.** Domain code throws typed
  errors; the CLI maps them to exit codes via `exitWithError`.
- **Playwright's runtime import lives only in `src/linkedin/playwright-session.ts`.**
  Every other `src/linkedin/` file imports types only. This is enforced
  by `tests/linkedin/boundaries.test.ts`.
- **No `any` in new code.** Strict TypeScript with `noUncheckedIndexedAccess`
  and `exactOptionalPropertyTypes` is on.
- **Native ESM, NodeNext modules.** No CommonJS in new code.

## Exit codes

JobHunter uses a stable exit-code mapping so CI scripts can rely on it:

| Code | Meaning               | Example triggers                                                       |
| ---: | --------------------- | ---------------------------------------------------------------------- |
|    0 | Success               | Any successful command.                                                |
|    1 | Fatal                 | Unhandled error (e.g., uncaught throw that isn't an `ApplicationError`). |
|    2 | Invalid usage         | Unknown option, missing argument, malformed identifier.                 |
|    3 | Missing required      | `OPENAI_API_KEY` not set, no active approved profile, no active filter. |
|    4 | LinkedIn blocked      | LinkedIn auth wall, captcha, or other access block. JobHunter stops.    |
|    5 | OpenAI failure        | Scoring / extraction failed (auth, rate limit, server error).           |
|  130 | User cancellation     | SIGINT (Ctrl-C) once = graceful cancel; twice = force exit.              |

`--help` and `--version` exit 0. The full mapping lives in
`src/errors/application-error.ts`.

## Verification

Run the full verification suite before opening a PR:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test
```

Live LinkedIn tests require `pnpm exec playwright install chromium` and
the `LINKEDIN_LIVE=1` opt-in. They are not part of normal CI.

## Pull requests

- One branch per non-trivial change (`<type>/<scope>` or `<type>/task-<scope>`).
- Conventional Commits subject lines (`feat:`, `fix:`, `chore:`, etc.).
- Include tests in the same PR as the change.
- Update `README.md` and `docs/architecture.md` if your change is user-visible.
- Do not combine unrelated changes into one PR.
- Squash-merge into `main`.
- Use the PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
