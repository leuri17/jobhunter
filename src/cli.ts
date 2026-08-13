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
import {
  runConfigureSearch,
  defaultInquirerPrompts,
  normalizePersistedSearchConfig,
  type SearchConfiguration,
  type SearchPrompts,
} from './search/index.js';
import { createRepositories } from './persistence/repositories/index.js';
import { initializeDatabase } from './persistence/database.js';
import { resolveRepoRootForMigrations } from './persistence/resolve-migrations.js';
import { ProfileImportService, type ProfileImportResult } from './profile/importer.js';

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

function isCommanderError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('commander.')
  );
}

function exitWithError(error: unknown): never {
  if (isCommanderError(error)) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  if (error instanceof ApplicationError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
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
  // Both branches serialise identically; the parameter is kept so the
  // command signature matches the documented --json flag behaviour.
  void json;
  process.stdout.write(`${JSON.stringify(loaded.config, null, 2)}\n`);
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

function formatSummary(result: ProfileImportResult): string {
  const lines = result.sources.map((source) => {
    const action = source.reused
      ? `reused-${source.textExtractionStatus}`
      : source.textExtractionStatus;
    const filename = source.path.split(/[\\/]/).pop() ?? source.path;
    const id = `source_${source.id}`;
    const annotation = formatSourceAnnotation(source);
    return `  ${id}  ${action}  ${filename}${annotation}`;
  });
  return [
    `status: ${result.status}`,
    `  extracted: ${result.counts.extracted}`,
    `  failed: ${result.counts.failed}`,
    `  reused: ${result.counts.reused}`,
    ...lines,
  ].join('\n');
}

function formatSummaryJson(result: ProfileImportResult): unknown {
  return {
    schemaVersion: 1,
    status: result.status,
    counts: result.counts,
    sources: result.sources.map((s) => ({
      id: `source_${s.id}`,
      internalId: s.id,
      path: s.path,
      sourceType: s.sourceType,
      sha256: s.sha256,
      fileSize: s.fileSize,
      storedPath: s.storedPath,
      textExtractionStatus: s.textExtractionStatus,
      textExtractionMessage: s.textExtractionMessage,
      extractedTextHash: s.extractedTextHash,
      reused: s.reused,
      warnings: s.warnings,
    })),
    failedSourcePaths: result.failedSourcePaths,
  };
}

function formatSourceAnnotation(source: ProfileImportResult['sources'][number]): string {
  const parts: string[] = [];
  if (source.textExtractionMessage !== null) {
    parts.push(source.textExtractionMessage);
  }
  if (source.warnings.length > 0) {
    const noun = source.warnings.length === 1 ? 'warning' : 'warnings';
    const codes = source.warnings.join(', ');
    parts.push(`${source.warnings.length} ${noun}: ${codes}`);
  }
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

async function profileImportCommand(
  rawPaths: readonly string[],
  options: { json: boolean },
): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  try {
    const repositories = createRepositories(handle);
    const service = new ProfileImportService({
      paths: platformPaths,
      repositories,
    });
    const result = await service.importSources(rawPaths);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(formatSummaryJson(result), null, 2)}\n`);
    } else {
      process.stdout.write(`${formatSummary(result)}\n`);
    }
  } finally {
    handle.close();
  }
}

export function createProgram(options: { prompts?: SearchPrompts } = {}): Command {
  const prompts: SearchPrompts = options.prompts ?? defaultInquirerPrompts;
  const program = new Command()
    .name('jobhunter')
    .description('Local job discovery pipeline')
    .showHelpAfterError(true)
    .exitOverride()
    .configureOutput({
      writeErr: () => undefined,
    });

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

  const configure = program
    .command('configure')
    .description('Interactive configuration commands (search settings, etc.).');

  configure
    .command('search')
    .description('Interactively configure LinkedIn search settings.')
    .option('--json', 'emit JSON to stdout', false)
    .action(async (options: { json: boolean }) => {
      try {
        const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
        const loaded = await loadConfig(paths, cliFileSystem);
        const existing = normalizePersistedSearchConfig(loaded.config.search);
        const configuration: SearchConfiguration = await runConfigureSearch({
          prompts,
          existing,
        });
        const patch: ConfigPatch = {
          search: {
            searchQueries: [...configuration.searchQueries],
            locations: configuration.locations.map((l) => ({ name: l.name, geoId: l.geoId })),
            datePosted: configuration.datePosted,
            workplaceTypes: [...configuration.workplaceTypes],
          },
        };
        const updateOptions: UpdateOptions = { confirm: async () => true };
        const result = await updateConfig(paths, patch, updateOptions, cliFileSystem);
        if (options.json) {
          process.stdout.write(`${JSON.stringify(result.config, null, 2)}\n`);
        } else {
          process.stdout.write('search configuration updated\n');
        }
      } catch (error) {
        exitWithError(error);
      }
    });

  const profile = program
    .command('profile')
    .description('Profile source import, extraction, and review commands.');

  profile
    .command('import')
    .description('Import one or two CV source files (PDF, Markdown, or plain text).')
    .option('--json', 'emit JSON to stdout', false)
    .argument('<path>', 'first source path')
    .argument('[path]', 'optional second source path')
    .action(async (path1: string, path2: string | undefined, options: { json: boolean }) => {
      try {
        const paths = [path1, path2].filter((value): value is string => typeof value === 'string');
        await profileImportCommand(paths, options);
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
export { SearchConfigError, SearchCancelledError, LinkedInURLParseError } from './search/errors.js';
export {
  runConfigureSearch,
  defaultInquirerPrompts,
  type SearchConfiguration,
} from './search/index.js';
export { ProfileImportService } from './profile/importer.js';
