# JobHunter

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/leuri17/jobhunter/actions/workflows/ci.yml/badge.svg)](https://github.com/leuri17/jobhunter/actions/workflows/ci.yml)
[![Node >= 24.18.0](https://img.shields.io/badge/node-%3E%3D24.18.0-brightgreen)](.node-version)
[![pnpm 11.18.0](https://img.shields.io/badge/pnpm-11.18.0-blue)](package.json)

> Local-first CLI that scrapes public LinkedIn job search results,
> persists them locally, and ranks them with deterministic filters plus
> OpenAI scoring.

JobHunter helps one job seeker discover job listings on LinkedIn,
apply their own deterministic filters, and rank the survivors against
their profile using OpenAI. Everything runs on your machine; nothing
is sent anywhere except your local SQLite database and the two
outbound HTTP calls you explicitly authorize (one to LinkedIn's
public search pages, one to OpenAI for scoring).

## Demo

A short terminal recording of the basic flow lives at
[`docs/demo.gif`](./docs/demo.gif). The source tape is
[`docs/demo.tape`](./docs/demo.tape); re-render with `vhs docs/demo.tape`.

## Quick start

```bash
# Install dependencies (Node 24.18.0, pnpm 11.18.0).
pnpm install

# Initialize the database + write the default config.
pnpm dev init

# Configure your searches and locations interactively.
pnpm dev configure search

# Run the full pipeline (requires OPENAI_API_KEY in your env).
pnpm dev run --yes

# Inspect results as JSON.
pnpm dev jobs list --json

# See resolved OS-specific runtime paths.
pnpm dev paths
```

`--help` exits 0 and prints the help text to stdout. SIGINT (Ctrl-C)
once cancels the current run gracefully; twice force-exits. See
[`docs/architecture.md`](./docs/architecture.md) for the full pipeline
walkthrough.

## Commands

JobHunter's CLI is small and explicit. Run `pnpm dev --help` for
the full list with descriptions; the most-used commands:

| Command | What it does |
| --- | --- |
| `pnpm dev paths` | Print the resolved OS-specific runtime paths. |
| `pnpm dev init` | Interactively initialize (paths, config, profile, filters). Resumable. |
| `pnpm dev configure search` | Interactively configure LinkedIn search settings. |
| `pnpm dev configure filters` | Interactively configure the global deterministic filter set. |
| `pnpm dev profile import <path>` | Import one or two CV source files. |
| `pnpm dev profile extract` | Extract a structured profile from imported sources via OpenAI. |
| `pnpm dev profile list` | List every persisted profile version. |
| `pnpm dev profile show <id>` | Print the review summary for a profile version. |
| `pnpm dev profile approve <id>` | Approve a draft profile version. |
| `pnpm dev profile reject <id>` | Reject a draft profile version. |
| `pnpm dev profile edit <id>` | Interactively edit a draft profile version. |
| `pnpm dev run` | Run the full discovery + extraction + filtering + scoring pipeline. |
| `pnpm dev jobs list` | List jobs filtered by state and refinements. |
| `pnpm dev jobs show <job-id>` | Print the full payload for a single job. |
| `pnpm dev jobs reevaluate` | Reevaluate stored jobs (filters-only / scores-only / --job / --dry-run). |
| `pnpm dev runs list` | List recent pipeline runs. |
| `pnpm dev runs show <run-id>` | Print the full payload for a single run. |

Most read-only commands accept `--json` to emit a single JSON document
to stdout. Logs go to stderr. See [`docs/architecture.md`](./docs/architecture.md)
for the JSON-envelope contract.

## Architecture

JobHunter is layered per `docs/architecture.md`:

| Layer | Path | Owns |
| --- | --- | --- |
| CLI | `src/cli.ts` | Commander argument parsing + the only `process.exit` site |
| Application | `src/<feature>/<service>.ts` | Orchestrators that compose domain logic with persistence and the browser |
| Domain | `src/<feature>/` (pure modules) | Rules, parsers, validators |
| Persistence | `src/persistence/` | Drizzle ORM + SQLite + repositories |
| Browser | `src/linkedin/` | Playwright + LinkedIn DOM |
| Diagnostics | `src/diagnostics/` | Capture strategies + artifact persistence |
| Logging | `src/logging/` | Pino adapter; logs go to stderr |

The scraper is built around a `BrowserSession` interface so the
production Playwright implementation and the test `FakeBrowserSession`
share the same contract.

## Development

Requires Node.js `24.18.0` (pinned via `.node-version`) and pnpm
`11.18.0`.

```bash
pnpm install --frozen-lockfile
pnpm dev --help            # confirm CLI runs
```

```bash
# Typecheck (production + test configs)
pnpm typecheck

# Lint
pnpm lint

# Format check / apply
pnpm format:check
pnpm format

# Build (tsc → dist/)
pnpm build

# Run the normal test suite
pnpm test

# Run live tests (opt-in; uses real LinkedIn)
LINKEDIN_LIVE=1 pnpm test:live
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
- `process.exit` lives only in `src/cli.ts`; domain code throws typed
  errors that the CLI maps to exit codes.
- Runtime Playwright imports live only in
  `src/linkedin/playwright-session.ts`. Every other `src/linkedin/`
  file imports types only. Both rules are enforced by tests.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — canonical
  architecture reference.
- [`docs/responsible-use.md`](./docs/responsible-use.md) — LinkedIn
  Terms-of-Service posture and user responsibilities.

## Contributing

Contributions welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
dev setup, testing strategy, architecture boundaries, exit codes, and
PR conventions.

## Security

To report a vulnerability privately, see
[`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) — Copyright (c) 2026 leuri17.

JobHunter is not affiliated with, endorsed by, or sponsored by LinkedIn
or Microsoft. "LinkedIn" is a trademark of Microsoft Corporation. See
[`docs/responsible-use.md`](./docs/responsible-use.md) for the full
responsible-use policy.
