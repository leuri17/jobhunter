/**
 * Bounded load-more loop.
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
 * whether to surface a `LoadMoreLoopExhaustedError` (Plan  +
 *  — soft warning; the search has still produced
 * `totalCardsDiscovered`).
 *
 * Each iteration issues ONE CDP round-trip to read every card's
 * anchor attributes (`data-occludable-job-id`, `href`) via
 * `page.locator(...).evaluateAll(...)`. The previous implementation
 * resolved per-card locators and called `locator.elementHandle()`
 * per card — N+1 round-trips per iteration that became the
 * single biggest Playwright-side cost on long lists (audit H14).
 *
 * Imports `Page` and `Locator` as TYPES only — runtime Playwright
 * values flow through `BrowserSession` in .  exercises
 * this module via inline fakes in `tests/linkedin/load-more.test.ts`.
 */
import type { Page, Locator } from 'playwright';

import { LINKEDIN_SELECTORS } from './selectors.js';
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

    const primaryLocator = page.locator(LINKEDIN_SELECTORS.cards.listItem);
    const altLocator = page.locator(LINKEDIN_SELECTORS.cards.listItemAlt);
    const discoveredThisIteration = await collectCards(primaryLocator, altLocator, idToCard);
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
 * Pure browser-side fn: walk each matched `<li>`, find the inner
 * `<a>`, and return the two attributes `parseCardJobId` inspects.
 * Hoisted to a module-level constant so both `evaluateAll` call sites
 * (primary + alt selector) reuse the same callback without re-
 * allocating the closure on every iteration of the outer loop.
 */
const collectCardAnchorAttrs = (nodes: Element[]): CardAnchorAttrs[] =>
  nodes.map((node) => {
    const anchor = node.querySelector('a');
    if (anchor === null) {
      return { occludable: null, href: null };
    }
    return {
      occludable: anchor.getAttribute('data-occludable-job-id'),
      href: anchor.getAttribute('href'),
    };
  });

/**
 * One CDP round-trip per iteration: read every card's anchor attrs
 * (`data-occludable-job-id`, `href`) via `evaluateAll` and parse each
 * to a `sourceJobId` client-side. Replaces the prior per-card
 * `locator.elementHandle()` + `parseCardJobId(element, document)`
 * pattern that drove hundreds of protocol round-trips per search on
 * long lists (audit H14).
 *
 * The selector is resolved exactly once per iteration: the primary
 * selector first; the alt selector only fires when the primary
 * yields no cards. The redundant `.count()` probe that the
 * pre-#63 code used to decide between primary and alt is gone —
 * an empty `evaluateAll` result is the cheapest possible "empty"
 * signal in Playwright (audit B3-C.3.2).
 *
 *  deviation: `sourceJobId` may be `null` when the anchor has
 * neither `data-occludable-job-id` nor a parseable `/jobs/view/<digits>/`
 * href. We preserve those cards in the output so the orchestrator
 * can write a `discoveryErrors` row.
 */
async function collectCards(
  primaryLocator: Locator,
  altLocator: Locator,
  idToCard: Map<string, DiscoveredCard>,
): Promise<number> {
  const primaryAttrs = await primaryLocator.evaluateAll<CardAnchorAttrs[], Element>(
    collectCardAnchorAttrs,
  );
  const attrs =
    primaryAttrs.length > 0
      ? primaryAttrs
      : await altLocator.evaluateAll<CardAnchorAttrs[], Element>(collectCardAnchorAttrs);

  let added = 0;
  let index = 0;
  for (const { occludable, href } of attrs) {
    const id = parseSourceJobIdFromAnchor(occludable, href);
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

interface CardAnchorAttrs {
  readonly occludable: string | null;
  readonly href: string | null;
}

/**
 * Pure parser for the two attributes that `parseCardJobId` (in
 * `card-id.ts`) inspects. Mirrors its logic so the production path
 * can decode the bulk-extracted attrs client-side without a second
 * round-trip. Kept inline rather than exported because the browser-
 * side `evaluateAll` callback re-uses the same rule on its side of
 * the protocol boundary.
 */
function parseSourceJobIdFromAnchor(occludable: string | null, href: string | null): string | null {
  if (occludable !== null) {
    return occludable;
  }
  if (href === null) {
    return null;
  }
  const match = /\/jobs\/view\/(\d+)/.exec(href);
  return match?.[1] ?? null;
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
 * Public alias for `discoverAllCards`. The plan + brief use
 * `loadMoreResults` as the canonical name; `discoverAllCards` is
 * preserved as a backward-compatible alias for  test callers.
 */
export const loadMoreResults = discoverAllCards;
