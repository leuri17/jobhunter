import { describe, expect, it } from 'vitest';

import { parseHTML } from 'linkedom';
import type { Locator, Page } from 'playwright';

import { discoverAllCards, type LoadMoreOptions } from '../../src/linkedin/load-more.js';
import { LINKEDIN_SELECTORS } from '../../src/linkedin/selectors.js';

/**
 *  a deterministic fake `Page` for `load-more` tests. The fake
 * serves a fixed list of card-count snapshots and answers `click()` on
 * the load-more button with the next snapshot.  will exercise
 * `discoverAllCards` against real Playwright via
 * `tests/linkedin/helpers/playwright-route-session.ts`.
 */

interface Snapshot {
  readonly cardIds: readonly string[];
  readonly loadMorePresent: boolean;
  readonly endOfResultsVisible: boolean;
}

interface FakeState {
  snapshots: readonly Snapshot[];
  snapshotIndex: number;
  clickCount: number;
}

class FakePage {
  public readonly state: FakeState;

  constructor(snapshots: readonly Snapshot[]) {
    this.state = {
      snapshots,
      snapshotIndex: 0,
      clickCount: 0,
    };
  }

  currentSnapshot(): Snapshot {
    const idx = Math.min(this.state.snapshotIndex, this.state.snapshots.length - 1);
    const snap = this.state.snapshots[idx];
    if (snap === undefined) {
      throw new Error('FakePage: no snapshots configured');
    }
    return snap;
  }

  locator = (selector: string): Locator => {
    const isListItem =
      selector === LINKEDIN_SELECTORS.cards.listItem ||
      selector === LINKEDIN_SELECTORS.cards.listItemAlt;
    const isLoadMore = selector === LINKEDIN_SELECTORS.loadMore.button;
    const isEndOfResults =
      selector === LINKEDIN_SELECTORS.endOfResults.noResults ||
      selector === LINKEDIN_SELECTORS.endOfResults.explicitEnd;

    const listItemCount = (): number => (isListItem ? this.currentSnapshot().cardIds.length : 0);
    const loadMoreCount = (): number =>
      isLoadMore && this.currentSnapshot().loadMorePresent ? 1 : 0;
    const endOfResultsCount = (): number =>
      isEndOfResults && this.currentSnapshot().endOfResultsVisible ? 1 : 0;

    return {
      count: async (): Promise<number> => {
        if (isListItem) return listItemCount();
        if (isLoadMore) return loadMoreCount();
        if (isEndOfResults) return endOfResultsCount();
        return 0;
      },
      first: () => this.locator(selector),
      all: async (): Promise<Locator[]> => {
        const ids = this.currentSnapshot().cardIds;
        return ids.map((id) => makeStubLocator(id));
      },
      elementHandle: async () => {
        // Return a single stub card so the loop's first iteration sees
        // the snapshot's first ID. The subsequent iterations rely on
        // `.all()` which returns per-card locators with the right IDs.
        const ids = this.currentSnapshot().cardIds;
        const id = ids[0] ?? '000000';
        return makeFakeElementHandle(
          `<li class="jobs-search-results__list-item"><a href="/jobs/view/${id}/" data-occludable-job-id="${id}">${id}</a></li>`,
        );
      },
      click: async (opts?: { timeout?: number }): Promise<void> => {
        void opts;
        if (!isLoadMore) return;
        this.state.clickCount += 1;
        if (this.state.snapshotIndex < this.state.snapshots.length - 1) {
          this.state.snapshotIndex += 1;
        }
      },
      waitFor: async (): Promise<void> => undefined,
    } as unknown as Locator;
  };
}

function makeStubLocator(id: string): Locator {
  return {
    count: async (): Promise<number> => 1,
    first: () => makeStubLocator(id),
    all: async (): Promise<Locator[]> => [makeStubLocator(id)],
    elementHandle: async () =>
      makeFakeElementHandle(
        `<li class="jobs-search-results__list-item"><a href="/jobs/view/${id}/" data-occludable-job-id="${id}">${id}</a></li>`,
      ),
    click: async (): Promise<void> => undefined,
    waitFor: async (): Promise<void> => undefined,
  } as unknown as Locator;
}

/**
 * Build a minimal element handle exposing the `getAttribute` /
 * `querySelector` surface that `parseCardJobId` consumes. The fake
 * is backed by linkedom so attribute lookups reflect real DOM
 * semantics. `parseCardJobId` expects the element to be a card
 * `<li>` containing an inner `<a>`; the caller wraps the anchor in
 * a `<li>` before invoking `makeFakeElementHandle`.
 */
function makeFakeElementHandle(html: string): {
  readonly outerHTML: string;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => {
    getAttribute: (name: string) => string | null;
    querySelector: (selector: string) => null;
  } | null;
  readonly evaluate: <T>(fn: (e: { outerHTML: string }) => T) => Promise<T>;
} {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const body = document.querySelector('body');
  const element = body?.firstElementChild ?? null;
  const getAttribute = (name: string): string | null => {
    if (element === null) return null;
    return element.getAttribute(name);
  };
  const querySelector = (
    selector: string,
  ): {
    getAttribute: (name: string) => string | null;
    querySelector: (selector: string) => null;
  } | null => {
    if (element === null) return null;
    const nested = element.querySelector(selector);
    if (nested === null) return null;
    return {
      getAttribute: (name: string) => nested.getAttribute(name),
      querySelector: () => null,
    };
  };
  return {
    outerHTML: html,
    getAttribute,
    querySelector,
    evaluate: async <T>(fn: (e: { outerHTML: string }) => T): Promise<T> => fn({ outerHTML: html }),
  };
}

const BASE_OPTS: LoadMoreOptions = {
  initialResultsMs: 10,
  maxNoProgressAttempts: 3,
  maxIterations: 20,
  scrollDelayMs: 0,
};

describe('src/linkedin/load-more — ', () => {
  it('returns 5 cards in 1 iteration when the snapshot has 5 cards and no load-more', async () => {
    const ids = ['100001', '100002', '100003', '100004', '100005'];
    const page = new FakePage([
      { cardIds: ids, loadMorePresent: false, endOfResultsVisible: false },
    ]);
    const { cards, outcome } = await discoverAllCards(page as unknown as Page, BASE_OPTS);
    expect(cards).toHaveLength(5);
    expect(outcome.kind).toBe('complete');
    if (outcome.kind === 'complete') {
      expect(outcome.totalCardsDiscovered).toBe(5);
      expect(outcome.iterations).toBe(1);
    }
  });

  it('returns 0 cards when the snapshot is empty (no-results)', async () => {
    const page = new FakePage([{ cardIds: [], loadMorePresent: false, endOfResultsVisible: true }]);
    const { cards, outcome } = await discoverAllCards(page as unknown as Page, BASE_OPTS);
    expect(cards).toEqual([]);
    expect(outcome.kind).toBe('complete');
  });

  it('loads the next batch when the load-more button is present', async () => {
    const first = ['200001', '200002', '200003'];
    const second = ['200001', '200002', '200003', '200004', '200005'];
    const third = ['200001', '200002', '200003', '200004', '200005', '200006', '200007'];
    const page = new FakePage([
      { cardIds: first, loadMorePresent: true, endOfResultsVisible: false },
      { cardIds: second, loadMorePresent: true, endOfResultsVisible: false },
      { cardIds: third, loadMorePresent: false, endOfResultsVisible: true },
    ]);
    const { cards, outcome } = await discoverAllCards(page as unknown as Page, BASE_OPTS);
    expect(cards).toHaveLength(7);
    if (outcome.kind === 'complete') {
      expect(outcome.totalCardsDiscovered).toBe(7);
      expect(outcome.iterations).toBeGreaterThanOrEqual(1);
    } else {
      throw new Error(`expected kind: 'complete', got ${outcome.kind}`);
    }
  });

  it('dedups cards across iterations by sourceJobId (first-seen wins)', async () => {
    const page = new FakePage([
      { cardIds: ['300001', '300002'], loadMorePresent: true, endOfResultsVisible: false },
      { cardIds: ['300002', '300003'], loadMorePresent: true, endOfResultsVisible: false },
      {
        cardIds: ['300001', '300002', '300003', '300004'],
        loadMorePresent: false,
        endOfResultsVisible: true,
      },
    ]);
    const { cards, outcome } = await discoverAllCards(page as unknown as Page, BASE_OPTS);
    const ids = cards.map((c) => c.sourceJobId).sort();
    expect(ids).toEqual(['300001', '300002', '300003', '300004']);
    expect(outcome.kind).toBe('complete');
  });

  it('returns kind: cancelled when the signal aborts before any iteration', async () => {
    const page = new FakePage([
      { cardIds: ['400001'], loadMorePresent: false, endOfResultsVisible: false },
    ]);
    const controller = new AbortController();
    controller.abort();
    const { cards, outcome } = await discoverAllCards(page as unknown as Page, {
      ...BASE_OPTS,
      signal: controller.signal,
    });
    expect(cards).toEqual([]);
    expect(outcome.kind).toBe('cancelled');
  });

  it('returns kind: no-progress after maxNoProgressAttempts consecutive identical snapshots', async () => {
    const page = new FakePage([
      { cardIds: ['500001'], loadMorePresent: true, endOfResultsVisible: false },
      { cardIds: ['500001'], loadMorePresent: true, endOfResultsVisible: false },
      { cardIds: ['500001'], loadMorePresent: true, endOfResultsVisible: false },
      { cardIds: ['500001'], loadMorePresent: true, endOfResultsVisible: false },
    ]);
    const { cards, outcome } = await discoverAllCards(page as unknown as Page, {
      ...BASE_OPTS,
      maxNoProgressAttempts: 2,
    });
    expect(cards.map((c) => c.sourceJobId)).toEqual(['500001']);
    expect(['no-progress', 'exhausted']).toContain(outcome.kind);
  });

  it('returns kind: exhausted when maxIterations is reached', async () => {
    const page = new FakePage(
      Array.from({ length: 5 }, (_, i) => ({
        cardIds: [`60000${i}`],
        loadMorePresent: true,
        endOfResultsVisible: false,
      })),
    );
    const { outcome } = await discoverAllCards(page as unknown as Page, {
      ...BASE_OPTS,
      maxIterations: 3,
      maxNoProgressAttempts: 10,
    });
    expect(outcome.kind).toBe('exhausted');
  });
});
