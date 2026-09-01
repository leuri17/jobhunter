import { ALIAS_MAP } from './keyword-aliases.js';

/**
 * Shared deterministic keyword normalization for the filter engine
 *
 * The matcher's normalization chain is a strict superset of
 * `normalizeForHashing` from `content-hash.ts`:
 *
 *   1. Unicode NFKC (`String.prototype.normalize('NFKC')`)
 *   2. Lowercase
 *   3. Fold the four punctuation separators `.`, `-`, `_`, `/` to a single
 *      space (so `node.js`, `node-js`, `node_js`, `node/js`, `node js`
 *      all collapse to the same canonical form when the trailing
 *      whitespace is collapsed).
 *   4. Collapse internal whitespace runs (`\s+` → single space).
 *   5. Trim.
 *
 * `normalizeKeyword` returns the normalized string itself; it does NOT
 * split into tokens. Tokenization and the alias lookup happen in
 * `keywordMatches`.
 */

/**
 * Canonical normalization for a single keyword or field string. Returns
 * the empty string for an empty input.
 */
export function normalizeKeyword(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[._\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNormalized(normalized: string): readonly string[] {
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(' ');
}

/**
 * Resolve the canonical token form for a normalized string. The alias
 * resolution is applied per-token: each whitespace-separated token is
 * independently replaced by `ALIAS_MAP[token]` if a key matches, or passes
 * through unchanged. Multi-word alias keys (e.g. `node.js`, `node js`)
 * never appear as individual tokens after normalization (the separators
 * are folded to spaces), so they intentionally never trigger here. The
 * documented entries remain useful as a spec-time checklist of multi-word
 * normalizations that the matcher supports via the per-token unfolding.
 *
 * Example: `node.js` → `node js` → tokenize → `node`, `js` → per-token
 * alias → `node`, `javascript`. Two tokens, equals the field stream
 * `Node JS` → `node`, `javascript`. They match.
 */
function resolveTokens(normalized: string): readonly string[] {
  const tokens = tokenizeNormalized(normalized);
  const resolved: string[] = [];
  for (const token of tokens) {
    resolved.push(ALIAS_MAP[token] ?? token);
  }
  return resolved;
}

/**
 * Returns the index of the matching window in the field token stream, or
 * `-1` when no match exists. The matchedTokenIndex is the index of the
 * first token in the matching window — same value the `matchKeywords`
 * orchestrator reports in `KeywordMatchHit`.
 *
 * The index is identical for the raw field token stream and the alias-
 * resolved field token stream: the alias map is applied token-by-token,
 * and resolved tokens never differ in count from the raw tokens.
 */
export function findKeywordMatchIndex(field: string, keyword: string): number {
  const normalizedField = normalizeKeyword(field);
  const normalizedKeyword = normalizeKeyword(keyword);
  if (normalizedField.length === 0 || normalizedKeyword.length === 0) {
    return -1;
  }
  const fieldTokens = resolveTokens(normalizedField);
  const keywordTokens = resolveTokens(normalizedKeyword);
  if (keywordTokens.length === 0 || keywordTokens.length > fieldTokens.length) {
    return -1;
  }
  const windowLength = keywordTokens.length;
  outer: for (let start = 0; start <= fieldTokens.length - windowLength; start += 1) {
    for (let offset = 0; offset < windowLength; offset += 1) {
      if (fieldTokens[start + offset] !== keywordTokens[offset]) {
        continue outer;
      }
    }
    return start;
  }
  return -1;
}

/**
 * Returns `true` when the token stream of `field` contains a token-stream
 * match of `keyword` (after normalization + alias resolution).
 *
 * The match uses token boundaries on both sides, so:
 *
 *   - `Java` matches `We use Java here` but NOT `JavaScript`.
 *   - `node.js` matches `Node JS` (after normalization + alias).
 *   - `machine learning` matches `experience with machine learning`.
 *   - `machine learning` does NOT match `machine unlearning`.
 *
 * Empty field or empty keyword (after normalization) returns `false`.
 */
export function keywordMatches(field: string, keyword: string): boolean {
  return findKeywordMatchIndex(field, keyword) >= 0;
}
