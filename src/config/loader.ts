import { z } from 'zod';

import type { PlatformPaths } from '../platform/paths.js';
import { createDefaultFileSystem } from './file-system-default.js';
import type { FileSystem } from './file-system.js';
import { hashOperationalConfig } from './hash.js';
import {
  DEFAULT_OPERATIONAL_CONFIG,
  OperationalConfigSchema,
  type OperationalConfig,
} from './schema.js';
import { ConfigError, UnknownConfigError, ValidationError } from '../errors/application-error.js';

export interface LoadedConfig {
  readonly config: OperationalConfig;
  readonly schemaVersion: 1;
  readonly hash: string;
  readonly path: string;
}

function toUnknownKeysError(unknown: readonly string[]): UnknownConfigError {
  return new UnknownConfigError(
    'unknown_keys',
    `Unknown configuration keys: ${unknown.join(', ')}`,
    {
      keys: [...unknown],
    },
  );
}

function toValidationError(issues: readonly z.ZodIssue[]): ValidationError {
  return new ValidationError('zod_failed', 'Configuration failed validation.', {
    issues: issues.map((issue) => ({ path: issue.path, message: issue.message })),
  });
}

function parseUnknownKeys(raw: unknown): readonly string[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const record = raw as Record<string, unknown>;
  const known = new Set(Object.keys(OperationalConfigSchema.shape));
  return Object.keys(record).filter((key) => !known.has(key));
}

export async function loadConfig(
  platformPaths: PlatformPaths,
  fileSystem: FileSystem = createDefaultFileSystem(),
): Promise<LoadedConfig> {
  const path = platformPaths.config.file('config.json');
  const exists = await fileSystem.pathExists(path);
  if (!exists) {
    const config = DEFAULT_OPERATIONAL_CONFIG;
    return { config, schemaVersion: 1, hash: hashOperationalConfig(config), path };
  }

  let raw: string;
  try {
    raw = await fileSystem.readFile(path);
  } catch (cause) {
    throw new ConfigError(
      'config_io_error',
      `Failed to read configuration at ${path}: ${(cause as Error).message}`,
      { path },
      cause instanceof Error ? cause : undefined,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(
      'config_parse_error',
      `Failed to parse configuration JSON at ${path}: ${(cause as Error).message}`,
      { path },
      cause instanceof Error ? cause : undefined,
    );
  }

  const unknownKeys = parseUnknownKeys(parsed);
  if (unknownKeys.length > 0) {
    throw toUnknownKeysError(unknownKeys);
  }

  const result = OperationalConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw toValidationError(result.error.issues);
  }

  return { config: result.data, schemaVersion: 1, hash: hashOperationalConfig(result.data), path };
}
