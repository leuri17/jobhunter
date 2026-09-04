# src/errors/

## Responsibility

Foundational error taxonomy for the sidecar. Defines the base `ApplicationError` class hierarchy, the stable process `ExitCode` mapping, and JSON serialization (`toJSON`) used by the desktop shell and HTTP error mapper to translate thrown errors into status responses and diagnostics.

## Design

- **`ExitCode` const + `ExitCodeValue` type** — frozen `as const` object enumerating `Success (0)`, `Fatal (1)`, `InvalidUsage (2)`, `MissingRequired (3)`, `LinkedInBlocked (4)`, `OpenAIFailure (5)`, `UserCancellation (130)`. Acts as the closed set of process exit codes.
- **`ApplicationError` (base)** — extends `Error`, immutable fields (`code`, `exitCode`, `metadata`, `cause`). Sets `name` from `constructor.name` to preserve subclass identity through stack traces. `toJSON()` emits an `ApplicationErrorJSON` (optionally including a flattened `cause: { name, message }`), enabling structured logging and HTTP transport without losing the `cause` chain.
- **Pinned-exit-code subclasses** — `PathError` (`Fatal`), `ConfigError` / `ValidationError` / `UnknownConfigError` (`InvalidUsage`), `LogConfigError` (`Fatal`). Each is a thin constructor that forwards to `ApplicationError` with a fixed `exitCode`, giving domain code ready-made categories without re-deriving codes.
- **`index.ts` barrel** — re-exports the public surface (`ExitCode`, all classes, `ExitCodeValue`, `ApplicationErrorMetadata`, `ApplicationErrorJSON`) for consumers that want a single import path.
- **Tagged-error extension pattern** — domain modules extend `ApplicationError` directly and either pin `exitCode` in the subclass constructor or accept an `exitCode` parameter (e.g. `LinkedInScraperError` taking `ExitCodeValue`), letting the codebase mix "fixed-code" and "configurable-code" leaves without changing the base.

## Flow

1. Domain code throws a subclass — either one defined here (`PathError`, `ConfigError`, `ValidationError`, `UnknownConfigError`, `LogConfigError`) or a module-local extension of `ApplicationError`.
2. The exception carries `(code, message, exitCode, metadata, cause)`; `name` reflects the throwing subclass.
3. Catchers inspect `instanceof ApplicationError`, read `code`/`exitCode`/`metadata`, and serialize via `toJSON()` for HTTP responses or structured logs. Embedders (sidecar route handlers, tests) use `exitCode` as the canonical category for uncaught throws.

## Integration

Direct importers of `../errors/application-error.js`:

- **`src/platform/paths.ts`** — `PathError`
- **`src/config/loader.ts`, `src/config/updater.ts`** — `ConfigError`, `ValidationError`, `UnknownConfigError`
- **`src/logging/logger.ts`** — `LogConfigError`
- Domain hierarchies extending `ApplicationError` + `ExitCode`: `src/linkedin/errors.ts` (and `src/linkedin/extraction/errors.ts`), `src/scoring/errors.ts`, `src/persistence/{errors,identifier-errors,repository-errors}.ts`, `src/inspection/errors.ts`, `src/reevaluation/errors.ts`, `src/pipeline/errors.ts` (overrides `exitCode` to `MissingRequired` post-super via cast), `src/init/errors.ts`, `src/filter/errors.ts`, `src/search/errors.ts`, `src/profile/errors.ts` (and `src/profile/openai/errors.ts`), `src/diagnostics/errors.ts`.

The barrel (`src/errors/index.ts`) is the intended public entry point; the sidecar's HTTP error mapper translates `ApplicationErrorJSON` payloads into HTTP responses (mapping `exitCode` to status: `InvalidUsage` (2) -> 400, `MissingRequired` (3) -> 404, `LinkedInBlocked` (4) -> 409, `OpenAIFailure` (5) -> 502, `UserCancellation` (130) -> 499, default -> 500). The `exitCode` field is the cross-runtime category token; tests assert on it directly.
