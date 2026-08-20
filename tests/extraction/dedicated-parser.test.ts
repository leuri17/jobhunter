import { describe, expect, it } from 'vitest';

import { parseHTML } from 'linkedom';
import type { Page } from 'playwright';

import { parseDedicatedPage } from '../../src/linkedin/extraction/dedicated-parser.js';
import { DedicatedPageError } from '../../src/linkedin/extraction/errors.js';
import { computeExtractionStatus } from '../../src/linkedin/extraction/status.js';
import { LINKEDIN_SELECTORS } from '../../src/linkedin/selectors.js';
import { loadFixture } from './fixtures/loadFixture.js';

/**
 * Unit tests for `src/linkedin/extraction/dedicated-parser.ts`
 * (TASK-013 Plan Task 11).
 *
 * Strategy mirrors `panel-parser.test.ts`: parse each fixture HTML
 * through `linkedom.parseHTML` (cheap, deterministic) and feed the
 * linkedom document to a minimal Playwright-shaped fake.
 *
 * The dedicated parser does NOT verify the page URL — the URL is
 * built from `sourceJobId` upstream by `buildDetailUrl`, so the
 * test surface is just the 4 field reads + the description's
 * `state: 'visible'` wait.
 */

interface FakeElement {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string;
}

interface FakeDocument {
  readonly querySelector: (selector: string) => FakeElement | null;
  readonly querySelectorAll: (selector: string) => FakeElement[];
}

interface FakePageArgs {
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
 * `.first()` semantics for the description multi-selector.
 */
function firstMatchingSelector(doc: FakeDocument, selectorList: string): FakeElement | null {
  for (const part of selectorList.split(',')) {
    const trimmed = part.trim();
    const node = doc.querySelector(trimmed);
    if (node !== null) return node;
  }
  return null;
}

/**
 * Resolve a single-element selector via `querySelector`. Multi-selector
 * lists are honoured for the dedicated parser because the description
 * selector is a comma-separated list.
 */
function pickNode(doc: FakeDocument, selector: string): FakeElement | null {
  if (selector.includes(',')) {
    return firstMatchingSelector(doc, selector);
  }
  return doc.querySelector(selector);
}

function makeFakePage(args: FakePageArgs): Page {
  const doc = parseDocument(args.html);
  const urlValue = args.url;

  const fakeLocator = (selector: string) => ({
    first: () => fakeLocator(selector),
    textContent: async () => {
      const node = pickNode(doc, selector);
      return node?.textContent ?? null;
    },
    getAttribute: async (name: string) => {
      void name;
      const node = pickNode(doc, selector);
      return node?.getAttribute(name) ?? null;
    },
    waitFor: async (opts: { state: string; timeout: number }) => {
      void opts.state;
      void opts.timeout;
      const node = pickNode(doc, selector);
      if (node === null) {
        // For the dedicated parser, the description must be visible.
        // Any other selector is treated as "exists" (the parser only
        // waits on the description container per the plan).
        if (selector === LINKEDIN_SELECTORS.dedicated.description) {
          throw new Error('description-not-visible');
        }
      }
      return undefined;
    },
  });

  return {
    url: () => urlValue,
    locator: fakeLocator,
  } as unknown as Page;
}

describe('src/linkedin/extraction/dedicated-parser.ts (Wave C)', () => {
  it('parseDedicatedPage reads all 4 fields from dedicated-complete.html (status = complete)', async () => {
    const html = loadFixture('dedicated-complete');
    const page = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/view/3800001/',
    });
    const fields = await parseDedicatedPage(page);
    expect(fields.title).toBe('Director of Engineering');
    expect(fields.company).toContain('Gamma Co');
    expect(fields.location).toContain('New York, NY');
    expect(fields.location).toContain('Hybrid');
    expect(fields.description).toContain('About the job.');
    expect(fields.description).toContain('Lead Gamma Co');
    expect(fields.description).toContain('Director-level role');

    // Service-layer status calc.
    expect(computeExtractionStatus(fields)).toBe('complete');
  });

  it('parseDedicatedPage reads only title + company from dedicated-partial.html (status = partial)', async () => {
    const html = loadFixture('dedicated-partial');
    const page = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/view/3800002/',
    });
    const fields = await parseDedicatedPage(page);
    expect(fields.title).toBe('Minimalist Senior Engineer');
    expect(fields.company).toContain('Delta');
    // Location + description containers are absent from the fixture.
    expect(fields.location).toBeNull();
    expect(fields.description).toBeNull();

    // Service-layer status calc — partial (location + description missing).
    expect(computeExtractionStatus(fields)).toBe('partial');
  });

  it('parseDedicatedPage returns null description (not a thrown error) when description container is absent', async () => {
    // The dedicated parser is more permissive than the panel parser:
    // a missing description field yields a `null` field, which the
    // service layer converts to `partial` (NOT a thrown
    // `DedicatedPageError`). The orchestrator distinguishes "page
    // didn't render" (navigation timeout, raised upstream) from
    // "page rendered with missing fields" (this code path).
    const html = `
      <html><body>
        <h1 class="job-details-jobs-unified-top-card__job-title">Minimal Header</h1>
        <div class="job-details-jobs-unified-top-card__company-name"><a href="/co/">Minimal Co</a></div>
        <!-- location + description missing -->
      </body></html>`;
    const page = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/view/3800003/',
    });
    const fields = await parseDedicatedPage(page);
    expect(fields.title).toBe('Minimal Header');
    expect(fields.company).toContain('Minimal Co');
    expect(fields.location).toBeNull();
    expect(fields.description).toBeNull();
    expect(computeExtractionStatus(fields)).toBe('partial');
  });

  it('parseDedicatedPage respects an aborted AbortSignal', async () => {
    const html = loadFixture('dedicated-complete');
    const page = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/view/3800001/',
    });
    const controller = new AbortController();
    controller.abort();
    let captured: DedicatedPageError | null = null;
    try {
      await parseDedicatedPage(page, { signal: controller.signal });
    } catch (error) {
      if (error instanceof DedicatedPageError) {
        captured = error;
      }
    }
    expect(captured).not.toBeNull();
    if (captured !== null) {
      expect(captured.metadata['reason']).toBe('cancelled');
    }
  });

  it('parseDedicatedPage reads from a custom field map (per Decision 25 wrapper seam)', async () => {
    // Custom fields — verifies the parser honours the optional `fields`
    // override (no inheritance from the default `LINKEDIN_FIELDS`).
    const html = `
      <html><body>
        <span data-test="custom-title">Custom Title</span>
        <span data-test="custom-company">Custom Co</span>
        <span data-test="custom-location">Custom Location</span>
        <span data-test="custom-description">Custom description text.</span>
      </body></html>`;
    const page = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/view/3800009/',
    });
    const fields = await parseDedicatedPage(page, {
      fields: {
        title: '[data-test="custom-title"]',
        company: '[data-test="custom-company"]',
        location: '[data-test="custom-location"]',
        description: '[data-test="custom-description"]',
      },
    });
    expect(fields.title).toBe('Custom Title');
    expect(fields.company).toBe('Custom Co');
    expect(fields.location).toBe('Custom Location');
    expect(fields.description).toBe('Custom description text.');
    expect(computeExtractionStatus(fields)).toBe('complete');
  });

  it('parseDedicatedPage reason="cancelled" surfaces even when the page renders normally (cancellation takes priority)', async () => {
    const html = loadFixture('dedicated-complete');
    const page = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/view/3800001/',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(parseDedicatedPage(page, { signal: controller.signal })).rejects.toThrow(
      DedicatedPageError,
    );
  });

  it('parseDedicatedPage reads the description via the multi-selector list (first-match wins)', async () => {
    // Override the description field to a multi-selector list that
    // matches only the .B selector — the parser should pick the FIRST
    // matching one of the comma-separated list. The middle .A is the
    // one that exists in the fixture.
    const html = `
      <html><body>
        <div class="jobs-description__content">via .A</div>
        <div class="jobs-description-content__text">via .B</div>
      </body></html>`;
    const page = makeFakePage({
      html,
      url: 'https://www.linkedin.com/jobs/view/3800010/',
    });
    const fields = await parseDedicatedPage(page, {
      fields: {
        title: '.missing',
        company: '.missing',
        location: '.missing',
        description:
          '.jobs-description__content, .jobs-description-content__text, .jobs-box__html-content',
      },
    });
    // First-match wins: .jobs-description__content exists first.
    expect(fields.description).toBe('via .A');
    expect(fields.title).toBeNull();
  });
});
