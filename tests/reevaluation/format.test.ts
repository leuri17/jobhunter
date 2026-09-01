import { describe, expect, it } from 'vitest';

import {
  formatReevaluationSummary,
  formatReevaluationTable,
  formatScoringPlanForReevaluation,
} from '../../src/reevaluation/format.js';
import {
  REEVALUATION_SCHEMA_VERSION,
  type ReevaluationPlan,
  type ReevaluationPlanEntry,
  type ReevaluationSkippedEntry,
  type ScoringPlan,
} from '../../src/reevaluation/state.js';

/**
 * Pure-helper tests for the human-readable formatters
 *
 * The tests assert snapshot-style output for each scope + dry-run
 * combination and the adaptive-truncation behavior of
 * `formatReevaluationTable` when `sourceJobId` is too long for the
 * terminal width.
 */

const ELLIPSIS = '\u2026';

function entry(
  id: number,
  action: ReevaluationPlanEntry['action'],
  opts: { sourceJobId?: string; fingerprint?: string; scoreInvalidated?: boolean } = {},
): ReevaluationPlanEntry {
  return {
    jobId: `job_${id}`,
    internalId: id,
    sourceJobId: opts.sourceJobId ?? `src-${id}`,
    action,
    fingerprint: opts.fingerprint ?? `fp-${id}-0123456789abcdef`,
    scoreInvalidated: opts.scoreInvalidated ?? false,
  };
}

function skipped(id: number, reason: ReevaluationSkippedEntry['reason']): ReevaluationSkippedEntry {
  return {
    jobId: `job_${id}`,
    internalId: id,
    sourceJobId: `src-${id}`,
    reason,
  };
}

function basePlan(overrides: Partial<ReevaluationPlan> = {}): ReevaluationPlan {
  return {
    schemaVersion: REEVALUATION_SCHEMA_VERSION,
    scope: 'default',
    dryRun: false,
    jobId: null,
    filtersToReevaluate: [],
    jobsToScore: [],
    skipped: [],
    scoringPlan: null,
    totals: {
      filtersRerun: 0,
      scoresRerun: 0,
      scoresInvalidated: 0,
      skipped: 0,
      scoringDeclinedByUser: false,
    },
    ...overrides,
  };
}

const SCORING_PLAN: ScoringPlan = {
  schemaVersion: 1 as const,
  runId: 1,
  searchExecutionId: 10,
  jobsDiscovered: 1,
  jobsAccepted: 1,
  scoresReused: 0,
  newOpenAIRequests: 1,
  skippedScoringCategories: [],
  scoringConcurrency: 3,
  perJob: [
    {
      jobId: 1,
      sourceJobId: 'src-1',
      kind: 'complete',
      isEligible: true,
      estimatedInputBytes: 50_000,
      reason: null,
    },
  ],
};

describe('formatReevaluationSummary', () => {
  it('empty default plan → all zeros + (none) per section', () => {
    const out = formatReevaluationSummary(basePlan(), 120);
    expect(out).toBe(
      [
        'Scope: default',
        'Dry run: no',
        'Job ID: —',
        'Filters to reevaluate: 0',
        'Jobs to score: 0',
        'Skipped: 0',
        'Totals: filtersRerun=0 scoresRerun=0 scoresInvalidated=0 skipped=0',
        'Scoring declined by user: no',
      ].join('\n'),
    );
  });

  it('default scope with 2 filter reruns + 1 score rerun + 1 skip → full block', () => {
    const plan = basePlan({
      filtersToReevaluate: [entry(1, 'reran'), entry(2, 'reran')],
      jobsToScore: [entry(3, 'reran')],
      skipped: [skipped(4, 'filter_update_required')],
      totals: {
        filtersRerun: 2,
        scoresRerun: 1,
        scoresInvalidated: 0,
        skipped: 1,
        scoringDeclinedByUser: false,
      },
    });

    const out = formatReevaluationSummary(plan, 120);
    expect(out).toContain('Scope: default');
    expect(out).toContain('Dry run: no');
    expect(out).toContain('Job ID: —');
    expect(out).toContain('Filters to reevaluate: 2');
    expect(out).toContain('  job_1  src-1  reran  fingerprint=fp-1-01');
    expect(out).toContain('  job_2  src-2  reran  fingerprint=fp-2-01');
    expect(out).toContain('Jobs to score: 1');
    expect(out).toContain('  job_3  src-3  reran  fingerprint=fp-3-01');
    expect(out).toContain('Skipped: 1');
    expect(out).toContain('  job_4  src-4  reason=filter_update_required');
    expect(out).toContain('Totals: filtersRerun=2 scoresRerun=1 scoresInvalidated=0 skipped=1');
    expect(out).toContain('Scoring declined by user: no');
  });

  it('--dry-run flag appears as "yes"', () => {
    const out = formatReevaluationSummary(basePlan({ dryRun: true }), 120);
    expect(out).toContain('Dry run: yes');
  });

  it('--job scope + supplied jobId appears verbatim', () => {
    const out = formatReevaluationSummary(
      basePlan({ scope: 'job', jobId: 'job_42', filtersToReevaluate: [entry(42, 'reran')] }),
      120,
    );
    expect(out).toContain('Scope: job');
    expect(out).toContain('Job ID: job_42');
  });

  it('--job scope with numeric LinkedIn sourceJobId', () => {
    const out = formatReevaluationSummary(basePlan({ scope: 'job', jobId: '3857123456' }), 120);
    expect(out).toContain('Job ID: 3857123456');
  });

  it('--scores-only + scoring declined → "yes"', () => {
    const out = formatReevaluationSummary(
      basePlan({
        scope: 'scores-only',
        scoringPlan: SCORING_PLAN,
        jobsToScore: [entry(1, 'reran')],
        totals: {
          filtersRerun: 0,
          scoresRerun: 1,
          scoresInvalidated: 0,
          skipped: 0,
          scoringDeclinedByUser: true,
        },
      }),
      120,
    );
    expect(out).toContain('Scope: scores-only');
    expect(out).toContain('Scoring declined by user: yes');
  });

  it('fingerprint is truncated to 8 hex chars per entry', () => {
    const plan = basePlan({
      filtersToReevaluate: [entry(1, 'reran', { fingerprint: 'abcdef0123456789ff00' })],
    });
    const out = formatReevaluationSummary(plan, 120);
    expect(out).toContain('fingerprint=abcdef01');
    expect(out).not.toContain('fingerprint=abcdef0123456789');
  });
});

describe('formatReevaluationTable', () => {
  it('returns "(no actions)" when both filter and score lists are empty', () => {
    const out = formatReevaluationTable(basePlan(), 120);
    expect(out).toBe('(no actions)');
  });

  it('renders the action table header + 2 data rows', () => {
    const plan = basePlan({
      filtersToReevaluate: [entry(1, 'reran'), entry(2, 'reran')],
    });
    const out = formatReevaluationTable(plan, 120);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Action       Job      Source ID                Fingerprint      ');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(out).toContain('reran');
    expect(out).toContain('job_1');
    expect(out).toContain('job_2');
    expect(out).toContain('fingerprint=fp-1-01');
  });

  it('renders the skipped table when totals.skipped > 0', () => {
    const plan = basePlan({
      filtersToReevaluate: [entry(1, 'reran')],
      skipped: [skipped(2, 'filter_update_required')],
      totals: {
        filtersRerun: 1,
        scoresRerun: 0,
        scoresInvalidated: 0,
        skipped: 1,
        scoringDeclinedByUser: false,
      },
    });
    const out = formatReevaluationTable(plan, 120);
    expect(out).toContain('Action       Job      Source ID                Fingerprint      ');
    expect(out).toContain('Reason                   Job      Source ID               ');
    expect(out).toContain('filter_update_required');
  });

  it('adaptive truncation: long sourceJobId values are truncated with ellipsis', () => {
    const longSource = 'X'.repeat(80);
    const plan = basePlan({
      filtersToReevaluate: [entry(1, 'reran', { sourceJobId: longSource })],
    });
    // Narrow terminal width to force truncation.
    const out = formatReevaluationTable(plan, 60);
    expect(out).toContain(ELLIPSIS);
    // The truncated form should NOT contain the full 80-char string.
    expect(out).not.toContain(longSource);
  });

  it('short sourceJobId values are preserved at width 120', () => {
    const plan = basePlan({
      filtersToReevaluate: [entry(1, 'reran', { sourceJobId: 'src-1' })],
    });
    const out = formatReevaluationTable(plan, 200);
    expect(out).toContain('src-1');
    expect(out).not.toContain(ELLIPSIS);
  });

  it('--dry-run entries use "would-rerun" as the action label', () => {
    const plan = basePlan({
      filtersToReevaluate: [entry(1, 'would-rerun')],
      dryRun: true,
    });
    const out = formatReevaluationTable(plan, 120);
    expect(out).toContain('would-rerun');
  });

  it('renders the empty "(no actions)" placeholder for an empty plan', () => {
    expect(formatReevaluationTable(basePlan(), 120)).toBe('(no actions)');
    expect(formatReevaluationTable(basePlan(), 80)).toBe('(no actions)');
  });
});

describe('formatScoringPlanForReevaluation', () => {
  it('re-exports formatScoringPlan from src/pipeline/format.js', () => {
    const out = formatScoringPlanForReevaluation(SCORING_PLAN, 120);
    expect(out).toContain('scoring plan:');
    expect(out).toContain('jobs discovered: 1');
    expect(out).toContain('new OpenAI requests: 1');
    expect(out).toContain('scoring concurrency: 3');
  });
});
