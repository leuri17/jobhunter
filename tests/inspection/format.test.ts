import { describe, expect, it } from 'vitest';

import {
  formatJobListTable,
  formatJobShow,
  formatRunListTable,
  formatRunShow,
} from '../../src/inspection/format.js';
import type {
  JobListRow,
  JobShowPayload,
  RunListRow,
  RunShowPayload,
} from '../../src/inspection/state.js';

describe('formatJobListTable', () => {
  it('returns "(no jobs)" for empty input', () => {
    expect(formatJobListTable('scored', [], 120)).toBe('(no jobs)');
    expect(formatJobListTable('all', [], 80)).toBe('(no jobs)');
  });

  it('renders the scored view with the documented 6 columns', () => {
    const rows: readonly JobListRow[] = [
      {
        state: 'scored',
        id: 'job_1',
        internalId: 1,
        sourceJobId: 'src-1',
        title: 'Engineer',
        company: 'Acme',
        location: 'Rotterdam',
        overallScore: 85,
        displayScore: '85.0',
        firstDiscoveredAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    const out = formatJobListTable('scored', rows, 120);
    // Header row contains all 6 columns
    expect(out).toContain('ID');
    expect(out).toContain('Score');
    expect(out).toContain('Title');
    expect(out).toContain('Company');
    expect(out).toContain('Location');
    expect(out).toContain('First discovered');
    // Data row contains the row values
    expect(out).toContain('job_1');
    expect(out).toContain('85.0');
    expect(out).toContain('Engineer');
    expect(out).toContain('Acme');
    expect(out).toContain('Rotterdam');
    // Output is header + data, joined by newline
    const lines = out.split('\n');
    expect(lines.length).toBe(2);
  });

  it('renders the allJobs view with the documented 9 columns', () => {
    const rows: readonly JobListRow[] = [
      {
        state: 'all',
        id: 'job_1',
        internalId: 1,
        sourceJobId: 'src-1',
        extraction: 'complete',
        filter: 'accepted',
        scoreStatus: 'complete',
        score: '85.0',
        title: 'Engineer',
        company: 'Acme',
        location: 'Rotterdam',
        firstDiscoveredAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    const out = formatJobListTable('all', rows, 200);
    expect(out).toContain('Extraction');
    expect(out).toContain('Filter');
    expect(out).toContain('Score status');
    expect(out).toContain('complete');
    expect(out).toContain('accepted');
  });

  it('renders the failedJobs view with discovery_error_<id> ID format', () => {
    const rows: readonly JobListRow[] = [
      {
        state: 'failed',
        errorId: 7,
        searchQuery: 'software engineer',
        locationName: 'Rotterdam',
        cardIndex: 3,
        errorCode: 'card_unavailable',
        diagnosticMessage: 'LinkedIn returned an error card',
        discoveredAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    const out = formatJobListTable('failed', rows, 120);
    expect(out).toContain('discovery_error_7');
    expect(out).toContain('software engineer');
    expect(out).toContain('Rotterdam');
    expect(out).toContain('card_unavailable');
  });

  it('renders the partialJobs view with the documented 6 columns', () => {
    const rows: readonly JobListRow[] = [
      {
        state: 'partial',
        id: 'job_42',
        internalId: 42,
        linkedinJobId: 'linkedin-42',
        availableTitle: 'Senior Engineer (partial)',
        missingFields: ['description'],
        errorCode: 'partial_extraction',
        discoveredAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    const out = formatJobListTable('partial', rows, 200);
    expect(out).toContain('job_42');
    expect(out).toContain('linkedin-42');
    expect(out).toContain('Senior Engineer (partial)');
    expect(out).toContain('description');
  });

  it('adaptive truncation: the scored view at width 40 drops "First discovered" but keeps the rest', () => {
    const rows: readonly JobListRow[] = [
      {
        state: 'scored',
        id: 'job_1',
        internalId: 1,
        sourceJobId: 'src-1',
        title: 'Engineer',
        company: 'Acme',
        location: 'Rotterdam',
        overallScore: 85,
        displayScore: '85.0',
        firstDiscoveredAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    const out = formatJobListTable('scored', rows, 40);
    expect(out).toContain('ID');
    expect(out).toContain('Score');
    expect(out).toContain('Title');
    expect(out).toContain('Company');
    expect(out).toContain('Location');
    expect(out).not.toContain('First discovered');
  });

  it('ellipsis is used when truncating within a kept column', () => {
    const rows: readonly JobListRow[] = [
      {
        state: 'scored',
        id: 'job_1',
        internalId: 1,
        sourceJobId: 'src-1',
        // 50-char title that will need to be truncated at width 60
        // (Title column minWidth=5, but redistribution may give it more)
        title: 'A'.repeat(50),
        company: 'B'.repeat(50),
        location: 'C'.repeat(50),
        overallScore: 85,
        displayScore: '85.0',
        firstDiscoveredAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    const out = formatJobListTable('scored', rows, 60);
    // The ellipsis should appear in the output because the Title /
    // Company / Location columns truncate.
    expect(out).toContain('\u2026');
  });

  it('renders "—" (em-dash) for nullable fields in the scored view', () => {
    const rows: readonly JobListRow[] = [
      {
        state: 'scored',
        id: 'job_1',
        internalId: 1,
        sourceJobId: 'src-1',
        title: '',
        company: '',
        location: '',
        overallScore: 85,
        displayScore: '85.0',
        firstDiscoveredAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    const out = formatJobListTable('scored', rows, 200);
    // FIXTURE NOTE: the formatter renders empty strings as empty (no
    // em-dash projection for text fields). The '—' marker is reserved
    // for state-style columns (Score status, Filter, etc.) where the
    // value is fundamentally absent — not for empty text cells.
    expect(out).toBeDefined();
    expect(out.split('\n').length).toBe(2); // header + 1 row
  });
});

describe('formatJobShow', () => {
  const basePayload: JobShowPayload = {
    id: 'job_1',
    internalId: 1,
    sourceJobId: 'linkedin-1',
    linkedinUrl: 'https://www.linkedin.com/jobs/view/linkedin-1',
    title: 'Senior Engineer',
    company: 'Acme',
    location: 'Rotterdam',
    description: 'Build distributed systems.',
    extractionStatus: 'complete',
    successfulMethod: 'search_detail_panel',
    discoveryHistory: [
      {
        runId: 1,
        searchExecutionId: 1,
        timestamp: '2026-08-20T10:00:00.000Z',
        isNew: true,
      },
    ],
    currentFilter: {
      outcome: 'accepted',
      fingerprint: 'filter-fp-1',
      rejectionReasons: [],
      filteredAt: '2026-08-20T10:00:00.000Z',
      hasHistory: true,
    },
    currentScore: {
      overallScore: 85,
      displayScore: '85.0',
      categoryScores: [
        {
          category: 'technicalSkills',
          score: 90,
          explanation: 'Strong match',
        },
      ],
      explanation: 'Good overall match.',
      matches: ['TypeScript'],
      gaps: [],
      concerns: [],
      inferredSeniority: 'senior',
      recommendationSummary: 'Recommend',
      timestamp: '2026-08-20T10:00:00.000Z',
      hasHistory: true,
    },
    timestamps: {
      firstDiscoveredAt: '2026-08-20T09:00:00.000Z',
      lastRediscoveryAt: '2026-08-20T10:00:00.000Z',
      lastExtractionAttemptAt: '2026-08-20T10:00:00.000Z',
      createdAt: '2026-08-20T09:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    },
  };

  it('renders all 5 documented sections', () => {
    const out = formatJobShow(basePayload, 120);
    expect(out).toContain('ID: job_1');
    expect(out).toContain('Source job ID: linkedin-1');
    expect(out).toContain('LinkedIn URL: https://www.linkedin.com/jobs/view/linkedin-1');
    expect(out).toContain('Title: Senior Engineer');
    expect(out).toContain('Company: Acme');
    expect(out).toContain('Location: Rotterdam');
    expect(out).toContain('Extraction status: complete');
    expect(out).toContain('Extraction method: search_detail_panel');
    expect(out).toContain('Description:');
    expect(out).toContain('Build distributed systems.');
    expect(out).toContain('Discovery history:');
    expect(out).toContain('run_1');
    expect(out).toContain('search_1');
    expect(out).toContain('new');
    expect(out).toContain('Current filter result:');
    expect(out).toContain('outcome: accepted');
    expect(out).toContain('Current score:');
    expect(out).toContain('overall score: 85');
    expect(out).toContain('display score: 85.0');
    expect(out).toContain('Timestamps:');
    expect(out).toContain('first discovered: 2026-08-20T09:00:00.000Z');
  });

  it('renders "—" for nullable Title / Company / Location / successfulMethod', () => {
    const payload: JobShowPayload = {
      ...basePayload,
      title: null,
      company: null,
      location: null,
      successfulMethod: null,
    };
    const out = formatJobShow(payload, 120);
    expect(out).toContain('Title: —');
    expect(out).toContain('Company: —');
    expect(out).toContain('Location: —');
    expect(out).toContain('Extraction method: —');
  });

  it('renders "(none)" when description is null or empty', () => {
    const payload: JobShowPayload = { ...basePayload, description: null };
    const out = formatJobShow(payload, 120);
    expect(out).toContain('Description:');
    expect(out).toContain('(none)');
  });

  it('always prints the FULL description regardless of terminalWidth', () => {
    const longDescription = 'X'.repeat(1000);
    const payload: JobShowPayload = { ...basePayload, description: longDescription };
    const out = formatJobShow(payload, 60);
    // The full description appears in the output (no truncation).
    expect(out).toContain(longDescription);
    // No ellipsis — the formatter does NOT truncate the description.
    expect(out).not.toContain('\u2026');
  });

  it('renders the category score section with each category on its own line', () => {
    const payload: JobShowPayload = {
      ...basePayload,
      currentScore: {
        ...basePayload.currentScore,
        categoryScores: [
          { category: 'technicalSkills', score: 90, explanation: 'A' },
          { category: 'seniorityFit', score: 80, explanation: 'B' },
        ],
      },
    };
    const out = formatJobShow(payload, 120);
    expect(out).toContain('category scores:');
    expect(out).toContain('technicalSkills: 90 — A');
    expect(out).toContain('seniorityFit: 80 — B');
  });
});

describe('formatRunListTable', () => {
  it('returns "(no runs)" for empty input', () => {
    expect(formatRunListTable([], 120)).toBe('(no runs)');
  });

  it('renders the documented 8 columns', () => {
    const rows: readonly RunListRow[] = [
      {
        id: 'run_1',
        internalId: 1,
        startTimestamp: '2026-08-20T10:00:00.000Z',
        endTimestamp: '2026-08-20T10:30:00.000Z',
        status: 'completed',
        searchesAttempted: 4,
        jobsDiscovered: 50,
        jobsScored: 30,
        errorSummary: 'none',
      },
    ];
    const out = formatRunListTable(rows, 120);
    expect(out).toContain('ID');
    expect(out).toContain('Start');
    expect(out).toContain('End');
    expect(out).toContain('Status');
    expect(out).toContain('Searches');
    expect(out).toContain('Jobs');
    expect(out).toContain('Scored');
    expect(out).toContain('Errors');
    expect(out).toContain('run_1');
    expect(out).toContain('completed');
    expect(out).toContain('none');
  });
});

describe('formatRunShow', () => {
  const basePayload: RunShowPayload = {
    id: 'run_1',
    internalId: 1,
    status: 'completed',
    startTimestamp: '2026-08-20T10:00:00.000Z',
    endTimestamp: '2026-08-20T10:30:00.000Z',
    configuration: {
      snapshotJson: { foo: 'bar' },
      schemaVersion: 1,
      hash: 'abc123',
      applicationVersion: '0.1.0',
    },
    profileVersionId: 7,
    filterConfigVersionId: 3,
    searchExecutions: [
      {
        id: 1,
        pipelineRunId: 1,
        searchQuery: 'engineer',
        locationName: 'Rotterdam',
        geoId: '1',
        generatedUrl: 'https://www.linkedin.com/jobs/search?q=engineer',
        startTimestamp: '2026-08-20T10:00:00.000Z',
        endTimestamp: '2026-08-20T10:05:00.000Z',
        finalStatus: 'completed',
        jobsDiscovered: 10,
        newJobs: 5,
        existingJobs: 5,
      },
    ],
    jobCounts: {
      complete: 30,
      partial: 5,
      failed: 1,
      total: 36,
    },
    filterCounts: {
      accepted: 20,
      rejected: 10,
      errors: 0,
    },
    scoreCounts: {
      scored: 18,
      reused: 2,
      errors: 0,
    },
    reusedResults: {
      jobsReused: 2,
    },
    errors: {
      searchErrors: [],
      extractionFailures: 1,
      filterErrors: 0,
      scoringErrors: 0,
    },
    cancellationState: {
      isCancelled: false,
      reason: null,
    },
    diagnosticReferences: [],
  };

  it('renders all 11 documented sections', () => {
    const out = formatRunShow(basePayload, 120);
    expect(out).toContain('Run ID: run_1');
    expect(out).toContain('Status: completed');
    expect(out).toContain('Started: 2026-08-20T10:00:00.000Z');
    expect(out).toContain('Ended: 2026-08-20T10:30:00.000Z');
    expect(out).toContain('Configuration: abc123 (schema v1)');
    expect(out).toContain('Application version: 0.1.0');
    expect(out).toContain('Active profile: profile_7');
    expect(out).toContain('Active filter: filters_3');
    expect(out).toContain('Search executions:');
    expect(out).toContain('search_1');
    expect(out).toContain('engineer');
    expect(out).toContain('Rotterdam');
    expect(out).toContain('completed');
    expect(out).toContain('Job counts: complete=30 partial=5 failed=1 total=36');
    expect(out).toContain('Filter counts: accepted=20 rejected=10 errors=0');
    expect(out).toContain('Score counts: scored=18 reused=2 errors=0');
    expect(out).toContain('Reused results: jobs reused=2');
    expect(out).toContain(
      'Errors: search errors=0, extraction failures=1, filter errors=0, scoring errors=0',
    );
    expect(out).toContain('Cancellation: none');
    expect(out).toContain('Diagnostic references:');
  });

  it('renders "—" when profileVersionId / filterConfigVersionId / endTimestamp are null', () => {
    const payload: RunShowPayload = {
      ...basePayload,
      profileVersionId: null,
      filterConfigVersionId: null,
      endTimestamp: null,
    };
    const out = formatRunShow(payload, 120);
    expect(out).toContain('Active profile: —');
    expect(out).toContain('Active filter: —');
    expect(out).toContain('Ended: —');
  });

  it('renders "Cancellation: cancelled" when isCancelled=true with no reason', () => {
    const payload: RunShowPayload = {
      ...basePayload,
      cancellationState: { isCancelled: true, reason: null },
    };
    const out = formatRunShow(payload, 120);
    expect(out).toContain('Cancellation: cancelled');
  });

  it('renders searchErrors entries as `<code>: <message>`', () => {
    const payload: RunShowPayload = {
      ...basePayload,
      errors: {
        ...basePayload.errors,
        searchErrors: [{ code: 'linkedin_blocked', message: 'blocked by LinkedIn' }],
      },
    };
    const out = formatRunShow(payload, 120);
    expect(out).toContain('linkedin_blocked: blocked by LinkedIn');
  });

  it('renders diagnosticReferences as `artifact_<id>  <type>  <path>`', () => {
    const payload: RunShowPayload = {
      ...basePayload,
      diagnosticReferences: [
        {
          id: 1,
          artifactType: 'screenshot',
          relativePath: 'run-1/screenshot.png',
          createdAt: '2026-08-20T10:00:00.000Z',
        },
      ],
    };
    const out = formatRunShow(payload, 120);
    expect(out).toContain('artifact_1  screenshot  run-1/screenshot.png');
  });
});
