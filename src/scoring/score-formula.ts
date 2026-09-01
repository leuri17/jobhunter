import { RUBRIC } from './rubric.js';
import type { ScoringCategory } from './types.js';
import { SCORING_CATEGORIES } from './types.js';

/**
 * Compute the full-precision weighted overall score.
 *
 * JobHunter calculates this — OpenAI does NOT. The weighted sum is
 * computed across the 7 categories with weights from `RUBRIC`; the
 * result is a JavaScript `number` (IEEE-754 double), which carries
 * the full precision needed for ranking and tie-breaking.
 *
 * Missing category scores are a programming error and throw — the
 * Zod source-of-truth validates that all 7 are present at parse time.
 */
export function computeOverallScore(
  categoryScores: Readonly<Record<ScoringCategory, number>>,
): number {
  let sum = 0;
  for (const category of SCORING_CATEGORIES) {
    const score = categoryScores[category];
    if (typeof score !== 'number') {
      throw new Error(`computeOverallScore: missing score for category "${category}"`);
    }
    sum += score * RUBRIC[category].weight;
  }
  return sum;
}

/**
 * Format the full-precision overall score as a one-decimal display
 * value. Pure — does not depend on locale. The display
 * value is what the user sees; the full-precision number is what the
 * ranking + persistence layer uses.
 */
export function formatDisplayScore(fullPrecision: number): string {
  if (typeof fullPrecision !== 'number' || !Number.isFinite(fullPrecision)) {
    throw new Error(`formatDisplayScore: invalid number "${String(fullPrecision)}"`);
  }
  return fullPrecision.toFixed(1);
}
