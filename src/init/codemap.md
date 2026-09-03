# src/init/

## Responsibility

First-run onboarding and bootstrap orchestrator. Walks ten prerequisites needed
to bring a fresh installation to a usable state: resolve OS paths, create
runtime directories, apply DB migrations, materialize `config.json`, validate
`OPENAI_API_KEY`, configure search filters, import CV sources, extract an
AI-generated profile draft, approve a profile version, and configure
deterministic job filters. Produces a typed `SetupSummary` consumed by the
desktop sidecar's Setup Wizard HTTP route and serialized as JSON for the response body.

## Design

- **Service-driven flow** — `InitOrchestrator` (`init-service.ts`) is the sole
  entry point; exposes `run(env)`. Composes existing barrels (`src/profile/`,
  `src/filter/`, `src/search/`, `src/config/`) without reaching into their
  internals. Honors AGENTS.md §5/§9 boundaries — no direct Playwright, Drizzle,
  OpenAI SDK, or Pino imports.
- **Per-step classification** — `classify.ts` exposes one pure `classify*`
  helper per prerequisite (`classifyPaths`, `classifyConfig`, `classifyExtract`,
  etc.) returning an `InitStepReport` with status `complete | incomplete |
  failed | not_started`. The orchestrator classifies first, then runs only
  the failing/incomplete step.
- **Step vocabulary** — `state.ts` defines `InitStepId`, `InitStepStatus`,
  `INIT_STEPS`, `INIT_STEP_LABELS`, `INIT_SCHEMA_VERSION`, and `SetupSummary`
  (with derived `ready`, `nextStep`, `openAiKeyMissing` flags).
- **Prompt seam** — `InitPrompts` (`prompts.ts`) abstracts interactive prompts
  (`askResume`, `askSourcePaths`, `askEditHandoff`, `confirmSummary`); the
  sidecar wires production adapters, tests inject `ScriptedInitPrompts` or
  `createFailingInitPrompts`.
- **OpenAI resolution** — `openai-resolve.ts` exports `resolveOpenAiClientOrNull`,
  a boundary helper reading `OPENAI_API_KEY` from `process.env`; absence is
  treated as skip-not-fail.
- **Logging seam** — `InitLogger` (`log.ts`) with `stepStart/Complete/Fail/Skip`
  events; production wraps `pinoInitLogger`, tests use `noopInitLogger`.
- **Typed errors** — `errors.ts` subclasses `InitLifecycleError` (extends
  `ApplicationError`) with pinned exit codes (`InitPathsFailedError`,
  `InitConfigSeedingFailedError`, `InitSearchFailedError`,
  `InitImportFailedError`, `InitExtractRuntimeFailedError`,
  `InitApprovalFailedError`, `InitFiltersFailedError`,
  `InitSummaryFailedError`); the sidecar maps them to HTTP status codes.
- **Summary renderer** — `format.ts` exports `formatInitSummary` for deterministic
  `<line>\n` rendering.

## Flow

1. `InitOrchestrator.run(env)` reads `OPENAI_API_KEY` from `env` to gate the
   `extract` step.
2. **paths** → `classifyPaths` (always `complete`; resolved at the boundary).
3. **directories** → `classifyDirectories` checks six runtime dirs via
   `fileSystem.pathExists`; on miss, calls `ensureRuntimeDirectories`.
4. **migrations** → `classifyMigrations` records the sidecar's
   `initializeDatabase` outcome (`migrationsApplied: true`).
5. **config** → `loadConfig` then `classifyConfig`; on `not_started`,
   `updateConfig` seeds defaults; on `failed`, surfaces `config_invalid`.
6. **openaiKey** → `classifyOpenAiKey` (always `complete`; key absence is a
   skip, surfaced via `classifyExtract.reason === 'openai_key_missing'`).
7. **search** → `classifySearch`; on incomplete, delegates to
   `runConfigureSearch` (`src/search/`) and persists via `updateConfig`;
   `SearchCancelledError` is rethrown.
8. **sources** → `classifySources`; on `not_started`, prompts via
   `askResume` + `askSourcePaths`, then `ProfileImportService.importSources`.
9. **extract** → `classifyExtract`; on `incomplete`, instantiates
   `ProfileExtractionService` with the injected `openaiClient`; failure maps
   to `InitExtractRuntimeFailedError`.
10. **approvedProfile** → `classifyApprovedProfile`; on `not_started`, prompts
    `askEditHandoff` and routes to `ProfileApprovalService` (approve/reject/
    edit-and-return/exit-init). Rejection preserves prior approved profile.
11. **filters** → `classifyFilters`; on incomplete, runs
    `ConfigureFiltersService` with injected `filterPrompts`.
12. `buildSummary()` returns `{ schemaVersion, ready, steps, nextStep,
    openAiKeyMissing }`.

## Integration

- **Host integration** — the desktop sidecar imports `InitOrchestrator`,
  `resolveOpenAiClientOrNull`, `InitPrompts`, and `pinoInitLogger` from the
  `@jobhunter/core/init` subpath, constructs the orchestrator with `PlatformPaths`,
  `Repositories`, `FileSystem`, and prompt adapters, then invokes `run(env)`
  inside the Setup Wizard HTTP route handler.
- **Profile pipeline** — successful bootstrap yields an active approved
  profile version (`profile_<id>`) consumed by `src/profile/` services and
  the downstream job-search pipeline (`src/search/`, `src/filter/`).
- **Output contract** — `formatInitSummary(summary)` is rendered to stdout;
  `SetupSummary` is also serialized as JSON via the sidecar's HTTP route.
- **Cancellation contract** — `UserCancellation` subclasses and
  `SearchCancelledError` are rethrown (exit 130); the sidecar maps them to
  HTTP status responses.
