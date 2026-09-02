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

export { loadConfig, type LoadedConfig } from './loader.js';

export {
  updateConfig,
  type ConfigPatch,
  type UpdateOptions,
  type ConfigPreview,
  type UpdateResult,
} from './updater.js';
