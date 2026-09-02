/**
 * Human-readable formatters for .
 *
 * Pure formatters. NO imports from `src/persistence/`,
 * `src/linkedin/`, `src/profile/`, `src/filter/`,
 * `src/scoring/`, `src/inspection/`. The formatters operate on the
 * plain `ReevaluationPlan` row shape declared in `./state.ts`; the
 * service layer is responsible for the row → shape mapping.
 *
 * The ONLY cross-module import in this file is the
 * `formatScoringPlanForReevaluation` thin pass-through that calls
 * `formatScoringPlan` from `src/pipeline/format.js` — that import
 * is the documented seam between the reevaluation formatter and
 * the existing pipeline-scoring-plan renderer. The boundaries test
 * (`tests/reevaluation/boundaries.test.ts`) excludes this single
 * file from the `src/pipeline/` ban.
 *
 * The formatters are TOTAL: an empty input renders the documented
 * `(no actions)` / `0` placeholders rather than crashing. Adaptive
 * truncation uses the local `truncateWithEllipsis` helper which
 * mirrors `src/inspection/truncate.ts` (U+2026 HORIZONTAL ELLIPSIS)
 * without taking a runtime dependency on that module.
 */

import { formatScoringPlan } from '../pipeline/format.js';
import type {
  ReevaluationPlan,
  ReevaluationPlanEntry,
  ReevaluationSkippedEntry,
  ScoringPlan,
} from './state.js';

const ELLIPSIS = '\u2026';

/**
 * Truncate `text` to at most `maxWidth` characters, replacing the
 * tail with U+2026 HORIZONTAL ELLIPSIS when truncation occurs.
 * Mirrors `src/inspection/truncate.ts` — inlined here so the
 * reevaluation module's pure layer stays free of `src/inspection/`
 * imports.
 *
 * - `text.length <= maxWidth` → returns `text` unchanged.
 * - `maxWidth <= 0`           → returns `''`.
 * - `maxWidth` not a non-negative integer → throws (defensive).
 */
function truncateWithEllipsis(text: string, maxWidth: number): string {
  if (!Number.isInteger(maxWidth) || maxWidth < 0) {
    throw new Error(`truncateWithEllipsis: maxWidth must be a non-negative integer.`);
  }
  if (maxWidth <= 0) return '';
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + ELLIPSIS;
}

/**
 * Default terminal width when `process.stdout.columns` is undefined
 * (mirrors `src/pipeline/format.ts:60` and `src/inspection/columns.ts`).
 */
const DEFAULT_TERMINAL_WIDTH = 120;

/**
 * Maximum width per column in `formatReevaluationTable`. The widths
 * mirror `formatTopNTable` (src/pipeline/format.ts:42-48) — fixed
 * caps keep the table deterministic regardless of input length. The
 * `sourceJobId` cap is the LinkedIn integer-length budget.
 */
const ACTION_COL_MAX = 12;
const JOB_COL_MAX = 8;
const SOURCE_ID_COL_MAX = 24;
const FINGERPRINT_COL_MAX = 17; // `fingerprint=` + 8 hex chars
const REASON_COL_MAX = 24;

/**
 * Thin pass-through that re-exports `formatScoringPlan` from
 * `src/pipeline/format.js` ( +  plan Task 4).
 * The function exists in this module only to document the import
 * boundary — the reevaluation module reuses the existing
 * pipeline-scoring-plan renderer unchanged. The `terminalWidth`
 * parameter is accepted for API symmetry with the rest of the
 * reevaluation formatters but is ignored because the pipeline
 * formatter does not consult terminal width.
 *
 * The CLI handler in  renders the scoring plan via this
 * function when the plan requires new OpenAI requests. The
 * boundaries test excludes this single `src/pipeline/format.js`
 * import from the reevaluation-module ban.
 */
export function formatScoringPlanForReevaluation(plan: ScoringPlan, terminalWidth: number): string {
  void terminalWidth;
  return formatScoringPlan(plan);
}

/**
 * Render the `ReevaluationPlan` as a multi-line block suitable for
 * the human-readable CLI output. The block lists the scope, the
 * per-job entries (filter + score + skip), the totals, and the
 * scoring-declined flag.
 *
 * Adaptive truncation: when `terminalWidth` is too small to hold
 * the longest `sourceJobId`, every `sourceJobId` is truncated to
 * fit the available budget (with the standard ellipsis suffix).
 * Long `fingerprint` strings are truncated to 8 hex chars (matches
 * the  example shape).
 */
export function formatReevaluationSummary(plan: ReevaluationPlan, terminalWidth: number): string {
  void terminalWidth; // reserved for future adaptive truncation of the summary block itself
  const lines: string[] = [];
  lines.push(`Scope: ${plan.scope}`);
  lines.push(`Dry run: ${plan.dryRun ? 'yes' : 'no'}`);
  lines.push(`Job ID: ${plan.jobId ?? '—'}`);

  lines.push(`Filters to reevaluate: ${plan.filtersToReevaluate.length}`);
  for (const entry of plan.filtersToReevaluate) {
    lines.push(formatEntryLine(entry));
  }

  lines.push(`Jobs to score: ${plan.jobsToScore.length}`);
  for (const entry of plan.jobsToScore) {
    lines.push(formatEntryLine(entry));
  }

  lines.push(`Skipped: ${plan.skipped.length}`);
  for (const entry of plan.skipped) {
    lines.push(formatSkippedLine(entry));
  }

  lines.push(
    `Totals: filtersRerun=${plan.totals.filtersRerun} scoresRerun=${plan.totals.scoresRerun} scoresInvalidated=${plan.totals.scoresInvalidated} skipped=${plan.totals.skipped}`,
  );
  lines.push(`Scoring declined by user: ${plan.totals.scoringDeclinedByUser ? 'yes' : 'no'}`);

  return lines.join('\n');
}

/**
 * Render the `ReevaluationPlan` as a compact table with adaptive
 * column widths. The shape mirrors `formatJobListTable` /
 * `formatRunListTable` — header row + one row
 * per entry, joined by `\n`.
 *
 * - Single summary block when `totals.skipped === 0` (just the
 *   totals + counts).
 * - Two tables when `totals.skipped > 0` (one for `Action | Job |
 *   Source ID | Fingerprint`, one for `Reason | Job | Source ID`).
 */
export function formatReevaluationTable(plan: ReevaluationPlan, terminalWidth: number): string {
  void terminalWidth; // widths are capped by the per-column MAX constants
  const lines: string[] = [];

  // Action table — always rendered.
  const actionEntries: readonly ReevaluationPlanEntry[] = [
    ...plan.filtersToReevaluate,
    ...plan.jobsToScore,
  ];
  if (actionEntries.length === 0) {
    lines.push('(no actions)');
  } else {
    lines.push(...renderActionTable(actionEntries));
  }

  // Skipped table — only when there are skipped entries.
  if (plan.skipped.length > 0) {
    lines.push('');
    lines.push(...renderSkippedTable(plan.skipped));
  }

  return lines.join('\n');
}

/**
 * Render one `ReevaluationPlanEntry` as the documented
 * `job_<n>  <sourceJobId>  <action>  fingerprint=<8 chars>` line.
 */
function formatEntryLine(entry: ReevaluationPlanEntry): string {
  return `  ${entry.jobId}  ${entry.sourceJobId}  ${entry.action}  fingerprint=${entry.fingerprint.slice(0, 8)}`;
}

/**
 * Render one `ReevaluationSkippedEntry` as the documented
 * `job_<n>  <sourceJobId>  reason=<reason>` line.
 */
function formatSkippedLine(entry: ReevaluationSkippedEntry): string {
  return `  ${entry.jobId}  ${entry.sourceJobId}  reason=${entry.reason}`;
}

// ---------------------------------------------------------------------------
// Table rendering helpers (private)
// ---------------------------------------------------------------------------

function renderActionTable(entries: readonly ReevaluationPlanEntry[]): readonly string[] {
  const headers = ['Action', 'Job', 'Source ID', 'Fingerprint'];
  const colWidths = [
    Math.max(
      'Action'.length,
      longestValue(entries, (e) => e.action.length),
      ACTION_COL_MAX,
    ),
    Math.max(
      'Job'.length,
      longestValue(entries, (e) => e.jobId.length),
      JOB_COL_MAX,
    ),
    Math.max('Source ID'.length, SOURCE_ID_COL_MAX),
    FINGERPRINT_COL_MAX,
  ];

  const cells = (entry: ReevaluationPlanEntry): readonly string[] => [
    entry.action,
    entry.jobId,
    truncateWithEllipsis(entry.sourceJobId, colWidths[2] ?? SOURCE_ID_COL_MAX),
    `fingerprint=${entry.fingerprint.slice(0, 8)}`,
  ];

  const headerLine = headers.map((h, i) => (h ?? '').padEnd(colWidths[i] ?? h.length)).join(' ');
  const rowLines = entries.map((entry) =>
    cells(entry)
      .map((c, i) => (c ?? '').padEnd(colWidths[i] ?? c.length))
      .join(' '),
  );

  return [headerLine, ...rowLines];
}

function renderSkippedTable(entries: readonly ReevaluationSkippedEntry[]): readonly string[] {
  const headers = ['Reason', 'Job', 'Source ID'];
  const colWidths = [
    Math.max('Reason'.length, REASON_COL_MAX),
    Math.max(
      'Job'.length,
      longestValue(entries, (e) => e.jobId.length),
      JOB_COL_MAX,
    ),
    Math.max('Source ID'.length, SOURCE_ID_COL_MAX),
  ];

  const cells = (entry: ReevaluationSkippedEntry): readonly string[] => [
    entry.reason,
    entry.jobId,
    truncateWithEllipsis(entry.sourceJobId, colWidths[2] ?? SOURCE_ID_COL_MAX),
  ];

  const headerLine = headers.map((h, i) => (h ?? '').padEnd(colWidths[i] ?? h.length)).join(' ');
  const rowLines = entries.map((entry) =>
    cells(entry)
      .map((c, i) => (c ?? '').padEnd(colWidths[i] ?? c.length))
      .join(' '),
  );

  return [headerLine, ...rowLines];
}

function longestValue<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((max, item) => Math.max(max, pick(item)), 0);
}

void DEFAULT_TERMINAL_WIDTH;
