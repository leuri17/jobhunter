/**
 * Centralised LinkedIn selector map (TASK-012 Plan Task 3, SPEC §21.3 + TASK-013 §22).
 *
 * Pure data — no Playwright import. Replace selectors here when the
 * LinkedIn DOM drifts; the orchestrator's `recordScraperError` calls
 * surface the failing selector via `metadata.selector` so the
 * diagnostic message identifies the breakage.
 *
 * Selector naming convention: `<group>.<element>` (e.g.
 * `cards.listItem`, `loadMore.button`, `overlays.loginModal`,
 * `panel.titleElement`). Each group is `readonly` so accidental
 * mutation is caught at compile time. The `selectorsMapVersion`
 * constant is bumped on any change to the map; refresh-policy
 * scripts can compare versions to know which saved fixture HTML
 * needs re-saving.
 *
 * Per the Wave A brief + Decision 15: card discovery walks multiple
 * fallback selectors (LinkedIn renders both old and new DOM shapes
 * during A/B rollouts). Wave C adds the `panel.*` + `dedicated.*`
 * groups used by TASK-013's job-detail parsers (Decision 25).
 */
export const LINKEDIN_SELECTORS_MAP_VERSION = 2 as const;

export const LINKEDIN_SELECTORS = {
  cards: {
    /** Primary result-card container (LinkedIn's current rendering). */
    listItem: 'li.jobs-search-results__list-item',
    /** Alternate selector for lazy-rendered variants + older DOM shapes. */
    listItemAlt: 'div.job-search-card',
    /** Anchor inside a card whose href contains `/jobs/view/<digits>`. */
    anchor: 'a[href*="/jobs/view/"]',
    /** LinkedIn data attribute carrying the canonical job ID on the anchor. */
    jobIdAttribute: 'data-occludable-job-id',
  },
  loadMore: {
    /** "See more jobs" button. May be absent on the last page. */
    button: 'button.infinite-scroller__show-more-button',
    /** Sentinel element the LinkedIn renderer adds at page end. */
    sentinel: 'div.infinite-scroller__page-end',
  },
  endOfResults: {
    /** "No results" message — single-source fallback when cardCount === 0. */
    noResults: 'p.artdeco-empty-state__message',
    /** Explicit end-of-results container. */
    explicitEnd: 'div.jobs-search-no-results',
  },
  overlays: {
    loginModal: 'div[data-modal="login"]',
    joinModal: 'div[data-modal="join"]',
    cookieConsent: 'div#artdeco-global-alert-container',
    genericModal: 'div[data-test-modal-container]',
    closeButton: 'button[aria-label="Dismiss"]',
  },
  /**
   * Search-detail panel selectors (SPEC §22.6). Selected when the user clicks
   * a card on the search page; the panel renders the job's detail DOM inline
   * in a side pane rather than navigating away.
   *
   * `titleElement` is the `<h1>` (text === anchor text); `titleAnchor` is
   * the inner `<a>` whose `href` carries the canonical `/jobs/view/<id>/`
   * path the panel-verification loop reads (Decision 7 + Decision 26).
   *
   * `description` is a multi-selector list (comma-separated) covering the
   * 4 known LinkedIn-rendered shapes (librarian research — LinkedIn
   * A/B-tests the description container).
   */
  panel: {
    /** Wrapper container the panel root renders into. */
    container: 'div.jobs-search__job-details--wrapper',
    /** `<h1>` whose text equals the displayed job title. */
    titleElement: '.job-details-jobs-unified-top-card__job-title',
    /** `<a>` inside the title element — its `href` carries the job ID. */
    titleAnchor: '.job-details-jobs-unified-top-card__job-title a',
    /** Company name (single text node). */
    company: '.job-details-jobs-unified-top-card__company-name',
    /** Primary description container (location + secondary metadata). */
    location: '.job-details-jobs-unified-top-card__primary-description-container',
    /**
     * Description body — multi-selector list (LinkedIn rotates between
     * `jobs-description__content`, `jobs-box__html-content`,
     * `jobs-description-content__text`, and `show-more-less-html__markup`).
     * Playwright's `.first()` honours the first match.
     */
    description:
      '.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, .show-more-less-html__markup',
  },
  /**
   * Dedicated job-page selectors (SPEC §22.7). Used when the search-detail
   * panel fails (timeout, mismatch, missing description, undismissable
   * overlay). The dedicated page reuses the unified top-card BEM classes
   * (per librarian research) — selectors are identical to the panel's
   * `*Element` fields. `title` + `company` resolve via the same selectors
   * for both views (Decision 25).
   */
  dedicated: {
    title: '.job-details-jobs-unified-top-card__job-title',
    company: '.job-details-jobs-unified-top-card__company-name a',
    location: '.job-details-jobs-unified-top-card__primary-description-container',
    description:
      '.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, .show-more-less-html__markup',
  },
} as const;

/** Type-level key of any group in `LINKEDIN_SELECTORS`. */
export type LinkedinSelectorGroup = keyof typeof LINKEDIN_SELECTORS;

/** Type-level key of any element within a selector group. */
export type LinkedinSelectorKey = {
  readonly [
    G in LinkedinSelectorGroup
  ]: `${G & string}.${keyof (typeof LINKEDIN_SELECTORS)[G] & string}`;
}[LinkedinSelectorGroup];

/** Default strategy for dismissing each known overlay. */
export const OVERLAY_DISMISSAL_STRATEGY: Readonly<
  Record<
    keyof typeof LINKEDIN_SELECTORS.overlays,
    'close' | 'escape' | 'outside_click' | 'accept' | 'reject'
  >
> = {
  loginModal: 'close',
  joinModal: 'close',
  cookieConsent: 'accept',
  genericModal: 'escape',
  closeButton: 'close',
};

/**
 * Regex that captures the LinkedIn numeric job ID in an anchor href.
 * Anchored to the start (optionally with an `https://*.linkedin.com`
 * host) so non-LinkedIn URLs are rejected by `parseCardJobId`.
 */
export const JOB_ID_HREF_PATTERN =
  /^(?:https?:\/\/(?:[\w-]+\.)?linkedin\.com)?\/jobs\/view\/(\d{6,})\/?$/;

/**
 * Shared field → selector map (TASK-013 Decision 25).
 *
 * Panel + dedicated-page parsers reuse the unified top-card DOM, so the
 * field selectors are identical — this constant centralises the
 * mapping in one place. The map is `readonly` and exports each
 * selector via a typed key so the parsers' `options.fields` parameter
 * stays structurally compatible with the default.
 *
 * The values come from `LINKEDIN_SELECTORS.panel` (rather than the
 * `dedicated` group) because the dedicated page reuses the unified
 * top-card BEM classes — same DOM, different URL.
 */
export const LINKEDIN_FIELDS: Readonly<
  Record<'title' | 'company' | 'location' | 'description', string>
> = {
  title: LINKEDIN_SELECTORS.panel.titleElement,
  company: LINKEDIN_SELECTORS.panel.company,
  location: LINKEDIN_SELECTORS.panel.location,
  description: LINKEDIN_SELECTORS.panel.description,
};
