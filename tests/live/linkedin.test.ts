import { describe, expect, it } from 'vitest';

/**
 * Live LinkedIn discovery tests (TASK-012 Plan Task 13, Wave E).
 *
 * These tests are opt-in via the LINKEDIN_LIVE=1 env var. By
 * default they are skipped so `pnpm test:live` exits 0 in CI
 * without hitting the live LinkedIn service. The
 * `vitest.live.config.ts` already includes the live directory with
 * `passWithNoTests: true`.
 *
 * To run:
 *   LINKEDIN_LIVE=1 pnpm test:live
 *
 * Future waves (TASK-013 / TASK-015) will replace the placeholder
 * with real coverage: navigate to a public LinkedIn search page,
 * assert card discovery + canonical sourceJobId extraction, and
 * exercise the per-card error path (no-ID cards).
 */
const ENABLED = process.env['LINKEDIN_LIVE'] === '1';

describe.skipIf(!ENABLED)('LinkedIn live discovery (opt-in)', () => {
  it('placeholder: verifies the live-test gate is wired', () => {
    // The test runner ONLY reaches this `it` when LINKEDIN_LIVE=1.
    // Asserting on `ENABLED` here would be circular; this test is
    // intentionally a no-op so the live suite is non-empty in CI
    // when the env var is set.
    expect(true).toBe(true);
  });

  // Future live test (TASK-013 / TASK-015): navigate to a real
  // LinkedIn search page + assert the orchestrator's per-search
  // walk completes. Skipped until the wave that introduces the live
  // orchestrator + scrape-side wiring.

  it.skipIf(!ENABLED)('extracts a public job-detail page end-to-end', async () => {
    // Navigate to a known public LinkedIn job-detail page.
    // Use the PlaywrightRouteSession to serve the dedicated fixture + open the page.
    // Assert all 4 required fields are extracted + extractionStatus === 'complete'.
    // This test is opt-in via LINKEDIN_LIVE=1.
    expect(true).toBe(true); // placeholder — real assertion in future wave
  });

  it.skipIf(!ENABLED)('scores a public job-detail page end-to-end (TASK-014)', async () => {
    // TASK-014 Wave E part 2: live scoring flow.
    // Navigate to a known public LinkedIn job-detail page.
    // Use the PlaywrightRouteSession to serve the dedicated fixture + open the page.
    // Then call ScoringService.scoreOne on the extracted job + a fake
    // profile + a fake filter result.
    // Assert:
    //   - overallScore is a valid number in [0, 100]
    //   - displayScore matches overallScore.toFixed(1)
    //   - the structured output has all 7 categories
    // This test is opt-in via LINKEDIN_LIVE=1.
    expect(true).toBe(true); // placeholder — real assertion in TASK-015 (orchestrator wire-up)
  });
});
