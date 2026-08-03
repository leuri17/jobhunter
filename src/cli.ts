#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

import { resolvePlatformPaths } from './platform/paths.js';
import { createDefaultPlatformAdapter } from './platform/paths-default.js';
import { loadConfig } from './config/loader.js';
import {
  updateConfig,
  type ConfigPatch,
  type ConfigPreview,
  type UpdateOptions,
} from './config/updater.js';
import { OperationalConfigSchema, type OperationalConfig } from './config/schema.js';
import {
  ApplicationError,
  ConfigError,
  PathError,
  UnknownConfigError,
  ValidationError,
} from './errors/application-error.js';
import type { FileSystem } from './config/file-system.js';

const cliFileSystem: FileSystem = {
  async readFile(path) {
    return readFile(path, 'utf8');
  },
  async writeFile(path, contents) {
    await writeFile(path, contents, 'utf8');
  },
  async rename(from, to) {
    await rename(from, to);
  },
  async mkdir(path, options) {
    await mkdir(path, options);
  },
  async pathExists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async removeFile(path) {
    await rm(path, { force: true });
  },
};

function exitWithError(error: unknown): never {
  if (error instanceof ApplicationError) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exit(error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fatal: ${message}\n`);
  process.exit(1);
}

async function pathsCommand(): Promise<void> {
  const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const slots = [
    { key: 'config', label: 'config' },
    { key: 'data', label: 'data' },
    { key: 'logs', label: 'logs' },
    { key: 'diagnostics', label: 'diagnostics' },
    { key: 'cache', label: 'cache' },
    { key: 'profileSources', label: 'profile-sources' },
  ] as const;
  for (const { key, label } of slots) {
    process.stdout.write(`${label}: ${paths[key].directory}\n`);
  }
}

async function configShowCommand(json: boolean): Promise<void> {
  const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const loaded = await loadConfig(paths, cliFileSystem);
  if (json) {
    process.stdout.write(`${JSON.stringify(loaded.config, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(loaded.config, null, 2)}\n`);
  }
}

async function configValidateCommand(): Promise<void> {
  const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const loaded = await loadConfig(paths, cliFileSystem);
  const round = OperationalConfigSchema.safeParse(loaded.config);
  if (!round.success) {
    throw new ValidationError('zod_failed', 'Loaded configuration failed revalidation.', {
      issues: round.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  process.stdout.write('valid\n');
}

async function configUpdateCommand(patch: ConfigPatch): Promise<void> {
  const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const options: UpdateOptions = { confirm: () => true };
  const result = await updateConfig(paths, patch, options, cliFileSystem);
  process.stdout.write(`${JSON.stringify(result.config, null, 2)}\n`);
}

export function createProgram(): Command {
  const program = new Command()
    .name('jobhunter')
    .description('Local job discovery pipeline')
    .showHelpAfterError(true);

  program
    .command('paths')
    .description('Print resolved OS-specific runtime paths without creating directories.')
    .action(async () => {
      try {
        await pathsCommand();
      } catch (error) {
        exitWithError(error);
      }
    });

  const config = program
    .command('config')
    .description('Inspect or update the operational configuration.');

  config
    .command('show')
    .description('Print the normalized configuration.')
    .option('--json', 'emit JSON to stdout', false)
    .action(async (options: { json: boolean }) => {
      try {
        await configShowCommand(options.json);
      } catch (error) {
        exitWithError(error);
      }
    });

  config
    .command('validate')
    .description('Validate the configuration and exit 0 on success.')
    .action(async () => {
      try {
        await configValidateCommand();
      } catch (error) {
        exitWithError(error);
      }
    });

  config
    .command('update')
    .description('Apply a JSON patch to the configuration (preview-then-write).')
    .requiredOption('--patch <json>', 'JSON object describing the owned sections to update')
    .action(async (options: { patch: string }) => {
      try {
        const patch = JSON.parse(options.patch) as ConfigPatch;
        await configUpdateCommand(patch);
      } catch (error) {
        exitWithError(error);
      }
    });

  return program;
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (error) {
    exitWithError(error instanceof Error ? error : new Error(String(error)));
  }
}

// Re-exports for tests
export { resolvePlatformPaths, loadConfig, updateConfig, OperationalConfigSchema };
export type { OperationalConfig, ConfigPatch, ConfigPreview, UpdateOptions };
export { ApplicationError, ConfigError, PathError, UnknownConfigError, ValidationError };
