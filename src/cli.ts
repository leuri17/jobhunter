#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';
import { confirm as inquirerConfirm } from '@inquirer/prompts';

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
import {
  ProfileExtractionService,
  type ProfileExtractionStatus,
} from './profile/extraction-service.js';
import { ProfileExtractionError } from './profile/openai/errors.js';
import { createDefaultOpenAIClient } from './profile/openai/client.js';
import type { OpenAIClient } from './profile/openai/types.js';
import type { Repositories } from './persistence/repositories/index.js';
import { ProfileReviewService } from './profile/review-service.js';
import { ProfileApprovalService } from './profile/approval-service.js';
import { ProfileRejectionService } from './profile/rejection-service.js';
import { ProfileEditingService } from './profile/editing-service.js';
import { renderReviewSummary } from './profile/review/index.js';
import { defaultInquirerEditorPrompts } from './profile/editing/index.js';
import { ConfigureFiltersService } from './filter/configure-service.js';
import { type FilterPrompts } from './filter/prompts.js';
import { defaultInquirerFilterPrompts } from './filter/prompts-inquirer.js';
import {
  InitOrchestrator,
  defaultInquirerInitPrompts,
  type InitPrompts,
  type InitOrchestratorOptions,
} from './init/index.js';
import {
  configureFiltersPromptAdapter,
  configureSearchPromptAdapter,
  profileApprovalPromptAdapter,
  profileRejectionPromptAdapter,
} from './init/cli-adapters.js';
import type { ProfileApprovalPrompts } from './profile/approval-service.js';
import type { ProfileRejectionPrompts } from './profile/rejection-service.js';
import { resolveOpenAiClientOrNull } from './init/openai-resolve.js';
import { formatInitSummary } from './init/format.js';
import { pinoInitLogger } from './init/log.js';
import { createLogger } from './logging/logger.js';
import {
  PipelineOrchestrator,
  PipelineOpenAIKeyMissingError,
  formatRunSummary,
  formatScoringPlan,
  formatTopNTable,
  InquirerPipelinePrompts,
  pinoPipelineLogger,
  getApplicationVersion,
  type PipelinePrompts,
  type PipelineRunResult,
} from './pipeline/index.js';
import { LinkedInDiscoveryService } from './linkedin/discovery-service.js';
import { LinkedInExtractionService } from './linkedin/extraction/service.js';
import { FilterApplyService } from './filter/service.js';
import { ScoringService } from './scoring/service.js';
import { createDefaultBrowserSession } from './linkedin/browser-default.js';
import { createDefaultDiagnosticManager } from './diagnostics/manager-default.js';

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

/**
 * Root structured logger used by the CLI subcommands. The default
 * configuration reads the LOG_LEVEL environment variable (falling back
 * to `info`) and writes to stdout.
 */
const rootLogger = createLogger({
  level: ((): 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal' | 'silent' => {
    const raw = process.env['LOG_LEVEL'];
    if (
      raw === 'debug' ||
      raw === 'trace' ||
      raw === 'warn' ||
      raw === 'error' ||
      raw === 'fatal' ||
      raw === 'silent'
    ) {
      return raw;
    }
    return 'info';
  })(),
  prettyTerminal: false,
});

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

/**
 * Resolve the human-friendly `profile_id` for a persisted version. The
 * service returns only the integer primary key and the content hash, so
 * the CLI does a single `findById` round-trip to read the `id` field
 * off the persisted `ProfessionalProfile` (e.g. `profile_a1b2...`).
 *
 * If the row somehow disappears between the extraction and this lookup
 * we fall back to `profile_<id>` (matching the documented public form)
 * and emit no diagnostic — the CLI should never fail a successful
 * extraction because of a UI-side bookkeeping read.
 */
async function resolveProfileId(
  repositories: Repositories,
  profileVersionId: number,
): Promise<string> {
  const row = await repositories.profileVersions.findById(profileVersionId);
  if (row !== null) {
    const profileJson = row.profileJson as { id?: unknown } | null;
    if (
      profileJson !== null &&
      typeof profileJson === 'object' &&
      typeof profileJson.id === 'string'
    ) {
      return profileJson.id;
    }
  }
  return `profile_${profileVersionId}`;
}

function formatExtractSummary(status: ProfileExtractionStatus, profileId: string | null): string[] {
  const lines = [`status: ${status.kind}`];
  if (status.kind === 'failed') {
    lines.push(`error_code: ${status.errorCode}`);
    lines.push(`message: ${status.message}`);
    lines.push(`attempts: ${status.attemptCount}`);
    return lines;
  }
  lines.push(`profile_version_id: ${status.profileVersionId}`);
  lines.push(`profile_id: ${profileId}`);
  lines.push(`content_hash: ${status.contentHash}`);
  if (status.kind === 'created') {
    lines.push(`conflicts: ${status.conflicts}`);
    lines.push(`warnings: ${status.warnings.length}`);
  }
  return lines;
}

function formatExtractSummaryJson(
  status: ProfileExtractionStatus,
  profileId: string | null,
): Record<string, unknown> {
  const base = { schemaVersion: 1 };
  if (status.kind === 'failed') {
    return {
      ...base,
      status: status.kind,
      error_code: status.errorCode,
      message: status.message,
      attempts: status.attemptCount,
    };
  }
  const common = {
    status: status.kind,
    profile_version_id: status.profileVersionId,
    profile_id: profileId,
    content_hash: status.contentHash,
  };
  if (status.kind === 'created') {
    return {
      ...base,
      ...common,
      conflicts: status.conflicts,
      warnings: [...status.warnings],
    };
  }
  return { ...base, ...common };
}

async function profileExtractCommand(
  options: { json: boolean },
  testHooks: { openaiClient?: OpenAIClient } = {},
): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  try {
    const repositories = createRepositories(handle);

    // 1. Resolve the set of usable source IDs (extraction only operates
    //    on sources whose stored text is recoverable).
    const allSources = await repositories.profileSources.list();
    const usableSourceIds = allSources
      .filter((source) => source.textExtractionStatus === 'success')
      .map((source) => source.id);
    if (usableSourceIds.length === 0) {
      throw new ValidationError(
        'profile_extraction_no_sources',
        'No imported sources with successful text extraction are available. Run "jobhunter profile import" before "profile extract".',
      );
    }

    // 2. Load the operational configuration.
    const loaded = await loadConfig(platformPaths, cliFileSystem);
    const profileExtractionConfig = {
      model: loaded.config.openai.profileExtraction.model,
      reasoningEffort: loaded.config.openai.profileExtraction.reasoningEffort,
    };

    // 3. Resolve the OpenAI client. Tests inject a fake via `testHooks`;
    //    production code reads `OPENAI_API_KEY` from the environment. The
    //    key is used once and discarded by `createDefaultOpenAIClient` —
    //    it is never logged or persisted (it is on the redact list).
    let openaiClient: OpenAIClient;
    if (testHooks.openaiClient !== undefined) {
      openaiClient = testHooks.openaiClient;
    } else {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new ValidationError(
          'openai_api_key_missing',
          'OPENAI_API_KEY environment variable is required to run "profile extract". Set OPENAI_API_KEY before invoking this command.',
        );
      }
      openaiClient = createDefaultOpenAIClient({ apiKey });
    }

    // 4. Run the orchestrator.
    const service = new ProfileExtractionService({
      repositories,
      openaiClient,
      config: profileExtractionConfig,
    });
    const status = await service.extract(usableSourceIds);

    // 5. Render the result. Failures are surfaced as typed errors so the
    //    action handler's `exitWithError` writes `<code>: <message>` to
    //    stderr and exits with the documented exit code (5 for the
    //    OpenAI failure family per SPEC §25). For `--json` we emit the
    //    structured failure document to stdout FIRST so the JSON stream
    //    is a single valid document, then throw the typed error so the
    //    CLI exits with code 5.
    if (status.kind === 'failed') {
      if (options.json) {
        const payload = formatExtractSummaryJson(status, null);
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        // Surface the failure to stdout too so the attempt count is
        // observable to the operator (stderr still receives the typed
        // error code via exitWithError below).
        process.stdout.write(`${formatExtractSummary(status, null).join('\n')}\n`);
      }
      throw new ProfileExtractionError(status.errorCode, status.message);
    }

    const profileId = await resolveProfileId(repositories, status.profileVersionId);
    if (options.json) {
      const payload = formatExtractSummaryJson(status, profileId);
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${formatExtractSummary(status, profileId).join('\n')}\n`);
  } finally {
    handle.close();
  }
}

async function profileListCommand(options: {
  json: boolean;
  status?: string | undefined;
}): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  try {
    const repositories = createRepositories(handle);
    const service = new ProfileReviewService(repositories);
    const status =
      options.status === undefined
        ? undefined
        : (options.status as 'draft' | 'approved' | 'rejected' | 'superseded');
    const entries = await service.list(status === undefined ? undefined : { status });
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, profiles: entries }, null, 2)}\n`);
      return;
    }
    if (entries.length === 0) {
      process.stdout.write('(no profile versions)\n');
      return;
    }
    const lines: string[] = [];
    lines.push(
      'ID                            STATUS       ACTIVE  CONTENT_HASH                          APPROVED',
    );
    for (const entry of entries) {
      const id = `profile_${entry.profileVersionId}`.padEnd(30);
      const status = entry.status.padEnd(11);
      const active = (entry.active ? 'yes' : 'no').padEnd(6);
      const hash = entry.contentHash.slice(0, 32).padEnd(34);
      const approved = entry.approvedAt ?? '—';
      lines.push(`${id}${status}${active}${hash}${approved}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  } finally {
    handle.close();
  }
}

async function profileShowCommand(
  rawId: string | undefined,
  options: { json: boolean },
): Promise<void> {
  if (typeof rawId !== 'string' || rawId.trim() === '') {
    throw new ValidationError(
      'profile_show_missing_id',
      'profile show requires a profile id argument.',
    );
  }
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  try {
    const repositories = createRepositories(handle);
    const service = new ProfileReviewService(repositories);
    const payload = await service.show(rawId);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `${renderReviewSummary({
        profile: payload.profile,
        warnings: payload.warnings,
        conflicts: payload.conflicts,
        overrides: payload.overrides,
      })}\n`,
    );
  } finally {
    handle.close();
  }
}

async function profileApproveCommand(rawId: string): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  try {
    const repositories = createRepositories(handle);
    const service = new ProfileApprovalService({
      repositories,
      prompts: {
        confirmApprovalWithWarnings: async (input) => {
          process.stderr.write(
            `Approving profile ${input.profileVersionId} with ${input.remainingWarnings.length} warning(s):\n`,
          );
          for (const warning of input.remainingWarnings) {
            process.stderr.write(`  - ${warning}\n`);
          }
          return inquirerConfirm({
            message: 'Proceed with approval?',
            default: false,
          });
        },
      },
    });
    const summary = await service.approve(rawId);
    process.stdout.write(`approved: profile_${summary.approvedProfileVersionId}\n`);
    if (summary.supersededProfileVersionId !== null) {
      process.stdout.write(`superseded: profile_${summary.supersededProfileVersionId}\n`);
    }
    process.stdout.write(`invalidated filter results: ${summary.invalidatedFilterResults}\n`);
  } finally {
    handle.close();
  }
}

async function profileRejectCommand(rawId: string): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  try {
    const repositories = createRepositories(handle);
    const service = new ProfileRejectionService({
      repositories,
      prompts: {
        confirmRejection: async (input) => {
          return inquirerConfirm({
            message: `Reject profile ${input.profileVersionId}? (prior approved profile stays active)`,
            default: false,
          });
        },
      },
    });
    const result = await service.reject(rawId);
    process.stdout.write(`rejected: profile_${result.rejectedProfileVersionId}\n`);
  } finally {
    handle.close();
  }
}

async function profileEditCommand(rawId: string): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });
  try {
    const repositories = createRepositories(handle);
    const service = new ProfileEditingService({
      repositories,
      prompts: defaultInquirerEditorPrompts,
    });
    const outcome = await service.startEdit(rawId);
    switch (outcome.kind) {
      case 'derived_draft':
        process.stdout.write(
          `derived draft: profile_${outcome.draftProfileVersionId} from profile_${outcome.priorProfileVersionId}\n`,
        );
        process.stdout.write(
          `${outcome.outcome.kind}: profile_${outcome.outcome.profileVersionId}\n`,
        );
        break;
      default:
        process.stdout.write(`${outcome.kind}: profile_${outcome.profileVersionId}\n`);
    }
  } finally {
    handle.close();
  }
}

async function runCommand(
  yes: boolean,
  jsonOutput: boolean,
  pipelinePrompts: PipelinePrompts,
): Promise<void> {
  const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const handle = await initializeDatabase(platformPaths, {
    migrationsFolder: resolveRepoRootForMigrations(),
  });

  // OpenAI key gate (Decision 11). The CLI validates the env
  // variable here (mirrors the `profile extract` pre-validation),
  // BEFORE the orchestrator's prerequisite check runs.
  const apiKey = process.env['OPENAI_API_KEY'];
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    handle.close();
    throw new PipelineOpenAIKeyMissingError(
      'openai_api_key_missing',
      'OPENAI_API_KEY environment variable is required to run "jobhunter run". Set OPENAI_API_KEY before invoking this command.',
    );
  }

  // SIGINT handling (Decision 5 + SPEC §40): the first SIGINT
  // triggers graceful cancellation; the second SIGINT force-exits.
  // The listener is removed in the finally block to keep the
  // process state clean for any subsequent invocations.
  const controller = new AbortController();
  let sigIntCount = 0;
  const onSigInt = (): void => {
    sigIntCount += 1;
    if (sigIntCount === 1) {
      process.stderr.write('cancellation requested; finishing current operations...\n');
      controller.abort();
    } else {
      process.stderr.write('force exit (second SIGINT)\n');
      process.exit(1);
    }
  };
  process.once('SIGINT', onSigInt);

  try {
    const repositories = createRepositories(handle);
    const loaded = await loadConfig(platformPaths, cliFileSystem);
    const browserSession = createDefaultBrowserSession({
      navigationMs: loaded.config.scraper.timeouts.navigationMs,
      initialResultsMs: loaded.config.scraper.timeouts.initialResultsMs,
      overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
    });
    const diagnosticManager = createDefaultDiagnosticManager({
      config: loaded.config.diagnostics.onScraperError,
      paths: platformPaths,
      repositories,
    });
    const discoveryService = new LinkedInDiscoveryService({
      repositories,
      browserSession,
      diagnosticManager,
      config: {
        navigationMs: loaded.config.scraper.timeouts.navigationMs,
        initialResultsMs: loaded.config.scraper.timeouts.initialResultsMs,
        overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
        maxNoProgressAttempts: loaded.config.scraper.maxNoProgressAttempts,
        maxIterations: 5,
      },
    });
    const extractionService = new LinkedInExtractionService({
      repositories,
      browserSession,
      diagnosticManager,
      config: {
        navigationMs: loaded.config.scraper.timeouts.navigationMs,
        detailPanelMs: loaded.config.scraper.timeouts.detailPanelMs,
        dedicatedPageMs: loaded.config.scraper.timeouts.dedicatedPageMs,
        overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
      },
    });
    const filterApplyService = new FilterApplyService({ repositories });
    const openaiClient = createDefaultOpenAIClient({ apiKey });
    const scoringService = new ScoringService({
      repositories,
      openaiClient,
      config: {
        model: loaded.config.openai.jobScoring.model,
        reasoningEffort: loaded.config.openai.jobScoring.reasoningEffort,
        concurrency: loaded.config.openai.jobScoring.concurrency,
      },
    });
    const orchestrator = new PipelineOrchestrator({
      repositories,
      browserSession,
      discoveryService,
      extractionService,
      filterApplyService,
      scoringService,
      diagnosticManager,
      config: {
        rawConfig: loaded.config,
        hash: loaded.hash,
        schemaVersion: 1,
      },
      prompts: pipelinePrompts,
      confirmScoring: yes,
      env: process.env,
      applicationVersion: getApplicationVersion(),
      logger: pinoPipelineLogger(rootLogger),
      // Forward the SIGINT-driven signal so the orchestrator can
      // detect cancellation between every search / job / score
      // step (SPEC §29.3 + §40).
      cancelSignal: controller.signal,
    });
    const result: PipelineRunResult = await orchestrator.run({});
    if (jsonOutput) {
      const payload = {
        ...result.summary,
        scoringPlan: result.scoringPlan,
        topN: result.topN,
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatRunSummary(result.summary)}\n`);
      if (result.scoringPlan !== null) {
        process.stdout.write(`\n${formatScoringPlan(result.scoringPlan)}\n`);
      }
      process.stdout.write(`\n${formatTopNTable(result.topN, process.stdout.columns ?? 120)}\n`);
    }
  } finally {
    process.removeListener('SIGINT', onSigInt);
    handle.close();
  }
}

export function createProgram(
  options: {
    prompts?: SearchPrompts;
    openaiClient?: OpenAIClient;
    filterPrompts?: FilterPrompts;
    initPrompts?: InitPrompts;
    /** Optional scripted search prompts for the `init` subcommand. */
    initSearchPrompts?: SearchPrompts;
    /** Optional scripted approval prompts for the `init` subcommand. */
    initApprovalPrompts?: ProfileApprovalPrompts;
    /** Optional scripted rejection prompts for the `init` subcommand. */
    initRejectionPrompts?: ProfileRejectionPrompts;
    /** Optional scripted pipeline prompts for the `run` subcommand. */
    pipelinePrompts?: PipelinePrompts;
  } = {},
): Command {
  const prompts: SearchPrompts = options.prompts ?? defaultInquirerPrompts;
  const filterPrompts: FilterPrompts | undefined = options.filterPrompts;
  const initPrompts: InitPrompts | undefined = options.initPrompts;
  const initSearchPrompts: SearchPrompts | undefined = options.initSearchPrompts;
  const initApprovalPrompts: ProfileApprovalPrompts | undefined = options.initApprovalPrompts;
  const initRejectionPrompts: ProfileRejectionPrompts | undefined = options.initRejectionPrompts;
  const pipelinePrompts: PipelinePrompts | undefined = options.pipelinePrompts;
  const testHooks: { openaiClient?: OpenAIClient } =
    options.openaiClient !== undefined ? { openaiClient: options.openaiClient } : {};
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

  configure
    .command('filters')
    .description('Interactively configure the global deterministic filter set.')
    .action(async () => {
      try {
        const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
        const handle = await initializeDatabase(paths, {
          migrationsFolder: resolveRepoRootForMigrations(),
        });
        try {
          const repositories = createRepositories(handle);
          const service = new ConfigureFiltersService({
            repositories,
            prompts: filterPrompts ?? defaultInquirerFilterPrompts,
          });
          const outcome = await service.run();
          switch (outcome.kind) {
            case 'saved':
              process.stdout.write(
                `filter config saved: filters_${outcome.filterConfigVersionId}\n`,
              );
              process.stdout.write(
                `invalidated filter results: ${outcome.invalidatedFilterResults}\n`,
              );
              break;
            case 'discarded':
              process.stdout.write('filter config discarded\n');
              break;
          }
        } finally {
          handle.close();
        }
      } catch (error) {
        exitWithError(error);
      }
    });

  program
    .command('init')
    .description('Interactively initialize JobHunter (paths, config, profile, filters). Resumable.')
    .action(async () => {
      try {
        const platformPaths = resolvePlatformPaths(createDefaultPlatformAdapter());
        const handle = await initializeDatabase(platformPaths, {
          migrationsFolder: resolveRepoRootForMigrations(),
        });
        try {
          const repositories = createRepositories(handle);
          // OpenAI key gate (Decision 4): null when absent.
          const openaiClient = testHooks.openaiClient ?? resolveOpenAiClientOrNull();
          const orchestratorOptions: InitOrchestratorOptions = {
            paths: platformPaths,
            repositories,
            fileSystem: cliFileSystem,
            prompts: initPrompts ?? defaultInquirerInitPrompts,
            openaiClient,
            searchPrompts: initSearchPrompts ?? configureSearchPromptAdapter(),
            filterPrompts: filterPrompts ?? configureFiltersPromptAdapter(),
            approvalPrompts: initApprovalPrompts ?? profileApprovalPromptAdapter(),
            rejectionPrompts: initRejectionPrompts ?? profileRejectionPromptAdapter(),
            logger: pinoInitLogger(rootLogger),
          };
          const orchestrator = new InitOrchestrator(orchestratorOptions);
          const summary = await orchestrator.run(process.env);
          process.stdout.write(`${formatInitSummary(summary)}\n`);
        } finally {
          handle.close();
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

  profile
    .command('extract')
    .description(
      'Extract a structured profile from the previously imported sources via OpenAI. ' +
        'Reads OPENAI_API_KEY from the environment. Operates on every imported source ' +
        'with textExtractionStatus === "success".',
    )
    .option('--json', 'emit JSON to stdout', false)
    .action(async (options: { json: boolean }) => {
      try {
        await profileExtractCommand(options, testHooks);
      } catch (error) {
        exitWithError(error);
      }
    });

  profile
    .command('list')
    .description('List every persisted profile version (most-recent-first).')
    .option('--json', 'emit JSON to stdout', false)
    .option('--status <status>', 'filter by status: draft, approved, rejected, or superseded')
    .action(async (options: { json: boolean; status?: string }) => {
      try {
        await profileListCommand(options);
      } catch (error) {
        exitWithError(error);
      }
    });

  profile
    .command('show')
    .description('Print the review summary for a profile version.')
    .argument('[id]', 'profile id (profile_<int> or profile_<json-id>)')
    .option('--json', 'emit JSON to stdout', false)
    .action(async (id: string | undefined, options: { json: boolean }) => {
      try {
        await profileShowCommand(id, options);
      } catch (error) {
        exitWithError(error);
      }
    });

  profile
    .command('approve')
    .description(
      'Approve a draft profile version. Marks it active and supersedes any prior approved version.',
    )
    .argument('<id>', 'profile id (profile_<int> or profile_<json-id>)')
    .action(async (id: string) => {
      try {
        await profileApproveCommand(id);
      } catch (error) {
        exitWithError(error);
      }
    });

  profile
    .command('reject')
    .description('Reject a draft profile version. Leaves the prior approved profile active.')
    .argument('<id>', 'profile id (profile_<int> or profile_<json-id>)')
    .action(async (id: string) => {
      try {
        await profileRejectCommand(id);
      } catch (error) {
        exitWithError(error);
      }
    });

  profile
    .command('edit')
    .description(
      'Interactively edit a draft profile version. Editing an approved profile derives a new draft.',
    )
    .argument('<id>', 'profile id (profile_<int> or profile_<json-id>)')
    .action(async (id: string) => {
      try {
        await profileEditCommand(id);
      } catch (error) {
        exitWithError(error);
      }
    });

  program
    .command('run')
    .description(
      'Run the full discovery + extraction + filtering + scoring pipeline (SPEC §33). ' +
        'Requires OPENAI_API_KEY in the environment and an active approved profile + ' +
        'active filter configuration.',
    )
    .option('--yes', 'bypass the scoring-plan confirmation', false)
    .option('--json', 'emit a single JSON document to stdout', false)
    .action(async (options: { yes: boolean; json: boolean }) => {
      try {
        await runCommand(
          options.yes,
          options.json,
          pipelinePrompts ?? new InquirerPipelinePrompts(),
        );
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
// TASK-008 re-exports were removed by Task 9 — the full extraction surface
// (services, fake, retry policy, prompt builder, errors, types, structured
// output) is now reachable through `src/profile/index.js`. Re-exports here
// would duplicate the canonical barrel.
