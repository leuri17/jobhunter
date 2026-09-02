/**
 * Public barrel for `src/platform/`.
 *
 * Re-exports the cross-platform path resolution and OS detection
 * primitives. The sidecar and the desktop bootstrap both consume
 * `createDefaultPlatformAdapter` + `resolvePlatformPaths` from
 * here so the platform boundary stays narrow.
 */

export { type Platform, type PlatformAdapter } from './platform.js';

export {
  resolvePlatformPaths,
  ensureDirectory,
  ensureRuntimeDirectories,
  type PlatformPathSlot,
  type PlatformPaths,
  type RuntimeDirectoryCategory,
  type EnsureRuntimeDirectoriesOptions,
} from './paths.js';

export { createDefaultPlatformAdapter } from './paths-default.js';
