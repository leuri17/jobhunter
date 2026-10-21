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
- `rotate-file.ts` — `createRotatingFileStream(options)` returns an
  append-mode `Writable` that rolls over at `maxBytes` (default 5 MB)
  and retains `maxFiles` generations (`jobhunter.log`, `jobhunter.1.log`
  …). `resolveDefaultLogPath(paths)` derives the sidecar's log
  destination from `PlatformPaths.logs`. The stream instance registered
  with pino never changes — rotation swaps the underlying file handle in
  place — so no write can land in a file it did not start in. Every
  filesystem failure (open, write, shift) degrades to an `onError`
  callback writing a `log.file.error` line to stderr rather than an
  emitted `'error'`, because an unhandled `'error'` on a pino
  destination stream would terminate the sidecar. A missing parent
  directory is created at open.
- `index.ts` is the public barrel re-exporting `LOG_LEVELS`,
  `createLogger`, all types, `pinoReevaluationLogger`, and the
  `rotate-file.js` surface.

## Flow

`domain code` → `Logger.{trace|debug|info|warn|error|fatal}(context, msg)`
→ `adapt` wrapper → `pino.<level>(context, msg)` → `multistream` →
optional file stream (append) + stdout (and stderr when supplied).
`pinoReevaluationLogger` short-circuits the level choice for
reevaluation events and enforces the event-name convention.

### Redaction path policy (audit B1-M1)

`DEFAULT_REDACT_PATHS` enumerates 11 secret-bearing key names. Every
entry is also re-emitted with four wildcard forms so a secret at
any of the shapes a caller might use is covered.

The five forms emitted per key `k`:

- `k` — top-level only.
- `*.k` — one-level wildcard (`obj.k`).
- `*.*.k` — two-level wildcard (`obj.obj.k`).
- `[*].k` — array-element wildcard at top level. **Note:** pino
  10.3.1's `@pinojs/redact` 0.4 does NOT match this form on its own
  (it requires an explicit parent for array-element paths, e.g.
  `messages[*].k`). The path is included for spec parity and as a
  no-op when nothing matches.
- `*.[*].k` — top-level array of objects with `k` (the common
  "messages: [{prompt: ...}]" shape).

Pino's wildcard syntax is **positional, not recursive**: `*.k` only
matches ONE level of nesting. The `**` form documented in pino's API
surface does NOT actually recurse in this version (it behaves
identically to `*.*`); the implementation in
`@pinojs/redact/index.js:selectiveClone` only walks the parts
sequence literally. So we enumerate the practical depths
explicitly (1 and 2 levels) rather than relying on `**`.

**Convention for future contributors.** When adding a new
secret-bearing key to `DEFAULT_REDACT_PATHS`, add it to the
`SECRET_KEYS` tuple at the top of `logger.ts` (NOT directly to the
exported array). The array literal spreads the tuple plus its
wildcard forms automatically, so adding a single new entry keeps the
five-form invariant intact without having to update four more lines
by hand.

`logger.ts`' Set-based merge at `buildPino` deduplicates the
wildcard set against any caller-supplied `options.redactPaths`, so
callers can add their own wildcard paths without conflicting with
the defaults.

## Integration

- Type-only `Logger` import: `src/pipeline/log.ts`,
  `src/scoring/log.ts`, `src/linkedin/log.ts`,
  `src/linkedin/extraction/log.ts`, `src/init/log.ts` — each defines
  its own domain logger port wrapping the shared `Logger`.
- Runtime wiring: the sidecar's root logger is constructed in `desktop/sidecar/src/server.ts:createSidecarRootLoggerFromConfig` when `BuildServerOptions.paths` is provided. It merges `config.logging.{level, prettyTerminal}` with `process.env.LOG_LEVEL` (env is the fallback when the config is missing or fails to load) and emits a `pino.Logger` with `DEFAULT_REDACT_PATHS`. `prettyTerminal: true` routes the console sink through the `pino-pretty` worker transport (declared as a runtime dep of `@jobhunter/sidecar`). When `paths` is supplied the logger **always** adds a `createRotatingFileStream` destination at `resolveDefaultLogPath(paths)`; the destination is not user-configurable and `logging.filePath` no longer exists in the config schema (issue #196). Omitting `paths` leaves the logger console-only, which is the legacy path the sidecar tests exercise. `createSidecarRootLogger` remains the env-only helper. The domain `createLogger()` factory has no production caller — only its own test exercises it — and still accepts an optional `filePath` for that reason. Subsystem modules (`src/init/log.ts`, `src/pipeline/log.ts`, etc.) receive a `Logger` via type-only import and adapt it per-domain.
- `src/reevaluation/log.ts` defines the `ReevaluationLogger` port;
  `pinoReevaluationLogger` is the only adapter bridging that port to
  the runtime Pino client, mirroring `pinoPipelineLogger` /
  `pinoScoringLogger` patterns in their respective modules.
- Reevaluation adapter differs from generic `Logger` usage: it pins
  event names (`reevaluation.*`), coerces `*Id` fields to strings,
  and elevates failures to `warn` rather than letting callers choose.
