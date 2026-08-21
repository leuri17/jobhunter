/**
 * Width-aware text truncation for inspection tables (SPEC §34.6).
 *
 * Pure helper. No I/O, no platform-specific behavior. The
 * ellipsis character is U+2026 HORIZONTAL ELLIPSIS so consumers can
 * grep for it and so the truncated form stays visually distinct
 * from the original.
 *
 * The stored value is NEVER mutated (SPEC §34.6 "preserve full
 * stored values") — this helper only renders a truncated display
 * string; the original is untouched. `jobs show` always prints the
 * full value via `formatJobShow` (no width budget).
 */

import { InspectionValidationError } from './errors.js';

const ELLIPSIS = '\u2026';

/**
 * Truncate `text` to at most `maxWidth` characters, replacing the
 * tail with U+2026 HORIZONTAL ELLIPSIS when truncation occurs.
 *
 * Behavior:
 *   - `text.length <= maxWidth` → returns `text` unchanged.
 *   - `maxWidth <= 0`           → returns `''` (nothing to show).
 *   - `text.length > maxWidth`  → returns `text.slice(0, maxWidth - 1) + '…'`
 *                                 (the last character is always the ellipsis).
 *   - `maxWidth` not a non-negative integer
 *                               → throws `InspectionValidationError`.
 *
 * Note: the non-negative-integer check guards against the
 * `truncate_invalid_max_width` failure mode called out in SPEC
 * §34.6. The caller (`selectColumns`) guarantees a non-negative
 * integer; the guard exists for the rare direct-usage case in
 * tests + the formatter's own defense-in-depth.
 */
export function truncateWithEllipsis(text: string, maxWidth: number): string {
  if (!Number.isInteger(maxWidth) || maxWidth < 0) {
    throw new InspectionValidationError(
      'truncate_invalid_max_width',
      `truncateWithEllipsis: maxWidth must be a non-negative integer (received ${maxWidth}).`,
      { maxWidth },
    );
  }
  if (maxWidth <= 0) return '';
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + ELLIPSIS;
}
