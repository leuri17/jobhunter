/**
 * Adaptive table + multi-line show formatters for inspection commands
 * (SPEC §34.5 + §34.6 + §35).
 *
 * Pure formatters. NO imports from `src/persistence/`, `src/pipeline/`,
 * `src/init/`, `src/scoring/`, `src/linkedin/`, `src/filter/`,
 * `src/profile/`. The formatters operate on the plain row shapes
 * declared in `state.ts`; the service layer (Wave B) is responsible
 * for the row → shape mapping.
 *
 * The formatters are TOTAL: an empty input returns `(no rows)` /
 * `(no runs)` / `(no jobs)` placeholders rather than crashing. The
 * `formatJobShow` formatter always prints the full stored values
 * (SPEC §34.6) — no truncation, no width budget for the description
 * + explanation.
 */

import { selectColumns } from './columns.js';
import type { ColumnSpec } from './state.js';
import {
  type JobListRow,
  type JobListState,
  type JobShowPayload,
  type RunListRow,
  type RunShowPayload,
} from './state.js';
import { truncateWithEllipsis } from './truncate.js';

/**
 * Cell-alignment hint. `right` aligns numeric / ID columns on the
 * right edge; `left` aligns everything else. The formatters use
 * `padEnd` / `padStart` respectively.
 */
type Alignment = 'left' | 'right';

/**
 * Columns that are right-aligned (numeric + ID-style values).
 * Every other column is left-aligned.
 */
const RIGHT_ALIGNED_HEADERS: ReadonlySet<string> = new Set(['ID', 'Score', 'Error ID', 'Card']);

function alignmentFor(header: string): Alignment {
  return RIGHT_ALIGNED_HEADERS.has(header) ? 'right' : 'left';
}

function padCell(text: string, width: number, alignment: Alignment): string {
  if (alignment === 'right') {
    return text.padStart(width);
  }
  return text.padEnd(width);
}

/**
 * Apply the column spec to one cell value. Returns the final
 * `width`-long string ready to be joined with peers.
 */
function renderCell(text: string, spec: ColumnSpec): string {
  const width = spec.maxWidth;
  let value = text;
  if (value.length > width && spec.truncate) {
    value = truncateWithEllipsis(value, width);
  } else if (value.length > width && !spec.truncate) {
    // Non-truncating columns must be left at their natural width;
    // selectColumns guarantees the natural width fits the budget
    // for ID + Score + Error ID.
    value = value.slice(0, width);
  }
  return padCell(value, width, alignmentFor(spec.header));
}

/**
 * Render the per-state column header for a row. The function is
 * a pure switch over the row's `state` discriminator and the
 * column index in `selectColumns(state, ...)` order. Column order
 * is fixed per state (see `HEADERS_BY_STATE`), so this lookup is
 * deterministic.
 */
function jobListCell(state: JobListState, row: JobListRow, columnIndex: number): string {
  // Helpers — keep the projections local so the per-state switch
  // stays flat and grep-able.
  const na = (): string => '—';
  const present = (v: string | null | undefined): string =>
    v === null || v === undefined ? na() : v;

  switch (state) {
    case 'all': {
      const r = row as Extract<JobListRow, { state: 'all' }>;
      const cells: readonly string[] = [
        r.id,
        r.extraction,
        r.filter,
        r.scoreStatus,
        r.score,
        r.title,
        r.company,
        r.location,
        r.firstDiscoveredAt,
      ];
      return cells[columnIndex] ?? '';
    }
    case 'scored': {
      const r = row as Extract<JobListRow, { state: 'scored' }>;
      const cells: readonly string[] = [
        r.id,
        r.displayScore,
        present(r.title),
        present(r.company),
        present(r.location),
        r.firstDiscoveredAt,
      ];
      return cells[columnIndex] ?? '';
    }
    case 'accepted': {
      const r = row as Extract<JobListRow, { state: 'accepted' }>;
      const cells: readonly string[] = [
        r.id,
        present(r.title),
        present(r.company),
        present(r.location),
        r.scoreStatus,
        r.filteredAt,
      ];
      return cells[columnIndex] ?? '';
    }
    case 'rejected': {
      const r = row as Extract<JobListRow, { state: 'rejected' }>;
      const cells: readonly string[] = [
        r.id,
        present(r.title),
        present(r.company),
        present(r.location),
        r.scoreStatus,
        r.rejectionReason,
        r.filteredAt,
      ];
      return cells[columnIndex] ?? '';
    }
    case 'unscored': {
      const r = row as Extract<JobListRow, { state: 'unscored' }>;
      const cells: readonly string[] = [
        r.id,
        present(r.title),
        present(r.company),
        present(r.location),
        r.scoringStatus,
        r.lastAttemptAt ?? na(),
      ];
      return cells[columnIndex] ?? '';
    }
    case 'partial': {
      const r = row as Extract<JobListRow, { state: 'partial' }>;
      const cells: readonly string[] = [
        r.id,
        r.linkedinJobId,
        r.availableTitle,
        r.missingFields.join(','),
        r.errorCode,
        r.discoveredAt,
      ];
      return cells[columnIndex] ?? '';
    }
    case 'failed': {
      const r = row as Extract<JobListRow, { state: 'failed' }>;
      const cells: readonly string[] = [
        `discovery_error_${r.errorId}`,
        r.searchQuery,
        r.locationName,
        r.cardIndex === null ? na() : String(r.cardIndex),
        r.errorCode,
        r.discoveredAt,
      ];
      return cells[columnIndex] ?? '';
    }
    case 'filter-errors': {
      const r = row as Extract<JobListRow, { state: 'filter-errors' }>;
      const cells: readonly string[] = [
        r.id,
        present(r.title),
        present(r.company),
        r.errorCode,
        r.lastAttemptAt,
      ];
      return cells[columnIndex] ?? '';
    }
    case 'scoring-errors': {
      const r = row as Extract<JobListRow, { state: 'scoring-errors' }>;
      const cells: readonly string[] = [
        r.id,
        present(r.title),
        present(r.company),
        r.errorCode,
        String(r.attempts),
        r.lastAttemptAt,
      ];
      return cells[columnIndex] ?? '';
    }
    default: {
      // Exhaustiveness check — `state` is a closed union.
      const exhaustive: never = state;
      void exhaustive;
      return '';
    }
  }
}

/**
 * Render the `jobs list` table (SPEC §34.5). The output is the
 * header line + one line per row, joined by `\n`. Empty input
 * returns the documented `(no jobs)` placeholder.
 */
export function formatJobListTable(
  state: JobListState,
  rows: readonly JobListRow[],
  terminalWidth: number,
): string {
  if (rows.length === 0) {
    return '(no jobs)';
  }
  const specs = selectColumns(state, terminalWidth);
  const headerLine = specs
    .map((spec) => padCell(spec.header, spec.maxWidth, alignmentFor(spec.header)))
    .join(' ');
  const rowLines = rows.map((row) =>
    specs.map((spec, i) => renderCell(jobListCell(state, row, i), spec)).join(' '),
  );
  return [headerLine, ...rowLines].join('\n');
}

/**
 * Render the `jobs show` multi-line block (SPEC §34.6). The
 * formatter prints the FULL stored description + explanation
 * regardless of the terminal width — SPEC §34.6 "preserve full
 * stored values". The `terminalWidth` argument is accepted for
 * API symmetry with `formatJobListTable` (callers can pass
 * `process.stdout.columns ?? 120` to all formatters) but is not
 * consulted.
 */
export function formatJobShow(payload: JobShowPayload, terminalWidth: number): string {
  void terminalWidth;
  const lines: string[] = [];
  lines.push(`ID: ${payload.id}`);
  lines.push(`Source job ID: ${payload.sourceJobId}`);
  lines.push(`LinkedIn URL: ${payload.linkedinUrl}`);
  lines.push(`Title: ${payload.title ?? '—'}`);
  lines.push(`Company: ${payload.company ?? '—'}`);
  lines.push(`Location: ${payload.location ?? '—'}`);
  lines.push(`Extraction status: ${payload.extractionStatus}`);
  lines.push(`Extraction method: ${payload.successfulMethod ?? '—'}`);

  lines.push('Description:');
  if (payload.description === null || payload.description === '') {
    lines.push('  (none)');
  } else {
    for (const line of payload.description.split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  lines.push('Discovery history:');
  if (payload.discoveryHistory.length === 0) {
    lines.push('  (no discoveries)');
  } else {
    for (const entry of payload.discoveryHistory) {
      const label = entry.isNew ? 'new' : 'existing';
      lines.push(
        `  run_${entry.runId}  search_${entry.searchExecutionId}  ${entry.timestamp}  ${label}`,
      );
    }
  }

  lines.push('Current filter result:');
  lines.push(`  outcome: ${payload.currentFilter.outcome ?? '—'}`);
  lines.push(`  fingerprint: ${payload.currentFilter.fingerprint ?? '—'}`);
  lines.push(`  filtered at: ${payload.currentFilter.filteredAt ?? '—'}`);
  if (payload.currentFilter.rejectionReasons.length === 0) {
    lines.push('  rejection reasons: (none)');
  } else {
    lines.push(`  rejection reasons: ${payload.currentFilter.rejectionReasons.join('; ')}`);
  }
  lines.push(`  historical results available: ${payload.currentFilter.hasHistory ? 'yes' : 'no'}`);

  lines.push('Current score:');
  lines.push(`  overall score: ${payload.currentScore.overallScore ?? '—'}`);
  lines.push(`  display score: ${payload.currentScore.displayScore ?? '—'}`);
  lines.push(`  timestamp: ${payload.currentScore.timestamp ?? '—'}`);
  if (payload.currentScore.categoryScores.length === 0) {
    lines.push('  category scores: (none)');
  } else {
    lines.push('  category scores:');
    for (const c of payload.currentScore.categoryScores) {
      lines.push(`    ${c.category}: ${c.score} — ${c.explanation}`);
    }
  }
  if (payload.currentScore.explanation === null || payload.currentScore.explanation === '') {
    lines.push('  explanation: (none)');
  } else {
    lines.push('  explanation:');
    for (const line of payload.currentScore.explanation.split('\n')) {
      lines.push(`    ${line}`);
    }
  }
  lines.push(
    `  matches: ${payload.currentScore.matches.length === 0 ? '(none)' : payload.currentScore.matches.join('; ')}`,
  );
  lines.push(
    `  gaps: ${payload.currentScore.gaps.length === 0 ? '(none)' : payload.currentScore.gaps.join('; ')}`,
  );
  lines.push(
    `  concerns: ${payload.currentScore.concerns.length === 0 ? '(none)' : payload.currentScore.concerns.join('; ')}`,
  );
  lines.push(`  inferred seniority: ${payload.currentScore.inferredSeniority ?? '—'}`);
  lines.push(`  recommendation: ${payload.currentScore.recommendationSummary ?? '—'}`);
  lines.push(`  historical results available: ${payload.currentScore.hasHistory ? 'yes' : 'no'}`);

  lines.push('Timestamps:');
  lines.push(`  first discovered: ${payload.timestamps.firstDiscoveredAt}`);
  lines.push(`  last rediscovered: ${payload.timestamps.lastRediscoveryAt}`);
  lines.push(`  last extraction attempt: ${payload.timestamps.lastExtractionAttemptAt ?? '—'}`);
  lines.push(`  created: ${payload.timestamps.createdAt}`);
  lines.push(`  updated: ${payload.timestamps.updatedAt}`);

  return lines.join('\n');
}

/**
 * Render the `runs list` table (SPEC §35.1). The columns are
 * fixed: `ID | Start | End | Status | Searches | Jobs | Scored | Errors`.
 * Adaptive width per column with the same priority + drop logic
 * as `formatJobListTable` (callers can pre-compute the column
 * spec via `selectColumns`-equivalent logic — the run-list
 * columns are fewer so the priority list is fixed and lives
 * here).
 */
const RUN_LIST_HEADERS: readonly string[] = [
  'ID',
  'Start',
  'End',
  'Status',
  'Searches',
  'Jobs',
  'Scored',
  'Errors',
];
const RUN_LIST_PRIORITIES: readonly number[] = [0, 4, 5, 3, 6, 6, 6, 1];

function runListColumnSpecs(terminalWidth: number): readonly ColumnSpec[] {
  // Build the per-column candidate (mirrors selectColumns).
  type Candidate = ColumnSpec & { readonly index: number };
  const candidates: Candidate[] = RUN_LIST_HEADERS.map((header, index) => {
    const priority = RUN_LIST_PRIORITIES[index] ?? Number.MAX_SAFE_INTEGER;
    const minWidth = header.length;
    const maxWidth = Math.min(header.length + 24, terminalWidth);
    const truncate = header !== 'ID';
    return { header, priority, minWidth, maxWidth, truncate, index };
  });
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
  const kept: Candidate[] = [];
  let totalMinWidth = 0;
  for (const candidate of sorted) {
    if (totalMinWidth + candidate.minWidth <= terminalWidth) {
      kept.push(candidate);
      totalMinWidth += candidate.minWidth;
    } else if (kept.some((k) => k.priority === 0)) {
      break;
    } else {
      break;
    }
  }
  if (!kept.some((k) => k.priority === 0)) {
    // Worst case: keep the ID column alone.
    kept.length = 0;
    kept.push(candidates[0]!);
  }
  kept.sort((a, b) => a.index - b.index);
  const fairShare = Math.floor(terminalWidth / Math.max(kept.length, 1));
  return kept.map((candidate) => ({
    header: candidate.header,
    priority: candidate.priority,
    minWidth: candidate.minWidth,
    maxWidth: Math.max(candidate.minWidth, Math.min(candidate.maxWidth, fairShare)),
    truncate: candidate.truncate,
  }));
}

function runListCell(row: RunListRow, columnIndex: number): string {
  const cells: readonly string[] = [
    row.id,
    row.startTimestamp,
    row.endTimestamp ?? '—',
    row.status,
    String(row.searchesAttempted),
    String(row.jobsDiscovered),
    String(row.jobsScored),
    row.errorSummary,
  ];
  return cells[columnIndex] ?? '';
}

export function formatRunListTable(rows: readonly RunListRow[], terminalWidth: number): string {
  if (rows.length === 0) {
    return '(no runs)';
  }
  const specs = runListColumnSpecs(terminalWidth);
  const headerLine = specs
    .map((spec) => padCell(spec.header, spec.maxWidth, alignmentFor(spec.header)))
    .join(' ');
  const rowLines = rows.map((row) =>
    specs.map((spec, i) => renderCell(runListCell(row, i), spec)).join(' '),
  );
  return [headerLine, ...rowLines].join('\n');
}

/**
 * Render the `runs show` multi-line block (SPEC §35.2). The
 * formatter prints the full configuration snapshot + diagnostic
 * paths (the latter truncated to the terminal width budget so a
 * very long path doesn't blow up the terminal).
 */
export function formatRunShow(payload: RunShowPayload, terminalWidth: number): string {
  const lines: string[] = [];
  lines.push(`Run ID: ${payload.id}`);
  lines.push(`Status: ${payload.status}`);
  lines.push(`Started: ${payload.startTimestamp}`);
  lines.push(`Ended: ${payload.endTimestamp ?? '—'}`);
  lines.push(
    `Configuration: ${payload.configuration.hash} (schema v${payload.configuration.schemaVersion})`,
  );
  lines.push(`Application version: ${payload.configuration.applicationVersion}`);
  lines.push(
    `Active profile: ${payload.profileVersionId === null ? '—' : `profile_${payload.profileVersionId}`}`,
  );
  lines.push(
    `Active filter: ${payload.filterConfigVersionId === null ? '—' : `filters_${payload.filterConfigVersionId}`}`,
  );

  lines.push('Search executions:');
  if (payload.searchExecutions.length === 0) {
    lines.push('  (no searches)');
  } else {
    for (const s of payload.searchExecutions) {
      lines.push(`  search_${s.id}  ${s.searchQuery} @ ${s.locationName}  ${s.finalStatus}`);
    }
  }

  lines.push(
    `Job counts: complete=${payload.jobCounts.complete} partial=${payload.jobCounts.partial} failed=${payload.jobCounts.failed} total=${payload.jobCounts.total}`,
  );
  lines.push(
    `Filter counts: accepted=${payload.filterCounts.accepted} rejected=${payload.filterCounts.rejected} errors=${payload.filterCounts.errors}`,
  );
  lines.push(
    `Score counts: scored=${payload.scoreCounts.scored} reused=${payload.scoreCounts.reused} errors=${payload.scoreCounts.errors}`,
  );
  lines.push(`Reused results: jobs reused=${payload.reusedResults.jobsReused}`);

  lines.push(
    `Errors: search errors=${payload.errors.searchErrors.length}, extraction failures=${payload.errors.extractionFailures}, filter errors=${payload.errors.filterErrors}, scoring errors=${payload.errors.scoringErrors}`,
  );
  if (payload.errors.searchErrors.length > 0) {
    for (const e of payload.errors.searchErrors) {
      lines.push(`  ${e.code}: ${e.message}`);
    }
  }

  lines.push(
    `Cancellation: ${payload.cancellationState.isCancelled ? (payload.cancellationState.reason ?? 'cancelled') : 'none'}`,
  );

  lines.push('Diagnostic references:');
  if (payload.diagnosticReferences.length === 0) {
    lines.push('  (no diagnostics)');
  } else {
    // Reserve a budget for the path column: the rest of the line is
    // `  artifact_<n>  <type>  ` ≈ 18 chars. The path gets whatever's left.
    const prefixLen = 18;
    const pathBudget = Math.max(20, terminalWidth - prefixLen);
    for (const d of payload.diagnosticReferences) {
      const path = truncateWithEllipsis(d.relativePath, pathBudget);
      lines.push(`  artifact_${d.id}  ${d.artifactType}  ${path}`);
    }
  }

  return lines.join('\n');
}
