/**
 * Public barrel for `src/init/`. Re-exports every public symbol from
 * the init layer so external consumers (desktop sidecar, tests) can
 * pull from a single import path.
 *
 * Domain boundaries: this module does not import Playwright,
 * Drizzle directly, or Pino directly. The InitLogger is reached via
 * the `./log.js` adapter.
 */
export {
  INIT_STEPS,
  INIT_SCHEMA_VERSION,
  INIT_STEP_LABELS,
  type InitSchemaVersion,
  type InitStepId,
  type InitStepReport,
  type InitStepStatus,
  type SetupSummary,
} from './state.js';

export {
  InitLifecycleError,
  InitPathsFailedError,
  InitConfigSeedingFailedError,
  InitMigrationsFailedError,
  InitSearchFailedError,
  InitImportFailedError,
  InitExtractRuntimeFailedError,
  InitApprovalFailedError,
  InitFiltersFailedError,
  InitSummaryFailedError,
} from './errors.js';

export {
  classifyPaths,
  classifyDirectories,
  classifyConfig,
  classifyMigrations,
  classifyOpenAiKey,
  classifySearch,
  classifySources,
  classifyExtract,
  classifyApprovedProfile,
  classifyFilters,
  type ClassifyPathsInput,
  type ClassifyConfigInput,
  type ClassifyMigrationsInput,
  type ClassifyOpenAiKeyInput,
  type ClassifySearchInput,
  type ClassifySourcesInput,
  type ClassifyExtractInput,
  type ClassifyApprovedProfileInput,
  type ClassifyFiltersInput,
} from './classify.js';

export { createFailingInitPrompts, ScriptedInitPrompts, type InitPrompts } from './prompts.js';

export { noopInitLogger, pinoInitLogger, type InitLogger } from './log.js';

export { formatInitSummary } from './format.js';

export { InitOrchestrator, type InitOrchestratorOptions } from './init-service.js';
