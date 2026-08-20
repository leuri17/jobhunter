import { DiagnosticError } from './errors.js';

export interface DiagnosticScope {
  readonly pipelineRunId?: number | null;
  readonly searchExecutionId?: number | null;
  readonly jobId?: number | null;
  readonly extractionAttemptId?: number | null;
  readonly discoveryErrorId?: number | null;
  /**
   * TASK-014: the auto-increment primary key of the `openai_request_metadata`
   * row that captured the failing OpenAI request. Optional because
   * diagnostics written before the OpenAI metadata row is committed
   * (or for non-OpenAI failures) do not yet have this id.
   */
  readonly openaiRequestId?: number | null;
}

export interface SafeFilenameOptions {
  readonly artifactType: string;
  readonly scope: DiagnosticScope;
  readonly extension: string;
  readonly timestamp?: string;
  readonly suffix?: string;
}

export interface SafeFilenameResult {
  readonly basename: string;
  readonly relativePath: string;
}

const MAX_COMPONENT_LENGTH = 40;

export function sanitizeFilenameComponent(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') return 'unknown';
  const lowered = value.toLowerCase();
  let out = '';
  let lastWasDash = false;
  for (const char of lowered) {
    const safe = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
    if (safe) {
      out += char;
      lastWasDash = false;
    } else if (!lastWasDash) {
      out += '-';
      lastWasDash = true;
    }
  }
  out = out.replace(/^-+|-+$/g, '');
  if (out === '') return 'unknown';
  if (out.length > MAX_COMPONENT_LENGTH) {
    out = `${out.slice(0, MAX_COMPONENT_LENGTH - 1)}-`;
  }
  return out;
}

function isPositiveId(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function safeTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

export function resolveScopeDirectory(scope: DiagnosticScope): string {
  const segments: string[] = [];
  if (isPositiveId(scope.pipelineRunId)) segments.push(`run-${scope.pipelineRunId}`);
  if (isPositiveId(scope.searchExecutionId)) segments.push(`search-${scope.searchExecutionId}`);
  if (isPositiveId(scope.jobId)) segments.push(`job-${scope.jobId}`);
  if (isPositiveId(scope.extractionAttemptId)) segments.push(`extraction-${scope.extractionAttemptId}`);
  if (isPositiveId(scope.discoveryErrorId)) segments.push(`discovery-error-${scope.discoveryErrorId}`);
  if (isPositiveId(scope.openaiRequestId)) segments.push(`openai-${scope.openaiRequestId}`);
  return segments.length === 0 ? 'unscoped' : segments.join('/');
}

export function buildSafeFilename(opts: SafeFilenameOptions): SafeFilenameResult {
  if (typeof opts.artifactType !== 'string' || opts.artifactType === '') {
    throw new DiagnosticError('invalid_filename_type', 'artifactType must be a non-empty string.');
  }
  if (typeof opts.extension !== 'string' || opts.extension === '') {
    throw new DiagnosticError('invalid_filename_extension', 'extension must be a non-empty string.');
  }
  const ts = safeTimestamp(opts.timestamp ?? new Date().toISOString());
  const parts: string[] = [sanitizeFilenameComponent(opts.artifactType)];
  if (isPositiveId(opts.scope.pipelineRunId)) parts.push(`run-${opts.scope.pipelineRunId}`);
  if (isPositiveId(opts.scope.searchExecutionId)) parts.push(`search-${opts.scope.searchExecutionId}`);
  if (isPositiveId(opts.scope.jobId)) parts.push(`job-${opts.scope.jobId}`);
  if (isPositiveId(opts.scope.extractionAttemptId)) parts.push(`extraction-${opts.scope.extractionAttemptId}`);
  if (isPositiveId(opts.scope.discoveryErrorId)) parts.push(`discovery-error-${opts.scope.discoveryErrorId}`);
  if (isPositiveId(opts.scope.openaiRequestId)) parts.push(`openai-${opts.scope.openaiRequestId}`);
  parts.push(ts);
  if (opts.suffix !== undefined && opts.suffix !== '') {
    const normalizedSuffix = opts.suffix.replace(/^-+/, '');
    if (normalizedSuffix !== '') parts.push(normalizedSuffix);
  }
  const safeExt = sanitizeFilenameComponent(opts.extension);
  const basename = `${parts.join('-')}.${safeExt}`;
  const relativePath = `${resolveScopeDirectory(opts.scope)}/${basename}`;
  return { basename, relativePath };
}
