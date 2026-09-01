import { createHash } from 'node:crypto';
import type { OperationalConfig } from '../config/schema.js';
import type { TopNRow } from './state.js';

/**
 * Serialize a value to deterministic JSON (sorted keys, no whitespace).
 * Used for the run configuration snapshot.
 */
export function deterministicJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(deterministicJsonStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const body = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${deterministicJsonStringify(v)}`)
    .join(',');
  return `{${body}}`;
}

/**
 * Build the run configuration snapshot.
 *
 * The snapshot is the normalized OperationalConfig shape (no secrets).
 * The hash is the SHA-256 of the deterministic JSON string.
 */
export function buildConfigSnapshot(config: OperationalConfig): {
  readonly snapshot: OperationalConfig;
  readonly hash: string;
} {
  const json = deterministicJsonStringify(config);
  const hash = createHash('sha256').update(json).digest('hex');
  return { snapshot: config, hash };
}

/**
 * Convert a TopNRow to a JSON-safe shape (deterministic key order).
 */
export function serializeTopNRow(row: TopNRow): Record<string, unknown> {
  return {
    jobId: row.jobId,
    sourceJobId: row.sourceJobId,
    score: row.score,
    displayScore: row.displayScore,
    title: row.title,
    company: row.company,
    location: row.location,
    firstDiscovered: row.firstDiscovered,
  };
}
