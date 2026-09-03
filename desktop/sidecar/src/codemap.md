# desktop/sidecar/src/

HTTP server entry point for the Jobhunter sidecar process. Boosts a Fastify instance, loads runtime configuration, wires shared error mapping, exposes an SSE helper, and registers the route modules that back the Tauri UI.

## Responsibility

- HTTP server bootstrap and lifecycle (Fastify).
- Runtime configuration loader (`env.ts`).
- SSE response primitive used by streaming routes (`sse.ts`).
- Error → HTTP status / JSON envelope mapping (`errors.ts`).

## Design

- **Fastify app**: `buildServer` constructs a `FastifyInstance` with a JSON logger (`LOG_LEVEL`), a global error handler that delegates to `statusFor` + `envelopeFor`, and a `/api/health` probe. Each route module from `./routes/` is mounted via `register*Routes` / `registerPathsRoute`.
- **Env loader** (`readEnv`): parses `JOBHUNTER_SIDECAR_PORT` (integer, `0` for OS-assigned); host is pinned to `127.0.0.1`. Returns the immutable `SidecarEnv` contract consumed by `buildServer`.
- **SSE helper** (`initSseHeaders`, `writeSseEvent<T>`, `closeSse`): low-level wrappers around `node:http.ServerResponse` that set `text/event-stream` headers, serialize `event:` / multi-line `data:` frames, and terminate the stream.
- **Error middleware** (`statusFor`, `envelopeFor`): maps `ApplicationError.exitCode` to HTTP semantics (`2→400`, `3→404`, `4→409`, `5→502`, else `5xx`/`500`) and produces a versioned `{ schemaVersion, error: { code, message, details } }` envelope.
- **Shutdown**: `main` installs `SIGTERM`/`SIGINT` handlers that abort in-flight pipeline runs (`abortAllActiveRuns`), race `server.close()` against a 5 s deadline, and exit non-zero on timeout.

## Flow

`main()` → `readEnv()` → `buildServer({ env })` → register routes (paths, config, profile, jobs, runs, pipeline) → `server.listen({ port, host })` → emit `READY <port>` on stdout. Routes stream progress via `initSseHeaders` + `writeSseEvent`. Errors thrown inside handlers reach `setErrorHandler`, which returns `envelopeFor(error)` with `statusFor(error)`. On signal, `abortAllActiveRuns()` then `server.close()` (5 s race) → `process.exit`.

## Integration

- Consumes: route modules under [./routes/](desktop/sidecar/src/routes/codemap.md); `ApplicationError` from `@jobhunter/core/errors`; `node:http.ServerResponse` for SSE.
- Consumed by: the Tauri host process, which spawns the sidecar, reads the `READY <port>` line from stdout, and issues HTTP/SSE calls against the bound `127.0.0.1` port.
