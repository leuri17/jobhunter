# src/logging/

## Responsibility

Pino-backed structured logging subsystem. Provides a single `Logger`
abstraction and a `LogContext` shape that every subsystem (pipeline,
scoring, reevaluation, linkedin, init) consumes via type-only imports.
Hides `pino` behind a barrel so no caller imports it directly except
through `src/logging/index.ts`.

## Design

- `logger.ts` — defines `LOG_LEVELS` (`trace`/`debug`/`info`/`warn`/
  `error`/`fatal`/`silent`), the `Logger` interface (six level methods
  plus `child()`), the open `LogContext` record (component, event,
  runId, searchId, jobId, errorCode + arbitrary keys), `LoggerOptions`
  (level, prettyTerminal, filePath?, redactPaths?), and
  `LoggerDestinations` (stdout + optional stderr).
- `createLogger(options, destinations?)` builds a Pino instance via
  `buildPino` (asserts level, merges `DEFAULT_REDACT_PATHS` with user
  paths, configures `multistream`, optionally appends a file stream
  created with `createWriteStream`), then wraps it through `adapt` so
  callers see only the domain `Logger` interface.
- `reevaluation-logger.ts` — `pinoReevaluationLogger(pino: Logger)`
  adapts the runtime `Logger` to the `ReevaluationLogger` port from
  `src/reevaluation/log.ts`. Every event maps to `pino.info` (or
  `pino.warn` for `reevaluationScoreFail`), stringifies numeric `*Id`
  fields to keep the `LogContext` ID-as-string contract, and tags each
  entry with `event: 'reevaluation.<verb>'`.
- `index.ts` is the public barrel re-exporting `LOG_LEVELS`,
  `createLogger`, all types, and `pinoReevaluationLogger`.

## Flow

`domain code` → `Logger.{trace|debug|info|warn|error|fatal}(context, msg)`
→ `adapt` wrapper → `pino.<level>(context, msg)` → `multistream` →
optional file stream (append) + stdout (and stderr when supplied).
`pinoReevaluationLogger` short-circuits the level choice for
reevaluation events and enforces the event-name convention.

## Integration

- Type-only `Logger` import: `src/pipeline/log.ts`,
  `src/scoring/log.ts`, `src/linkedin/log.ts`,
  `src/linkedin/extraction/log.ts`, `src/init/log.ts` — each defines
  its own domain logger port wrapping the shared `Logger`.
- Runtime wiring: the production logger is constructed in `desktop/sidecar/src/server.ts:createSidecarRootLogger`, which builds a `pino.Logger` directly with `DEFAULT_REDACT_PATHS` and a validated `LOG_LEVEL` from the environment. The domain `createLogger()` factory has no production caller — only its own test exercises it. Subsystem modules (`src/init/log.ts`, `src/pipeline/log.ts`, etc.) receive a `Logger` via type-only import and adapt it per-domain.
- `src/reevaluation/log.ts` defines the `ReevaluationLogger` port;
  `pinoReevaluationLogger` is the only adapter bridging that port to
  the runtime Pino client, mirroring `pinoPipelineLogger` /
  `pinoScoringLogger` patterns in their respective modules.
- Reevaluation adapter differs from generic `Logger` usage: it pins
  event names (`reevaluation.*`), coerces `*Id` fields to strings,
  and elevates failures to `warn` rather than letting callers choose.
