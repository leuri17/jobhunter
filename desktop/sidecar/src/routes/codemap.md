# desktop/sidecar/src/routes/

## Responsibility

Fastify HTTP route handlers bridging the desktop UI to the `@jobhunter/core`
service layer. Each file owns one resource (pipeline, profile, jobs, runs,
config, paths) and exposes a single `register*Routes(app, opts?)` entry point
that mounts the resource's URL surface. Thin handler bodies delegate every
business rule to core services; the only logic kept local is request
decoding, `AbortController` bookkeeping, and SSE framing.

## Design

- **One file per resource**, named after the mounted URL prefix.
- **Thin handlers**: parse params/query/body, call a core service, wrap the
  result in `{ schemaVersion: 1, ... }`. No domain logic in the handlers.
- **Helpers colocated** so handlers stay one-liners:
  - `db-helper.ts` — `openDbHandle()` initializes SQLite via
    `initializeDatabase(paths, { migrationsFolder })`; re-exports
    `createRepositories` so every handler can build the repo bundle.
  - `fs-adapter.ts` — `sidecarFileSystem: FileSystem` implements the core
    `FileSystem` interface over `node:fs/promises` (`readFile`, `writeFile`,
    `rename`, `mkdir`, `access`, `rm`), injected into `loadConfig` /
    `updateConfig`.
  - `openai-resolve.ts` — `resolveOpenAiClientOrNull()` lazily builds an
    `OpenAIClient` from the resolved secrets backend's store (falling back
    to `OPENAI_API_KEY`), with an optional `timeoutMs` override; returns
    `null` when unset so handlers can reply `503 openai_unavailable`.
  - `openai.ts` — `registerOpenAiRoutes()` exposes `GET /api/openai/models`
    (see the OpenAI bullet under Flow) with an injectable `listModels` seam.
- **SSE channel** (`pipeline.ts`) reuses `initSseHeaders` / `writeSseEvent` /
  `closeSse` from `../sse.ts`. A module-level `activeRuns: Map<runId,
ActiveRun>` tracks `AbortController` + ring-buffered logs (capped at
  `LOG_RING_BUFFER_MAX = 1000`).
- **Shutdown hook**: `abortAllActiveRuns()` is exported so `main()` can
  cancel in-flight orchestrators before the server closes.

## Flow

- **Pipeline**: `POST /api/pipeline/run` → `pipelineRunHandler` allocates
  `runId`, kicks off `runPipeline()` (fire-and-forget), returns `202`. The
  background routine assembles `LinkedInDiscoveryService`,
  `LinkedInExtractionService`, `FilterApplyService`, `ScoringService`,
  `PipelineOrchestrator`, and a tee-logger that mirrors pino into the run's
  log buffer. `POST /api/pipeline/:runId/cancel` (`pipelineCancelHandler`)
  trips the `AbortController`. `GET /api/pipeline/:runId/events`
  (`pipelineEventsHandler`) opens an SSE channel, `setInterval` polls every
  1s, drains buffered logs, emits `heartbeat`, then emits terminal `done`
  and deletes the run after a 60s TTL.
- **Profile**: `registerProfileRoutes` adds `@fastify/multipart` (50 MB
  limit). `profileImportHandler` accepts multipart filenames (v1 delegates
  to `ProfileImportService.importSources`); `profileExtractHandler` invokes
  `ProfileExtractionService.extract(usable)` over `OPENAI_MODEL ?? 'gpt-5'`;
  `profileApproveHandler` / `profileRejectHandler` run approval services
  with auto-confirming prompts; `profileEditHandler` returns `501
edit_via_http_not_supported` (interactive TUI prompts are out-of-band
  for an HTTP sidecar).
- **Jobs**: `jobsListHandler` (`GET /api/jobs`) parses filters
  (`state`, `limit`, `minScore`, `company`, `location`, `run` with
  `run_<id>` prefix stripping) into `JobsListService.list`. `jobsShowHandler`
  calls `JobsShowService.show`. `jobsReevaluateHandler` (`POST`) wires
  `ReevaluationService.execute` with `FilterApplyService` + `ScoringService`,
  defaulting `confirmScoring` to `false` so HTTP clients cannot trigger a
  scoring batch without explicit opt-in.
- **Runs**: `runsListHandler` (limit default 20) and `runsShowHandler`
  wrap `RunsListService` / `RunsShowService`.
- **Config**: `configGetHandler` loads via `loadConfig(paths,
sidecarFileSystem)`; `configPatchHandler` applies `ConfigPatch` through
  `updateConfig` with an auto-confirming `options.confirm`; `configValidateHandler`
  re-parses with `OperationalConfigSchema.safeParse`, throwing
  `ValidationError` on failure. The secrets api-key surface reads/writes the
  resolved secrets backend (`../secrets-backend.ts`): GET reports
  `configured`/`source`/`masked` plus `backend`/`backendReason`/
  `legacyFilePresent`; PUT validates first, then writes the backend (a
  keychain-unavailable fallback only writes the file with
  `allowPlaintextFallback: true` — otherwise `503
secrets_backend_unavailable`); DELETE clears through the backend;
  `POST /api/secrets/api-key/migrate` moves a legacy `secrets.json` key into
  the keychain, deleting the file only after a verified read-back
  (`legacy_shadowed` 409 when the keychain already holds a key,
  `secrets_migration_verification_failed` 500 on mismatch). `jobs.ts` /
  `pipeline.ts` resolve their API key through the same backend store.
- **OpenAI**: `openai.ts` registers `GET /api/openai/models` — the sorted
  model ids the effective key can access, via `OpenAIClient.listModels()`
  (`models.list()` auto-pagination, no token cost) on a 10 s client
  timeout. No key configured → `200 { configured: false, models: [] }`
  (a distinguishable outcome, not an error); probe failures reuse
  `classifyKeyValidationFailure` from `config.ts` (rejected key trio →
  401, otherwise 503). The lister is injectable through
  `buildServer({ listModels })` so tests stay off the network.
- **Paths**: `pathsGetHandler` exposes `resolvePlatformPaths(
createDefaultPlatformAdapter())` directories.

## Integration

- **Mounted by** `desktop/sidecar/src/server.ts` via the `register*Routes`
  exports; `abortAllActiveRuns` is invoked on shutdown.
- **SSE primitives** from `../sse.ts`.
- **Core service consumers** (via `@jobhunter/core/*`):
  `pipeline/` (`PipelineOrchestrator`, `pinoPipelineLogger`),
  `profile/` (`ProfileImportService`, `ProfileExtractionService`,
  `ProfileReviewService`, `ProfileApprovalService`,
  `ProfileRejectionService`, `createDefaultOpenAIClient`, `OpenAIClient`),
  `inspection/` (`JobsListService`, `JobsShowService`, `RunsListService`,
  `RunsShowService`), `reevaluation/` (`ReevaluationService`,
  `pinoReevaluationLogger`), `linkedin/`, `scoring/`, `filter/`,
  `diagnostics/`, `config/`, `errors/`.
- **Indirect dependency layer**: `persistence/` (SQLite initialization,
  repository bundle), `platform/` (`resolvePlatformPaths`,
  `createDefaultPlatformAdapter`) — both proxied through `db-helper.ts`.
