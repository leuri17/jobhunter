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

Requires Node.js `24.18.0` (pinned via `.node-version`), pnpm
`11.18.0`, and a Rust toolchain (for `cargo tauri dev` and the
desktop shell build).

```bash
pnpm install --frozen-lockfile

# Core + tests only — no desktop shell needed.
pnpm typecheck
pnpm test

# Full desktop app — Rust shell + sidecar + UI hot reload.
cargo tauri dev
```

## Architecture boundaries

The project enforces a few hard rules so it stays maintainable. These
are checked by automated tests; do not relax them in a PR without first
opening an issue:

- **`process.exit` lives only in `desktop/sidecar/src/server.ts` (the sidecar's process entrypoint).** The Tauri shell supervises and terminates the sidecar child process. Domain code throws typed errors; the sidecar's HTTP error mapper translates them into HTTP status codes + JSON envelopes and never exits the process.
- **Playwright's runtime import lives only in `src/linkedin/playwright-session.ts`.**
  Every other `src/linkedin/` file imports types only. This is enforced
  by `tests/linkedin/boundaries.test.ts`.
- **No `any` in new code.** Strict TypeScript with `noUncheckedIndexedAccess`
  and `exactOptionalPropertyTypes` is on.
- **Native ESM, NodeNext modules.** No CommonJS in new code.

## Verification

Run the full verification suite before opening a PR:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

The desktop shell (Tauri Rust binary + UI bundle) is built separately;
see the `desktop/` workspace and the Tauri build docs for that pipeline.

Live LinkedIn tests require `pnpm exec playwright install chromium` and
the `LINKEDIN_LIVE=1` opt-in. They are not part of normal CI.

Run `tsc -p tsconfig.json --noEmit` from repo root to manually check
the root config (covers `tests/` and the catch-all tsconfig). The
`pnpm typecheck` script does not exercise the root config today.

## Pull requests

- One branch per non-trivial change (`<type>/<scope>` or `<type>/task-<scope>`).
- Conventional Commits subject lines (`feat:`, `fix:`, `chore:`, etc.).
- Include tests in the same PR as the change.
- Update `README.md` and `docs/architecture.md` if your change is user-visible.
- Do not combine unrelated changes into one PR.
- Squash-merge into `main`.
- Use the PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
