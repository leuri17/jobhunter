import type { RunSummary, TopNRow } from './state.js';
import type { ScoringPlan } from '../scoring/state.js';

/**
 * Render the run summary as a human-readable multi-line block.
 */
export function formatRunSummary(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`run: run_${summary.runId}`);
  lines.push(`status: ${summary.status}`);
  lines.push(`started: ${summary.startTimestamp}`);
  lines.push(`ended: ${summary.endTimestamp}`);
  lines.push(
    `searches: planned=${summary.searchesPlanned} attempted=${summary.searchesAttempted} completed=${summary.searchesCompleted}`,
  );
  if (summary.searchErrors.length > 0) {
    lines.push(`search errors: ${summary.searchErrors.length}`);
    for (const e of summary.searchErrors) {
      lines.push(`  ${e.code}: ${e.message}`);
    }
  }
  lines.push(
    `jobs: discovered=${summary.jobsDiscovered} new_complete=${summary.newCompleteJobs} existing_complete_skipped=${summary.existingCompleteJobsSkipped} existing_partial_skipped=${summary.existingPartialJobsSkipped} new_partial=${summary.newPartialJobs} failed=${summary.failedExtractions}`,
  );
  lines.push(
    `filters: accepted=${summary.jobsAccepted} rejected=${summary.jobsRejected} errors=${summary.filterErrors}`,
  );
  lines.push(
    `scoring: scored=${summary.jobsScored} reused=${summary.scoresReused} errors=${summary.scoringErrors} declined=${summary.scoringDeclinedByUser}`,
  );
  if (summary.cancellationReason !== null) {
    lines.push(`cancellation: ${summary.cancellationReason}`);
  }
  return lines.join('\n');
}

/**
 * Render the top-N table (SPEC §33.1).
 */
export function formatTopNTable(rows: readonly TopNRow[], terminalWidth: number): string {
  if (rows.length === 0) return '(no scored jobs)';
  const headers = ['ID', 'Score', 'Title', 'Company', 'Location', 'First discovered'];
  const idxMax = 10;
  const scoreMax = 6;
  const titleMax = 32;
  const companyMax = 24;
  const locationMax = 24;
  const firstMax = 24;

  const cells = (row: TopNRow): string[] => [
    `job_${row.jobId}`.slice(0, idxMax),
    row.displayScore.slice(0, scoreMax),
    (row.title ?? '').slice(0, titleMax),
    (row.company ?? '').slice(0, companyMax),
    (row.location ?? '').slice(0, locationMax),
    row.firstDiscovered.slice(0, firstMax),
  ];

  const rowsRender = rows.map(cells);
  void terminalWidth; // reserved for future adaptive-width truncation
  const widths = headers.map((h, i) => {
    const valueMax = [idxMax, scoreMax, titleMax, companyMax, locationMax, firstMax][i] ?? h.length;
    return Math.max(h.length, ...rowsRender.map((r) => (r[i] ?? '').length), valueMax);
  });
  const rowToLine = (cells: readonly string[]): string =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? c.length)).join(' ');
  return [rowToLine(headers), ...rowsRender.map(rowToLine)].join('\n');
}

/**
 * Render the scoring plan (SPEC §30).
 */
export function formatScoringPlan(plan: ScoringPlan): string {
  const lines: string[] = [];
  lines.push('scoring plan:');
  lines.push(`  jobs discovered: ${plan.jobsDiscovered}`);
  lines.push(`  jobs accepted: ${plan.jobsAccepted}`);
  lines.push(`  scores reused: ${plan.scoresReused}`);
  lines.push(`  new OpenAI requests: ${plan.newOpenAIRequests}`);
  lines.push(`  scoring concurrency: ${plan.scoringConcurrency}`);
  if (plan.skippedScoringCategories.length > 0) {
    lines.push(`  skipped categories: ${plan.skippedScoringCategories.join(', ')}`);
  }
  return lines.join('\n');
}
