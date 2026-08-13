import { hashString } from './hashing.js';

const BOM = '\uFEFF';

/**
 * Normalize extracted CV text into a deterministic canonical form.
 *
 * Transformations applied, in order:
 *  1. Strip a leading UTF-8 BOM if present.
 *  2. Canonicalize line endings (`\r\n` and `\r` → `\n`).
 *  3. Trim trailing whitespace from every line.
 *  4. Collapse runs of 3+ consecutive blank lines down to 2.
 *  5. Strip trailing blank lines from the end of the document.
 *
 * Note on rule 4: 3+ blank lines collapse to 2. This is intentional
 * (a markdown file with 3 blank lines between sections is normalized to
 * 2) but is not documented in SPEC.md. Callers that need to preserve
 * arbitrary blank-line counts should call the underlying helpers
 * instead of this top-level normalizer.
 */
export function normalizeExtractedText(input: string): string {
  if (typeof input !== 'string') return '';
  let text = input;
  if (text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line === '') {
      blankRun += 1;
      if (blankRun <= 2) {
        collapsed.push(line);
      }
    } else {
      blankRun = 0;
      collapsed.push(line);
    }
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') {
    collapsed.pop();
  }
  return collapsed.join('\n');
}

export function hashExtractedText(text: string): string {
  return hashString(normalizeExtractedText(text));
}

export interface ExtractedTextStats {
  readonly normalizedLength: number;
  readonly lineCount: number;
}

export function calculateExtractedTextStats(text: string): ExtractedTextStats {
  const normalized = normalizeExtractedText(text);
  if (normalized === '') {
    return { normalizedLength: 0, lineCount: 0 };
  }
  const lines = normalized.split('\n');
  return {
    normalizedLength: normalized.length,
    lineCount: lines.length,
  };
}
