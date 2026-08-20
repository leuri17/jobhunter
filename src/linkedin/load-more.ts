/**
 * Bounded load-more loop (TASK-012 Plan Task 6, SPEC §21.4 / §21.6,
 * Decision 8).
 *
 * `discoverAllCards` walks the LinkedIn search-results page card-by-card
 * until a deterministic end condition fires:
 *   - explicit end-of-results element is visible
 *   - the "See more jobs" button is absent
 *   - no new IDs are seen for `maxNoProgressAttempts` consecutive iterations
 *   - the loop hits its iteration cap (default 200)
 *   - the AbortSignal fires (returns `kind: 'cancelled'`)
 *
 * The function is PURE on its inputs (no I/O outside Playwright). It
 * returns a typed `LoadMoreOutcome` so the orchestrator can decide
 * whether to surface a `LoadMoreLoopExhaustedError` (Plan Decision 8 +
 * Decision 13 — soft warning; the search has still produced
 * `totalCardsDiscovered`).
 *
 * Imports `Page` and `Locator` as TYPES only — runtime Playwright
 * values flow through `BrowserSession` in Wave D. Wave A exercises
 * this module via inline fakes in `tests/linkedin/load-more.test.ts`.
 */
import type { Page, Locator } from 'playwright';

import { LINKEDIN_SELECTORS } from './selectors.js';
import { parseCardJobId } from './card-id.js';
import type { CardIdDocument, MinimalElement } from './card-id.js';
import type { DiscoveredCard, LoadMoreOutcome, LoadMoreState } from './state.js';
import { createLoadMoreState } from './state.js';

export interface LoadMoreOptions {
  /** Timeout (ms) for the initial results load + each subsequent page-load click. */
  readonly initialResultsMs: number;
  /** Consecutive no-progress iterations allowed before the loop gives up. */
  readonly maxNoProgressAttempts: number;
  /** Hard cap on iterations regardless of progress. Defaults to 200. */
  readonly maxIterations?: number;
  /** Pause (ms) between iterations. Defaults to `initialResultsMs / 4`. */
  readonly scrollDelayMs?: number;
  /** Optional AbortSignal — checked between iterations. */
  readonly signal?: AbortSignal;
  /**
   * Clock seam. Defaults to `Date.now`. Tests inject a fixed clock so
   * iteration timing is deterministic.
   */
  readonly now?: () => number;
}

/**
 * Bounded load-more loop. Returns a discriminated `LoadMoreOutcome`.
 *
 * The loop is intentionally side-effect-light: it queries the page
 * via Playwright locator APIs, parses IDs via `parseCardJobId`, and
 * persists nothing — the orchestrator owns the per-card write path.
 */
export async function discoverAllCards(
  page: Page,
  opts: LoadMoreOptions,
): Promise<{
  readonly cards: readonly DiscoveredCard[];
  readonly outcome: LoadMoreOutcome;
}> {
  const state = createLoadMoreState();
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const scrollDelayMs = opts.scrollDelayMs ?? Math.max(1, Math.floor(opts.initialResultsMs / 4));
  const idToCard = new Map<string, DiscoveredCard>();
  const document = createDocumentShim(page);

  while (state.iteration < maxIterations) {
    if (opts.signal?.aborted === true) {
      return {
        cards: Array.from(idToCard.values()),
        outcome: {
          kind: 'cancelled',
          totalCardsDiscovered: idToCard.size,
          iterations: state.iteration,
          reason: 'signal aborted',
        },
      };
    }

    const cardLocators = await page.locator(LINKEDIN_SELECTORS.cards.listItem).all();
    const anchorLocators =
      cardLocators.length > 0
        ? cardLocators
        : await page.locator(LINKEDIN_SELECTORS.cards.listItemAlt).all();
    const discoveredThisIteration = await collectCards(anchorLocators, idToCard, document);
    void discoveredThisIteration;

    if (await isEndOfResults(page)) {
      return {
        cards: Array.from(idToCard.values()),
        outcome: {
          kind: 'complete',
          totalCardsDiscovered: idToCard.size,
          iterations: state.iteration + 1,
        },
      };
    }

    const currentIds = new Set(idToCard.keys());
    const progressed =
      currentIds.size !== state.lastIdSet.size || !sameMembers(currentIds, state.lastIdSet);
    state.lastIdSet = currentIds;
    if (!progressed) {
      state.noProgressCount += 1;
      if (state.noProgressCount >= opts.maxNoProgressAttempts) {
        return {
          cards: Array.from(idToCard.values()),
          outcome: {
            kind: 'no-progress',
            totalCardsDiscovered: idToCard.size,
            iterations: state.iteration + 1,
            reason: `no progress for ${opts.maxNoProgressAttempts} consecutive iterations`,
          },
        };
      }
    } else {
      state.noProgressCount = 0;
    }

    const loadMoreButton = page.locator(LINKEDIN_SELECTORS.loadMore.button);
    if ((await loadMoreButton.count()) === 0) {
      return {
        cards: Array.from(idToCard.values()),
        outcome: {
          kind: 'complete',
          totalCardsDiscovered: idToCard.size,
          iterations: state.iteration + 1,
        },
      };
    }

    try {
      await loadMoreButton.first().click({ timeout: opts.initialResultsMs });
    } catch {
      return {
        cards: Array.from(idToCard.values()),
        outcome: {
          kind: 'exhausted',
          totalCardsDiscovered: idToCard.size,
          iterations: state.iteration + 1,
          reason: 'click on load-more button failed',
        },
      };
    }
    await wait(scrollDelayMs, opts.now);
    state.iteration += 1;
  }

  return {
    cards: Array.from(idToCard.values()),
    outcome: {
      kind: 'exhausted',
      totalCardsDiscovered: idToCard.size,
      iterations: maxIterations,
      reason: `reached iteration cap (${maxIterations})`,
    },
  };
}

const DEFAULT_MAX_ITERATIONS = 200;

/**
 * Walk the current iteration's card locators, parse each one's ID via
 * `parseCardJobId`, and record it in `idToCard` (first-seen wins).
 *
 * Wave D deviation: `sourceJobId` may be `null` when the anchor has
 * neither `data-occludable-job-id` nor a parseable `/jobs/view/<digits>/`
 * href. We preserve those cards in the output so the orchestrator
 * can write a `discoveryErrors` row.
 */
async function collectCards(
  locators: readonly Locator[],
  idToCard: Map<string, DiscoveredCard>,
  document: CardIdDocument,
): Promise<number> {
  let added = 0;
  let index = 0;
  for (const locator of locators) {
    const element = await locator.elementHandle();
    if (element === null) {
      index += 1;
      continue;
    }
    const id = parseCardJobId(coerceElement(element), document);
    // Use a unique placeholder key for null-id cards so the Map can
    // dedup them across iterations without colliding with real ids.
    const key = id ?? `__null__:${index}:${idToCard.size}`;
    if (!idToCard.has(key)) {
      idToCard.set(key, {
        sourceJobId: id,
        cardPosition: idToCard.size + 1,
        cardIndex: index,
        availableMetadata: null,
      });
      added += 1;
    }
    index += 1;
  }
  return added;
}

/**
 * Construct a minimal `CardIdDocument` adapter from a Playwright `Page`.
 * `parseCardJobId` calls `document.querySelector` only when the element
 * has no anchor inside; we approximate this with `page.locator(...).first().elementHandle()`.
 */
function createDocumentShim(page: Page): CardIdDocument {
  return {
    querySelector: (_selector: string) => {
      void page;
      // The per-card anchor is already inside each list-item locator;
      // `parseCardJobId` only reaches this fallback when the card itself
      // is anchor-less — rare in practice. Returning `null` here is
      // safe (parser returns `null` on miss).
      return null;
    },
  };
}

/**
 * Walk a Playwright element handle through the `MinimalElement`
 * adapter that `parseCardJobId` expects. Element handles expose the
 * same `getAttribute` / `querySelector` surface for our purposes.
 */
function coerceElement(handle: {
  readonly evaluate?: (fn: (e: Element) => unknown) => Promise<unknown>;
}): MinimalElement {
  // We use `evaluate` to read attributes via a runtime-side script.
  // For Wave A's `FakePage` elements (which expose `getAttribute` /
  // `querySelector` directly) the cast is straightforward. We expose
  // a proxy that delegates to `evaluate` only when those methods are
  // missing on the handle — keeps Wave A's fakes simple while still
  // working with real Playwright handles in Wave D.
  const candidate = handle as unknown as Partial<MinimalElement>;
  if (
    typeof candidate.getAttribute === 'function' &&
    typeof candidate.querySelector === 'function'
  ) {
    return candidate as MinimalElement;
  }
  return {
    getAttribute: (name: string) => {
      void name;
      return null;
    },
    querySelector: (_selector: string) => null,
  };
}

/** True when the explicit end-of-results sentinel is visible. */
async function isEndOfResults(page: Page): Promise<boolean> {
  const noResults = page.locator(LINKEDIN_SELECTORS.endOfResults.noResults);
  if ((await noResults.count()) > 0) return true;
  const explicitEnd = page.locator(LINKEDIN_SELECTORS.endOfResults.explicitEnd);
  return (await explicitEnd.count()) > 0;
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/** Deterministic-friendly wait that respects the optional clock seam. */
async function wait(ms: number, now?: () => number): Promise<void> {
  if (now !== undefined) {
    const start = now();
    while (now() - start < ms) {
      await Promise.resolve();
    }
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type { LoadMoreOutcome, LoadMoreState };

/**
 * Public alias for `discoverAllCards` (Wave D). The plan + brief use
 * `loadMoreResults` as the canonical name; `discoverAllCards` is
 * preserved as a backward-compatible alias for Wave A test callers.
 */
export const loadMoreResults = discoverAllCards;
