/**
 * Public barrel for `src/config/`.
 *
 * Re-exports the config loading, updating, schema, and file-system
 * surface that consumers (the pipeline orchestrator and the sidecar)
 * import. Hashing helpers stay internal to `src/config/` — they're
 * an implementation detail of `loader.ts` and `updater.ts`.
 */

export type { FileSystem } from './file-system.js';
export { createDefaultFileSystem } from './file-system-default.js';

export {
  OperationalConfigSchema,
  DEFAULT_OPERATIONAL_CONFIG,
  type OperationalConfig,
} from './schema.js';

export {
  REASONING_EFFORT_CHOICES,
  REASONING_EFFORT_VALUES,
  ReasoningEffortSchema,
  type ReasoningEffort,
} from './labels.js';

export { loadConfig, type LoadedConfig } from './loader.js';

export { resolveRefusalDetection } from './refusal.js';

export {
  updateConfig,
  type ConfigPatch,
  type UpdateOptions,
  type ConfigPreview,
  type UpdateResult,
} from './updater.js';

export {
  FileSecretsStore,
  resolveSecretsPath,
  maskSecret,
  SECRETS_FILENAME,
  type SecretsStore,
  type Secrets,
  type FileSecretsStoreOptions,
} from './secrets.js';

export {
  KeychainSecretsStore,
  SocketKeychainTransport,
  parseBridgeEnv,
  BRIDGE_PORT_ENV_VAR,
  BRIDGE_TOKEN_ENV_VAR,
  type KeychainTransport,
  type KeychainSecretsStoreOptions,
  type SocketKeychainTransportOptions,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeError,
  type BridgeEnv,
} from './keychain-secrets.js';

export {
  resolveOpenAiApiKey,
  resolveApiKeySource,
  type ResolveApiKeyOptions,
  type ApiKeySource,
} from './api-key.js';
