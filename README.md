# JobHunter

> Local-first, public-anonymous LinkedIn scraper for the MVP. JobHunter
> discovers public search results, persists them, and surfaces a
> ranked short-list. No authentication, no third-party job source, no
> per-job data extraction beyond what the public search-results page
> already shows.

## Quick start

```bash
# Install dependencies (Node 24.18.0, pnpm 11.18.0)
pnpm install

# Initialize the database + write the default config
pnpm dev -- init

# Discover jobs from a public LinkedIn search
pnpm dev -- run --search='engineer' --location='Remote'

# Or pass the full pipeline options (search matrix from configured queries/locations):
pnpm dev -- run                    # human-readable run summary + top-N
pnpm dev -- run --yes              # skip the scoring-plan confirmation
pnpm dev -- run --json             # emit a single JSON document to stdout
# SIGINT once → graceful cancellation; twice → force exit.

# Reevaluate stored jobs after a config/profile change (SPEC §28).
pnpm dev -- jobs reevaluate                     # default: complete jobs with stale/missing filter or score
pnpm dev -- jobs reevaluate --filters-only      # rerun stale filters only, mark dependent scores stale
pnpm dev -- jobs reevaluate --scores-only       # skip jobs whose filter is stale/missing (filter_update_required)
pnpm dev -- jobs reevaluate --job job_42        # target a single complete job
pnpm dev -- jobs reevaluate --dry-run           # plan with no DB writes, no OpenAI calls
pnpm dev -- jobs reevaluate --dry-run --json    # single JSON document to stdout
pnpm dev -- jobs reevaluate --yes               # bypass only the OpenAI confirmation

# Print help
pnpm dev -- --help
```

## Architecture

JobHunter is structured into isolated layers per `SPEC.md §43.1` and
`AGENTS.md §5`:

| Layer       | Path                            | Owns                                 |
| ----------- | ------------------------------- | ------------------------------------ |
| CLI         | `src/cli.ts`                    | Argument parsing + exit-code mapping |
| Application | `src/<feature>/<service>.ts`    | Orchestrators + per-task services    |
| Domain      | `src/<feature>/` (pure modules) | Rules, parsers, validators           |
| Persistence | `src/persistence/`              | Drizzle + SQLite + repositories      |
| Browser     | `src/linkedin/`                 | Playwright + LinkedIn DOM            |
| Diagnostics | `src/diagnostics/`              | Capture strategies + artifacts       |
| Logging     | `src/logging/`                  | Pino adapter                         |

The scraper is built around a `BrowserSession` interface so the
production Playwright implementation and the test `FakeBrowserSession`
share the same contract (Plan Decision 2, Wave B).

## Development

```bash
# Typecheck (production + test configs)
pnpm typecheck

# Lint
pnpm lint

# Format check / apply
pnpm format:check
pnpm format

# Run the normal test suite
pnpm test

# Run the live tests (opt-in; uses real network)
LINKEDIN_LIVE=1 pnpm test:live

# Run the real-Playwright smoke tests (opt-in; needs Chromium binary)
PLAYWRIGHT_SMOKE=1 pnpm test tests/linkedin/playwright-session.smoke.test.ts
PLAYWRIGHT_SMOKE=1 pnpm test tests/linkedin/helpers/playwright-route-session.smoke.test.ts
```

The smoke tests require the Chromium binary:

```bash
pnpm exec playwright install chromium
```

### LinkedIn HTML fixtures

The fixture HTML files at `tests/linkedin/fixtures/*.html` are snapshots
of LinkedIn's public search page DOM used by the scraper's unit +
integration tests. They will go stale when LinkedIn changes its
markup. When a scraper test fails on selector drift, regenerate the
affected fixture(s) by:

1. Navigating to a real LinkedIn public search page in a browser.
2. Saving the rendered HTML.
3. Committing the update alongside any selector changes in
   `src/linkedin/selectors.ts`.

The selector map (`src/linkedin/selectors.ts`) is versioned
(`LINKEDIN_SELECTORS_MAP_VERSION`) so a stale fixture is visible via
the version mismatch.

## Testing strategy

- **Unit / pure tests:** cover domain rules, parsers, config
  validation, and the LinkedIn scraper's pure helpers (parser,
  navigation helper, load-more loop with a `FakePage`).
- **Integration tests:** run against a real SQLite database with the
  real Drizzle migrations + a `FakeBrowserSession` for the browser
  layer. The discovery-service test in
  `tests/linkedin/discovery-service.test.ts` exercises 9 scenarios
  covering the SPEC §21.3 walk.
- **HTTP-shape fidelity tests:** use the
  `PlaywrightRouteSession` helper to serve the saved HTML fixtures
  through `context.route()` interception (no live network).
- **Live tests:** opt-in via `LINKEDIN_LIVE=1`. Default behavior: all
  tests are skipped so the live suite exits 0 in CI.

## Constraints

- No `any` in new code.
- Type-only Playwright imports allowed in: `browser-session.ts`,
  `overlay.ts`, `load-more.ts`, `navigation.ts`,
  `discovery-service.ts`. Runtime Playwright imports allowed in:
  `playwright-session.ts` only (the sole runtime importer).
- Strict TypeScript, native ESM, NodeNext imports.
- `process.exit` lives in `src/cli.ts` only; domain code must throw
  typed errors that the CLI maps to exit codes.

See `AGENTS.md` for the full development ruleset and
`docs/superpowers/plans/2026-08-19-task-012-linkedin-discovery-result-loading.md`
for the TASK-012 plan + reconciliation notes.
