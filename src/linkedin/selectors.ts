/**
 * Centralised LinkedIn selector map (TASK-012 Plan Task 3, SPEC §21.3).
 *
 * Pure data — no Playwright import. Replace selectors here when the
 * LinkedIn DOM drifts; the orchestrator's `recordScraperError` calls
 * surface the failing selector via `metadata.selector` so the
 * diagnostic message identifies the breakage.
 *
 * Selector naming convention: `<group>.<element>` (e.g.
 * `cards.listItem`, `loadMore.button`, `overlays.loginModal`). Each
 * group is `readonly` so accidental mutation is caught at compile
 * time. The `selectorsMapVersion` constant is bumped on any change to
 * the map; refresh-policy scripts can compare versions to know which
 * saved fixture HTML needs re-saving.
 *
 * Per the Wave A brief + Decision 15: card discovery walks multiple
 * fallback selectors (LinkedIn renders both old and new DOM shapes
 * during A/B rollouts). The library is intentionally minimal in Wave A;
 * Wave C may add additional keys without bumping the version constant.
 */
export const LINKEDIN_SELECTORS_MAP_VERSION = 1 as const;

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
