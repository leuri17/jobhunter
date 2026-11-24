# src/config/

## Responsibility

Owns the operational configuration surface: the Zod schema that defines the
persisted `config.json` shape, the loader that reads/validates it, the updater
that applies patches and writes atomically, a content-addressable hash of the
config, and a `FileSystem` port used for dependency-injected I/O. It is the
single source of truth for `OperationalConfig` (search targets, OpenAI models,
scraper timeouts, output limits, logging, and diagnostics toggles).

Also owns the **secrets** surface, which is deliberately kept out of
`OperationalConfig`: `secrets.ts` declares the `SecretsStore` port, the
`Secrets` shape, and the interim `FileSecretsStore` backend
(`secrets.json` at mode `0600`, written atomically via temp file + rename).
Keys are stored **per provider** (#359) in `aiProviderApiKeys`; the
earlier single slot (`aiProviderApiKey`, and before it `openaiApiKey`)
still reads, and moves into the saved config's provider slot the first
time that provider's key is resolved. `api-key.ts` holds
`resolveAiProviderApiKey` / `resolveApiKeySource` — the single seam
through which every consumer obtains the key for one provider (stored
slot wins, `AI_PROVIDER_API_KEY` / `OPENAI_API_KEY` is the fallback).
Because keys are not in the operational config, they never affect
`hashOperationalConfig` and cannot appear in the config diff. See
[#211](https://github.com/leuri17/jobhunter/issues/211) for the planned move
to the OS keychain; `SecretsStore` is the seam that replacement targets.

`keychain-secrets.ts` is that replacement's client half: a
`KeychainSecretsStore` (`SecretsStore` over the Tauri shell's token-authed
loopback TCP bridge) plus the `SocketKeychainTransport` that speaks the
bridge's one-line-per-connection JSON protocol (5 s deadline, 64 KiB
response cap, every transport failure normalized to a
`secrets_backend_unavailable` `SecretStoreError`) and `parseBridgeEnv` for
the `JOBHUNTER_SECRETS_BRIDGE_PORT`/`_TOKEN` pair.

## Design

- **Schema-first validation** — `schema.ts` composes `.strict()` Zod objects
  (`searchSchema`, `openaiSchema`, `scraperSchema`, `outputSchema`,
  `loggingSchema`, `diagnosticsSchema`) into `OperationalConfigSchema`;
  `OperationalConfig` is derived via `z.infer`, so the type and runtime
  validator never drift. `DEFAULT_OPERATIONAL_CONFIG` is the typed fallback
  used when no file exists.
- **File-system port/adapter** — `file-system.ts` declares the `FileSystem`
  interface (`readFile`, `writeFile`, `rename`, `mkdir`, `pathExists`,
  `removeFile`); `file-system-default.ts` provides the `node:fs/promises`
  adapter via `createDefaultFileSystem()`. Both `loadConfig` and `updateConfig`
  take it as a defaulted last parameter — the dependency-injection seam that
  makes tests use in-memory fakes.
- **Path injection** — neither module hardcodes locations; the caller passes a
  `PlatformPaths` (from `src/platform/paths.ts`), and the file resolves as
  `platformPaths.config.file('config.json')`.
- **Content-addressable hash** — `hashOperationalConfig()` produces a SHA-256
  digest over `JSON.stringify(config, sortedTopLevelKeys)` for stable run
  identity. It stays internal (not re-exported by `index.ts`).
- **Typed error taxonomy** — failures surface as `ConfigError`
  (`config_io_error`, `config_parse_error`, `config_write_failed`,
  `update_cancelled`), `UnknownConfigError` (`unknown_keys`), or
  `ValidationError` (`zod_failed`) from `src/errors/application-error.ts`.
- **Confirmation callback** — `UpdateOptions.confirm(preview)` inverts control
  so the embedder (sidecar HTTP handler or test) decides whether a diff is applied.

## Flow

Load: `loadConfig(platformPaths, fileSystem?)` → resolve `path` →
`fileSystem.pathExists`. If absent, return `DEFAULT_OPERATIONAL_CONFIG` plus
its hash. If present: `fileSystem.readFile` (wraps failures in
`config_io_error`) → `JSON.parse` (`config_parse_error`) →
`parseUnknownKeys()` compares top-level keys against
`OperationalConfigSchema.shape` and throws `toUnknownKeysError()` →
`OperationalConfigSchema.safeParse` → `toValidationError()` on failure →
returns `LoadedConfig { config, schemaVersion: 1, hash, path }`.

Update: `updateConfig(platformPaths, patch, options, fileSystem?)` →
`readCurrentConfig()` (dynamic `import('./loader.js')` to break the cycle) →
shallow section merge of `ConfigPatch` over `before` → `safeParse` on the
merged object → build `ConfigPreview { before, after, changedKeys }` where
`diffKeys()` compares JSON-serialized top-level sections →
`await options.confirm(preview)`; a `false` answer throws
`update_cancelled` → atomic write: `mkdir(config.directory, {recursive})`,
`writeFile` to `${path}.${randomUUID()}.tmp`, then `rename` onto `path`; any
throw removes the temp file and raises `config_write_failed` → returns
`UpdateResult { config, hash, preview }`.

## Integration

- Public exports (`index.ts`): `FileSystem`, `createDefaultFileSystem`,
  `OperationalConfigSchema`, `DEFAULT_OPERATIONAL_CONFIG`, `OperationalConfig`,
  the provider catalog (`AI_PROVIDER_IDS`, `AI_PROVIDER_ENDPOINTS`,
  `AI_PROVIDER_CHOICES`, `AI_PROVIDER_REASONING_EFFORT_IDS`,
  `AiProviderIdSchema`) with `resolveAiProviderBaseUrl` /
  `resolveProviderEndpoint`, `loadConfig`/`LoadedConfig`, and
  `updateConfig` with `ConfigPatch`, `UpdateOptions`, `ConfigPreview`,
  `UpdateResult`. From the secrets surface: `FileSecretsStore`,
  `KeychainSecretsStore`, `SocketKeychainTransport`, `parseBridgeEnv`,
  `maskSecret`, `resolveSecretsPath`, `resolveAiProviderApiKey`,
  `resolveApiKeySource`, and their option/type surface. `hash.ts` is
  internal.
- `src/init/init-service.ts` imports `loadConfig`, `updateConfig`,
  `OperationalConfigSchema`, and the `FileSystem` type: it loads config during
  onboarding, materializes `config.json` via a no-op `updateConfig(paths, {},
{ confirm: async () => true }, fileSystem)`, writes user answers through a
  second `updateConfig`, then re-loads.
- `src/init/classify.ts` validates a caller-supplied config with
  `OperationalConfigSchema.safeParse` instead of re-reading from disk.
- `desktop/sidecar/src/secrets-backend.ts` consumes
  `KeychainSecretsStore` + `SocketKeychainTransport` + `parseBridgeEnv` to
  pick the keychain or the file backend at sidecar boot (issue #211).
- `src/pipeline/orchestrator.ts` carries `rawConfig: OperationalConfig` through
  the run; `src/pipeline/normalize.ts` `buildConfigSnapshot()` returns the
  snapshot plus its hash for run provenance.
- `src/linkedin/extraction/service.ts` consumes the
  `scraper.timeouts` shape; `src/reevaluation/service.ts` falls back to
  `DEFAULT_OPERATIONAL_CONFIG.openai.jobScoring`.
