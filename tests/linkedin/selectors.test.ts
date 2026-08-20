import { describe, expect, it } from 'vitest';

import {
  JOB_ID_HREF_PATTERN,
  LINKEDIN_SELECTORS,
  LINKEDIN_SELECTORS_MAP_VERSION,
  OVERLAY_DISMISSAL_STRATEGY,
} from '../../src/linkedin/selectors.js';

describe('src/linkedin/selectors — Wave A', () => {
  it('LINKEDIN_SELECTORS_MAP_VERSION === 1', () => {
    expect(LINKEDIN_SELECTORS_MAP_VERSION).toBe(1);
  });

  it('exposes the four required selector groups', () => {
    const groupKeys = Object.keys(LINKEDIN_SELECTORS).sort();
    expect(groupKeys).toEqual(['cards', 'endOfResults', 'loadMore', 'overlays']);
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
