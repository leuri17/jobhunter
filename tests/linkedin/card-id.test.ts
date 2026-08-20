import { describe, expect, it } from 'vitest';

import { parseHTML } from 'linkedom';

import {
  parseCardJobId,
  type CardIdDocument,
  type MinimalElement,
} from '../../src/linkedin/card-id.js';
import { LINKEDIN_SELECTORS } from '../../src/linkedin/selectors.js';

interface LinkedomElement {
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => LinkedomElement | null;
}

interface LinkedomDocument {
  readonly querySelector: (selector: string) => LinkedomElement | null;
}

function adapt(document: LinkedomDocument): CardIdDocument {
  return {
    querySelector: (selector: string): MinimalElement | null => {
      const node = document.querySelector(selector);
      if (node === null) return null;
      const adapter: MinimalElement = {
        getAttribute: (name: string) => node.getAttribute(name),
        querySelector: (child: string): MinimalElement | null => {
          const nested = node.querySelector(child);
          if (nested === null) return null;
          return {
            getAttribute: (name: string) => nested.getAttribute(name),
            querySelector: (grandchild: string): MinimalElement | null => {
              const deep = nested.querySelector(grandchild);
              if (deep === null) return null;
              return {
                getAttribute: (name: string) => deep.getAttribute(name),
                querySelector: () => null,
              };
            },
          };
        },
      };
      return adapter;
    },
  };
}

describe('src/linkedin/card-id — Wave A', () => {
  function makeDocument(html: string): {
    readonly document: CardIdDocument;
    readonly firstCard: () => MinimalElement | null;
  } {
    const { document: rawDoc } = parseHTML(html);
    const linkedomDoc = rawDoc as unknown as LinkedomDocument;
    return {
      document: adapt(linkedomDoc),
      firstCard: () => {
        const primary = linkedomDoc.querySelector(LINKEDIN_SELECTORS.cards.listItem);
        if (primary !== null) {
          return {
            getAttribute: (name: string) => primary.getAttribute(name),
            querySelector: (selector: string): MinimalElement | null => {
              const nested = primary.querySelector(selector);
              if (nested === null) return null;
              return {
                getAttribute: (name: string) => nested.getAttribute(name),
                querySelector: () => null,
              };
            },
          };
        }
        const alt = linkedomDoc.querySelector(LINKEDIN_SELECTORS.cards.listItemAlt);
        if (alt === null) return null;
        return {
          getAttribute: (name: string) => alt.getAttribute(name),
          querySelector: (selector: string): MinimalElement | null => {
            const nested = alt.querySelector(selector);
            if (nested === null) return null;
            return {
              getAttribute: (name: string) => nested.getAttribute(name),
              querySelector: () => null,
            };
          },
        };
      },
    };
  }

  it('returns the data-occludable-job-id value when present', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <a href="/jobs/view/111111/" data-occludable-job-id="999999">link</a>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBe('999999');
  });

  it('falls back to the regex-extracted href ID when the data attribute is absent', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <a href="/jobs/view/123456/">link</a>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBe('123456');
  });

  it('returns null when the card has no anchor and no data attribute', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <span>no anchor here</span>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBeNull();
  });

  it('returns null for an anchor that points at a non-LinkedIn href', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <a href="https://example.com/foo">not LinkedIn</a>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBeNull();
  });

  it('returns null for an href whose captured ID is too short', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <a href="/jobs/view/12345/">short ID</a>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBeNull();
  });

  it('prefers the data attribute over the href', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <a href="/jobs/view/111111/" data-occludable-job-id="222222">prefer me</a>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBe('222222');
  });

  it('returns null when the element argument is null', () => {
    const { document } = makeDocument('<html><body></body></html>');
    expect(parseCardJobId(null, document)).toBeNull();
  });

  it('returns null when the element argument is not an object', () => {
    const { document } = makeDocument('<html><body></body></html>');
    expect(parseCardJobId(42, document)).toBeNull();
    expect(parseCardJobId('not an element', document)).toBeNull();
  });

  it('returns null when document is null and the element has no anchor inside', () => {
    const { firstCard } = makeDocument(`
      <html><body>
        <li class="jobs-search-results__list-item">
          <span>plain text</span>
        </li>
      </body></html>`);
    expect(parseCardJobId(firstCard(), null)).toBeNull();
  });

  it('strips whitespace from the data-occludable-job-id value', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <a href="/jobs/view/111111/" data-occludable-job-id="  424242  ">spaced</a>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBe('424242');
  });

  it('returns null when data-occludable-job-id is empty', () => {
    const html = `
      <html><body>
        <li class="jobs-search-results__list-item">
          <a href="/jobs/view/111111/" data-occludable-job-id="">empty</a>
        </li>
      </body></html>`;
    const { document, firstCard } = makeDocument(html);
    expect(parseCardJobId(firstCard(), document)).toBe('111111');
  });

  it('uses the alt selector path when the primary list-item class is absent', () => {
    const html = `
      <html><body>
        <div class="job-search-card">
          <a href="/jobs/view/777777/">alt path</a>
        </div>
      </body></html>`;
    const { document } = makeDocument(html);
    const altCard = document.querySelector(LINKEDIN_SELECTORS.cards.listItemAlt);
    expect(parseCardJobId(altCard, document)).toBe('777777');
  });
});
