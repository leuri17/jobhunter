# desktop/sidecar/

## Responsibility
Node.js HTTP sidecar process that exposes the core `src/` (monorepo `@jobhunter/core`)
functionality to the Tauri desktop UI. Spawned and supervised by the Tauri shell
(`desktop/tauri/src/sidecar.rs`); the host reads `READY <port>` from stdout and binds
HTTP/SSE calls to `127.0.0.1`. Hosts the pipeline runner, init/reevaluation endpoints,
and inspection routes for jobs, runs, profile, config, and resolved filesystem paths.

## Design
Fastify 5 (`fastify`) HTTP server with typed route modules and a global error handler
that maps domain errors (`statusFor` / `envelopeFor` in `errors.ts`) into JSON envelopes.
Cross-cutting plugins: `@fastify/cors` and `@fastify/multipart`. SSE live updates are
implemented via a thin helper (`src/sse.ts`) that writes `text/event-stream` frames
directly to `node:http.ServerResponse`, used by long-running pipeline routes. Process
config comes from `readEnv()` (`src/env.ts`); logging is Fastify's pino at `LOG_LEVEL`
(default `info`). ESM (`"type": "module"`), executed with `tsx` in dev/`start`, built
with `tsc` (`build` script) to `dist/`.

## Flow
`main()` -> `readEnv()` -> `buildServer()` -> Fastify `listen({ host, port })` ->
stdout `READY <port>`. Per-request lifecycle: HTTP/SSE request -> typed route handler
under `src/routes/` -> call into `@jobhunter/core` (pipeline, init, reevaluation,
inspection) -> JSON envelope or SSE stream back to the Tauri UI. SIGTERM/SIGINT
triggers `shutdown()` which calls `abortAllActiveRuns()`, races `server.close()`
against a 5s timeout, and exits with status derived from the race result.

## Integration
Sub-maps:
- [src/](desktop/sidecar/src/codemap.md) — `server.ts` entry, `env.ts`, `errors.ts`, `sse.ts`
- [routes/](desktop/sidecar/src/routes/codemap.md) — `paths`, `config`, `profile`, `jobs`, `runs`, `pipeline` (`pipeline.ts` owns SSE streams and run abort)

Consumes: `@jobhunter/core` (workspace dep), `fastify`, `@fastify/cors`,
`@fastify/multipart`, `tsx`. Dev: `vitest`, `typescript`, `@types/node`.
Launched and managed by the Tauri shell (`desktop/tauri/src/sidecar.rs`).

Scripts: `dev` (tsx watch), `start` (tsx), `build` (tsc), `typecheck` (tsc --noEmit), `test` (vitest run).