import { randomUUID } from 'node:crypto';

import type { PlatformPaths } from '../platform/paths.js';
import { createDefaultFileSystem } from './file-system-default.js';
import type { FileSystem } from './file-system.js';
import { hashOperationalConfig } from './hash.js';
import { OperationalConfigSchema, type OperationalConfig } from './schema.js';
import { ConfigError, ValidationError } from '../errors/application-error.js';

export interface ConfigPatch {
  readonly search?: OperationalConfig['search'];
  readonly openai?: OperationalConfig['openai'];
  readonly scraper?: OperationalConfig['scraper'];
  readonly output?: OperationalConfig['output'];
  readonly logging?: OperationalConfig['logging'];
  readonly diagnostics?: OperationalConfig['diagnostics'];
}

export interface UpdateOptions {
  readonly confirm: (preview: ConfigPreview) => Promise<boolean> | boolean;
}

export interface ConfigPreview {
  readonly before: OperationalConfig;
  readonly after: OperationalConfig;
  readonly changedKeys: readonly string[];
}

export interface UpdateResult {
  readonly config: OperationalConfig;
  readonly hash: string;
  readonly preview: ConfigPreview;
}

function diffKeys(before: OperationalConfig, after: OperationalConfig): readonly string[] {
  return (Object.keys(after) as (keyof OperationalConfig)[]).filter((key) => {
    return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  });
}

export async function updateConfig(
  platformPaths: PlatformPaths,
  patch: ConfigPatch,
  options: UpdateOptions,
  fileSystem: FileSystem = createDefaultFileSystem(),
): Promise<UpdateResult> {
  const path = platformPaths.config.file('config.json');
  const before = await readCurrentConfig(platformPaths, fileSystem);

  const merged: OperationalConfig = {
    ...before,
    ...(patch.search !== undefined ? { search: patch.search } : {}),
    ...(patch.openai !== undefined ? { openai: patch.openai } : {}),
    ...(patch.scraper !== undefined ? { scraper: patch.scraper } : {}),
    ...(patch.output !== undefined ? { output: patch.output } : {}),
    ...(patch.logging !== undefined ? { logging: patch.logging } : {}),
    ...(patch.diagnostics !== undefined ? { diagnostics: patch.diagnostics } : {}),
  };

  const result = OperationalConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ValidationError('zod_failed', 'Patched configuration failed validation.', {
      issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }

  const after = result.data;
  const preview: ConfigPreview = {
    before,
    after,
    changedKeys: diffKeys(before, after),
  };

  const confirmed = await options.confirm(preview);
  if (!confirmed) {
    throw new ConfigError('update_cancelled', 'Configuration update was declined by the user.', {
      changedKeys: [...preview.changedKeys],
    });
  }

  const tempPath = `${path}.${randomUUID()}.tmp`;
  try {
    await fileSystem.mkdir(platformPaths.config.directory, { recursive: true });
    await fileSystem.writeFile(tempPath, `${JSON.stringify(after, null, 2)}\n`);
    await fileSystem.rename(tempPath, path);
  } catch (cause) {
    await fileSystem.removeFile(tempPath).catch(() => undefined);
    throw new ConfigError(
      'config_write_failed',
      `Failed to write configuration atomically at ${path}: ${(cause as Error).message}`,
      { path },
      cause instanceof Error ? cause : undefined,
    );
  }

  return { config: after, hash: hashOperationalConfig(after), preview };
}

async function readCurrentConfig(
  platformPaths: PlatformPaths,
  fileSystem: FileSystem,
): Promise<OperationalConfig> {
  const { loadConfig } = await import('./loader.js');
  const loaded = await loadConfig(platformPaths, fileSystem);
  return loaded.config;
}
