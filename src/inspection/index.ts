/**
 * Public barrel for `src/inspection/` (TASK-016).
 *
 * Re-exports the public surface that the CLI handler
 * (`src/cli.ts`) and the test harness consume. Internal helpers
 * stay accessible via their source paths.
 *
 * Layout:
 *   - Pure layer: state, errors, columns, truncate, format, json-schemas.
 *   - Service layer: services/{jobs-list,jobs-show,runs-list,runs-show}-service
 *     (Wave B — re-exported only after the wave lands).
 */

// Pure layer — state vocabulary.
export {
  INSPECTION_SCHEMA_VERSION,
  JOB_LIST_STATES,
  type ColumnSpec,
  type InspectionSchemaVersion,
  type JobListResult,
  type JobListRow,
  type JobListRowAccepted,
  type JobListRowAll,
  type JobListRowFailed,
  type JobListRowFilterErrors,
  type JobListRowPartial,
  type JobListRowRejected,
  type JobListRowScored,
  type JobListRowScoringErrors,
  type JobListRowUnscored,
  type JobListSortKey,
  type JobListState,
  type JobShowPayload,
  type PipelineRunSearchExecutionRow,
  type RunListRow,
  type RunShowPayload,
} from './state.js';

// Pure layer — typed errors.
export {
  InspectionError,
  InspectionNotFoundError,
  InspectionResourceNotFoundError,
  InspectionValidationError,
} from './errors.js';

// Pure layer — adaptive columns.
export {
  DEFAULT_TERMINAL_WIDTH,
  HEADERS_BY_STATE,
  PRIORITY_BY_STATE,
  selectColumns,
} from './columns.js';

// Pure layer — truncation.
export { truncateWithEllipsis } from './truncate.js';

// Pure layer — human-readable formatters.
export { formatJobListTable, formatJobShow, formatRunListTable, formatRunShow } from './format.js';

// Pure layer — Zod schemas for `--json` output.
export {
  JobListJsonSchema,
  JobListRowJsonSchema,
  JobShowJsonSchema,
  PathsJsonSchema,
  RunListJsonSchema,
  RunListRowJsonSchema,
  RunShowJsonSchema,
  type JobListJsonPayload,
  type JobShowJsonPayload,
  type PathsJsonPayload,
  type RunListJsonPayload,
  type RunShowJsonPayload,
} from './json-schemas.js';

// Service layer — Wave B (TASK-016).
export {
  JobsListService,
  sortJobListRows,
  type JobsListInput,
  type JobsListServiceOptions,
} from './services/jobs-list-service.js';
export {
  JobsShowService,
  linkedinJobUrl,
  type JobsShowServiceOptions,
} from './services/jobs-show-service.js';
export {
  RunsListService,
  summariseSearchErrors,
  type RunsListInput,
  type RunsListServiceOptions,
} from './services/runs-list-service.js';
export { RunsShowService, type RunsShowServiceOptions } from './services/runs-show-service.js';
