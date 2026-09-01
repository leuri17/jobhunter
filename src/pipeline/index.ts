/**
 * Public barrel for src/pipeline/.
 *
 * Re-exports the public surface that the CLI handler (src/cli.ts)
 * and the test harness consume. Internal helpers stay accessible
 * via their source paths.
 */

export {
  PIPELINE_SCHEMA_VERSION,
  type PipelineRunStatus,
  type RunSummary,
  type TopNRow,
} from './state.js';

export {
  PipelineLifecycleError,
  PipelinePrerequisiteError,
  PipelineOpenAIKeyMissingError,
} from './errors.js';

export { noopPipelineLogger, pinoPipelineLogger, type PipelineLogger } from './log.js';

export { buildConfigSnapshot, deterministicJsonStringify, serializeTopNRow } from './normalize.js';
export { formatRunSummary, formatTopNTable, formatScoringPlan } from './format.js';

export type { PipelinePrompts } from './prompts.js';
export { ScriptedPipelinePrompts, FailingPipelinePrompts } from './prompts.js';
export { InquirerPipelinePrompts } from './prompts-inquirer.js';

export { getApplicationVersion } from './version.js';

export { PipelineOrchestrator } from './orchestrator.js';
export type {
  PipelineOrchestratorOptions,
  PipelineRunInput,
  PipelineRunResult,
} from './orchestrator.js';
