/**
 * Deterministic alias map for the deterministic keyword matcher (SPEC §18,
 * TASK-010 Task 3).
 *
 * Keys are the **normalized** token form produced by `normalizeKeyword`
 * (NFKC, lowercase, trim, `.`, `-`, `_`, `/` folded to a single space,
 * collapsed whitespace). Values are the canonical replacement tokens.
 *
 * The matcher consults this map as a per-token lookup: each whitespace-
 * separated token of the normalized field/keyword is independently replaced
 * by `ALIAS_MAP[token]` when a key matches, or passes through unchanged.
 *
 * The multi-word entries listed below (e.g. `node.js`, `node js`) never
 * appear as individual tokens after normalization (the separators are
 * folded to spaces), so per-token lookup alone cannot trigger them. They
 * are kept as documentation of the multi-word normalizations the matcher
 * supports via the per-token unfolding — e.g. `node.js` → `node js` →
 * tokens `node`, `js` → per-token → `node`, `javascript`. The two-token
 * canonical form is identical to the field stream `Node JS` → `node`,
 * `javascript`, so the matcher still reports a match.
 *
 * Updates to this file are version-controlled. Each entry must be
 * intentional and traceable to a known abbreviation, alternate spelling,
 * or punctuation variant. The companion constant `KEYWORD_ALIAS_VERSION`
 * is the human-readable version label — bump it in the same commit when
 * the map changes meaningfully.
 *
 * This map is intentionally distinct from `src/profile/name-aliases.ts`:
 * skill-dedup and filter-matching have different join semantics, and the
 * filter alias map is allowed to evolve independently from the profile one.
 */

export const KEYWORD_ALIAS_VERSION = '1.0.0';

export const ALIAS_MAP: Readonly<Record<string, string>> = Object.freeze({
  // SPEC §18 examples — multi-word keys (documented intent; per-token
  // resolution unfolds them via the single-word entries below).
  'node.js': 'nodejs',
  'node js': 'nodejs',
  'react.js': 'react',
  // Per-token single-word entries actually consumed by the matcher.
  postgres: 'postgresql',
  js: 'javascript',
  ts: 'typescript',
  k8s: 'kubernetes',
});
