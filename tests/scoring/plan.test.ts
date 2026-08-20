import { describe, expect, it } from 'vitest';

import { buildScoringPlan } from '../../src/scoring/plan.js';
import type { ScoringKind } from '../../src/scoring/state.js';

const RUN = { id: 1 };
const SEARCH = { id: 10 };

describe('buildScoringPlan', () => {
  it('handles an empty jobs list', () => {
    const plan = buildScoringPlan({
      run: RUN,
      searchExecution: SEARCH,
      jobs: [],
      eligibleFlags: new Map(),
      scoreKinds: new Map(),
      scoringConcurrency: 3,
    });
    expect(plan.jobsDiscovered).toBe(0);
    expect(plan.jobsAccepted).toBe(0);
    expect(plan.scoresReused).toBe(0);
    expect(plan.newOpenAIRequests).toBe(0);
    expect(plan.perJob).toEqual([]);
    expect(plan.skippedScoringCategories).toEqual([]);
    expect(plan.scoringConcurrency).toBe(3);
    expect(plan.runId).toBe(1);
    expect(plan.searchExecutionId).toBe(10);
  });

  it('counts all-new: 3 jobs, all eligible, no reuse', () => {
    const plan = buildScoringPlan({
      run: RUN,
      searchExecution: SEARCH,
      jobs: [
        { id: 1, sourceJobId: 'j1', estimatedInputBytes: 50_000 },
        { id: 2, sourceJobId: 'j2', estimatedInputBytes: 60_000 },
        { id: 3, sourceJobId: 'j3', estimatedInputBytes: 70_000 },
      ],
      eligibleFlags: new Map([
        [1, { isEligible: true, reason: null }],
        [2, { isEligible: true, reason: null }],
        [3, { isEligible: true, reason: null }],
      ]),
      scoreKinds: new Map<number, ScoringKind>([
        [1, 'complete'],
        [2, 'complete'],
        [3, 'complete'],
      ]),
      scoringConcurrency: 3,
    });
    expect(plan.jobsDiscovered).toBe(3);
    expect(plan.jobsAccepted).toBe(3);
    expect(plan.scoresReused).toBe(0);
    expect(plan.newOpenAIRequests).toBe(3);
  });

  it('counts mixed: 3 jobs, 1 reused, 2 new', () => {
    const plan = buildScoringPlan({
      run: RUN,
      searchExecution: SEARCH,
      jobs: [
        { id: 1, sourceJobId: 'j1', estimatedInputBytes: 50_000 },
        { id: 2, sourceJobId: 'j2', estimatedInputBytes: 60_000 },
        { id: 3, sourceJobId: 'j3', estimatedInputBytes: 70_000 },
      ],
      eligibleFlags: new Map([
        [1, { isEligible: true, reason: null }],
        [2, { isEligible: true, reason: null }],
        [3, { isEligible: true, reason: null }],
      ]),
      scoreKinds: new Map<number, ScoringKind>([
        [1, 'reused'],
        [2, 'complete'],
        [3, 'complete'],
      ]),
      scoringConcurrency: 3,
    });
    expect(plan.scoresReused).toBe(1);
    expect(plan.newOpenAIRequests).toBe(2);
  });

  it('counts ineligible: 3 jobs, 1 ineligible', () => {
    const plan = buildScoringPlan({
      run: RUN,
      searchExecution: SEARCH,
      jobs: [
        { id: 1, sourceJobId: 'j1', estimatedInputBytes: 50_000 },
        { id: 2, sourceJobId: 'j2', estimatedInputBytes: 60_000 },
        { id: 3, sourceJobId: 'j3', estimatedInputBytes: 70_000 },
      ],
      eligibleFlags: new Map<number, { isEligible: boolean; reason: string | null }>([
        [1, { isEligible: false, reason: 'extractionStatus is "partial"' }],
        [2, { isEligible: true, reason: null }],
        [3, { isEligible: true, reason: null }],
      ]),
      scoreKinds: new Map<number, ScoringKind>(),
      scoringConcurrency: 3,
    });
    expect(plan.jobsAccepted).toBe(2);
    expect(plan.perJob[0]?.isEligible).toBe(false);
    expect(plan.perJob[0]?.reason).toBe('extractionStatus is "partial"');
  });

  it('defaults missing eligibility flag to eligible + null reason', () => {
    const plan = buildScoringPlan({
      run: RUN,
      searchExecution: SEARCH,
      jobs: [{ id: 1, sourceJobId: 'j1', estimatedInputBytes: 50_000 }],
      eligibleFlags: new Map(),
      scoreKinds: new Map(),
      scoringConcurrency: 1,
    });
    expect(plan.perJob[0]?.isEligible).toBe(true);
    expect(plan.perJob[0]?.reason).toBeNull();
    expect(plan.perJob[0]?.kind).toBe('skipped');
  });

  it('carries through scoringConcurrency + runId + searchExecutionId', () => {
    const plan = buildScoringPlan({
      run: { id: 42 },
      searchExecution: { id: 7 },
      jobs: [],
      eligibleFlags: new Map(),
      scoreKinds: new Map(),
      scoringConcurrency: 5,
    });
    expect(plan.runId).toBe(42);
    expect(plan.searchExecutionId).toBe(7);
    expect(plan.scoringConcurrency).toBe(5);
  });

  it('includes skippedScoringCategories when provided', () => {
    const plan = buildScoringPlan({
      run: RUN,
      searchExecution: SEARCH,
      jobs: [],
      eligibleFlags: new Map(),
      scoreKinds: new Map(),
      scoringConcurrency: 1,
      skippedScoringCategories: ['seniorityFit', 'domainIndustryFit'],
    });
    expect(plan.skippedScoringCategories).toEqual(['seniorityFit', 'domainIndustryFit']);
  });
});
