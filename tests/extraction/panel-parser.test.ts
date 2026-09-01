import { describe, expect, it } from 'vitest';

import { parseHTML } from 'linkedom';
import type { Page } from 'playwright';

import {
  PANEL_DESCRIPTION_WAIT_MS,
  PANEL_VERIFY_MAX_ATTEMPTS,
  PANEL_VERIFY_RETRY_MS,
  parsePanel,
} from '../../src/linkedin/extraction/panel-parser.js';
import {
  PanelExtractionError,
  PanelJobIdMismatchError,
} from '../../src/linkedin/extraction/errors.js';
import { computeExtractionStatus } from '../../src/linkedin/extraction/status.js';
import { LINKEDIN_SELECTORS } from '../../src/linkedin/selectors.js';
import { loadFixture } from './fixtures/loadFixture.js';

/**
 * Unit tests for `src/linkedin/extraction/panel-parser.ts`
 *
 * Strategy: parse each fixture HTML through `linkedom.parseHTML`
 * (cheap, deterministic), then hand-construct a fake `Page` whose
 * locator APIs read from the linkedom document. The fake mirrors
 * the surface `parsePanel` actually touches:
 *   - `page.url()` → the constructor's `url`
 *   - `page.locator(selector).first().textContent()` → the
 *     resolved element's text (or null)
 *   - `page.locator(selector).first().getAttribute('href')` →
 *     the element's href attribute (or null)
 *   - `page.locator(selector).first().waitFor({ state, timeout })`
 *     → resolves immediately if the element exists, throws on
 *     timeout otherwise (the fake's wait timeout is a small constant)
 *
 * The fake honours the multi-selector `LINKEDIN_SELECTORS.panel.description`
 * (comma-separated CSS selectors): the first matching selector wins.
 * `LINKEDIN_SELECTORS.panel.titleAnchor` resolves to the inner `<a>`.
 */

interface FakeElement {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string;
}

interface FakeDocument {
  readonly querySelector: (selector: string) => FakeElement | null;
  readonly querySelectorAll: (selector: string) => FakeElement[];
}

interface FakeLocatorChainArgs {
  readonly href: string | null;
  readonly sourceJobId: string;
  readonly expectMismatch: boolean;
}

interface FakePageArgs extends FakeLocatorChainArgs {
  readonly html: string;
  readonly url: string;
}

function parseDocument(html: string): FakeDocument {
  const { document: rawDoc } = parseHTML(html);
  return rawDoc as unknown as FakeDocument;
}

/**
 * Resolve a comma-separated CSS selector list. Returns the first
 * selector that matches at least one node. Mirrors Playwright's
 * `.first()` semantics for the `LINKEDIN_SELECTORS.panel.description`
 * multi-selector list.
 */
function firstMatchingSelector(doc: FakeDocument, selectorList: string): FakeElement | null {
  for (const part of selectorList.split(',')) {
    const trimmed = part.trim();
    const node = doc.querySelector(trimmed);
    if (node !== null) return node;
  }
  return null;
}

function firstMatchingSelectors(doc: FakeDocument, selectorList: string): FakeElement[] {
  for (const part of selectorList.split(',')) {
    const trimmed = part.trim();
    const matches = doc.querySelectorAll(trimmed);
    if (matches.length > 0) return matches;
  }
  return [];
}

function makeFakePage(args: FakePageArgs): {
  readonly page: Page;
  readonly callLog: { readonly op: string; readonly selector: string }[];
} {
  const doc = parseDocument(args.html);
  const callLog: { op: string; selector: string }[] = [];

  const urlValue = args.url;

  const fakeLocator = (selector: string) => {
    callLog.push({ op: 'locator', selector });
    return {
      first: () => {
        callLog.push({ op: 'first', selector });
        return fakeLocator(selector);
      },
      // Text read — used for the 4 field reads.
      textContent: async () => {
        callLog.push({ op: 'textContent', selector });
        const node = pickNode(doc, selector);
        return node?.textContent ?? null;
      },
      // Attribute read — used for the panel title anchor href.
      getAttribute: async (name: string) => {
        callLog.push({ op: `getAttribute(${name})`, selector });
        const node = pickNode(doc, selector);
        return node?.getAttribute(name) ?? null;
      },
      // Visibility wait — used for the description container pre-check.
      // Mirrors Playwright's `state: 'visible'` semantics by succeeding
      // iff the node exists.
      waitFor: async (opts: { state: string; timeout: number }) => {
        callLog.push({ op: `waitFor(${opts.state},${opts.timeout})`, selector });
        void opts.timeout;
        // Honour the production test config — only the description
        // selector is required to be visible at parse time. The
        // multi-selector description list resolves to the first match.
        const node =
          selector === LINKEDIN_SELECTORS.panel.description
            ? firstMatchingSelector(doc, LINKEDIN_SELECTORS.panel.description)
            : pickNode(doc, selector);
        if (node === null) {
          // Simulate a timeout — Playwright throws on waitFor timeout.
          throw new Error(`waitFor timed out for selector ${selector}`);
        }
        return undefined;
      },
    };
  };

  const fakePage = {
    url: () => {
      callLog.push({ op: 'url', selector: '' });
      return urlValue;
    },
    locator: fakeLocator,
  };

  return {
    page: fakePage as unknown as Page,
    callLog,
  };
}

/**
 * Resolve a single-element selector via `querySelector`. Multi-selector
 * lists are not honoured here (use `firstMatchingSelector` for those).
 */
function pickNode(doc: FakeDocument, selector: string): FakeElement | null {
  if (selector.includes(',')) {
    return firstMatchingSelector(doc, selector);
  }
  return doc.querySelector(selector);
}

function pinPanelTitleAnchorHref(doc: FakeDocument, expectedId: string): void {
  // Asserts the fixture's panel title anchor exists with the
  // expected href; throws if not (used to fail loud on bad
  // fixtures).
  const anchor = doc.querySelector(LINKEDIN_SELECTORS.panel.titleAnchor);
  if (anchor === null) {
    throw new Error('panel title anchor fixture missing');
  }
  const href = anchor.getAttribute('href');
  if (href === null) {
    throw new Error('panel title anchor href missing');
  }
  // The href must point to the expectedId (or "999999" for the
  // mismatch fixture). Tests that intentionally swap the fixture
  // pass their own `expectedId`.
  expect(href).toContain(`/${expectedId}/`);
}

describe('src/linkedin/extraction/panel-parser.ts', () => {
  it('exports the documented retry + wait budgets', () => {
    expect(PANEL_VERIFY_MAX_ATTEMPTS).toBe(3);
    expect(PANEL_VERIFY_RETRY_MS).toBe(500);
    expect(PANEL_DESCRIPTION_WAIT_MS).toBe(10_000);
  });

  it('parsePanel reads all 4 fields from panel-complete.html (status = complete)', async () => {
    const html = loadFixture('panel-complete');
    const { page } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      href: null,
      sourceJobId: '1234567890',
      expectMismatch: false,
    });
    const fields = await parsePanel(page, { sourceJobId: '1234567890' });
    expect(fields.title).toBe('Senior Software Engineer');
    expect(fields.company).toBe('Acme Corp');
    expect(fields.location).toContain('San Francisco, CA');
    expect(fields.location).toContain('$180,000/yr');
    expect(fields.description).toContain('About the job.');
    expect(fields.description).toContain('Senior Software Engineer to design');

    // Service-layer status calc — `complete` only when all 4 valid.
    expect(computeExtractionStatus(fields)).toBe('complete');
  });

  it('parsePanel reads 3 fields from panel-partial.html (status = partial)', async () => {
    const html = loadFixture('panel-partial');
    const { page } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      href: null,
      sourceJobId: '1234567890',
      expectMismatch: false,
    });
    const fields = await parsePanel(page, { sourceJobId: '1234567890' });
    expect(fields.title).toBe('Staff Engineer');
    expect(fields.company).toBe('Beta Inc');
    // Location container is ABSENT from this fixture → null.
    expect(fields.location).toBeNull();
    // Description truncates to the preview paragraph; the "Show more"
    // button text must be stripped by `normalizeText`.
    expect(fields.description).toContain('Preview of the job description.');
    expect(fields.description).not.toMatch(/show more/i);

    // Service-layer status calc — partial because location is missing.
    expect(computeExtractionStatus(fields)).toBe('partial');
  });

  it('parsePanel throws PanelJobIdMismatchError when panel-anchor href differs from selected sourceJobId', async () => {
    const html = loadFixture('panel-mismatch');
    // The fixture's panel-anchor href points to `/jobs/view/999999/`,
    // but we're "selecting" job 1234567890. The verifier must catch
    // this after the bounded retry loop.
    const { page } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      href: 'https://www.linkedin.com/jobs/view/999999/',
      sourceJobId: '1234567890',
      expectMismatch: true,
    });
    // Confirm the fixture is what we expect (guard against silent drift).
    const doc = parseDocument(html);
    pinPanelTitleAnchorHref(doc, '999999');

    await expect(parsePanel(page, { sourceJobId: '1234567890' })).rejects.toThrow(
      PanelJobIdMismatchError,
    );
  });

  it('PanelJobIdMismatchError carries expectedSourceJobId + actualSourceJobId + attempts = PANEL_VERIFY_MAX_ATTEMPTS', async () => {
    const html = loadFixture('panel-mismatch');
    const { page } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      href: 'https://www.linkedin.com/jobs/view/999999/',
      sourceJobId: '1234567890',
      expectMismatch: true,
    });
    let captured: PanelJobIdMismatchError | null = null;
    try {
      await parsePanel(page, { sourceJobId: '1234567890' });
    } catch (error) {
      if (error instanceof PanelJobIdMismatchError) {
        captured = error;
      }
    }
    expect(captured).not.toBeNull();
    if (captured !== null) {
      expect(captured.code).toBe('panel_job_id_mismatch');
      expect(captured.metadata['expectedSourceJobId']).toBe('1234567890');
      expect(captured.metadata['actualSourceJobId']).toBe('999999');
      expect(captured.metadata['attempts']).toBe(PANEL_VERIFY_MAX_ATTEMPTS);
    }
  });

  it('parsePanel throws PanelExtractionError(description_not_visible) when description container is missing', async () => {
    const html = loadFixture('panel-parse-failure');
    const { page } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      href: null,
      sourceJobId: '1234567890',
      expectMismatch: false,
    });
    let captured: PanelExtractionError | null = null;
    try {
      await parsePanel(page, { sourceJobId: '1234567890' });
    } catch (error) {
      if (error instanceof PanelExtractionError) {
        captured = error;
      }
    }
    expect(captured).not.toBeNull();
    if (captured !== null) {
      expect(captured.code).toBe('panel_extraction_failed');
      expect(captured.metadata['reason']).toBe('description_not_visible');
    }
  });

  it('PanelExtractionError carries the url in metadata', async () => {
    const html = loadFixture('panel-parse-failure');
    const { page } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer&currentJobId=1234567890',
      href: null,
      sourceJobId: '1234567890',
      expectMismatch: false,
    });
    let captured: PanelExtractionError | null = null;
    try {
      await parsePanel(page, { sourceJobId: '1234567890' });
    } catch (error) {
      if (error instanceof PanelExtractionError) {
        captured = error;
      }
    }
    expect(captured).not.toBeNull();
    if (captured !== null) {
      expect(captured.metadata['url']).toBe(
        'https://www.linkedin.com/jobs/search/?keywords=engineer&currentJobId=1234567890',
      );
    }
  });

  it('parsePanel checks the signal before the description wait (cancelled case)', async () => {
    const html = loadFixture('panel-complete');
    const { page } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      href: null,
      sourceJobId: '1234567890',
      expectMismatch: false,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      parsePanel(page, { sourceJobId: '1234567890', signal: controller.signal }),
    ).rejects.toThrow(PanelExtractionError);
  });

  it('parsePanel reads the href from panel.titleAnchor (Oracle Finding 2: inner <a>, NOT <h1>)', async () => {
    const html = loadFixture('panel-complete');
    const { page, callLog } = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      href: 'https://www.linkedin.com/jobs/view/1234567890/',
      sourceJobId: '1234567890',
      expectMismatch: false,
    });
    await parsePanel(page, { sourceJobId: '1234567890' });

    // The verifier must have issued getAttribute('href') against the
    // panel.titleAnchor selector. The 4 field reads against fields.title
    // (the <h1>) are separate textContent calls — there must NEVER be
    // a getAttribute against `<h1>` (the <h1> carries no href).
    const titleAnchorCalls = callLog.filter(
      (entry) =>
        entry.op === 'getAttribute(href)' &&
        entry.selector === LINKEDIN_SELECTORS.panel.titleAnchor,
    );
    expect(titleAnchorCalls.length).toBeGreaterThanOrEqual(1);
    // No getAttribute on fields.title (the <h1>).
    const titleElementAttrCalls = callLog.filter(
      (entry) =>
        entry.op === 'getAttribute(href)' &&
        entry.selector === LINKEDIN_SELECTORS.panel.titleElement,
    );
    expect(titleElementAttrCalls.length).toBe(0);
  });

  it('parsePanel description selector waits via the multi-selector list (first-match wins)', () => {
    // The panels use one of 4 LinkedIn-rendered classes — verify the
    // FIELDS map exposes the multi-selector list (the parser itself
    // delegates to Playwright, which does first-match winning).
    expect(LINKEDIN_SELECTORS.panel.description).toContain('.jobs-description__content');
    expect(LINKEDIN_SELECTORS.panel.description).toContain(', ');
  });
});

describe('src/linkedin/extraction/panel-parser.ts — first-match selector resolution', () => {
  // Verification helpers — these tests check that `firstMatchingSelector`
  // honours the multi-selector list the same way Playwright does
  // (any-of). Most of the panel-parser tests are integration-level
  // (parsePanel + fakePage), but these unit tests pin the resolution
  // logic so future refactors can't regress.

  it('firstMatchingSelector returns the first selector that matches', () => {
    const html = `
      <html><body>
        <div class="jobs-description-content__text">second</div>
        <div class="jobs-description__content">first</div>
      </body></html>`;
    const doc = parseDocument(html);
    expect(
      firstMatchingSelector(doc, '.jobs-description__content, .jobs-description-content__text')
        ?.textContent,
    ).toBe('first');
  });

  it('firstMatchingSelector returns null when no selector matches', () => {
    const html = `<html><body></body></html>`;
    const doc = parseDocument(html);
    const result = firstMatchingSelector(
      doc,
      '.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, .show-more-less-html__markup',
    );
    expect(result).toBeNull();
  });

  it('firstMatchingSelectors returns the first non-empty list of matches', () => {
    const html = `
      <html><body>
        <div class="jobs-description-content__text">one</div>
        <div class="jobs-description-content__text">two</div>
      </body></html>`;
    const doc = parseDocument(html);
    const matches = firstMatchingSelectors(
      doc,
      '.jobs-description__content, .jobs-description-content__text',
    );
    expect(matches.length).toBe(2);
    expect(matches[0]?.textContent).toBe('one');
    expect(matches[1]?.textContent).toBe('two');
  });
});
