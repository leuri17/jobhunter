/**
 * Per-job scoring eligibility (SPEC §26.1).
 *
 * A job is eligible for scoring iff all three are true:
 *   1. `job.extractionStatus === 'complete'` — the job-detail
 *      extraction produced a complete record (not partial or failed).
 *   2. `filterResult.outcome === 'accepted'` — the deterministic
 *      filter accepted the job.
 *   3. `filterResult.fingerprint === activeFilterFingerprint` — the
 *      current filter result is not stale (the active filter version
 *      matches the fingerprint of the result we're looking at).
 *
 * Pure function — no I/O. The caller resolves the
 * `activeFilterFingerprint` from the active filter configuration.
 */
export interface ScoringEligibilityInput {
  readonly job: {
    readonly extractionStatus: 'complete' | 'partial' | 'failed';
  };
  readonly filterResult: {
    readonly outcome: 'accepted' | 'rejected';
    readonly fingerprint: string;
  };
  readonly activeFilterFingerprint: string;
}

export function isJobEligibleForScoring(input: ScoringEligibilityInput): boolean {
  return (
    input.job.extractionStatus === 'complete' &&
    input.filterResult.outcome === 'accepted' &&
    input.filterResult.fingerprint === input.activeFilterFingerprint
  );
}
