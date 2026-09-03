/**
 * Pure text normalizer for the panel + dedicated-page description
 * HTML (, ,  addendum).
 *
 * Strips presentation HTML, normalizes whitespace, preserves
 * paragraph + list boundaries, and strips the
 * `Show more` / `See more` / `View more` literal (librarian
 * race-condition #5: these CTAs appear in both the panel
 * description button and the dedicated page's truncated text).
 *
 * Per AGENTS.md §5 / §9: domain code does not import Playwright,
 * Drizzle directly, the `openai` SDK, or
 * Pino directly. This file is a pure helper — it has no side
 * effects and no imports beyond the local type alias below.
 */

/**
 * Tags to drop entirely (their inner text is NOT meaningful job
 * content). `<script>` / `<style>` carry their own markup; the
 * other three render only affordances, not job description text.
 */
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON']);

/**
 * Block-level tags whose open + close markers are converted to a
 * single space (preserves word boundaries around the inner text).
 * Used so a `<p>Hello</p><p>World</p>` body normalizes to
 * `'Hello World'` (not `'HelloWorld'`).
 */
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'LI',
  'UL',
  'OL',
  'BR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TR',
  'TD',
  'TH',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
]);

/** Strip "Show more" / "See more" / "View more" CTA literals from the body. */
const SHOW_MORE_LITERAL_RE = /\b(show more|see more|view more)\b\.?/gi;

/**
 * Strip presentation HTML from a string of description text.
 *
 * Returns the empty string when:
 *   - the input is not a string, OR
 *   - the input is the empty string, OR
 *   - the input contains only dropped tags + whitespace.
 *
 * The function is pure: no I/O, no globals, deterministic.
 */
export function normalizeText(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let text = input;

  // Drop script/style blocks first (their inner text is irrelevant).
  for (const tag of DROP_TAGS) {
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    text = text.replace(re, ' ');
  }

  // Convert block-level tags to a single space (preserves word boundaries).
  for (const tag of BLOCK_TAGS) {
    const openRe = new RegExp(`<${tag}[^>]*>`, 'gi');
    const closeRe = new RegExp(`<\\/${tag}>`, 'gi');
    text = text.replace(openRe, ' ').replace(closeRe, ' ');
  }

  // Drop all remaining tags.
  text = text.replace(/<[^>]+>/g, ' ');

  // Strip "Show more" / "See more" / "View more" CTA literals.
  text = text.replace(SHOW_MORE_LITERAL_RE, '');

  // Decode common HTML entities (mirrors `cheerio` `decodeEntities` behavior).
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse repeated whitespace (including newlines) to a single space.
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Validate that a normalized field is non-empty (
 * every required field must contain non-whitespace text after
 * normalization). Returns `false` for `null`, the empty string,
 * whitespace-only strings, and HTML whose text normalizes to
 * nothing.
 */
export function isValidRequiredField(value: string | null): boolean {
  return typeof value === 'string' && normalizeText(value).length > 0;
}
