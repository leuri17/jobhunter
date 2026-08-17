import { describe, expect, it } from 'vitest';

import { applySeniorityRule } from '../../src/filter/seniority-rule.js';
import type { SeniorityDetectionResult } from '../../src/filter/seniority-detector.js';

/**
 * TASK-010 Task 4 — `seniority-rule.ts` tests.
 *
 * The max-seniority rule (SPEC §19) compares the detected level against
 * the configured maximum:
 *
 *   - `maximum === null` → rule does NOT apply (abstained);
 *   - `detected === 'unknown'` → rule abstains (never rejects unknown);
 *   - `detected` rank ≤ `maximum` rank → accepted;
 *   - `detected` rank > `maximum` rank → rejected.
 *
 * The abbreviation "abstained" preserves SPEC §19's language; the rule
 * helper itself reports all three outcomes (`accepted | abstained |
 * rejected`) — the evaluator (Task 6) does NOT need to translate the
 * surface.
 *
 * `SENIORITY_LEVELS` rank order (from `src/profile/schema.ts`):
 *
 *   intern (0) < junior (1) < mid (2) < senior (3) < staff (4) <
 *     principal (5) < lead (6) < manager (7) < director (8) <
 *     executive (9).
 */

function detection(detected: SeniorityDetectionResult['detected']): SeniorityDetectionResult {
  return detected === 'unknown'
    ? { detected: 'unknown', matchedPhrases: [] }
    : { detected, matchedPhrases: [{ phrase: detected, level: detected }] };
}

describe('applySeniorityRule — abstention paths', () => {
  it('abstains when maximum is null regardless of detection', () => {
    expect(applySeniorityRule(null, detection('senior'))).toEqual({
      outcome: 'abstained',
      detected: 'senior',
      matchedAgainst: null,
    });
    expect(applySeniorityRule(null, detection('intern'))).toEqual({
      outcome: 'abstained',
      detected: 'intern',
      matchedAgainst: null,
    });
    expect(applySeniorityRule(null, detection('executive'))).toEqual({
      outcome: 'abstained',
      detected: 'executive',
      matchedAgainst: null,
    });
  });

  it('abstains when maximum is null and detection is unknown', () => {
    const result = applySeniorityRule(null, detection('unknown'));
    expect(result.outcome).toBe('abstained');
    expect(result.detected).toBe('unknown');
    expect(result.matchedAgainst).toBeNull();
  });

  it('abstains when detected is unknown regardless of maximum', () => {
    expect(applySeniorityRule('senior', detection('unknown'))).toEqual({
      outcome: 'abstained',
      detected: 'unknown',
      matchedAgainst: null,
    });
    expect(applySeniorityRule('intern', detection('unknown'))).toEqual({
      outcome: 'abstained',
      detected: 'unknown',
      matchedAgainst: null,
    });
    expect(applySeniorityRule('executive', detection('unknown'))).toEqual({
      outcome: 'abstained',
      detected: 'unknown',
      matchedAgainst: null,
    });
  });

  it('abstains when both maximum is null AND detected is unknown', () => {
    const result = applySeniorityRule(null, detection('unknown'));
    expect(result.outcome).toBe('abstained');
    expect(result.matchedAgainst).toBeNull();
  });
});

describe('applySeniorityRule — accepted paths (detected ≤ maximum)', () => {
  it('accepts when detected is below the maximum (senior max, junior detected)', () => {
    expect(applySeniorityRule('senior', detection('junior'))).toEqual({
      outcome: 'accepted',
      detected: 'junior',
      matchedAgainst: 'senior',
    });
  });

  it('accepts when detected equals the maximum (senior max, senior detected)', () => {
    expect(applySeniorityRule('senior', detection('senior'))).toEqual({
      outcome: 'accepted',
      detected: 'senior',
      matchedAgainst: 'senior',
    });
  });

  it('accepts a junior detected when the maximum is staff', () => {
    expect(applySeniorityRule('staff', detection('senior'))).toEqual({
      outcome: 'accepted',
      detected: 'senior',
      matchedAgainst: 'staff',
    });
  });

  it('accepts when detected equals the maximum (staff max, staff detected)', () => {
    expect(applySeniorityRule('staff', detection('staff'))).toEqual({
      outcome: 'accepted',
      detected: 'staff',
      matchedAgainst: 'staff',
    });
  });

  it('accepts any detected at or below an intern maximum', () => {
    expect(applySeniorityRule('intern', detection('intern'))).toEqual({
      outcome: 'accepted',
      detected: 'intern',
      matchedAgainst: 'intern',
    });
  });

  it('accepts any detected at or below an executive maximum', () => {
    for (const d of [
      'intern',
      'junior',
      'mid',
      'staff',
      'principal',
      'manager',
      'director',
      'executive',
    ] as const) {
      const result = applySeniorityRule('executive', detection(d));
      expect(result.outcome).toBe('accepted');
      expect(result.matchedAgainst).toBe('executive');
      expect(result.detected).toBe(d);
    }
  });
});

describe('applySeniorityRule — rejected paths (detected > maximum)', () => {
  it('rejects when detected is above the maximum (senior max, staff detected)', () => {
    expect(applySeniorityRule('senior', detection('staff'))).toEqual({
      outcome: 'rejected',
      detected: 'staff',
      matchedAgainst: 'senior',
    });
  });

  it('rejects principal when maximum is staff', () => {
    expect(applySeniorityRule('staff', detection('principal'))).toEqual({
      outcome: 'rejected',
      detected: 'principal',
      matchedAgainst: 'staff',
    });
  });

  it('rejects executive when maximum is staff (3 ranks above)', () => {
    expect(applySeniorityRule('staff', detection('executive'))).toEqual({
      outcome: 'rejected',
      detected: 'executive',
      matchedAgainst: 'staff',
    });
  });

  it('rejects junior when maximum is intern (one rank above)', () => {
    expect(applySeniorityRule('intern', detection('junior'))).toEqual({
      outcome: 'rejected',
      detected: 'junior',
      matchedAgainst: 'intern',
    });
  });

  it('rejects executive when maximum is intern', () => {
    expect(applySeniorityRule('intern', detection('executive'))).toEqual({
      outcome: 'rejected',
      detected: 'executive',
      matchedAgainst: 'intern',
    });
  });
});

describe('applySeniorityRule — return shape', () => {
  it('reports the detected level on the result regardless of outcome', () => {
    const accepted = applySeniorityRule('senior', detection('junior'));
    expect(accepted.detected).toBe('junior');

    const rejected = applySeniorityRule('senior', detection('staff'));
    expect(rejected.detected).toBe('staff');

    const abstained = applySeniorityRule(null, detection('senior'));
    expect(abstained.detected).toBe('senior');
  });

  it('reports matchedAgainst as null only on abstention', () => {
    expect(applySeniorityRule(null, detection('senior')).matchedAgainst).toBeNull();
    expect(applySeniorityRule('senior', detection('unknown')).matchedAgainst).toBeNull();

    expect(applySeniorityRule('senior', detection('junior')).matchedAgainst).toBe('senior');
    expect(applySeniorityRule('senior', detection('staff')).matchedAgainst).toBe('senior');
  });

  it('returns only one of the three documented outcomes', () => {
    const outcomes = new Set(['accepted', 'abstained', 'rejected']);
    const samples: Array<
      readonly [Parameters<typeof applySeniorityRule>[0], ReturnType<typeof detection>]
    > = [
      ['senior', detection('senior')],
      ['senior', detection('junior')],
      ['senior', detection('staff')],
      ['senior', detection('unknown')],
      [null, detection('senior')],
      [null, detection('unknown')],
    ];
    for (const [maximum, det] of samples) {
      const result = applySeniorityRule(maximum, det);
      expect(outcomes.has(result.outcome)).toBe(true);
    }
  });
});
