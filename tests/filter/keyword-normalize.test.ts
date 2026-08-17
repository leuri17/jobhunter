import { describe, expect, it } from 'vitest';

import { ALIAS_MAP, KEYWORD_ALIAS_VERSION } from '../../src/filter/keyword-aliases.js';
import { keywordMatches, normalizeKeyword } from '../../src/filter/keyword-normalize.js';

/**
 * TASK-010 Task 3 — `keyword-normalize.ts` tests.
 *
 * The brief specifies the canonical normalization chain:
 *
 *   NFKC → lowercase → trim → collapse whitespace → fold
 *   `.`, `-`, `_`, `/` separators to a single space.
 *
 * The alias map is consulted as a whole-string lookup on the normalized form,
 * then per-token for any tail that doesn't match a multi-word key.
 */

describe('normalizeKeyword', () => {
  it('returns an empty string for an empty input', () => {
    expect(normalizeKeyword('')).toBe('');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeKeyword('   \t\n  ')).toBe('');
  });

  it('lowercases the input', () => {
    expect(normalizeKeyword('JavaScript')).toBe('javascript');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeKeyword('  hello world  ')).toBe('hello world');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeKeyword('hello\t   world')).toBe('hello world');
  });

  it('applies Unicode NFKC normalization before lowercasing', () => {
    // NFKC of "ﬁre" (U+FB01) is "fire".
    expect(normalizeKeyword('ﬁre')).toBe('fire');
    // NFKC of "Ⅸ" (Roman numeral nine) is "IX".
    expect(normalizeKeyword('Ⅸ')).toBe('ix');
  });

  it('folds the four separators (`.`, `-`, `_`, `/`) to a single space', () => {
    // The separator set is documented in the task brief and SPEC §18.
    expect(normalizeKeyword('node.js')).toBe('node js');
    expect(normalizeKeyword('node-js')).toBe('node js');
    expect(normalizeKeyword('node_js')).toBe('node js');
    expect(normalizeKeyword('node/js')).toBe('node js');
    expect(normalizeKeyword('node js')).toBe('node js');
  });

  it('folds separators to a space even when adjacent to whitespace', () => {
    expect(normalizeKeyword('node . js')).toBe('node js');
    expect(normalizeKeyword('node -js')).toBe('node js');
    expect(normalizeKeyword('node _ js')).toBe('node js');
  });

  it('preserves letters and digits that are not separators', () => {
    expect(normalizeKeyword('C++')).toBe('c++');
    expect(normalizeKeyword('C# engineer')).toBe('c# engineer');
  });

  it('combines NFKC + trim + lowercase + whitespace + separator folding', () => {
    expect(normalizeKeyword('  NODE.JS\nEngineer  ')).toBe('node js engineer');
  });
});

describe('ALIAS_MAP', () => {
  it('is frozen at the object level', () => {
    expect(Object.isFrozen(ALIAS_MAP)).toBe(true);
  });

  it('declares the SPEC §18 initial entries', () => {
    expect(ALIAS_MAP['node.js']).toBe('nodejs');
    expect(ALIAS_MAP['node js']).toBe('nodejs');
    expect(ALIAS_MAP['react.js']).toBe('react');
    expect(ALIAS_MAP['postgres']).toBe('postgresql');
  });

  it('declares the js/ts/k8s triplet documented in the task brief', () => {
    expect(ALIAS_MAP['js']).toBe('javascript');
    expect(ALIAS_MAP['ts']).toBe('typescript');
    expect(ALIAS_MAP['k8s']).toBe('kubernetes');
  });

  it('exposes the initial KEYWORD_ALIAS_VERSION constant', () => {
    expect(KEYWORD_ALIAS_VERSION).toBe('1.0.0');
  });
});

describe('keywordMatches — normalization + alias resolution', () => {
  it('returns false for empty field or empty keyword after normalization', () => {
    expect(keywordMatches('', 'javascript')).toBe(false);
    expect(keywordMatches('javascript developer', '')).toBe(false);
    expect(keywordMatches('   ', 'javascript')).toBe(false);
    expect(keywordMatches('javascript developer', '   ')).toBe(false);
  });

  it('matches a single normalized token (case-insensitive)', () => {
    expect(keywordMatches('JavaScript developer', 'javascript')).toBe(true);
    expect(keywordMatches('WE LOVE TYPESCRIPT', 'typescript')).toBe(true);
  });

  it('does NOT match when the keyword is a prefix of a different token (JavaScript ≠ Java)', () => {
    // Boundary case from SPEC §18: `Java` is its own token, `JavaScript` is its
    // own token — `Java` does NOT match `JavaScript`.
    expect(keywordMatches('JavaScript developer', 'Java')).toBe(false);
  });

  it('matches a single normalized token surrounded by other tokens', () => {
    expect(keywordMatches('We use Java here', 'Java')).toBe(true);
  });

  it('resolves the per-token alias for `node.js` / `Node JS` after normalization', () => {
    // SPEC §18: "node.js matches Node JS" after normalization + alias.
    // After normalization, both sides have the two tokens `node`, `js`.
    // Per-token alias resolution turns `js` into `javascript`, so the
    // canonical form is `node javascript` on both sides — they match.
    expect(keywordMatches('Node JS', 'node.js')).toBe(true);
    expect(keywordMatches('Node JS', 'node js')).toBe(true);
    expect(keywordMatches('Node.js', 'nodejs')).toBe(false);
  });

  it('matches `node.js` against a longer field containing `Node JS` (alias example)', () => {
    // The matching is by token stream, so `node.js` matches anywhere the
    // consecutive `node javascript` window appears in the field.
    expect(keywordMatches('We use Node JS for backend', 'node.js')).toBe(true);
  });

  it('resolves the per-token alias `js` → `javascript` when the whole key does not match', () => {
    // After normalization, the three-word phrase `we use js` is not a single
    // key in the alias map, so the matching falls through to per-token
    // resolution: `we use javascript`. The field `We use JS` matches.
    expect(keywordMatches('We use JS', 'we use js')).toBe(true);
  });

  it('resolves the per-token alias `postgres` → `postgresql`', () => {
    expect(keywordMatches('PostgreSQL experience', 'postgres')).toBe(true);
  });

  it('resolves the per-token alias `k8s` → `kubernetes`', () => {
    expect(keywordMatches('Kubernetes engineer', 'k8s')).toBe(true);
    expect(keywordMatches('We use k8s for orchestration', 'k8s')).toBe(true);
  });

  it('resolves the per-token alias `ts` → `typescript`', () => {
    expect(keywordMatches('TypeScript weekly', 'ts')).toBe(true);
  });

  it('resolves the per-token alias `react.js` → `react` (after normalization, falls through to tokens)', () => {
    // After normalization `react.js` becomes `react js`, which is not a key
    // in the map, so the matcher tokenizes and applies per-token aliases.
    // The result is that `react.js` matches any field whose token stream
    // contains `react` followed by `javascript` (from `js` → `javascript`).
    expect(keywordMatches('react js everywhere', 'react.js')).toBe(true);
  });

  it('matches multi-word phrases consecutively in the field token stream', () => {
    expect(keywordMatches('experience with machine learning', 'machine learning')).toBe(true);
  });

  it('does NOT match multi-word phrases when the tokens are not consecutive', () => {
    // `machine learning` is two tokens; `machine unlearning` has `unlearning`
    // as the second token, so the exact consecutive pair does not appear.
    expect(keywordMatches('machine unlearning', 'machine learning')).toBe(false);
  });

  it('does NOT match multi-word phrases when the order is reversed', () => {
    expect(keywordMatches('learning machine', 'machine learning')).toBe(false);
  });

  it('matches a multi-word keyword that spans the entire field', () => {
    expect(keywordMatches('machine learning', 'machine learning')).toBe(true);
  });

  it('matches a single-word keyword in a long field', () => {
    expect(
      keywordMatches(
        'We are looking for a senior software engineer with strong ' +
          'experience in distributed systems and cloud infrastructure',
        'senior',
      ),
    ).toBe(true);
  });

  it('matches a single-word keyword inside a hyphen-separated field', () => {
    expect(keywordMatches('k8s-related tasks', 'k8s')).toBe(true);
  });

  it('does NOT match when the keyword is a substring of a single field token', () => {
    // `script` is a substring of `JavaScript` but is also part of the same
    // token (`javascript` has no space), so the token-stream matcher does
    // not match it.
    expect(keywordMatches('JavaScript', 'script')).toBe(false);
  });

  it('does NOT match when the keyword has more tokens than the field', () => {
    expect(keywordMatches('machine', 'machine learning')).toBe(false);
  });

  it('matches a single-token keyword against a field with the same token after separator folding', () => {
    // Punctuation variants documented in the task brief.
    expect(keywordMatches('react.js engineer', 'react js')).toBe(true);
    expect(keywordMatches('react-js engineer', 'react_js')).toBe(true);
    expect(keywordMatches('react_js engineer', 'react-js')).toBe(true);
  });

  it('is pure: repeated invocation with the same input returns the same result', () => {
    const first = keywordMatches('JavaScript developer', 'typescript');
    const second = keywordMatches('JavaScript developer', 'typescript');
    expect(first).toBe(second);
    expect(first).toBe(false);
  });
});
