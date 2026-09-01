# Architecture

JobHunter is a local CLI that helps one job seeker discover public job
listings on LinkedIn, score them against their profile, and rank the
top matches. This document explains the architecture in prose form. For
setup and command reference, see [`README.md`](../README.md); for
LinkedIn Terms-of-Service posture, see
[`docs/responsible-use.md`](./responsible-use.md).

## Design principles

- **Local-first.** Everything runs on your machine. No hosted services,
  no telemetry, no account, no synchronization.
- **Single user, single profile.** JobHunter is designed for one job
  seeker using it on their own machine.
- **Inspectable.** Every persisted record is readable SQLite. Every
  log line is structured JSON.
- **Reproducible decisions.** Deterministic filters and fingerprints
  make filter and scoring results stable across runs given the same
  inputs.
- **Bounded execution.** Sequential scraping, timeouts, and retry
  caps. No parallelism by design.
- **Strict typing.** TypeScript strict mode with `noUncheckedIndexedAccess`
  and `exactOptionalPropertyTypes`. Zod validates every external,
  persisted, CLI, profile, filter, OpenAI, and JSON boundary.

## Layered structure

| Layer | Lives in | Owns |
| --- | --- | --- |
| CLI | `src/cli.ts` | Commander argument parsing; the only file that calls `process.exit`. |
| Application | `src/<feature>/<service>.ts` | Orchestrators that compose domain logic with persistence and the browser. |
| Domain | `src/<feature>/` (pure modules) | Rules, parsers, validators — no I/O. |
| Persistence | `src/persistence/` | Drizzle ORM, SQLite, repositories, migrations. |
| Browser | `src/linkedin/` | Playwright + LinkedIn DOM. |
| Diagnostics | `src/diagnostics/` | Capture strategies + artifact persistence (operator-only, never sent off-machine). |
| Logging | `src/logging/` | Pino adapter; log records go to stderr, never to stdout. |

The scraper is built around a `BrowserSession` interface so the
production Playwright implementation and the test `FakeBrowserSession`
share the same contract.

## Pipeline stages

When you run `jobhunter run`, the orchestrator walks these stages in
order:

1. **Initialization.** Resolve the OS-specific paths, ensure directories
   exist, initialize SQLite, apply pending migrations, write a default
   `config.json` if missing, validate the `OPENAI_API_KEY` without
   persisting it.
2. **Search-matrix generation.** Produce the Cartesian product of every
   configured search query × every configured location; build the
   LinkedIn URL for each pair with `sortBy=DD` always included.
3. **LinkedIn discovery.** For each URL, navigate, validate the page,
   dismiss recoverable overlays, discover job cards, iterate job IDs,
   load more results, and stop on a deterministic end condition.
4. **Job extraction.** For each discovered job, attempt extraction from
   the embedded panel first, then from the dedicated job page as a
   fallback. Persist complete, partial, and failed outcomes.
5. **Deterministic filtering.** Apply your local keyword, seniority, and
   language filters. No LLM involvement.
6. **Scoring-plan confirmation.** Show what will be scored; ask for
   confirmation unless `--yes`.
7. **LLM scoring.** For each accepted job, send the profile + extracted
   job to OpenAI; parse the structured response with Zod; persist.
8. **Ranking.** Apply the deterministic weighted-score formula; rank
   by descending score.
9. **Terminal output.** Show the top N (default 20) in a human-readable
   table or as a single JSON document with `--json`.
10. **Run finalization.** Persist the run summary with the configuration
    snapshot.

## The LinkedIn scraper — public, unauthenticated, bounded

JobHunter only accesses LinkedIn's **public, unauthenticated**
job-search pages. Concretely:

- It does not log in.
- It does not store or transmit credentials.
- It does not access authenticated content.
- It reuses no session state across runs.
- It scrapes one search at a time (sequential, never parallel).
- It uses bounded timeouts and a retry cap (3 attempts per page).
- It stops on LinkedIn-side blocks (auth wall, captcha) with a typed
  `LinkedInBlocked` error and exit code 4. No bypass.

For full policy and user-facing responsibilities, see
[`docs/responsible-use.md`](./responsible-use.md).

## Profile lifecycle

A profile moves through four statuses:

1. **`draft`** — extracted from imported CV sources via OpenAI; not
   yet usable for filtering or scoring.
2. **`approved`** — explicitly approved by the user via the
   interactive editor; becomes the active profile.
3. **`rejected`** — explicitly rejected; preserved but inactive.
4. **`superseded`** — replaced by a newer approved profile; preserved
   for traceability.

Conflicts between sources (when two CV sources disagree) must be
resolved by explicit user action. Profiles with unresolved
`blocking_conflict` warnings cannot be approved.

## Filtering

Filtering is fully deterministic — it never calls OpenAI. The filter
config is global (one set of rules applies to every job regardless of
search query, location, or pipeline run).

Rules cover:

- Excluded companies (normalized exact match).
- Title and description keywords — excluded or required-any.
- Seniority cap (the highest seniority term in the title; titles
  above the cap are rejected).
- Accepted languages (only when a job description explicitly requires
  a non-accepted language is it rejected; ambiguous references don't
  trigger rejection).

Filter results are fingerprinted so a job with stable inputs doesn't
need to be re-filtered when the profile or filter config is unchanged.

## Scoring

Scoring uses OpenAI to evaluate each accepted job against your
approved profile. Inputs are limited to: the profile, the job's
extracted title, company, location, and normalized description, and a
versioned rubric. Outputs are validated with Zod and persisted with
their request hashes + token usage. Raw prompts and raw responses
are **not** persisted by default.

The final overall score is computed deterministically from the seven
category scores using a fixed weighted formula.

## Persistence

SQLite is the source of truth for everything that requires history,
identity, approval, or lifecycle management:

- Imported profile sources (immutable copies with SHA-256 hashes).
- Profile drafts, revisions, conflicts, warnings, and approval history.
- Manual derived-value overrides.
- Global filter configuration versions (immutable history).
- Pipeline runs, search executions, jobs, discovery events, errors.
- Extraction attempts, filter results, score results, diagnostic
  artifact references.

Foreign keys are enforced. Every migration is committed.

## Configuration

Configuration is persisted in OS-specific JSON (`config.json`). The
schema is Zod-validated and `.strict()` — unknown properties are
rejected. The `OPENAI_API_KEY` is read from the environment, never
persisted.

Defaults match what's documented in the schema; nothing is implicit.
Use `jobhunter config show` to inspect the normalized configuration
and `jobhunter config validate` to check it.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 1 | Fatal (uncaught throw that isn't an `ApplicationError`) |
| 2 | Invalid usage (unknown option, missing argument, malformed identifier) |
| 3 | Missing required (`OPENAI_API_KEY`, no active profile, no active filter) |
| 4 | LinkedIn blocked (auth wall, captcha, or other access block) |
| 5 | OpenAI failure (scoring / extraction failed) |
| 130 | User cancellation (SIGINT — graceful or forced) |

`--help` and `--version` exit 0.

## Reliability invariants

A handful of cross-cutting invariants are non-negotiable:

- JSON stdout stays clean. Every log record goes to stderr; nothing
  else writes to stdout during `--json` execution.
- A single SIGINT triggers a graceful cancellation between pipeline
  steps; a second SIGINT force-exits.
- One job's failure never terminates the whole run. Search-level or
  browser-level failures terminate the affected search or run only
  when safe continuation is impossible; already-persisted data
  remains.
- Diagnostic artifacts (screenshots, traces, HTML snapshots) are
  written under the OS-specific diagnostics directory only. They
  never reach stdout, stderr, or any networked destination.

These are checked by automated tests; see `CONTRIBUTING.md` for the
full verification commands.
