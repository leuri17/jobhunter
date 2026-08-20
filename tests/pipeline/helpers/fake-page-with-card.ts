import { FakePage, type FakeLocator } from '../../../src/linkedin/fake-page.js';
import type { CreateFakePage } from '../../../src/linkedin/fake-session.js';

/**
 * Build a `CreateFakePage` factory whose `FakePage` instances advertise
 * one card-shaped locator per supplied `sourceJobId`. The locator's
 * `elementHandle()` exposes `data-occludable-job-id = <id>` + an inner
 * anchor whose `href` matches `/jobs/view/<id>/` (the surface
 * `LinkedInDiscoveryService` consumes via `parseCardJobId`).
 *
 * The page also satisfies the `LinkedInExtractionService` panel-parser's
 * minimum DOM shape:
 *   - The `panel-title-anchor` locator returns a node whose `href`
 *     attribute matches the expected `sourceJobId` so
 *     `verifyPanelHrefMatches` succeeds.
 *   - The `job-description` locator returns a `count()` of 1 with a
 *     no-op `waitFor({ state: 'visible' })` so the panel parser's
 *     description-wait succeeds.
 *
 * The page returns the same card-shape for every `sourceJobId` passed
 * in (not strictly per-job); the discovery flow reads
 * `recordNewJob`-tracked job IDs from the database, so the page factory
 * is only consulted for the per-search discovery card list (one row per
 * card ID in input order).
 */
export function fakePageWithCard(sourceJobIds: readonly string[]): CreateFakePage {
  return (_session, url): FakePage => {
    void url;
    const firstId = sourceJobIds[0] ?? '';

    function makeAnchorNode(id: string): {
      readonly getAttribute: (name: string) => string | null;
      readonly querySelector: (selector: string) => null;
    } {
      return {
        getAttribute: (attr: string): string | null => {
          if (attr === 'data-occludable-job-id') return id;
          if (attr === 'href') return `/jobs/view/${id}/`;
          return null;
        },
        querySelector: (): null => null,
      };
    }
    function makeCardNode(id: string): {
      readonly getAttribute: (name: string) => string | null;
      readonly querySelector: (selector: string) => ReturnType<typeof makeAnchorNode> | null;
    } {
      return {
        getAttribute: (): null => null,
        querySelector: (selector: string): ReturnType<typeof makeAnchorNode> | null => {
          if (selector.includes('/jobs/view/')) return makeAnchorNode(id);
          return null;
        },
      };
    }
    function makeCardLocator(id: string): FakeLocator {
      return {
        count: async () => 1,
        all: async () => [makeCardLocator(id)],
        first: (): FakeLocator => makeCardLocator(id),
        elementHandle: async () => makeCardNode(id),
        click: async () => undefined,
        waitFor: async () => undefined,
      };
    }

    return new FakePage({
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      onGoto: async () => ({
        status: () => 200,
        url: () => 'https://www.linkedin.com/jobs/search/?q=engineer',
      }),
      onGetAttribute: (): null => null,
      onQuerySelector: (selector): ReturnType<typeof makeAnchorNode> | null => {
        // The panel parser reads `panel-title-anchor` from the page
        // itself (via `safeGetAttribute(page.locator(...))`). Match
        // that pattern: when the selector contains
        // 'panel-title-anchor', answer with the first card's anchor
        // node. The orchestrator uses the page-level locator (not the
        // per-card locator) for the panel title verification.
        if (selector.includes('panel-title-anchor') || selector.includes('top-card-link')) {
          return makeAnchorNode(firstId);
        }
        return null;
      },
      onLocator: (selector): FakeLocator | null => {
        // Discovery: card-list-item selectors return the card list.
        if (
          selector.includes('jobs-search-results__list-item') ||
          selector.includes('job-search-card')
        ) {
          return {
            count: async () => sourceJobIds.length,
            all: async () => sourceJobIds.map((id) => makeCardLocator(id)),
            first: (): FakeLocator => makeCardLocator(firstId),
            elementHandle: async () => makeCardNode(firstId),
            click: async () => undefined,
            waitFor: async () => undefined,
          };
        }
        // Extraction panel: every selector the parser queries resolves
        // to a 1-element locator with a no-op `waitFor` so the panel
        // parser's description-wait succeeds. The querySelector hook
        // (above) supplies the actual data.
        if (
          selector.includes('description') ||
          selector.includes('panel-title') ||
          selector.includes('top-card-link')
        ) {
          return {
            count: async () => 1,
            all: async () => [
              {
                count: async () => 1,
                all: async () => [],
                first: () => makeCardLocator(firstId),
                elementHandle: async () => makeCardNode(firstId),
                click: async () => undefined,
                waitFor: async () => undefined,
              },
            ],
            first: (): FakeLocator => makeCardLocator(firstId),
            elementHandle: async () => makeCardNode(firstId),
            click: async () => undefined,
            waitFor: async () => undefined,
          };
        }
        return null;
      },
    });
  };
}
