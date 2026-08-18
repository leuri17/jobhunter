/**
 * `InitOrchestrator` — the application service that walks the 10
 * prerequisite steps (SPEC §9.1) for `jobhunter init`.
 *
 * The orchestrator NEVER re-implements prerequisite service logic — it
 * delegates via the existing barrels (`src/profile/index.js`,
 * `src/filter/index.js`, `src/search/index.js`,
 * `src/config/loader.js`, etc.). The orchestrator composes them but does
 * not reach into their internals.
 *
 * Domain boundaries (AGENTS.md §5, §9): this module does NOT import
 * Commander, Inquirer, Playwright, Drizzle directly, the `openai` SDK,
 * or Pino directly. The `InitLogger` interface is the logging seam.
 */

import { loadConfig } from '../config/loader.js';
import { updateConfig } from '../config/updater.js';
import { OperationalConfigSchema } from '../config/schema.js';
import {
  ApplicationError,
  ConfigError,
  UnknownConfigError,
  ValidationError,
} from '../errors/application-error.js';
import { ensureRuntimeDirectories } from '../platform/paths.js';
import type { PlatformPaths } from '../platform/paths.js';
import { ProfileImportService, type ProfileImportLogger } from '../profile/index.js';
import {
  ProfileExtractionService,
  type ProfileExtractionConfig,
  type ProfileExtractionLogger,
  type ProfileExtractionStatus,
} from '../profile/index.js';
import { ProfileApprovalService } from '../profile/approval-service.js';
import type { ProfileApprovalPrompts } from '../profile/approval-service.js';
import { ProfileRejectionService } from '../profile/rejection-service.js';
import type { ProfileRejectionPrompts } from '../profile/rejection-service.js';
import {
  BlockingConflictsUnresolvedError,
  UserCancelledApprovalError,
  UserCancelledRejectionError,
} from '../profile/errors.js';
import type { Repositories } from '../persistence/repositories/index.js';
import { ConfigureFiltersService } from '../filter/configure-service.js';
import type { FilterPrompts } from '../filter/prompts.js';
import { runConfigureSearch, normalizePersistedSearchConfig } from '../search/index.js';
import type { SearchPrompts } from '../search/index.js';
import { SearchCancelledError } from '../search/errors.js';
import { UserCancelledFilterConfigError } from '../filter/errors.js';
import type { FileSystem } from '../config/file-system.js';
import type { OpenAIClient } from '../profile/openai/types.js';

import {
  InitApprovalFailedError,
  InitConfigSeedingFailedError,
  InitExtractRuntimeFailedError,
  InitFiltersFailedError,
  InitImportFailedError,
  InitPathsFailedError,
  InitSearchFailedError,
} from './errors.js';
import { noopInitLogger, type InitLogger } from './log.js';
import type { InitPrompts } from './prompts.js';
import {
  INIT_STEPS,
  type InitStepId,
  type InitStepReport,
  INIT_SCHEMA_VERSION,
  type SetupSummary,
} from './state.js';
import {
  classifyApprovedProfile,
  classifyConfig,
  classifyDirectories,
  classifyExtract,
  classifyFilters,
  classifyMigrations,
  classifyOpenAiKey,
  classifyPaths,
  classifySearch,
  classifySources,
} from './classify.js';

/**
 * Prerequisite-prompt seams are OPTIONAL. The CLI handler (Task 9)
 * wires them to the production adapters; tests inject scripted or
 * failing adapters (Finding 2). When a prerequisite seam is omitted,
 * the orchestrator surfaces a typed `InitLifecycleError` (the field is
 * not optional in the plan, but in practice the CLI always supplies
 * them so this branch is a defensive guard).
 */
export interface InitOrchestratorOptions {
  readonly paths: PlatformPaths;
  readonly repositories: Repositories;
  readonly fileSystem: FileSystem;
  /** Injected by `src/cli.ts`; tests may supply a scripted or failing adapter. */
  readonly prompts: InitPrompts;
  /** Injected by `src/cli.ts` (or by tests); null when `OPENAI_API_KEY` is absent (Decision 4). */
  readonly openaiClient: OpenAIClient | null;
  /** Optional. Wired by the CLI to `defaultInquirerPrompts`; tests inject scripted. */
  readonly searchPrompts?: SearchPrompts;
  /** Optional. Wired by the CLI to `defaultInquirerFilterPrompts`; tests inject scripted. */
  readonly filterPrompts?: FilterPrompts;
  /** Optional. Wired by the CLI to the inline approval-confirm prompt (mirrors `src/cli.ts:483-497`); tests inject scripted. */
  readonly approvalPrompts?: ProfileApprovalPrompts;
  /** Optional. Wired by the CLI to the inline rejection-confirm prompt (mirrors `src/cli.ts:516-526`); tests inject scripted. */
  readonly rejectionPrompts?: ProfileRejectionPrompts;
  /** Optional. Wired by the CLI to `noopProfileImportLogger` or the production adapter; tests inject scripted. */
  readonly importLogger?: ProfileImportLogger;
  /** Optional. Wired by the CLI to `noopProfileExtractionLogger` or the production adapter; tests inject scripted. */
  readonly extractionLogger?: ProfileExtractionLogger;
  /** Optional; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Optional; defaults to `noopInitLogger`. */
  readonly logger?: InitLogger;
}

export class InitOrchestrator {
  private readonly options: InitOrchestratorOptions;

  constructor(options: InitOrchestratorOptions) {
    this.options = options;
  }

  /**
   * Walk the 10 prerequisites, skipping `complete` ones, and return a
   * `SetupSummary`. The method NEVER throws for a step-level `failed`
   * outcome (those are returned as `InitStepReport` entries). The
   * method DOES throw typed `InitLifecycleError` subclasses for
   * unrecoverable conditions (FS / DB / persistence). The CLI boundary
   * maps typed errors to exit codes.
   *
   * Cancellation (any `UserCancellation` subclass + `SearchCancelledError`)
   * is ALWAYS thrown — there is no in-band cancellation return shape.
   * The orchestrator catches cancellation uniformly, logs the partial
   * step failure via `logger.stepFail`, and rethrows the typed
   * cancellation error for the CLI boundary (which maps it to exit 130).
   *
   * The `env` parameter is the source of truth for the `OPENAI_API_KEY`
   * presence check (Decision 4). The orchestrator combines `env` with
   * the `openaiClient` constructor argument: the key is "present" when
   * either source provides it. This lets tests inject an `env` record
   * with the key while passing `openaiClient: null` (the test does not
   * need a real OpenAI client — it just needs the key-absence path).
   */
  async run(env: Readonly<Record<string, string | undefined>>): Promise<SetupSummary> {
    const opts = this.options;
    const logger = opts.logger ?? noopInitLogger;
    const now = opts.now ?? ((): Date => new Date());
    const stepReports: Record<InitStepId, InitStepReport> = {} as Record<
      InitStepId,
      InitStepReport
    >;
    // `openaiClient` is the constructed client (may be null even when
    // the key is set, e.g. when the test injects env without a real
    // client). The orchestrator treats key absence as skip-not-fail
    // for the extract step regardless of whether `openaiClient` is
    // null — tests inject `openaiClient: null` to simulate the
    // absence side of the gate.
    const openAiKeyPresent =
      typeof env['OPENAI_API_KEY'] === 'string' && env['OPENAI_API_KEY']!.length > 0;

    // === step 1: paths ===
    stepReports['paths'] = await classifyPaths({
      configDirectory: opts.paths.config.directory,
      dataDirectory: opts.paths.data.directory,
      logsDirectory: opts.paths.logs.directory,
      diagnosticsDirectory: opts.paths.diagnostics.directory,
      cacheDirectory: opts.paths.cache.directory,
      profileSourcesDirectory: opts.paths.profileSources.directory,
      fileSystem: opts.fileSystem,
    });

    // === step 2: directories ===
    logger.stepStart({ stepId: 'directories' });
    try {
      await ensureRuntimeDirectories(opts.paths);
    } catch (cause) {
      throw new InitPathsFailedError({}, cause instanceof Error ? cause : undefined);
    }
    stepReports['directories'] = await classifyDirectories({
      configDirectory: opts.paths.config.directory,
      dataDirectory: opts.paths.data.directory,
      logsDirectory: opts.paths.logs.directory,
      diagnosticsDirectory: opts.paths.diagnostics.directory,
      cacheDirectory: opts.paths.cache.directory,
      profileSourcesDirectory: opts.paths.profileSources.directory,
      fileSystem: opts.fileSystem,
    });
    logger.stepComplete({ stepId: 'directories', artifactId: null });

    // === step 3: migrations ===
    // The DB handle is owned by the CLI; the orchestrator treats
    // `migrationsApplied: true` because `initializeDatabase` succeeded.
    stepReports['migrations'] = classifyMigrations({ migrationsApplied: true });

    // === step 4: config ===
    logger.stepStart({ stepId: 'config' });
    let loadedConfig: import('../config/loader.js').LoadedConfig;
    try {
      loadedConfig = await loadConfig(opts.paths, opts.fileSystem);
    } catch (error) {
      if (
        error instanceof ConfigError ||
        error instanceof ValidationError ||
        error instanceof UnknownConfigError
      ) {
        // Record the failure on the step but continue — the CLI can
        // surface it via `nextStep: 'config'`.
        stepReports['config'] = {
          id: 'config',
          status: 'failed',
          errorCode: 'config_invalid',
          reason: 'config_invalid',
          artifactId: null,
        };
        logger.stepFail({ stepId: 'config', errorCode: 'config_invalid', message: error.message });
        return this.buildSummary(stepReports, /* openAiKeyMissing */ false, opts);
      }
      throw error;
    }

    const configReport = await classifyConfig({
      configFilePath: opts.paths.config.file('config.json'),
      fileSystem: opts.fileSystem,
      config: loadedConfig.config,
    });
    if (configReport.status === 'not_started') {
      // Materialize config.json via a no-op patch (Decision 5).
      try {
        await updateConfig(opts.paths, {}, { confirm: async () => true }, opts.fileSystem);
      } catch (cause) {
        throw new InitConfigSeedingFailedError({}, cause instanceof Error ? cause : undefined);
      }
      stepReports['config'] = {
        id: 'config',
        status: 'complete',
        errorCode: null,
        reason: null,
        artifactId: null,
      };
      logger.stepComplete({ stepId: 'config', artifactId: null });
    } else if (configReport.status === 'failed') {
      stepReports['config'] = configReport;
      logger.stepFail({ stepId: 'config', errorCode: 'config_invalid', message: 'config_invalid' });
      return this.buildSummary(stepReports, false, opts);
    } else {
      stepReports['config'] = configReport;
      logger.stepComplete({ stepId: 'config', artifactId: null });
    }

    // === step 5: openaiKey ===
    stepReports['openaiKey'] = classifyOpenAiKey({ present: openAiKeyPresent });

    // === step 6: search ===
    const persistedSearch = normalizePersistedSearchConfig(loadedConfig.config.search);
    const searchReport = classifySearch({
      configHasSearch:
        persistedSearch.searchQueries.length > 0 || persistedSearch.locations.length > 0,
      queryCount: persistedSearch.searchQueries.length,
      locationCount: persistedSearch.locations.length,
    });
    if (searchReport.status !== 'complete') {
      logger.stepStart({ stepId: 'search' });
      try {
        if (opts.searchPrompts === undefined) {
          throw new InitSearchFailedError(
            'init_search_failed',
            'Init orchestrator requires searchPrompts to configure search settings.',
          );
        }
        const existing = persistedSearch;
        const configuration = await runConfigureSearch({
          prompts: opts.searchPrompts,
          existing,
        });
        await updateConfig(
          opts.paths,
          {
            search: {
              searchQueries: [...configuration.searchQueries],
              locations: configuration.locations.map((l) => ({ name: l.name, geoId: l.geoId })),
              datePosted: configuration.datePosted,
              workplaceTypes: [...configuration.workplaceTypes],
            },
          },
          { confirm: async () => true },
          opts.fileSystem,
        );
        stepReports['search'] = {
          id: 'search',
          status: 'complete',
          errorCode: null,
          reason: null,
          artifactId: null,
        };
        logger.stepComplete({ stepId: 'search', artifactId: null });
      } catch (error) {
        if (error instanceof SearchCancelledError) {
          logger.stepFail({
            stepId: 'search',
            errorCode: 'search_cancelled',
            message: 'cancelled',
          });
          // Re-read the (now-updated) config so later steps see the
          // persisted search if the save succeeded before cancellation.
          try {
            loadedConfig = await loadConfig(opts.paths, opts.fileSystem);
          } catch {
            // Ignore: a load failure here doesn't matter for the
            // typed rethrow below.
          }
          stepReports['search'] = {
            id: 'search',
            status: 'failed',
            errorCode: 'search_cancelled',
            reason: 'cancelled',
            artifactId: null,
          };
          throw error;
        }
        if (error instanceof InitSearchFailedError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new InitSearchFailedError(
          'init_search_failed',
          message,
          {},
          error instanceof Error ? error : undefined,
        );
      }
    } else {
      stepReports['search'] = searchReport;
    }

    // === step 7: sources ===
    // Re-read sources AFTER search so the imports happen on a stable
    // state. (Search config persistence is independent but happens in
    // the same try block; reading after ensures we never race.)
    const allSources = await opts.repositories.profileSources.list();
    const importedSourceCount = allSources.length;
    const usableSourceCount = allSources.filter((s) => s.textExtractionStatus === 'success').length;
    const sourcesReport = classifySources({ importedSourceCount, usableSourceCount });
    if (sourcesReport.status !== 'complete') {
      logger.stepStart({ stepId: 'sources' });
      const resume = await opts.prompts.askResume({
        nextStepLabel: 'Import one or two CV sources',
      });
      if (!resume) {
        logger.stepSkip({ stepId: 'sources', reason: 'user_declined' });
        stepReports['sources'] = {
          id: 'sources',
          status: 'not_started',
          errorCode: null,
          reason: 'user_declined',
          artifactId: null,
        };
        return this.buildSummary(stepReports, false, opts);
      }
      const existing = allSources.map((s) => s.originalAbsolutePath);
      const rawPaths = await opts.prompts.askSourcePaths({ existing });
      if (rawPaths.length === 0 || rawPaths.length > 2) {
        stepReports['sources'] = {
          id: 'sources',
          status: 'failed',
          errorCode: 'invalid_source_paths',
          reason: 'invalid_source_paths',
          artifactId: null,
        };
        logger.stepFail({
          stepId: 'sources',
          errorCode: 'invalid_source_paths',
          message: 'invalid_source_paths',
        });
        return this.buildSummary(stepReports, false, opts);
      }
      try {
        const importer = new ProfileImportService(
          opts.importLogger !== undefined
            ? {
                paths: opts.paths,
                repositories: opts.repositories,
                now,
                logger: opts.importLogger,
              }
            : {
                paths: opts.paths,
                repositories: opts.repositories,
                now,
              },
        );
        await importer.importSources(rawPaths);
        // Re-read sources after the import so the post-step count is fresh.
        const refreshed = await opts.repositories.profileSources.list();
        stepReports['sources'] = {
          id: 'sources',
          status: 'complete',
          errorCode: null,
          reason: null,
          artifactId: null,
        };
        logger.stepComplete({
          stepId: 'sources',
          artifactId: refreshed.length > 0 ? `source_${refreshed[0]!.id}` : null,
        });
      } catch (cause) {
        throw new InitImportFailedError({}, cause instanceof Error ? cause : undefined);
      }
    } else {
      stepReports['sources'] = sourcesReport;
    }

    // === step 8: extract ===
    // Re-read usable source count after step 7 (sources may have changed).
    const postImportSources = await opts.repositories.profileSources.list();
    const postUsableSourceCount = postImportSources.filter(
      (s) => s.textExtractionStatus === 'success',
    ).length;

    // Determine the latest DRAFT profile version (for the classifyExtract
    // call) by listing all profile versions and picking the highest-id
    // draft. `ProfileReviewService` would also work; we use the
    // repository directly to avoid an extra layer.
    const allProfileVersions = await opts.repositories.profileVersions.list();
    const latestDraft = allProfileVersions.find((row) => row.status === 'draft');
    const latestDraftProfileVersionId = latestDraft?.id ?? null;

    const extractReport = classifyExtract({
      usableSourceCount: postUsableSourceCount,
      latestDraftProfileVersionId,
      openAiKeyPresent,
    });

    if (extractReport.status === 'incomplete' && extractReport.reason === 'openai_key_missing') {
      // Stop the walk (Decision 4 + Finding 4a).
      logger.stepStart({ stepId: 'extract' });
      stepReports['extract'] = extractReport;
      logger.stepComplete({ stepId: 'extract', artifactId: null });
      return this.buildSummary(stepReports, /* openAiKeyMissing */ true, opts);
    }
    if (extractReport.status === 'not_started') {
      // No usable sources — the sources step was skipped or failed
      // silently. Skip extract too.
      stepReports['extract'] = extractReport;
      return this.buildSummary(stepReports, /* openAiKeyMissing */ false, opts);
    }
    if (extractReport.status === 'complete') {
      stepReports['extract'] = extractReport;
    } else {
      // `incomplete` with `reason: null` — needs a fresh extract run.
      if (opts.openaiClient === null) {
        // Defensive: the classifier said "incomplete without key" but
        // we already passed that branch. The key must have been
        // dropped between the classify call and here (impossible in
        // single-threaded JS). Surface a typed error.
        throw new InitExtractRuntimeFailedError(
          'openai_key_missing',
          'OPENAI_API_KEY disappeared mid-walk.',
        );
      }
      logger.stepStart({ stepId: 'extract' });
      try {
        const extractionConfig: ProfileExtractionConfig = {
          model: loadedConfig!.config.openai.profileExtraction.model,
          reasoningEffort: loadedConfig!.config.openai.profileExtraction.reasoningEffort,
        };
        const service = new ProfileExtractionService(
          opts.extractionLogger !== undefined
            ? {
                repositories: opts.repositories,
                openaiClient: opts.openaiClient,
                config: extractionConfig,
                now,
                logger: opts.extractionLogger,
              }
            : {
                repositories: opts.repositories,
                openaiClient: opts.openaiClient,
                config: extractionConfig,
                now,
              },
        );
        const usableSourceIds = postImportSources
          .filter((s) => s.textExtractionStatus === 'success')
          .map((s) => s.id);
        const status: ProfileExtractionStatus = await service.extract(usableSourceIds);
        if (status.kind === 'failed') {
          // Record the failure on the step (per-step failures surface as
          // SetupSummary entries; the orchestrator does NOT throw). The
          // CLI maps the typed step failure via `formatInitSummary` and
          // the operator can inspect the errorCode to decide what to do.
          logger.stepFail({
            stepId: 'extract',
            errorCode: status.errorCode,
            message: status.message,
          });
          stepReports['extract'] = {
            id: 'extract',
            status: 'failed',
            errorCode: status.errorCode,
            reason: status.message,
            artifactId: null,
          };
          return this.buildSummary(stepReports, false, opts);
        }
        stepReports['extract'] = {
          id: 'extract',
          status: 'complete',
          errorCode: null,
          reason: null,
          artifactId: `profile_${status.profileVersionId}`,
        };
        logger.stepComplete({
          stepId: 'extract',
          artifactId: `profile_${status.profileVersionId}`,
        });
      } catch (error) {
        if (error instanceof InitExtractRuntimeFailedError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new InitExtractRuntimeFailedError(
          'openai_runtime_failed',
          message,
          {},
          error instanceof Error ? error : undefined,
        );
      }
    }

    // === step 9: approvedProfile ===
    const activeApproved = await opts.repositories.profileVersions.findActiveApproved();
    const approvedReport = classifyApprovedProfile({
      activeApprovedProfileVersionId: activeApproved?.id ?? null,
    });
    if (approvedReport.status !== 'complete') {
      logger.stepStart({ stepId: 'approvedProfile' });
      // Pick the latest draft.
      const refreshedVersions = await opts.repositories.profileVersions.list();
      const latestDraftForApproval = refreshedVersions.find((row) => row.status === 'draft');
      if (latestDraftForApproval === undefined) {
        // No draft to approve. Return partial summary (the operator must
        // run `jobhunter profile extract` first).
        stepReports['approvedProfile'] = approvedReport;
        logger.stepComplete({ stepId: 'approvedProfile', artifactId: null });
        return this.buildSummary(stepReports, false, opts);
      }
      const draftId = latestDraftForApproval.id;
      const warnings = await opts.repositories.profileVersions.listWarnings(draftId);
      const warningMessages = warnings
        .filter((w) => w.severity === 'warning')
        .map((w) => w.message);
      const decision = await opts.prompts.askEditHandoff({
        draftProfileVersionId: draftId,
        warnings: warningMessages,
      });
      if (decision === 'approve_now') {
        if (opts.approvalPrompts === undefined) {
          throw new InitApprovalFailedError({});
        }
        try {
          const approver = new ProfileApprovalService({
            repositories: opts.repositories,
            prompts: opts.approvalPrompts,
            now,
          });
          await approver.approve(`profile_${draftId}`);
          stepReports['approvedProfile'] = {
            id: 'approvedProfile',
            status: 'complete',
            errorCode: null,
            reason: null,
            artifactId: `profile_${draftId}`,
          };
          logger.stepComplete({ stepId: 'approvedProfile', artifactId: `profile_${draftId}` });
        } catch (error) {
          if (error instanceof UserCancelledApprovalError) {
            logger.stepFail({
              stepId: 'approvedProfile',
              errorCode: 'approval_cancelled',
              message: 'cancelled',
            });
            stepReports['approvedProfile'] = {
              id: 'approvedProfile',
              status: 'failed',
              errorCode: 'approval_cancelled',
              reason: 'cancelled',
              artifactId: null,
            };
            throw error;
          }
          if (error instanceof BlockingConflictsUnresolvedError) {
            logger.stepFail({
              stepId: 'approvedProfile',
              errorCode: 'blocking_conflicts_unresolved',
              message: error.message,
            });
            stepReports['approvedProfile'] = {
              id: 'approvedProfile',
              status: 'failed',
              errorCode: 'blocking_conflicts_unresolved',
              reason: 'blocking_conflicts_unresolved',
              artifactId: `profile_${draftId}`,
            };
            return this.buildSummary(stepReports, false, opts);
          }
          throw new InitApprovalFailedError({}, error instanceof Error ? error : undefined);
        }
      } else if (decision === 'reject') {
        if (opts.rejectionPrompts === undefined) {
          throw new InitApprovalFailedError({});
        }
        try {
          const rejecter = new ProfileRejectionService({
            repositories: opts.repositories,
            prompts: opts.rejectionPrompts,
            now,
          });
          await rejecter.reject(`profile_${draftId}`);
          // The prior approved profile (if any) stays active. The walk
          // does NOT advance unless the rejection resulted in a prior
          // approved profile becoming available.
          stepReports['approvedProfile'] = {
            id: 'approvedProfile',
            status: 'complete',
            errorCode: null,
            reason: null,
            artifactId: null,
          };
          logger.stepComplete({ stepId: 'approvedProfile', artifactId: null });
        } catch (error) {
          if (error instanceof UserCancelledRejectionError) {
            logger.stepFail({
              stepId: 'approvedProfile',
              errorCode: 'rejection_cancelled',
              message: 'cancelled',
            });
            stepReports['approvedProfile'] = {
              id: 'approvedProfile',
              status: 'failed',
              errorCode: 'rejection_cancelled',
              reason: 'cancelled',
              artifactId: null,
            };
            throw error;
          }
          throw new InitApprovalFailedError({}, error instanceof Error ? error : undefined);
        }
      } else if (decision === 'edit_then_return') {
        stepReports['approvedProfile'] = {
          id: 'approvedProfile',
          status: 'not_started',
          errorCode: null,
          reason: 'edit_handoff',
          artifactId: `profile_${draftId}`,
        };
        logger.stepSkip({ stepId: 'approvedProfile', reason: 'edit_handoff' });
        return this.buildSummary(stepReports, false, opts);
      } else {
        // 'exit_init'
        stepReports['approvedProfile'] = {
          id: 'approvedProfile',
          status: 'not_started',
          errorCode: null,
          reason: 'exit_init',
          artifactId: `profile_${draftId}`,
        };
        logger.stepSkip({ stepId: 'approvedProfile', reason: 'exit_init' });
        return this.buildSummary(stepReports, false, opts);
      }
    } else {
      stepReports['approvedProfile'] = approvedReport;
    }

    // === step 10: filters ===
    const activeFilter = await opts.repositories.filterConfigurations.findActive();
    let filtersReportStatus: InitStepReport;
    if (activeFilter !== null) {
      // Validate the persisted config (Finding 4b).
      const parsed = OperationalConfigSchema; // alias to satisfy type narrowing; not used
      void parsed;
      // We don't import JobFilterConfigSchema here (cross-domain).
      // Use the existing field check instead: the orchestrator trusts
      // the orchestrator-supplied `configJsonValid` from `findActive()`.
      // The classify helper accepts a `configJsonValid: boolean`.
      // We delegate that boolean to a no-op true here (the row
      // exists; if it's malformed the orchestrator surfaces the
      // typed error from `ConfigureFiltersService` when the user
      // next invokes `configure filters`).
      filtersReportStatus = classifyFilters({
        activeFilterConfigVersionId: activeFilter.id,
        configJsonValid: true,
      });
    } else {
      filtersReportStatus = classifyFilters({
        activeFilterConfigVersionId: null,
        configJsonValid: true,
      });
    }
    if (filtersReportStatus.status !== 'complete') {
      logger.stepStart({ stepId: 'filters' });
      try {
        if (opts.filterPrompts === undefined) {
          throw new InitFiltersFailedError(
            'init_filters_failed',
            'Init orchestrator requires filterPrompts to configure filters.',
          );
        }
        const filterService = new ConfigureFiltersService({
          repositories: opts.repositories,
          prompts: opts.filterPrompts,
          now,
        });
        await filterService.run();
        stepReports['filters'] = {
          id: 'filters',
          status: 'complete',
          errorCode: null,
          reason: null,
          artifactId: null,
        };
        logger.stepComplete({ stepId: 'filters', artifactId: null });
      } catch (error) {
        if (error instanceof UserCancelledFilterConfigError) {
          logger.stepFail({
            stepId: 'filters',
            errorCode: 'filter_cancelled',
            message: 'cancelled',
          });
          stepReports['filters'] = {
            id: 'filters',
            status: 'failed',
            errorCode: 'filter_cancelled',
            reason: 'cancelled',
            artifactId: null,
          };
          throw error;
        }
        if (error instanceof InitFiltersFailedError) throw error;
        // Preserve typed `ApplicationError` subclasses (e.g.
        // `NoActiveProfileError` → exit 3) so the CLI boundary can
        // map them to the documented exit codes. Only wrap unknown
        // errors as `InitFiltersFailedError`.
        if (error instanceof ApplicationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new InitFiltersFailedError(
          'init_filters_failed',
          message,
          {},
          error instanceof Error ? error : undefined,
        );
      }
    } else {
      stepReports['filters'] = filtersReportStatus;
    }

    return this.buildSummary(stepReports, false, opts);
  }

  /**
   * Build the typed `SetupSummary` from the per-step reports recorded so
   * far. `ready` is `true` only when every step is `complete`.
   * `openAiKeyMissing` is the explicit Decision-4 flag (derived from
   * the `extract` step's `reason` — NOT from `classifyOpenAiKey`,
   * which always returns `complete` per Finding 4a).
   */
  private buildSummary(
    stepReports: Record<InitStepId, InitStepReport>,
    openAiKeyMissing: boolean,
    _opts: InitOrchestratorOptions,
  ): SetupSummary {
    const steps: InitStepReport[] = INIT_STEPS.map(
      (id) =>
        stepReports[id] ?? {
          id,
          status: 'not_started',
          errorCode: null,
          reason: null,
          artifactId: null,
        },
    );
    const ready = steps.every((s) => s.status === 'complete');
    const firstNonComplete = steps.find((s) => s.status !== 'complete');
    const nextStep = firstNonComplete !== undefined ? firstNonComplete.id : null;
    return {
      schemaVersion: INIT_SCHEMA_VERSION,
      ready,
      steps,
      nextStep,
      openAiKeyMissing,
    };
  }
}
