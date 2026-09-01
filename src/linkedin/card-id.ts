/**
 * Pure card-ID parser.
 *
 * `parseCardJobId(element, document)` extracts the canonical LinkedIn
 * job ID from a card element using two priority paths:
 *   1. The `data-occludable-job-id` attribute on the anchor element
 *      (LinkedIn's most stable source — survives lazy-render re-renders).
 *   2. A regex match on `<a href="/jobs/view/<digits>">` (fallback
 *      when the data attribute is absent or stale).
 *
 * The function is PURE: it never throws, never logs, never touches
 * Playwright. The orchestrator passes a linkedom-backed `Document` so
 * unit tests can exercise the parser without launching Chromium.
 *
 * Returns `null` on every miss — the orchestrator writes a
 * `discoveryErrors` row for those.
 */
import { LINKEDIN_SELECTORS, JOB_ID_HREF_PATTERN } from './selectors.js';

const MIN_JOB_ID_DIGITS = 6;
const MAX_JOB_ID_DIGITS = 12;

export interface MinimalElement {
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => MinimalElement | null;
}

/**
 * Document surface used by `parseCardJobId` — narrow on purpose so the
 * orchestrator can pass either a linkedom `document` or any DOM-compatible
 * implementation (e.g. jsdom) without coupling to a specific library.
 */
export interface CardIdDocument {
  readonly querySelector: (selectors: string) => MinimalElement | null;
}

/**
 * Extract the canonical LinkedIn job ID from `element`.
 * Returns `string | null`.
 */
export function parseCardJobId(element: unknown, document: CardIdDocument | null): string | null {
  const candidate = findAnchor(element, document);
  if (candidate === null) return null;
  const fromAttribute = readJobIdAttribute(candidate);
  if (fromAttribute !== null) return fromAttribute;
  const fromHref = readJobIdFromHref(candidate);
  return fromHref;
}

/** Locate the card's anchor: prefer a direct anchor inside `element`,
 *  fall back to the closest matching anchor via `document`. */
function findAnchor(element: unknown, document: CardIdDocument | null): MinimalElement | null {
  if (isMinimalElement(element)) {
    const directAnchor = element.querySelector(LINKEDIN_SELECTORS.cards.anchor);
    if (directAnchor !== null) return directAnchor;
  }
  if (document !== null) {
    const fallback = document.querySelector(LINKEDIN_SELECTORS.cards.anchor);
    if (fallback !== null) return fallback;
  }
  return null;
}

/** Read the canonical ID from the data attribute when present. */
function readJobIdAttribute(anchor: MinimalElement): string | null {
  const raw = anchor.getAttribute(LINKEDIN_SELECTORS.cards.jobIdAttribute);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!isValidJobId(trimmed)) return null;
  return trimmed;
}

/** Read the canonical ID from the anchor's href via the regex. */
function readJobIdFromHref(anchor: MinimalElement): string | null {
  const href = anchor.getAttribute('href');
  if (href === null || href === '') return null;
  const match = JOB_ID_HREF_PATTERN.exec(href);
  if (match === null) return null;
  // `match[1]` is guaranteed by the regex's capture group.
  const id = match[1];
  if (id === undefined || !isValidJobId(id)) return null;
  return id;
}

/** LinkedIn job IDs are 6–12 digits (no leading zeros in practice). */
function isValidJobId(value: string): boolean {
  if (value.length < MIN_JOB_ID_DIGITS || value.length > MAX_JOB_ID_DIGITS) return false;
  return /^\d{6,12}$/.test(value);
}

function isMinimalElement(value: unknown): value is MinimalElement {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<MinimalElement>;
  return (
    typeof candidate.getAttribute === 'function' && typeof candidate.querySelector === 'function'
  );
}
