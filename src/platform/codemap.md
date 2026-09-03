# src/platform/

## Responsibility

Platform/OS abstraction layer: exposes the host platform identifier, user home directory, and process environment through a single `PlatformAdapter` seam, and resolves the canonical filesystem slots (`config`, `data`, `logs`, `diagnostics`, `cache`, `profileSources`) used by every persistence-, config-, and profile-touching module. Owns `ensureDirectory` / `ensureRuntimeDirectories`, the only sanctioned path-mutation entry points.

## Design

Adapter pattern over `node:os` and `node:process`. `Platform` (`'linux' | 'darwin' | 'win32'`) and `PlatformAdapter` (`platform`, `home`, `environment`) live in `platform.ts`; `createDefaultPlatformAdapter()` in `paths-default.ts` is the production wiring that reads `process.platform`, `os.homedir()`, and `process.env`. `paths.ts` is pure: `resolvePlatformPaths(adapter)` dispatches to private `linuxPaths`, `darwinPaths`, `windowsPaths` builders, each returning a frozen-shape `PlatformPaths` (six `PlatformPathSlot` records, each `{ directory, file(name) }`). Linux follows XDG Base Directory (`XDG_CONFIG_HOME`/`DATA`/`STATE`/`CACHE`) with `jobhunter` namespaces; macOS uses `~/Library/{Application Support,Logs,Caches}/JobHunter`; Windows requires `APPDATA`+`LOCALAPPDATA` and throws `PathError('windows_missing_environment')` otherwise. Posix path joining is forced via `path.posix.join` and Windows joining via `path.win32.join`, so slot strings are always expressed with the host separator. `resolvePlatformPaths` uses an exhaustive `switch` with a `never` fallthrough that throws `PathError('unsupported_platform')`. `ensureDirectory` wraps `fs/promises.mkdir({ recursive: true })` (dynamic import) and rethrows as `PathError('directory_create_failed')`; `ensureRuntimeDirectories` iterates the slot keys (defaulting to `ALL_RUNTIME_CATEGORIES`).

## Flow

1. Caller obtains an adapter — production code calls `createDefaultPlatformAdapter()`; tests pass a hand-built `PlatformAdapter` literal.
2. `resolvePlatformPaths(adapter)` switches on `adapter.platform`, threading `adapter.home` (Linux/macOS) or `adapter.environment` (Linux XDG overrides, Windows required vars) into the platform builder.
3. The builder returns a `PlatformPaths` value; consumers read `paths[category].directory` or call `paths[category].file(name)`.
4. At boot, `ensureRuntimeDirectories(paths, { categories? })` walks the requested slot keys and `mkdir -p`s each `directory`, erroring with structured `PathError` instances on filesystem failure.

## Integration

- `src/init/init-service.ts` — calls `ensureRuntimeDirectories(opts.paths)` during the first-run flow.
- `src/config/loader.ts`, `src/config/updater.ts` — accept `PlatformPaths` for config file I/O.
- `src/persistence/database.ts` — uses `ensureDirectory` + the `data` slot to place the SQLite store.
- `src/diagnostics/manager.ts`, `src/diagnostics/manager-default.ts` — narrowed to `Pick<PlatformPaths, 'diagnostics'>`.
- `src/profile/importer.ts`, `src/profile/file-copy.ts` — operate on `config`/`profileSources` slots.
- `desktop/sidecar/src/routes/{config,db-helper,paths,pipeline,profile}.ts` — re-resolve paths per request via `resolvePlatformPaths(createDefaultPlatformAdapter())`.
- Test suites (`tests/platform/paths.test.ts`, `tests/config/*`, `tests/profile/*`, `tests/persistence/*`, `tests/init/*`) inject custom `PlatformAdapter` fixtures for hermetic, cross-platform assertions.
