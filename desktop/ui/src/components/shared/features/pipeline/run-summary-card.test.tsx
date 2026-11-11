// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { RunSummary } from '@jobhunter/core/pipeline';
import { asRunSummary, RunSummaryCard } from './run-summary-card';

// The card renders outside a router instance here, so Link gets a
// context-free anchor stub (same pattern as pipeline.test.tsx).
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  const stubLink = ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children?: ReactNode;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  );
  return { ...actual, Link: stubLink };
});

const realSummary: RunSummary = {
  schemaVersion: 1,
  runId: 1,
  status: 'completed',
  startTimestamp: '2026-01-01T00:00:00.000Z',
  endTimestamp: '2026-01-01T00:00:02.000Z',
  searchesPlanned: 1,
  searchesAttempted: 1,
  searchesCompleted: 1,
  searchErrors: [],
  jobsDiscovered: 2,
  newCompleteJobs: 1,
  existingCompleteJobsSkipped: 0,
  existingPartialJobsSkipped: 0,
  newPartialJobs: 1,
  failedExtractions: 0,
  jobsAccepted: 1,
  jobsRejected: 0,
  filterErrors: 0,
  jobsScored: 1,
  scoresReused: 0,
  scoringErrors: 0,
  scoringDeclinedByUser: false,
  cancellationReason: null,
};

describe('asRunSummary', () => {
  it('accepts the terminal SSE payload (PipelineRunResult) and returns its summary', () => {
    const payload = { summary: realSummary, scoringPlan: null, topN: [] };
    expect(asRunSummary(payload)).toEqual(realSummary);
  });

  it('rejects payloads that are not a run result', () => {
    expect(asRunSummary(null)).toBeNull();
    expect(asRunSummary({})).toBeNull();
    expect(
      asRunSummary({ summary: { schemaVersion: 2, runId: 1, status: 'completed' } }),
    ).toBeNull();
    expect(asRunSummary({ schemaVersion: 1, runId: 1, status: 'completed' })).toBeNull();
  });
});

describe('RunSummaryCard', () => {
  afterEach(cleanup);

  it('renders Jobs skipped as the sum of the two extraction-skip counters', () => {
    const summary: RunSummary = {
      ...realSummary,
      existingCompleteJobsSkipped: 7,
      existingPartialJobsSkipped: 2,
    };
    render(<RunSummaryCard summary={summary} tokens={null} />);
    const label = screen.getByText('Jobs skipped');
    expect(label.previousElementSibling?.textContent).toBe('9');
  });
});
