import { describe, expect, it } from 'vitest';

import {
  JOB_ID_HREF_PATTERN,
  LINKEDIN_FIELDS,
  LINKEDIN_SELECTORS,
  LINKEDIN_SELECTORS_MAP_VERSION,
  OVERLAY_DISMISSAL_STRATEGY,
} from '../../src/linkedin/selectors.js';

describe('src/linkedin/selectors — ', () => {
  it('LINKEDIN_SELECTORS_MAP_VERSION === 2 (bumped in  for panel + dedicated)', () => {
    expect(LINKEDIN_SELECTORS_MAP_VERSION).toBe(2);
  });

  it('exposes the six selector groups after ', () => {
    const groupKeys = Object.keys(LINKEDIN_SELECTORS).sort();
    expect(groupKeys).toEqual([
      'cards',
      'dedicated',
      'endOfResults',
      'loadMore',
      'overlays',
      'panel',
    ]);
  });

  it('cards group carries the documented keys', () => {
    expect(Object.keys(LINKEDIN_SELECTORS.cards).sort()).toEqual([
      'anchor',
      'jobIdAttribute',
      'listItem',
      'listItemAlt',
    ]);
    expect(LINKEDIN_SELECTORS.cards.listItem).toBe('li.jobs-search-results__list-item');
    expect(LINKEDIN_SELECTORS.cards.jobIdAttribute).toBe('data-occludable-job-id');
    expect(LINKEDIN_SELECTORS.cards.anchor).toBe('a[href*="/jobs/view/"]');
  });

  it('loadMore group carries button + sentinel', () => {
    expect(Object.keys(LINKEDIN_SELECTORS.loadMore).sort()).toEqual(['button', 'sentinel']);
    expect(LINKEDIN_SELECTORS.loadMore.button).toContain('infinite-scroller__show-more-button');
    expect(LINKEDIN_SELECTORS.loadMore.sentinel).toContain('infinite-scroller__page-end');
  });

  it('endOfResults group carries noResults + explicitEnd', () => {
    expect(Object.keys(LINKEDIN_SELECTORS.endOfResults).sort()).toEqual([
      'explicitEnd',
      'noResults',
    ]);
  });

  it('overlays group covers loginModal + joinModal + cookieConsent + genericModal + closeButton', () => {
    expect(Object.keys(LINKEDIN_SELECTORS.overlays).sort()).toEqual([
      'closeButton',
      'cookieConsent',
      'genericModal',
      'joinModal',
      'loginModal',
    ]);
  });

  it('every overlay has a default dismissal strategy', () => {
    const overlayKeys = Object.keys(LINKEDIN_SELECTORS.overlays).sort();
    const strategyKeys = Object.keys(OVERLAY_DISMISSAL_STRATEGY).sort();
    expect(strategyKeys).toEqual(overlayKeys);
  });

  it('OVERLAY_DISMISSAL_STRATEGY uses only valid strategy values', () => {
    const validStrategies = new Set(['close', 'escape', 'outside_click', 'accept', 'reject']);
    for (const value of Object.values(OVERLAY_DISMISSAL_STRATEGY)) {
      expect(validStrategies.has(value)).toBe(true);
    }
  });

  it('loginModal dismissal strategy defaults to close', () => {
    expect(OVERLAY_DISMISSAL_STRATEGY.loginModal).toBe('close');
    expect(OVERLAY_DISMISSAL_STRATEGY.joinModal).toBe('close');
    expect(OVERLAY_DISMISSAL_STRATEGY.cookieConsent).toBe('accept');
    expect(OVERLAY_DISMISSAL_STRATEGY.genericModal).toBe('escape');
    expect(OVERLAY_DISMISSAL_STRATEGY.closeButton).toBe('close');
  });

  it('JOB_ID_HREF_PATTERN captures LinkedIn numeric job IDs (absolute + relative paths)', () => {
    const samples = [
      ['https://www.linkedin.com/jobs/view/123456789/', '123456789'],
      ['https://linkedin.com/jobs/view/123456/', '123456'],
      ['/jobs/view/123456/', '123456'],
    ] as const;
    for (const [href, expected] of samples) {
      const match = JOB_ID_HREF_PATTERN.exec(href);
      expect(match).not.toBeNull();
      if (match !== null) {
        expect(match[1]).toBe(expected);
      }
    }
  });

  it('JOB_ID_HREF_PATTERN captures both relative and absolute LinkedIn URLs with 6+ digits', () => {
    expect(JOB_ID_HREF_PATTERN.exec('https://www.linkedin.com/jobs/view/123456789/')?.[1]).toBe(
      '123456789',
    );
    expect(JOB_ID_HREF_PATTERN.exec('/jobs/view/123456/')?.[1]).toBe('123456');
    expect(JOB_ID_HREF_PATTERN.exec('/jobs/view/1234567')?.[1]).toBe('1234567');
  });

  it('JOB_ID_HREF_PATTERN rejects short IDs (< 6 digits) and non-LinkedIn hrefs', () => {
    const rejects = [
      '/jobs/view/12345/', // 5 digits
      '/jobs/view/abc/', // non-numeric
      'https://example.com/jobs/view/123456789/', // wrong host
      '/jobs/123456', // no `/view/` segment
      '/jobs/view/999/', // 3 digits
    ];
    for (const href of rejects) {
      expect(JOB_ID_HREF_PATTERN.exec(href)).toBeNull();
    }
  });
});

describe('src/linkedin/selectors —  (panel + dedicated + FIELDS map)', () => {
  it('panel group carries container + titleElement + titleAnchor + company + location + description', () => {
    expect(Object.keys(LINKEDIN_SELECTORS.panel).sort()).toEqual([
      'company',
      'container',
      'description',
      'location',
      'titleAnchor',
      'titleElement',
    ]);
    expect(LINKEDIN_SELECTORS.panel.container).toBe('div.jobs-search__job-details--wrapper');
    expect(LINKEDIN_SELECTORS.panel.titleElement).toBe(
      '.job-details-jobs-unified-top-card__job-title',
    );
    expect(LINKEDIN_SELECTORS.panel.titleAnchor).toBe(
      '.job-details-jobs-unified-top-card__job-title a',
    );
    expect(LINKEDIN_SELECTORS.panel.company).toBe(
      '.job-details-jobs-unified-top-card__company-name',
    );
    expect(LINKEDIN_SELECTORS.panel.location).toBe(
      '.job-details-jobs-unified-top-card__primary-description-container',
    );
  });

  it('panel.description is a multi-selector list covering 4 LinkedIn-rendered shapes', () => {
    const description = LINKEDIN_SELECTORS.panel.description;
    expect(description).toContain('.jobs-description__content');
    expect(description).toContain('.jobs-box__html-content');
    expect(description).toContain('.jobs-description-content__text');
    expect(description).toContain('.show-more-less-html__markup');
  });

  it('dedicated group carries title + company + location + description', () => {
    expect(Object.keys(LINKEDIN_SELECTORS.dedicated).sort()).toEqual([
      'company',
      'description',
      'location',
      'title',
    ]);
    expect(LINKEDIN_SELECTORS.dedicated.title).toBe(
      '.job-details-jobs-unified-top-card__job-title',
    );
    expect(LINKEDIN_SELECTORS.dedicated.company).toBe(
      '.job-details-jobs-unified-top-card__company-name a',
    );
    expect(LINKEDIN_SELECTORS.dedicated.location).toBe(
      '.job-details-jobs-unified-top-card__primary-description-container',
    );
  });

  it('dedicated.description matches the panel.description shape (uniform top-card DOM)', () => {
    expect(LINKEDIN_SELECTORS.dedicated.description).toBe(LINKEDIN_SELECTORS.panel.description);
  });

  it('LINKEDIN_FIELDS reuses the panel selectors for all 4 fields', () => {
    expect(Object.keys(LINKEDIN_FIELDS).sort()).toEqual([
      'company',
      'description',
      'location',
      'title',
    ]);
    expect(LINKEDIN_FIELDS.title).toBe(LINKEDIN_SELECTORS.panel.titleElement);
    expect(LINKEDIN_FIELDS.company).toBe(LINKEDIN_SELECTORS.panel.company);
    expect(LINKEDIN_FIELDS.location).toBe(LINKEDIN_SELECTORS.panel.location);
    expect(LINKEDIN_FIELDS.description).toBe(LINKEDIN_SELECTORS.panel.description);
  });

  it('LINKEDIN_FIELDS is a Readonly Record (frozen shape)', () => {
    const fieldKeys: ReadonlyArray<keyof typeof LINKEDIN_FIELDS> = [
      'title',
      'company',
      'location',
      'description',
    ];
    expect(fieldKeys).toHaveLength(4);
    for (const key of fieldKeys) {
      expect(typeof LINKEDIN_FIELDS[key]).toBe('string');
      expect(LINKEDIN_FIELDS[key].length).toBeGreaterThan(0);
    }
  });
});
