# Repository Atlas: jobhunter

## Project Responsibility

Local-first job-search automation for LinkedIn. The core TypeScript package (`@jobhunter/core`, rooted at `src/`) drives a Playwright-based scraper over public LinkedIn job search results, normalizes and extracts structured job data with OpenAI models, applies deterministic filters plus LLM scoring against a candidate profile, and persists everything to a local SQLite database through Drizzle ORM. A Tauri v2 desktop application (`desktop/`) wraps the same core behind a Fastify HTTP sidecar and a React UI.

Runtime baseline: Node `>=24.18.0 <25`, ESM-only (`"type": "module"`), pnpm `11.25.0`.

## System Entry Points

| File | Configures |
| --- | --- |
| `package.json` | Private workspace root `jobhunter`. Shared runtime deps (`playwright`, `openai`, `drizzle-orm`, `better-sqlite3`, `pino`, `pdf-parse`, `zod`) and scripts: `typecheck` (`pnpm -r`), `lint`/`lint:fix`, `format`/`format:check`, `test`, `test:coverage`, `test:acceptance`, `test:live`, `test:live:list`, `db:generate`. |
| `pnpm-workspace.yaml` | pnpm workspaces: `src`, `desktop/sidecar`, `desktop/ui`. `allowBuilds` denies `better-sqlite3` postinstall builds and permits `esbuild`; `minimumReleaseAgeExclude` pins `better-sqlite3@13.0.3`. |
| `tsconfig.base.json` | Shared strict compiler baseline: `target`/`lib` ES2023, `module`/`moduleResolution` NodeNext, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noImplicitOverride`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `isolatedModules`. |
| `tsconfig.json` | Root typecheck project extending the base: `noEmit`, `lib: ["ES2023","DOM"]`, relaxes `noPropertyAccessFromIndexSignature`; includes `src/**/*` and `tests/**/*`, excludes `desktop`, `dist`, `node_modules`. |
| `tsconfig.test.json` | Test-scoped project extending `tsconfig.json` with `rootDir: "."`; includes `src/**/*.ts`, `tests/**/*.ts`, and both vitest config files. |
| `drizzle.config.ts` | Drizzle Kit with SQLite dialect: `schema: ./src/persistence/schema.ts`, migrations `out: ./drizzle`, `verbose`, `strict`. Drives `pnpm db:generate`. |
| `eslint.config.mjs` | Flat config: `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-config-prettier`, Node globals, customized `@typescript-eslint/no-unused-vars` (`^_` ignore patterns). `globalIgnores` covers `dist`, `node_modules`, `coverage`, `.worktrees`, `.superpowers`, `docs`, `drizzle`, `desktop/tauri/target`. |
| `vitest.config.ts` | Default unit/acceptance suite: includes `tests/**/*.test.ts`, excludes `tests/live/**`, v8 coverage provider. |
| `vitest.live.config.ts` | Network-touching suite: includes only `tests/live/**/*.test.ts` with `passWithNoTests`. |

## Directory Map (Aggregated)

| Directory | Responsibility Summary | Detailed Map |
| --- | --- | --- |
| `src/` | `@jobhunter/core` library package root; private ESM, ESM subpath `exports` map (`./pipeline`, `./persistence`, `./linkedin`, `./scoring`, `./profile`, `./filter`, `./search`, `./config`, `./logging`, `./platform`, `./errors`, `./diagnostics`, `./reevaluation`, `./inspection`, `./init`). No CLI — consumed by the sidecar and tests via subpath imports. | [View Map](src/codemap.md) |
| `src/config/` | Configuration loading, environment/secret resolution, and schema validation. | [View Map](src/config/codemap.md) |
| `src/persistence/` | SQLite access via `better-sqlite3` + Drizzle ORM; schema definition consumed by Drizzle Kit. | [View Map](src/persistence/codemap.md) |
| `src/persistence/repositories/` | Table-scoped repository layer over the Drizzle client. | [View Map](src/persistence/repositories/codemap.md) |
| `src/pipeline/` | End-to-end run orchestrator wiring search, discovery, extraction, filtering, scoring, and persistence. | [View Map](src/pipeline/codemap.md) |
| `src/search/` | Search query/URL construction and search-plan derivation. | [View Map](src/search/codemap.md) |
| `src/linkedin/` | Playwright browser session management and LinkedIn job discovery. | [View Map](src/linkedin/codemap.md) |
| `src/linkedin/extraction/` | DOM/HTML parsing and structured field extraction from job pages. | [View Map](src/linkedin/extraction/codemap.md) |
| `src/filter/` | Deterministic pre-scoring filters and exclusion rules. | [View Map](src/filter/codemap.md) |
| `src/scoring/` | OpenAI-backed job/profile fit scoring and rationale generation. | [View Map](src/scoring/codemap.md) |
| `src/profile/` | Candidate profile domain: ingestion, storage shape, and lifecycle. | [View Map](src/profile/codemap.md) |
| `src/profile/extractors/` | Profile source extractors (e.g. resume/PDF via `pdf-parse`). | [View Map](src/profile/extractors/codemap.md) |
| `src/profile/editing/` | Profile mutation and edit-application logic. | [View Map](src/profile/editing/codemap.md) |
| `src/profile/review/` | Profile review/confirmation workflow. | [View Map](src/profile/review/codemap.md) |
| `src/profile/openai/` | OpenAI client plumbing and prompts for profile operations. | [View Map](src/profile/openai/codemap.md) |
| `src/init/` | First-run initialization: database bootstrap and workspace setup. | [View Map](src/init/codemap.md) |
| `src/reevaluation/` | Re-scoring of previously persisted jobs after profile or criteria changes. | [View Map](src/reevaluation/codemap.md) |
| `src/diagnostics/` | Diagnostic reporting and run introspection helpers. | [View Map](src/diagnostics/codemap.md) |
| `src/diagnostics/capture/` | Artifact capture (HTML/screenshot/trace) for failed or suspect runs. | [View Map](src/diagnostics/capture/codemap.md) |
| `src/inspection/` | Read-only inspection surface over persisted runs and jobs. | [View Map](src/inspection/codemap.md) |
| `src/inspection/services/` | Query/aggregation services backing inspection views. | [View Map](src/inspection/services/codemap.md) |
| `src/errors/` | Typed error hierarchy and error classification. | [View Map](src/errors/codemap.md) |
| `src/logging/` | Structured logging via `pino` (`pino-pretty` in development). | [View Map](src/logging/codemap.md) |
| `src/platform/` | Platform/OS abstractions: paths, filesystem, and process concerns. | [View Map](src/platform/codemap.md) |
| `drizzle/` | Generated SQL migrations and Drizzle Kit metadata (`out` target of `drizzle.config.ts`). | [View Map](drizzle/codemap.md) |
| `desktop/` | Desktop application workspace: Tauri shell + sidecar + UI. | — |
| `desktop/sidecar/` | `@jobhunter/sidecar`: Fastify 5 HTTP bridge exposing core capabilities to the UI; run via `tsx`. | [View Map](desktop/sidecar/codemap.md) |
| `desktop/sidecar/src/` | Server bootstrap (`src/server.ts`), plugin registration (`@fastify/cors`, `@fastify/multipart`), and shared handlers. | [View Map](desktop/sidecar/src/codemap.md) |
| `desktop/sidecar/src/routes/` | HTTP route modules mapping endpoints onto `@jobhunter/core` subpaths. | [View Map](desktop/sidecar/src/routes/codemap.md) |
| `desktop/ui/` | `@jobhunter/ui`: React 19 + Vite frontend with TanStack Router/Query, Radix UI, Tailwind CSS v4; Vitest + Playwright tests. | [View Map](desktop/ui/codemap.md) |
| `desktop/ui/src/lib/` | UI utilities: sidecar API client, query setup, and shared helpers. | [View Map](desktop/ui/src/lib/codemap.md) |
| `desktop/tauri/` | `jobhunter-desktop` Rust crate (Tauri v2, edition 2021, MSRV 1.77) with `tauri-plugin-single-instance` and `tauri-plugin-notification`. | [View Map](desktop/tauri/codemap.md) |
| `desktop/tauri/src/` | Rust sources for the shell: sidecar process supervision (`tokio` process/IO), commands, and window wiring. | [View Map](desktop/tauri/src/codemap.md) |

## Architecture

- **Core (`src/`)** — a library package, not a CLI. `@jobhunter/core` exposes configuration (`src/config/`), logging (`src/logging/`), and persistence (`src/persistence/`) plus bounded-context service modules via subpath exports. The sidecar (`desktop/sidecar/`) is the only host that embeds and invokes the core at runtime; tests embed it directly.
- **Pipeline flow** — `search/` builds the search plan → `linkedin/` drives Playwright discovery and `linkedin/extraction/` parses job detail pages → `filter/` applies deterministic exclusions → `scoring/` performs OpenAI fit scoring against the candidate profile from `profile/` → results are written through `persistence/repositories/` into SQLite. `diagnostics/` captures artifacts on failure; `reevaluation/` and `inspection/` operate on already-persisted data.
- **Schema/migrations** — `src/persistence/schema.ts` is the single source of truth; Drizzle Kit generates SQL into `drizzle/`.
- **Desktop (`desktop/`)** — the Tauri v2 Rust shell (`desktop/tauri/`) spawns and supervises the Node sidecar (`desktop/sidecar/`), which exposes `@jobhunter/core` over HTTP; the React UI (`desktop/ui/`) is served in the Tauri webview and talks to the sidecar via its API client in `desktop/ui/src/lib/`.
