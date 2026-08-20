/**
 * Deterministic ranking for TASK-014 scoring (SPEC §26.5).
 *
 * The order is:
 *   1. `overallScore` descending (full precision).
 *   2. `sourceJobId` ascending for exact ties.
 *
 * No recency, preference, discovery-order, or filter-weight adjustments
 * (per SPEC §26.5). No minimum threshold. Pure function — no I/O.
 */
export interface RankedResult {
  readonly sourceJobId: string;
  readonly overallScore: number;
  readonly rank: number;
}

export function rankResults(
  scores: readonly { readonly sourceJobId: string; readonly overallScore: number }[],
): readonly RankedResult[] {
  const sorted = [...scores].sort((a, b) => {
    if (a.overallScore !== b.overallScore) {
      return b.overallScore - a.overallScore; // descending
    }
    if (a.sourceJobId < b.sourceJobId) return -1; // ascending
    if (a.sourceJobId > b.sourceJobId) return 1;
    return 0;
  });
  return sorted.map((entry, index) => ({
    sourceJobId: entry.sourceJobId,
    overallScore: entry.overallScore,
    rank: index + 1, // 1-based
  }));
}
