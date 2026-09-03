# JobHunter

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/leuri17/jobhunter/actions/workflows/ci.yml/badge.svg)](https://github.com/leuri17/jobhunter/actions/workflows/ci.yml)
[![Node >= 24.18.0](https://img.shields.io/badge/node-%3E%3D24.18.0-brightgreen)](.node-version)
[![pnpm 11.25.0](https://img.shields.io/badge/pnpm-11.25.0-blue)](package.json)

> Local-first desktop app that scrapes public LinkedIn job search
> results, persists them locally, and ranks them with deterministic
> filters plus OpenAI scoring.

JobHunter helps one job seeker discover job listings on LinkedIn,
apply their own deterministic filters, and rank the survivors against
their profile using OpenAI. Everything runs on your machine; nothing
is sent anywhere except your local SQLite database and the two
outbound HTTP calls you explicitly authorize (one to LinkedIn's
public search pages, one to OpenAI for scoring).

## Quick start

### For users (download a build)

1. Download the latest installer for your platform from
   [Releases](https://github.com/leuri17/jobhunter/releases):
   - macOS: `JobHunter_x.y.z_aarch64.dmg`
   - Windows: `JobHunter_x.y.z_x64-setup.exe`
   - Linux: `JobHunter_x.y.z_amd64.AppImage` or `.deb`
2. Drag to Applications (macOS) or run the installer (Windows/Linux).
3. Set `OPENAI_API_KEY` in your environment before launching.

### For developers (build from source)

Requires Node 24.18.0+ and pnpm 11.25.0+.

```bash
pnpm install
pnpm --filter @jobhunter/ui build      # build the frontend
cd desktop/tauri && cargo build        # build the Rust shell
```

Launch via `cargo tauri dev` from `desktop/tauri`.

## Commands

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `pnpm test`      | Run all workspace tests (core + sidecar + ui) |
| `pnpm typecheck` | Typecheck every workspace                     |
| `pnpm lint`      | Lint all workspaces                           |
| `pnpm format`    | Format every workspace                        |

The desktop app itself has no CLI; everything happens in the UI.

## Architecture

JobHunter is layered per `docs/architecture.md`:

| Layer        | Path               | Owns                                                         |
| ------------ | ------------------ | ------------------------------------------------------------ |
| Core library | `src/`             | Domain logic, persistence, browser, scoring — pure modules   |
| Sidecar      | `desktop/sidecar/` | Fastify HTTP server exposing the core library                |
| Tauri shell  | `desktop/tauri/`   | Window, menu, lifecycle, native notifications                |
| Frontend     | `desktop/ui/`      | React UI: dashboard, jobs, pipeline, runs, profile, settings |

`process.exit` lives only in `desktop/sidecar/src/server.ts` (the sidecar's process entrypoint). The Tauri shell supervises and terminates the sidecar child process. The sidecar's HTTP error mapper translates typed errors into status codes + JSON envelopes and never exits the process.

The scraper is built around a `BrowserSession` interface so the
production Playwright implementation and the test `FakeBrowserSession`
share the same contract.

## Development

Requires Node.js `24.18.0` (pinned via `.node-version`), pnpm
`11.25.0`, and a Rust toolchain for the Tauri shell.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

```bash
# Frontend-only build (produces desktop/ui/dist/ for Tauri to bundle).
pnpm --filter @jobhunter/ui build

# Full desktop app — Rust shell + sidecar + UI hot reload.
cargo tauri dev
```

## Testing strategy

- **Unit tests** cover domain rules, parsers, config validation, and
  the LinkedIn scraper's pure helpers.
- **Integration tests** run against a real SQLite database with the
  real Drizzle migrations and a `FakeBrowserSession`.
- **HTTP-shape fidelity tests** use the `PlaywrightRouteSession` helper
  to serve saved HTML fixtures through `context.route()` interception
  (no live network).
- **Live tests** are opt-in via `LINKEDIN_LIVE=1` and excluded from
  normal CI.

Saved HTML fixtures at `tests/linkedin/fixtures/*.html` are snapshots
of LinkedIn's public search page DOM used by the unit + integration
tests. They will go stale when LinkedIn changes its markup. When a
scraper test fails on selector drift, regenerate the affected
fixture(s) by navigating to a real LinkedIn public search page in an
incognito/private window (no cookies, no logged-in state, no PII),
saving the rendered HTML, and committing the update alongside any
selector changes in `src/linkedin/selectors.ts`.

## Constraints

- Strict TypeScript with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. No `any` in new code.
- Native ESM, NodeNext imports. No CommonJS.
- `process.exit` lives only in `desktop/sidecar/src/server.ts` (the sidecar's process entrypoint). The Tauri shell supervises and terminates the sidecar child process. The sidecar's HTTP error mapper translates typed errors into status codes + JSON envelopes and never exits the process.
- Runtime Playwright imports live only in
  `src/linkedin/playwright-session.ts`. Every other `src/linkedin/`
  file imports types only. Both rules are enforced by tests.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — canonical
  architecture reference.
- [`docs/desktop.md`](./docs/desktop.md) — desktop build, bundle,
  and ship instructions.
- [`docs/responsible-use.md`](./docs/responsible-use.md) — LinkedIn
  Terms-of-Service posture and user responsibilities.

## Contributing

Contributions welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
dev setup, testing strategy, architecture boundaries, and PR
conventions.

## Security

To report a vulnerability privately, see
[`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) — Copyright (c) 2026 leuri17.

JobHunter is not affiliated with, endorsed by, or sponsored by LinkedIn
or Microsoft. "LinkedIn" is a trademark of Microsoft Corporation. See
[`docs/responsible-use.md`](./docs/responsible-use.md) for the full
responsible-use policy.
