import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';

import {
  createDefaultBrowserSession,
  dismissRecoverableOverlays,
  discoverAllCards,
  navigateWithTimeout,
} from '../../src/linkedin/index.js';
import type { BrowserSession, DiscoveredCard, LoadMoreOutcome } from '../../src/linkedin/index.js';
import {
  buildDetailUrl,
  parseDedicatedPage,
  validateRequiredFields,
} from '../../src/linkedin/extraction/index.js';
import { buildLinkedInSearchURL } from '../../src/search/url-builder.js';

/**
 * Live LinkedIn smoke tests — the regression net for DOM/serving drift.
 *
 * Opt-in via `LINKEDIN_LIVE=1` (skipped otherwise, so `pnpm test:live`
 * exits 0 in CI without touching the network):
 *   LINKEDIN_LIVE=1 pnpm test:live
 *
 * Each test maps to a real incident class:
 *   1. overlay dismissal bounded by a wall-clock ceiling (#310-class hangs),
 *   2. card discovery with parsed sourceJobIds (#312-class parser drift),
 *   3. dedicated `/jobs/view/<id>/` field extraction (#313-class selector drift).
 *
 * The tests run sequentially and share state: one browser session, one
 * search page opened by test 1, and the first parsed sourceJobId carried
 * from test 2 into test 3. A failure in an earlier test surfaces as a
 * clear "must run first" error in the later ones.
 *
 * LinkedIn guest serving is intermittent (auth-wall / empty hydration on
 * first load). The discovery test retries once on an empty card set
 * before failing; a genuinely unreachable LinkedIn fails fast with the
 * navigation result attached.
 */
const ENABLED = process.env['LINKEDIN_LIVE'] === '1';

const NAVIGATION_MS = 30_000;
const INITIAL_RESULTS_MS = 20_000;
const OVERLAY_DISMISSAL_MS = 5_000;
const OVERLAY_WALL_CLOCK_CEILING_MS = 30_000;
const DISCOVERY_MAX_ITERATIONS = 6;
const MAX_NO_PROGRESS_ATTEMPTS = 3;

const GUEST_SEARCH_URL = buildLinkedInSearchURL({
  query: 'software engineer',
  geoId: '103644278',
  datePosted: 604_800,
  workplaceTypes: ['1', '2', '3'],
});

interface DiscoveryResult {
  readonly cards: readonly DiscoveredCard[];
  readonly outcome: LoadMoreOutcome;
}

describe.skipIf(!ENABLED)('LinkedIn live smoke (opt-in)', () => {
  let session: BrowserSession;
  let searchPage: Page | null = null;
  let firstSourceJobId: string | null = null;

  beforeAll(async () => {
    session = createDefaultBrowserSession({
      navigationMs: NAVIGATION_MS,
      initialResultsMs: INITIAL_RESULTS_MS,
      overlayDismissalMs: OVERLAY_DISMISSAL_MS,
    });
    await session.launch();
  });

  afterAll(async () => {
    await session.close();
  });

  async function openGuestSearchPage(): Promise<Page> {
    const page = await session.openPage(GUEST_SEARCH_URL);
    const navigation = await navigateWithTimeout({
      page,
      url: GUEST_SEARCH_URL,
      timeoutMs: NAVIGATION_MS,
    });
    expect(navigation.ok, `guest search navigation failed: ${JSON.stringify(navigation)}`).toBe(
      true,
    );
    return page;
  }

  async function dismissOverlays(page: Page): Promise<number> {
    const startedAt = Date.now();
    await dismissRecoverableOverlays(page, { overlayDismissalMs: OVERLAY_DISMISSAL_MS });
    return Date.now() - startedAt;
  }

  async function runDiscovery(page: Page): Promise<DiscoveryResult> {
    return discoverAllCards(page, {
      initialResultsMs: INITIAL_RESULTS_MS,
      maxNoProgressAttempts: MAX_NO_PROGRESS_ATTEMPTS,
      maxIterations: DISCOVERY_MAX_ITERATIONS,
    });
  }

  it('dismisses guest overlays within a wall-clock budget', async () => {
    searchPage = await openGuestSearchPage();
    const elapsedMs = await dismissOverlays(searchPage);
    expect(elapsedMs).toBeLessThan(OVERLAY_WALL_CLOCK_CEILING_MS);
  });

  it('discovers cards with parsed sourceJobIds', async () => {
    const page = searchPage;
    if (page === null) {
      throw new Error('overlay dismissal test must run first to open the search page');
    }

    let result = await runDiscovery(page);
    if (result.cards.length === 0) {
      await session.closePage(page);
      searchPage = await openGuestSearchPage();
      await dismissOverlays(searchPage);
      result = await runDiscovery(searchPage);
    }

    expect(result.cards.length, `discovery outcome: ${result.outcome.kind}`).toBeGreaterThan(0);
    const parsedIds = result.cards.flatMap((card) =>
      card.sourceJobId === null ? [] : [card.sourceJobId],
    );
    expect(parsedIds.length, 'cards with a parsed sourceJobId').toBeGreaterThan(0);
    firstSourceJobId = parsedIds[0] ?? null;
  });

  it('parses a dedicated /jobs/view/<id>/ page completely', async () => {
    const sourceJobId = firstSourceJobId;
    if (sourceJobId === null) {
      throw new Error('card discovery test must run first to parse a sourceJobId');
    }

    const url = buildDetailUrl(sourceJobId);
    const page = await session.openFallbackPage(url);
    try {
      const navigation = await navigateWithTimeout({ page, url, timeoutMs: NAVIGATION_MS });
      expect(navigation.ok, `dedicated page navigation failed: ${JSON.stringify(navigation)}`).toBe(
        true,
      );
      await dismissOverlays(page);

      const fields = await parseDedicatedPage(page);
      const validation = validateRequiredFields(fields);
      expect(validation.missing, `missing fields on ${url}`).toEqual([]);
    } finally {
      await session.closeFallbackPage(page);
    }
  });
});
