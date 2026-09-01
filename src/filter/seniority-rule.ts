import { SENIORITY_LEVELS } from '../profile/schema.js';
import type { SeniorityLevel } from '../profile/schema.js';

import type { DetectedSeniority, SeniorityDetectionResult } from './seniority-detector.js';

/**
 *  max-seniority rule.
 *
 * The rule compares the detected level against the configured maximum and
 * reports one of three outcomes:
 *
 *   - `accepted`: detected rank ≤ maximum rank
 *   - `rejected`: detected rank > maximum rank
 *   - `abstained`: rule does not apply (`maximum === null`) or the
 *     detection produced `unknown`
 *
 * Abstention aligns with 's "Abstain for unknown" rule and with
 * the broader §9 principle: deterministic filters must abstain when a rule
 * cannot decide reliably. The rule helper itself reports all three
 * outcomes; it does NOT translate rejection — that translation is the
 * evaluator's responsibility (Task 6).
 *
 * The rank order is taken from `SENIORITY_LEVELS` in
 * `src/profile/schema.ts`. The helper never calls OpenAI.
 */

export type SeniorityRuleOutcome = 'accepted' | 'abstained' | 'rejected';

export interface SeniorityRuleResult {
  readonly outcome: SeniorityRuleOutcome;
  readonly detected: DetectedSeniority;
  readonly matchedAgainst: SeniorityLevel | null;
}

/**
 * Apply the  maximum-seniority rule.
 *
 * @param maximum  The configured maximum acceptable level. `null`
 *                 disables the rule; the helper abstains.
 * @param detection  The `SeniorityDetectionResult` produced by
 *                    `detectSeniority` (or a structurally identical
 *                    value for tests).
 *
 * @returns The full decision record: outcome, original detected level,
 *          and the maximum the detection was matched against (or `null`
 *          on abstention).
 */
export function applySeniorityRule(
  maximum: SeniorityLevel | null,
  detection: SeniorityDetectionResult,
): SeniorityRuleResult {
  if (maximum === null) {
    return {
      outcome: 'abstained',
      detected: detection.detected,
      matchedAgainst: null,
    };
  }
  if (detection.detected === 'unknown') {
    return {
      outcome: 'abstained',
      detected: 'unknown',
      matchedAgainst: null,
    };
  }
  // The static types guarantee both `indexOf` lookups succeed (both
  // arguments are members of `SENIORITY_LEVELS`), so the `-1` "missing"
  // branch is unreachable.
  const detectedRank = SENIORITY_LEVELS.indexOf(detection.detected);
  const maximumRank = SENIORITY_LEVELS.indexOf(maximum);
  const outcome: SeniorityRuleOutcome = detectedRank <= maximumRank ? 'accepted' : 'rejected';
  return {
    outcome,
    detected: detection.detected,
    matchedAgainst: maximum,
  };
}
