/**
 * RunsListService — read-side service for `runs list`.
 *
 * Returns the `limit` most recent pipeline runs as `RunListRow`s
 * ordered by id DESC. The `errorSummary` field is
 * synthesised from the run's `searchErrors` JSON column: it is
 * `'none'` when the run had no errors, or `<code>: <count>` when
 * at least one error is present.
 *
 * Domain boundary: this service imports `src/persistence/repositories/`
 * — the only module under `src/inspection/` allowed to do so.
 */

import type { RunListRow } from '../state.js';
import type { Repositories } from '../../persistence/repositories/index.js';
import type { PipelineRunRow } from '../../persistence/repositories/pipeline-runs.js';

/** Default limit per  (`runTopN` default). */
const DEFAULT_RUNS_LIST_LIMIT = 20;

export interface RunsListServiceOptions {
  readonly repositories: Repositories;
}

export interface RunsListInput {
  readonly limit?: number;
}

/**
 * Read-only service backing `runs list [--limit <n>]`.
 */
export class RunsListService {
  constructor(private readonly repositories: Repositories) {}

  async list(opts: RunsListInput = {}): Promise<readonly RunListRow[]> {
    const limit = this.resolveLimit(opts.limit);
    const runs = await this.repositories.pipelineRuns.listRecent(limit);
    return runs.map((row) => this.rowToListRow(row));
  }

  /**
   * Validate + coerce the requested limit. The sidecar route does
   * the primary validation; this is a defense-in-depth check.
   */
  private resolveLimit(rawLimit: number | undefined): number {
    if (rawLimit === undefined) return DEFAULT_RUNS_LIST_LIMIT;
    if (!Number.isInteger(rawLimit) || rawLimit <= 0) return DEFAULT_RUNS_LIST_LIMIT;
    return rawLimit;
  }

  /** Map a `PipelineRunRow` to the public `RunListRow` shape. */
  private rowToListRow(row: PipelineRunRow): RunListRow {
    return {
      id: `run_${row.id}`,
      internalId: row.id,
      startTimestamp: row.startTimestamp,
      endTimestamp: row.endTimestamp,
      status: row.status,
      searchesAttempted: row.searchesAttempted,
      jobsDiscovered: row.jobsDiscovered,
      jobsScored: row.jobsScored,
      errorSummary: summariseSearchErrors(row.searchErrors),
    };
  }
}

/**
 * Pure: synthesise the `errorSummary` column from the run's
 * `searchErrors` JSON column. Returns `'none'` when there are no
 * errors, or `<code>: <n>` for the first error code (matching the
 * plan's "first search error code + count" contract).
 */
export function summariseSearchErrors(searchErrors: readonly unknown[] | null): string {
  if (searchErrors === null || searchErrors.length === 0) {
    return 'none';
  }
  const counts = new Map<string, number>();
  for (const entry of searchErrors) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const code = typeof e['code'] === 'string' ? e['code'] : null;
    if (code === null) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (counts.size === 0) return 'none';
  const first = counts.entries().next();
  if (first.done === true) return 'none';
  const [code, count] = first.value;
  return `${code}: ${count}`;
}
