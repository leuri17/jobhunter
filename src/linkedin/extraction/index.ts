/**
 * Public barrel for `src/linkedin/extraction/` (TASK-013 Plan Task 14).
 *
 * Re-exports the public surface that the orchestrator (TASK-015)
 * consumes. Test helpers stay internal.
 */
export { LinkedInExtractionService } from './service.js';
export type {
  LinkedInExtractionServiceOptions,
  ExtractOneInput,
  ExtractBatchInput,
} from './service.js';

export { LINKEDIN_EXTRACTION_SCHEMA_VERSION } from './state.js';
export type {
  ExtractionOutcome,
  ExtractionBatchOutcome,
  ExtractionFieldSet,
  ExtractionKind,
  ExtractionMethod,
  RequiredField,
  LinkedinExtractionSchemaVersion,
} from './state.js';

export { LINKEDIN_FIELDS } from '../selectors.js';

export { parsePanel } from './panel-parser.js';
export type { ParsePanelOptions } from './panel-parser.js';
export {
  PANEL_VERIFY_MAX_ATTEMPTS,
  PANEL_VERIFY_RETRY_MS,
  PANEL_DESCRIPTION_WAIT_MS,
} from './panel-parser.js';

export { parseDedicatedPage } from './dedicated-parser.js';
export type { ParseDedicatedPageOptions } from './dedicated-parser.js';
export { DEDICATED_DESCRIPTION_WAIT_MS } from './dedicated-parser.js';

export { normalizeText, isValidRequiredField } from './normalize.js';
export { validateRequiredFields } from './required-fields.js';
export type { RequiredFieldsValidation } from './required-fields.js';
export { computeExtractionStatus } from './status.js';
export { buildDetailUrl } from './detail-url.js';

export {
  LinkedInExtractionError,
  PanelExtractionError,
  PanelJobIdMismatchError,
  DedicatedPageError,
  RequiredFieldMissingError,
  DetailUrlBuildError,
} from './errors.js';

export { noopLinkedInExtractionLogger, pinoLinkedInExtractionLogger } from './log.js';
export type { LinkedInExtractionLogger } from './log.js';
