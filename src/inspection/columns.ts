/**
 * Adaptive column selection for inspection tables (SPEC §34.5 + §34.6).
 *
 * Pure helper. The output of `selectColumns` drives both the
 * human-readable table formatter (`formatJobListTable`) and the
 * width-aware truncation logic in `truncate.ts`. The fixed
 * headers + priorities per state are the documented column order
 * (SPEC §34.5); the priority list controls which columns are
 * dropped first when the terminal is narrow.
 *
 * Priority convention:
 *   - `0` = essential (never dropped, e.g. ID).
 *   - `1` = secondary identifier (e.g. Score).
 *   - `2+` = textual / numeric / temporal columns, higher = drop sooner.
 *
 * The `ID` column is always priority `0`; `Score` is always `1`;
 * `Title` is always `2`. The remaining priorities are assigned to
 * make the SPEC §34.5 drop order fall out naturally (e.g. for
 * `--scored`, `Location` and `First discovered` drop before
 * `Title` / `Company`).
 */

import { InspectionValidationError } from './errors.js';
import type { ColumnSpec, JobListState } from './state.js';

/**
 * Terminal-width fallback when `process.stdout.columns` is
 * unavailable (mirrors `src/pipeline/format.ts:60`).
 */
export const DEFAULT_TERMINAL_WIDTH = 120;

/**
 * Column-cap extra chars: a column may grow up to
 * `header.length + COLUMN_GROWTH` chars above its min width when
 * the terminal is wider than the column set's minimum. This keeps
 * long values readable without making narrow terminals crowded.
 */
const COLUMN_GROWTH = 24;

/**
 * The per-state header array (SPEC §34.5). The order is the
 * documented display order. Each state's column set is intentionally
 * distinct: the column count per state is 5–8 and the priority list
 * below is what `selectColumns` uses to drop columns under narrow
 * terminals.
 */
export const HEADERS_BY_STATE: Record<JobListState, readonly string[]> = {
  // ['ID', 'Extraction', 'Filter', 'Score status', 'Score', 'Title', 'Company', 'Location', 'First discovered']
  all: [
    'ID',
    'Extraction',
    'Filter',
    'Score status',
    'Score',
    'Title',
    'Company',
    'Location',
    'First discovered',
  ],
  // ['ID', 'Score', 'Title', 'Company', 'Location', 'First discovered']
  scored: ['ID', 'Score', 'Title', 'Company', 'Location', 'First discovered'],
  // ['ID', 'Title', 'Company', 'Location', 'Score status', 'Filtered at']
  accepted: ['ID', 'Title', 'Company', 'Location', 'Score status', 'Filtered at'],
  // ['ID', 'Title', 'Company', 'Location', 'Score status', 'Reason', 'Filtered at']
  rejected: ['ID', 'Title', 'Company', 'Location', 'Score status', 'Reason', 'Filtered at'],
  // ['ID', 'Title', 'Company', 'Location', 'Scoring status', 'Last attempt']
  unscored: ['ID', 'Title', 'Company', 'Location', 'Scoring status', 'Last attempt'],
  // ['ID', 'LinkedIn ID', 'Title', 'Missing', 'Code', 'Discovered']
  partial: ['ID', 'LinkedIn ID', 'Title', 'Missing', 'Code', 'Discovered'],
  // ['Error ID', 'Query', 'Location', 'Card', 'Code', 'Discovered']
  failed: ['Error ID', 'Query', 'Location', 'Card', 'Code', 'Discovered'],
  // ['ID', 'Title', 'Company', 'Code', 'Last attempt']
  'filter-errors': ['ID', 'Title', 'Company', 'Code', 'Last attempt'],
  // ['ID', 'Title', 'Company', 'Code', 'Attempts', 'Last attempt']
  'scoring-errors': ['ID', 'Title', 'Company', 'Code', 'Attempts', 'Last attempt'],
};

/**
 * The per-state priority list. The array index matches the
 * column index in `HEADERS_BY_STATE[state]`. Lower priorities
 * are kept first when the terminal is narrow.
 *
 * Invariants:
 *   - The ID column (index 0 in every state) is always priority `0`.
 *   - For `--scored`, `Score` is priority `1`; `Title` is `2`;
 *     `Company` is `3`; `Location` is `4`; `First discovered` is
 *     `5` — so a narrow terminal drops `Location` + `First discovered`
 *     before `Title` / `Company` (the SPEC §34.5 test).
 */
export const PRIORITY_BY_STATE: Record<JobListState, readonly number[]> = {
  // ID(0) Extraction(4) Filter(5) ScoreStatus(2) Score(1) Title(2) Company(3) Location(4) FirstDiscovered(5)
  all: [0, 4, 5, 2, 1, 2, 3, 6, 7],
  // ID(0) Score(1) Title(2) Company(3) Location(4) FirstDiscovered(5)
  scored: [0, 1, 2, 3, 4, 5],
  // ID(0) Title(2) Company(3) Location(4) ScoreStatus(1) FilteredAt(5)
  accepted: [0, 2, 3, 4, 1, 5],
  // ID(0) Title(2) Company(3) Location(4) ScoreStatus(1) Reason(5) FilteredAt(6)
  rejected: [0, 2, 3, 4, 1, 5, 6],
  // ID(0) Title(2) Company(3) Location(4) ScoringStatus(1) LastAttempt(5)
  unscored: [0, 2, 3, 4, 1, 5],
  // ID(0) LinkedInID(1) Title(2) Missing(4) Code(3) Discovered(5)
  partial: [0, 1, 2, 4, 3, 5],
  // ErrorID(0) Query(2) Location(4) Card(5) Code(3) Discovered(5)
  failed: [0, 2, 4, 5, 3, 5],
  // ID(0) Title(2) Company(3) Code(1) LastAttempt(4)
  'filter-errors': [0, 2, 3, 1, 4],
  // ID(0) Title(2) Company(3) Code(1) Attempts(4) LastAttempt(5)
  'scoring-errors': [0, 2, 3, 1, 4, 5],
};

/**
 * Columns that are NEVER truncated regardless of the terminal
 * width — the spec calls out `ID` and `Score` as essential
 * (SPEC §34.6 "never truncated").
 */
const NEVER_TRUNCATE_HEADERS: ReadonlySet<string> = new Set(['ID', 'Score', 'Error ID']);

/**
 * Compute the adaptive `ColumnSpec[]` for `state` given the
 * terminal width. The function is total:
 *
 *   - When `terminalWidth` is too small to fit the ID + Score
 *     columns, it throws `InspectionValidationError`.
 *   - Otherwise, it returns at minimum the ID column (priority 0)
 *     and as many additional columns as the terminal can fit
 *     (highest priority first).
 *
 * The returned column order matches the documented per-state
 * header order; columns are dropped (NOT reordered) when the
 * terminal is narrow.
 */
export function selectColumns(state: JobListState, terminalWidth: number): readonly ColumnSpec[] {
  if (!Number.isInteger(terminalWidth) || terminalWidth < 0) {
    throw new InspectionValidationError(
      'select_columns_invalid_terminal_width',
      `selectColumns: terminalWidth must be a non-negative integer (received ${terminalWidth}).`,
      { terminalWidth },
    );
  }
  const headers = HEADERS_BY_STATE[state];
  const priorities = PRIORITY_BY_STATE[state];
  if (headers.length !== priorities.length) {
    // Compile-time guard — the two arrays must stay in lock-step.
    throw new InspectionValidationError(
      'select_columns_header_priority_mismatch',
      `selectColumns: headers and priorities length mismatch for state "${state}".`,
      { state, headers: headers.length, priorities: priorities.length },
    );
  }

  // Build the per-column candidate spec (header, priority, minWidth,
  // maxWidth, truncate). minWidth = header.length. maxWidth is the
  // column's growth budget; `selectColumns` will redistribute after
  // dropping.
  type Candidate = ColumnSpec & { readonly index: number };
  const candidates: Candidate[] = headers.map((header, index) => {
    const priority = priorities[index] ?? Number.MAX_SAFE_INTEGER;
    const minWidth = header.length;
    const maxWidth = Math.min(header.length + COLUMN_GROWTH, terminalWidth);
    const truncate = !NEVER_TRUNCATE_HEADERS.has(header);
    return { header, priority, minWidth, maxWidth, truncate, index };
  });

  // Sort candidates by priority ascending so we drop from the tail.
  // The original header order is preserved within the same priority
  // (Node's sort is stable) — the spec requires drop-without-reorder.
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority);

  // Drop the lowest-priority columns until the total minWidth fits.
  const kept: Candidate[] = [];
  let totalMinWidth = 0;
  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    if (candidate === undefined) continue;
    if (totalMinWidth + candidate.minWidth <= terminalWidth) {
      kept.push(candidate);
      totalMinWidth += candidate.minWidth;
    } else if (kept.some((k) => k.priority === 0)) {
      // Already have the ID column but no room for more — stop.
      break;
    } else {
      // ID itself doesn't fit — surface the failure mode.
      break;
    }
  }

  if (!kept.some((k) => k.priority === 0)) {
    throw new InspectionValidationError(
      'terminal_width_too_small',
      `selectColumns: terminal width ${terminalWidth} cannot fit the essential ID column for state "${state}".`,
      { terminalWidth, state, minRequiredWidth: sorted[0]?.minWidth ?? 0 },
    );
  }

  // Restore the documented header order (the spec mandates drop,
  // never reorder).
  kept.sort((a, b) => a.index - b.index);

  // Redistribute the column widths evenly across the kept columns.
  // Each kept column's maxWidth is the smaller of (a) its original
  // growth budget and (b) the fair-share allocation `floor(terminalWidth / kept)`.
  const fairShare = Math.floor(terminalWidth / Math.max(kept.length, 1));
  const finalSpecs: ColumnSpec[] = kept.map((candidate) => {
    const maxWidth = Math.max(candidate.minWidth, Math.min(candidate.maxWidth, fairShare));
    return {
      header: candidate.header,
      priority: candidate.priority,
      minWidth: candidate.minWidth,
      maxWidth,
      truncate: candidate.truncate,
    };
  });

  return finalSpecs;
}
