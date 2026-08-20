import { describe, expect, it } from 'vitest';

import { JOB_ID_HREF_PATTERN } from '../../src/linkedin/selectors.js';

import { loadFixture, loadFixtureAsDocument, type FixtureName } from './fixtures/loadFixture.js';

/**
 * Narrowed view of a linkedom element. The real `Element` interface
 * has ~50 properties; the tests only need `getAttribute` +
 * `textContent` + `querySelector` + `querySelectorAll`.
 */
interface FakeElement {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string | null;
  readonly querySelector: (selector: string) => FakeElement | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    [index: number]: FakeElement;
  };
}

const FIXTURES: readonly FixtureName[] = [
  'search-results-basic',
  'search-results-no-results',
  'search-results-with-modal',
  // Wave C — TASK-013 extraction layer
  'panel-complete',
  'panel-partial',
  'panel-mismatch',
  'panel-parse-failure',
  'dedicated-complete',
  'dedicated-partial',
];

function asElement(node: unknown): FakeElement {
  return node as unknown as FakeElement;
}

function toElements(iterable: {
  readonly length: number;
  [index: number]: unknown;
}): FakeElement[] {
  const out: FakeElement[] = [];
  for (let i = 0; i < iterable.length; i += 1) {
    out.push(asElement(iterable[i]));
  }
  return out;
}

describe('tests/linkedin/fixtures (Wave E)', () => {
  it.each(FIXTURES)('loadFixture(%j) returns a non-empty string', (name) => {
    const html = loadFixture(name);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    // Every fixture must be a valid HTML document with the basic
    // DOCTYPE + html + body tags. linkedom can parse any well-formed
    // variant; this guards against accidental empty-file commits.
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html.toLowerCase()).toContain('<body');
  });

  it('search-results-basic: 5 cards via the data-occludable-job-id selector', () => {
    const doc = loadFixtureAsDocument('search-results-basic');
    const cards = toElements(doc.querySelectorAll('li.jobs-search-results__list-item'));
    expect(cards.length).toBe(5);
    // The card-id parser reads `data-occludable-job-id` first. Confirm
    // every card has the attribute set to a 7+ digit id.
    for (const card of cards) {
      const id = card.getAttribute('data-occludable-job-id');
      expect(id).toMatch(/^\d{7,}$/);
    }
  });

  it('search-results-basic: each card has an anchor with /jobs/view/<id>/', () => {
    const doc = loadFixtureAsDocument('search-results-basic');
    const anchors = toElements(doc.querySelectorAll('a[href*="/jobs/view/"]'));
    expect(anchors.length).toBe(5);
    // The href is a FULL LinkedIn URL (e.g. `https://www.linkedin.com/jobs/view/4000001/`)
    // — the production `JOB_ID_HREF_PATTERN` accepts both full URLs
    // AND path-only hrefs (the regex allows an optional `https://*.linkedin.com`
    // prefix). Importing the production regex keeps this test in sync
    // with the orchestrator's parser.
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      expect(JOB_ID_HREF_PATTERN.test(href)).toBe(true);
    }
  });

  it('search-results-basic: each card has the documented metadata (title, company, location)', () => {
    const doc = loadFixtureAsDocument('search-results-basic');
    const cards = toElements(doc.querySelectorAll('li.jobs-search-results__list-item'));
    for (const card of cards) {
      const title = card.querySelector('h3.base-search-card__title');
      const subtitle = card.querySelector('h4.base-search-card__subtitle');
      const location = card.querySelector('span.job-search-card__location');
      expect((title?.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect((subtitle?.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect((location?.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('search-results-no-results: 0 cards + 1 no-results sentinel', () => {
    const doc = loadFixtureAsDocument('search-results-no-results');
    const cards = toElements(doc.querySelectorAll('li.jobs-search-results__list-item'));
    expect(cards.length).toBe(0);
    const sentinel = asElement(doc.querySelector('p.artdeco-empty-state__message'));
    expect((sentinel.textContent ?? '').toLowerCase()).toContain('no matching jobs');
  });

  it('search-results-with-modal: 3 cards + 1 modal overlay with a dismiss button', () => {
    const doc = loadFixtureAsDocument('search-results-with-modal');
    const cards = toElements(doc.querySelectorAll('li.jobs-search-results__list-item'));
    expect(cards.length).toBe(3);
    const modal = asElement(doc.querySelector('div[data-modal="login"]'));
    expect(modal).not.toBeNull();
    const dismissBtn = modal.querySelector('button[aria-label="Dismiss"]');
    expect(dismissBtn).not.toBeNull();
  });

  it('search-results-with-modal: 3 unique card ids (no duplicates)', () => {
    const doc = loadFixtureAsDocument('search-results-with-modal');
    const cards = toElements(doc.querySelectorAll('li.jobs-search-results__list-item'));
    const ids = cards.map((c) => c.getAttribute('data-occludable-job-id'));
    expect(new Set(ids).size).toBe(3);
  });
});
