import { describe, expect, it } from 'vitest';

import {
  JobListJsonSchema,
  JobShowJsonSchema,
  PathsJsonSchema,
  RunListJsonSchema,
  RunShowJsonSchema,
} from '../../src/inspection/json-schemas.js';

/**
 * Pure-helper tests for the Zod schemas in `src/inspection/json-schemas.ts`
 * (, Task 14, ).
 *
 * The schemas are the source of truth for the `--json` payload contract.
 * These tests:
 *   - Build a representative fixture for every top-level schema and assert
 *     `safeParse(fixture).success === true` (round-trip acceptance).
 *   - Pin the `schemaVersion` contract: missing field fails; `2` is
 *     rejected; only the literal `1` succeeds.
 *   - Pin the no-truncation invariant: ellipsis characters (U+2026) are
 *     NEVER present in the parsed JSON output.
 *   - Pin the ISO 8601 timestamp invariant at the schema level (the
 *     format the services emit per ).
 *   - For `JobListJsonSchema`, build one fixture per documented state
 *     (all 9 — 'all', 'scored', 'accepted', 'rejected', 'unscored',
 *     'partial', 'failed', 'filter-errors', 'scoring-errors').
 *
 * No live DB, no I/O — pure in-memory Zod validation.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TS = '2026-08-20T10:00:00.000Z';
const TS2 = '2026-08-20T10:30:00.000Z';

/** Fixture for one `JobListRow` of every documented state. */
const ROW_BY_STATE = {
  all: {
    state: 'all' as const,
    id: 'job_1',
    internalId: 1,
    sourceJobId: 'src-1',
    extraction: 'complete' as const,
    filter: 'accepted' as const,
    scoreStatus: 'complete' as const,
    score: '85.0',
    title: 'Senior Engineer',
    company: 'Acme',
    location: 'Rotterdam',
    firstDiscoveredAt: TS,
  },
  scored: {
    state: 'scored' as const,
    id: 'job_2',
    internalId: 2,
    sourceJobId: 'src-2',
    title: 'Staff Engineer',
    company: 'Beta',
    location: 'Amsterdam',
    overallScore: 92,
    displayScore: '92.0',
    firstDiscoveredAt: TS,
  },
  accepted: {
    state: 'accepted' as const,
    id: 'job_3',
    internalId: 3,
    sourceJobId: 'src-3',
    title: 'Backend Engineer',
    company: 'Gamma',
    location: 'Utrecht',
    scoreStatus: 'complete' as const,
    filteredAt: TS,
  },
  rejected: {
    state: 'rejected' as const,
    id: 'job_4',
    internalId: 4,
    sourceJobId: 'src-4',
    title: 'Junior Engineer',
    company: 'Delta',
    location: 'Eindhoven',
    scoreStatus: 'skipped' as const,
    rejectionReason: 'location_mismatch',
    filteredAt: TS,
  },
  unscored: {
    state: 'unscored' as const,
    id: 'job_5',
    internalId: 5,
    sourceJobId: 'src-5',
    title: 'DevOps Engineer',
    company: 'Epsilon',
    location: 'Rotterdam',
    scoringStatus: 'pending' as const,
    lastAttemptAt: null,
  },
  partial: {
    state: 'partial' as const,
    id: 'job_6',
    internalId: 6,
    linkedinJobId: 'linkedin-6',
    availableTitle: 'Senior Engineer (partial)',
    missingFields: ['description'],
    errorCode: 'partial_extraction',
    discoveredAt: TS,
  },
  failed: {
    state: 'failed' as const,
    errorId: 7,
    searchQuery: 'software engineer',
    locationName: 'Rotterdam',
    cardIndex: 3,
    errorCode: 'card_unavailable',
    diagnosticMessage: 'LinkedIn returned an error card',
    discoveredAt: TS,
  },
  'filter-errors': {
    state: 'filter-errors' as const,
    id: 'job_8',
    internalId: 8,
    sourceJobId: 'src-8',
    title: 'Platform Engineer',
    company: 'Zeta',
    errorCode: 'filter_runtime_error',
    lastAttemptAt: TS,
  },
  'scoring-errors': {
    state: 'scoring-errors' as const,
    id: 'job_9',
    internalId: 9,
    sourceJobId: 'src-9',
    title: 'Data Engineer',
    company: 'Eta',
    errorCode: 'openai_request_failed',
    attempts: 3,
    lastAttemptAt: TS,
  },
} as const;

/** Representative `jobs list` envelope (one row per state). */
const jobListEnvelope = (state: keyof typeof ROW_BY_STATE) => ({
  schemaVersion: 1 as const,
  state,
  filters: {
    minimumScore: null,
    company: null,
    location: null,
    runId: null,
  },
  limit: 50,
  returned: 1,
  jobs: [ROW_BY_STATE[state]],
});

/** Representative `jobs show` payload. */
const jobShowPayload = {
  schemaVersion: 1 as const,
  id: 'job_1',
  internalId: 1,
  sourceJobId: 'linkedin-1',
  linkedinUrl: 'https://www.linkedin.com/jobs/view/linkedin-1',
  title: 'Senior Engineer',
  company: 'Acme',
  location: 'Rotterdam',
  description: 'Build distributed systems.',
  extractionStatus: 'complete' as const,
  successfulMethod: 'search_detail_panel' as const,
  discoveryHistory: [
    {
      runId: 1,
      searchExecutionId: 1,
      timestamp: TS,
      isNew: true,
    },
  ],
  currentFilter: {
    outcome: 'accepted' as const,
    fingerprint: 'filter-fp-1',
    rejectionReasons: [],
    filteredAt: TS,
    hasHistory: true,
  },
  currentScore: {
    overallScore: 85,
    displayScore: '85.0',
    categoryScores: [{ category: 'technicalSkills', score: 90, explanation: 'Strong match' }],
    explanation: 'Good overall match.',
    matches: ['TypeScript'],
    gaps: [],
    concerns: [],
    inferredSeniority: 'senior',
    recommendationSummary: 'Recommend',
    timestamp: TS,
    hasHistory: true,
  },
  timestamps: {
    firstDiscoveredAt: TS,
    lastRediscoveryAt: TS,
    lastExtractionAttemptAt: TS,
    createdAt: TS,
    updatedAt: TS,
  },
};

/** Representative `runs list` envelope. */
const runListEnvelope = {
  schemaVersion: 1 as const,
  limit: 10,
  returned: 1,
  runs: [
    {
      id: 'run_1',
      internalId: 1,
      startTimestamp: TS,
      endTimestamp: TS2,
      status: 'completed' as const,
      searchesAttempted: 4,
      jobsDiscovered: 50,
      jobsScored: 30,
      errorSummary: 'none',
    },
  ],
};

/** Representative `runs show` payload. */
const runShowPayload = {
  schemaVersion: 1 as const,
  id: 'run_1',
  internalId: 1,
  status: 'completed' as const,
  startTimestamp: TS,
  endTimestamp: TS2,
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
      startTimestamp: TS,
      endTimestamp: TS2,
      finalStatus: 'completed' as const,
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

/** Representative `paths --json` payload. */
const pathsPayload = {
  schemaVersion: 1 as const,
  paths: {
    config: '/home/leuri/.config/jobhunter',
    data: '/home/leuri/.local/share/jobhunter',
    logs: '/home/leuri/.local/share/jobhunter/logs',
    diagnostics: '/home/leuri/.local/share/jobhunter/diagnostics',
    cache: '/home/leuri/.cache/jobhunter',
    profileSources: '/home/leuri/.local/share/jobhunter/profile-sources',
  },
};

// ---------------------------------------------------------------------------
// JobListJsonSchema — discriminated union over all 9 states
// ---------------------------------------------------------------------------

describe('JobListJsonSchema', () => {
  it('accepts a representative fixture for the --all state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('all'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --scored state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('scored'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --accepted state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('accepted'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --rejected state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('rejected'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --unscored state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('unscored'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --partial state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('partial'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --failed state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('failed'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --filter-errors state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('filter-errors'));
    expect(result.success).toBe(true);
  });

  it('accepts a representative fixture for the --scoring-errors state', () => {
    const result = JobListJsonSchema.safeParse(jobListEnvelope('scoring-errors'));
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = jobListEnvelope('all');
    const result = JobListJsonSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: 2 (only the literal 1 is accepted)', () => {
    const fixture = { ...jobListEnvelope('all'), schemaVersion: 2 };
    const result = JobListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('never contains the U+2026 ellipsis in any string field (no-truncation invariant)', () => {
    // Build a fixture with a long string that would normally trigger
    // truncation in the table formatter, then assert the JSON schema
    // never produces or requires ellipsis.
    const fixture = {
      ...jobListEnvelope('all'),
      jobs: [
        {
          ...ROW_BY_STATE.all,
          title: 'A'.repeat(500),
          company: 'B'.repeat(500),
          location: 'C'.repeat(500),
        },
      ],
    };
    const parsed = JobListJsonSchema.parse(fixture);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('\u2026');
  });

  it('accepts ISO 8601 UTC timestamps (Z suffix) in firstDiscoveredAt', () => {
    const fixture = {
      ...jobListEnvelope('all'),
      jobs: [{ ...ROW_BY_STATE.all, firstDiscoveredAt: '2026-07-30T09:00:00.000Z' }],
    };
    const result = JobListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts ISO 8601 timestamps with offset in firstDiscoveredAt', () => {
    const fixture = {
      ...jobListEnvelope('all'),
      jobs: [{ ...ROW_BY_STATE.all, firstDiscoveredAt: '2026-07-30T09:00:00.000+02:00' }],
    };
    const result = JobListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('rejects non-ISO-8601 strings in firstDiscoveredAt', () => {
    const fixture = {
      ...jobListEnvelope('all'),
      jobs: [{ ...ROW_BY_STATE.all, firstDiscoveredAt: 'not-a-date' }],
    };
    const result = JobListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JobShowJsonSchema
// ---------------------------------------------------------------------------

describe('JobShowJsonSchema', () => {
  it('accepts a representative fixture', () => {
    const result = JobShowJsonSchema.safeParse(jobShowPayload);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = jobShowPayload;
    const result = JobShowJsonSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: 2 (only the literal 1 is accepted)', () => {
    const fixture = { ...jobShowPayload, schemaVersion: 2 };
    const result = JobShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('never contains the U+2026 ellipsis in any string field (no-truncation invariant)', () => {
    const fixture = {
      ...jobShowPayload,
      title: 'A'.repeat(500),
      company: 'B'.repeat(500),
      location: 'C'.repeat(500),
      description: 'D'.repeat(2000),
    };
    const parsed = JobShowJsonSchema.parse(fixture);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('\u2026');
  });

  it('accepts ISO 8601 UTC timestamps in every documented timestamp field', () => {
    const fixture = {
      ...jobShowPayload,
      timestamps: {
        firstDiscoveredAt: '2026-07-30T09:00:00.000Z',
        lastRediscoveryAt: '2026-07-30T09:00:00.000Z',
        lastExtractionAttemptAt: '2026-07-30T09:00:00.000Z',
        createdAt: '2026-07-30T09:00:00.000Z',
        updatedAt: '2026-07-30T09:00:00.000Z',
      },
      currentScore: { ...jobShowPayload.currentScore, timestamp: '2026-07-30T09:00:00.000Z' },
      currentFilter: { ...jobShowPayload.currentFilter, filteredAt: '2026-07-30T09:00:00.000Z' },
    };
    const result = JobShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('rejects a non-ISO-8601 timestamp in firstDiscoveredAt', () => {
    const fixture = {
      ...jobShowPayload,
      timestamps: { ...jobShowPayload.timestamps, firstDiscoveredAt: 'not-a-date' },
    };
    const result = JobShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RunListJsonSchema
// ---------------------------------------------------------------------------

describe('RunListJsonSchema', () => {
  it('accepts a representative fixture', () => {
    const result = RunListJsonSchema.safeParse(runListEnvelope);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = runListEnvelope;
    const result = RunListJsonSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: 2 (only the literal 1 is accepted)', () => {
    const fixture = { ...runListEnvelope, schemaVersion: 2 };
    const result = RunListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('never contains the U+2026 ellipsis in any string field', () => {
    const fixture = {
      ...runListEnvelope,
      runs: [
        {
          ...runListEnvelope.runs[0],
          errorSummary: 'X'.repeat(500),
        },
      ],
    };
    const parsed = RunListJsonSchema.parse(fixture);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('\u2026');
  });

  it('accepts ISO 8601 UTC timestamps in startTimestamp', () => {
    const fixture = {
      ...runListEnvelope,
      runs: [{ ...runListEnvelope.runs[0], startTimestamp: '2026-07-30T09:00:00.000Z' }],
    };
    const result = RunListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('rejects a non-ISO-8601 string in startTimestamp', () => {
    const fixture = {
      ...runListEnvelope,
      runs: [{ ...runListEnvelope.runs[0], startTimestamp: 'not-a-date' }],
    };
    const result = RunListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RunShowJsonSchema
// ---------------------------------------------------------------------------

describe('RunShowJsonSchema', () => {
  it('accepts a representative fixture', () => {
    const result = RunShowJsonSchema.safeParse(runShowPayload);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = runShowPayload;
    const result = RunShowJsonSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: 2 (only the literal 1 is accepted)', () => {
    const fixture = { ...runShowPayload, schemaVersion: 2 };
    const result = RunShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('never contains the U+2026 ellipsis in any string field', () => {
    const fixture = {
      ...runShowPayload,
      configuration: {
        ...runShowPayload.configuration,
        hash: 'A'.repeat(500),
      },
    };
    const parsed = RunShowJsonSchema.parse(fixture);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('\u2026');
  });

  it('accepts ISO 8601 UTC timestamps in startTimestamp', () => {
    const fixture = {
      ...runShowPayload,
      startTimestamp: '2026-07-30T09:00:00.000Z',
      endTimestamp: '2026-07-30T09:30:00.000Z',
    };
    const result = RunShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('rejects a non-ISO-8601 string in startTimestamp', () => {
    const fixture = { ...runShowPayload, startTimestamp: 'not-a-date' };
    const result = RunShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PathsJsonSchema
// ---------------------------------------------------------------------------

describe('PathsJsonSchema', () => {
  it('accepts a representative fixture', () => {
    const result = PathsJsonSchema.safeParse(pathsPayload);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = pathsPayload;
    const result = PathsJsonSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: 2 (only the literal 1 is accepted)', () => {
    const fixture = { ...pathsPayload, schemaVersion: 2 };
    const result = PathsJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('never contains the U+2026 ellipsis in any string field', () => {
    const fixture = {
      ...pathsPayload,
      paths: {
        config: '/A'.repeat(500),
        data: '/B'.repeat(500),
        logs: '/C'.repeat(500),
        diagnostics: '/D'.repeat(500),
        cache: '/E'.repeat(500),
        profileSources: '/F'.repeat(500),
      },
    };
    const parsed = PathsJsonSchema.parse(fixture);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('\u2026');
  });
});

// ---------------------------------------------------------------------------
// ISO 8601 timestamp contract (cross-schema, )
// ---------------------------------------------------------------------------

describe('ISO 8601 timestamp contract', () => {
  it('JobShowJsonSchema accepts "2026-07-30T09:00:00.000Z"', () => {
    const fixture = {
      ...jobShowPayload,
      timestamps: {
        ...jobShowPayload.timestamps,
        firstDiscoveredAt: '2026-07-30T09:00:00.000Z',
      },
    };
    const result = JobShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('JobShowJsonSchema rejects "not-a-date"', () => {
    const fixture = {
      ...jobShowPayload,
      timestamps: {
        ...jobShowPayload.timestamps,
        firstDiscoveredAt: 'not-a-date',
      },
    };
    const result = JobShowJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('RunListJsonSchema rejects "not-a-date" in startTimestamp', () => {
    const fixture = {
      ...runListEnvelope,
      runs: [{ ...runListEnvelope.runs[0], startTimestamp: 'not-a-date' }],
    };
    const result = RunListJsonSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});
