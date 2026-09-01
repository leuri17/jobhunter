import { AVAILABLE_METADATA_MAX_BYTES } from './state.js';
import { Redactor } from '../diagnostics/redactor.js';
import type { LinkedInScraperLogger } from './log.js';

/**
 * Options for `truncateAvailableMetadata`.
 *
 * `metadata` is the raw card metadata the orchestrator extracted
 * from the DOM (title / company / location snippet). The function
 * applies `Redactor` (if provided) to remove secret-like values,
 * then trims the result to fit within `maxBytes` (default
 * `AVAILABLE_METADATA_MAX_BYTES` = 2 KiB).
 */
export interface TruncateAvailableMetadataOptions {
  readonly metadata: unknown;
  readonly maxBytes?: number;
  readonly redactor?: Redactor;
  readonly logger?: LinkedInScraperLogger;
}

/**
 * Result of the truncation. When fields are dropped, the dropped
 * keys are returned in the `droppedFields` array so the orchestrator
 * can log a warning. `result` is the (possibly empty) record — `null`
 * if the input was nullish or every value was redacted to empty.
 */
export interface TruncateAvailableMetadataResult {
  readonly result: Readonly<Record<string, string>> | null;
  readonly droppedFields: readonly string[];
}

/**
 * Pure truncation + redaction helper.  deviation: the
 * placeholder `truncateAvailableMetadata` in `state.ts` only capped
 * the size; the real implementation lives here and adds the
 * `Redactor` pass + a `droppedFields` audit trail.
 *
 * The function is idempotent: a second call with the same input
 * returns the same output. It does NOT mutate `metadata`.
 */
export function truncateAvailableMetadata(
  options: TruncateAvailableMetadataOptions,
): TruncateAvailableMetadataResult {
  const { metadata, redactor, logger } = options;
  const maxBytes = options.maxBytes ?? AVAILABLE_METADATA_MAX_BYTES;

  if (metadata === null || metadata === undefined) {
    return { result: null, droppedFields: [] };
  }

  // Redact first (deep). If the metadata is not a plain object, wrap it
  // as a string record so the truncation path is uniform.
  const redacted = redactor !== undefined ? redactor.redactValue(metadata) : metadata;

  // Normalize: ensure we have a Record<string, string>-shaped value.
  // Non-object inputs are stringified; arrays are dropped (they don't
  // fit the `availableMetadata` schema).
  const candidate: Record<string, unknown> =
    typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted)
      ? (redacted as Record<string, unknown>)
      : { value: redacted };

  if (byteSize(candidate) <= maxBytes) {
    return {
      result: stringifyValues(candidate),
      droppedFields: [],
    };
  }

  // Drop the longest string values first until the size fits. We
  // sort ASCENDING by entry size and keep greedily — the largest
  // entries that don't fit end up in `dropped` (the smallest
  // fields survive, so the user keeps the most "nugget" data per
  // byte of budget).
  const entries = Object.entries(candidate).sort((a, b) => entrySize(a) - entrySize(b));
  const kept: Array<[string, unknown]> = [];
  const dropped: string[] = [];
  let bytes = 0;
  for (const [key, value] of entries) {
    const entryBytes = entrySize([key, value]);
    if (bytes + entryBytes <= maxBytes) {
      kept.push([key, value]);
      bytes += entryBytes;
    } else {
      dropped.push(key);
    }
  }

  if (kept.length === 0) {
    if (logger !== undefined) {
      logger.searchFail({
        searchId: 'metadata_truncation',
        errorCode: 'all_fields_dropped',
        message: `All ${dropped.length} metadata fields exceeded the ${maxBytes}-byte budget`,
      });
    }
    return { result: null, droppedFields: dropped };
  }

  if (logger !== undefined && dropped.length > 0) {
    logger.searchFail({
      searchId: 'metadata_truncation',
      errorCode: 'fields_dropped',
      message: `Dropped ${dropped.length} metadata field(s) over the ${maxBytes}-byte budget: ${dropped.join(', ')}`,
    });
  }

  return {
    result: stringifyValues(Object.fromEntries(kept)),
    droppedFields: dropped,
  };
}

function stringifyValues(record: Record<string, unknown>): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      out[key] = value;
    } else if (value === null || value === undefined) {
      // Drop null/undefined values; they would serialize as 'null'/'undefined'.
      continue;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return Object.freeze(out);
}

function entrySize(entry: readonly [string, unknown]): number {
  const [key, value] = entry;
  return Buffer.byteLength(`${JSON.stringify(key)}:${JSON.stringify(value)}`, 'utf8') + 1;
}

function byteSize(record: Record<string, unknown>): number {
  return Object.entries(record).reduce((acc, entry) => acc + entrySize(entry), 0);
}
