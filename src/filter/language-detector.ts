import { normalizeLanguageName } from '../profile/name-normalize.js';
import { normalizeKeyword } from './keyword-normalize.js';
import {
  KNOWN_LANGUAGES,
  LANGUAGE_REFERENCE_PHRASES,
  LANGUAGE_REQUIRED_PHRASES,
} from './language-patterns.js';

/**
 * Deterministic language-requirement detection from job descriptions
 * (; ).
 *
 * The detector scans the normalized description for occurrences of each
 * slug in the union of `input.acceptedLanguages` and `KNOWN_LANGUAGES`
 * (from `./language-patterns.js`). The candidate's accepted list is
 * always included; the known-languages list is added so the
 * language-rejection rule (Task 6) can surface languages the candidate
 * does NOT speak. Without the known-languages union, the detector would
 * only ever return requirements for the candidate's accepted set, and
 * the rule's "fail" branch would be unreachable.
 *
 * For every language occurrence in the description, the detector looks
 * for required or reference phrases from the versioned dictionaries in
 * `language-patterns.ts` within a ±5-token window. Each match becomes
 * a `LanguageRequirement` entry:
 *
 *   - Required phrases (§20.1) carry `kind: 'required'`.
 *   - Reference phrases (§20.2) carry `kind: 'reference'`.
 *   - A small set of standalone adjectives carry `kind: 'ambiguous'` (see
 *     the ambiguity rule below).
 *
 * Normalization goes through `normalizeKeyword` from Task 3 (NFKC →
 * lowercase → fold `.`, `-`, `_`, `/` to space → collapse whitespace →
 * trim). That step turns `Native-level` into `native level`, so the
 * phrase entry `native-level` matches via its normalized token sequence.
 * The detector reports the *original* matched phrase (with the dash
 * intact) in `matchedPhrase`, never the normalized form.
 *
 * Token boundaries matter: the detector never matches substrings, so
 * `dutch` does not match `dutchman`. The window is 5 tokens before and
 * after each language occurrence (clamped to the description bounds).
 *
 * Multi-word phrases match exactly those tokens in sequence. The detector
 * applies a "longest match wins per starting position" rule so that when
 * both `native-level` and `native` could match at the same offset,
 * `native-level` is reported and the shorter `native` is suppressed.
 * Likewise for `is mandatory` vs `mandatory`, `is desirable` vs
 * `desirable`, and `is required` vs `required`.
 *
 * Within a single language occurrence, the detector also de-duplicates
 * repeated matches of the same phrase (e.g. when the same phrase appears
 * twice inside the 5-token window). Distinct occurrences of the language
 * still produce one entry each, as required by the brief ("two required
 * matches for the same language → one entry per matched phrase; the
 * evaluator deduplicates" applies to identical phrases only).
 *
 * **Ambiguity rule (implementer's choice).** The brief lists six
 * standalone adjectives (`fluent`, `required`, `native`, `mandatory`,
 * `desirable`, `preferred`) as candidates for `kind: 'ambiguous'`. Our
 * choice: `fluent` and `native` only. Rationale:
 *
 *   - `fluent` and `native` appear in two genuinely opposite contexts
 *     ("fluent Dutch required" vs "fluent speaker"; "native Dutch
 *     required" vs "native audience"). Both readings are plausible in
 *     real job descriptions.
 *   - `required`, `mandatory` clearly mean requirement.
 *   - `desirable`, `preferred` clearly mean preference.
 *
 * The evaluator (Task 6) treats `ambiguous` matches with the same
 * abstention logic as `reference` matches per  ("Abstain when
 * wording cannot be classified reliably. Abstention must not reject the
 * job.").
 *
 * Domain-boundary note (AGENTS.md §5, §9): this module imports only
 * `keyword-normalize.js` and `name-normalize.js`. It must not import
 * Commander, Inquirer, Playwright, Drizzle, OpenAI, or Pino. The
 * `tests/filter/boundaries.test.ts` guard enforces this.
 */

export type LanguageRequirement =
  | {
      readonly kind: 'required';
      readonly language: string;
      readonly normalizedLanguage: string;
      readonly matchedPhrase: string;
    }
  | {
      readonly kind: 'reference';
      readonly language: string;
      readonly normalizedLanguage: string;
      readonly matchedPhrase: string;
    }
  | {
      readonly kind: 'ambiguous';
      readonly language: string;
      readonly normalizedLanguage: string;
      readonly matchedPhrase: string;
    };

export interface LanguageDetectionResult {
  readonly requirements: readonly LanguageRequirement[];
  /** Normalized language slugs, preserved verbatim from the input. */
  readonly acceptedLanguages: readonly string[];
}

export interface DetectLanguageInput {
  readonly description: string | null;
  readonly acceptedLanguages: readonly string[];
}

const WINDOW_SIZE = 5;

/**
 * Phrases classified as `ambiguous` when matched (see the JSDoc above for
 * the rationale). The set is intentionally narrow — only the two
 * standalone adjectives that have plausible opposite readings.
 */
const AMBIGUOUS_PHRASES: ReadonlySet<string> = new Set(['fluent', 'native']);

interface PhraseEntry {
  readonly phrase: string;
  readonly tokens: readonly string[];
  readonly kind: 'required' | 'reference' | 'ambiguous';
}

interface DescriptionTokens {
  /** Original-case tokens (whitespace-split). */
  readonly originalTokens: readonly string[];
  /** Normalized token stream (NFKC → lowercase → separator fold). */
  readonly normalizedTokens: readonly string[];
  /**
   * `normalizedIndexToOriginalIndex[i]` is the index (in `originalTokens`)
   * of the original token that produced normalized token `i`. A single
   * original token may produce multiple normalized tokens (e.g. when it
   * contains separators like `-`), so multiple consecutive normalized
   * indices can map back to the same original token index.
   */
  readonly normalizedIndexToOriginalIndex: readonly number[];
}

function tokenizeDescription(description: string): DescriptionTokens {
  const originalTokens = description.trim().split(/\s+/);
  const normalizedTokens: string[] = [];
  const normalizedIndexToOriginalIndex: number[] = [];
  for (let k = 0; k < originalTokens.length; k += 1) {
    const normalized = normalizeKeyword(originalTokens[k] ?? '');
    if (normalized.length === 0) {
      continue;
    }
    const parts = normalized.split(' ');
    for (const part of parts) {
      normalizedTokens.push(part);
      normalizedIndexToOriginalIndex.push(k);
    }
  }
  return { originalTokens, normalizedTokens, normalizedIndexToOriginalIndex };
}

function tokenizePhrase(phrase: string): readonly string[] {
  const normalized = normalizeKeyword(phrase);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(' ');
}

function classifyPhrase(phrase: string): 'required' | 'reference' | 'ambiguous' {
  if (AMBIGUOUS_PHRASES.has(phrase)) {
    return 'ambiguous';
  }
  if ((LANGUAGE_REQUIRED_PHRASES as readonly string[]).includes(phrase)) {
    return 'required';
  }
  return 'reference';
}

function buildPhraseIndex(): readonly PhraseEntry[] {
  const seen = new Set<string>();
  const entries: PhraseEntry[] = [];
  for (const phrase of LANGUAGE_REQUIRED_PHRASES) {
    if (seen.has(phrase)) {
      continue;
    }
    seen.add(phrase);
    const tokens = tokenizePhrase(phrase);
    if (tokens.length === 0) {
      continue;
    }
    entries.push({ phrase, tokens, kind: classifyPhrase(phrase) });
  }
  for (const phrase of LANGUAGE_REFERENCE_PHRASES) {
    if (seen.has(phrase)) {
      continue;
    }
    seen.add(phrase);
    const tokens = tokenizePhrase(phrase);
    if (tokens.length === 0) {
      continue;
    }
    entries.push({ phrase, tokens, kind: classifyPhrase(phrase) });
  }
  return entries;
}

const PHRASE_INDEX: readonly PhraseEntry[] = buildPhraseIndex();

/**
 * Find the longest phrase in `PHRASE_INDEX` that starts at `startIdx`
 * inside `tokens`. Returns `null` when nothing matches. The phrase is
 * matched token-by-token against the normalized description; matches are
 * case-insensitive (because the tokens are already normalized).
 */
function findLongestAt(tokens: readonly string[], startIdx: number): PhraseEntry | null {
  const remaining = tokens.length - startIdx;
  if (remaining <= 0) {
    return null;
  }
  let best: PhraseEntry | null = null;
  for (const entry of PHRASE_INDEX) {
    if (entry.tokens.length > remaining) {
      continue;
    }
    let matches = true;
    for (let j = 0; j < entry.tokens.length; j += 1) {
      if (tokens[startIdx + j] !== entry.tokens[j]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    if (best === null || entry.tokens.length > best.tokens.length) {
      best = entry;
    }
  }
  return best;
}

/**
 * Find every occurrence of a consecutive token sequence inside `tokens`.
 * Returns the start indices, in ascending order.
 */
function findOccurrences(tokens: readonly string[], needle: readonly string[]): readonly number[] {
  if (needle.length === 0 || needle.length > tokens.length) {
    return [];
  }
  const positions: number[] = [];
  outer: for (let i = 0; i <= tokens.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (tokens[i + j] !== needle[j]) {
        continue outer;
      }
    }
    positions.push(i);
  }
  return positions;
}

/**
 * Recover the original-case text of a language occurrence from the
 * normalized token range. The mapping handles descriptions that contain
 * separators inside tokens (e.g. `Native-level`) — the normalized token
 * stream splits those into multiple tokens, so we widen the lookup by
 * taking the min and max original-token index covered.
 */
function recoverLanguageText(
  tokens: DescriptionTokens,
  langStart: number,
  langLength: number,
): string {
  let minOriginal = Number.POSITIVE_INFINITY;
  let maxOriginal = -1;
  for (let j = langStart; j < langStart + langLength; j += 1) {
    const originalIdx = tokens.normalizedIndexToOriginalIndex[j] ?? -1;
    if (originalIdx < minOriginal) {
      minOriginal = originalIdx;
    }
    if (originalIdx > maxOriginal) {
      maxOriginal = originalIdx;
    }
  }
  if (minOriginal === Number.POSITIVE_INFINITY || maxOriginal < 0) {
    return '';
  }
  return tokens.originalTokens.slice(minOriginal, maxOriginal + 1).join(' ');
}

function pushRequirement(
  out: LanguageRequirement[],
  entry: PhraseEntry,
  language: string,
  normalizedLanguage: string,
): void {
  switch (entry.kind) {
    case 'required':
      out.push({
        kind: 'required',
        language,
        normalizedLanguage,
        matchedPhrase: entry.phrase,
      });
      return;
    case 'reference':
      out.push({
        kind: 'reference',
        language,
        normalizedLanguage,
        matchedPhrase: entry.phrase,
      });
      return;
    case 'ambiguous':
      out.push({
        kind: 'ambiguous',
        language,
        normalizedLanguage,
        matchedPhrase: entry.phrase,
      });
      return;
  }
}

/**
 * Inspect a job description for required and reference language phrases
 *
 * The detector walks the description token-by-token:
 *
 *   1. Normalize the description via `normalizeKeyword`.
 *   2. For each accepted language slug, find its (possibly multi-token)
 *      normalized form inside the description's token stream.
 *   3. For each language occurrence, scan the surrounding 5-token window
 *      for any phrase from `LANGUAGE_REQUIRED_PHRASES` or
 *      `LANGUAGE_REFERENCE_PHRASES`. When a multi-word phrase and a
 *      shorter phrase start at the same offset, the longer phrase wins
 *      (so `is mandatory` is reported instead of also `mandatory`).
 *      Identical phrases that match multiple times in the same window
 *      are de-duplicated.
 *   4. Each surviving phrase match becomes a `LanguageRequirement`
 *      entry. The `language` field preserves the original case from the
 *      description; `normalizedLanguage` is the canonical slug.
 *
 * Null or empty-after-normalization descriptions return no requirements
 * (the evaluator will abstain). Languages absent from the description
 * produce no entry. Two required matches for the same language produce
 * one entry per matched phrase (deduplicated within a single window).
 */
export function detectLanguageRequirements(input: DetectLanguageInput): LanguageDetectionResult {
  const accepted = [...input.acceptedLanguages];
  if (input.description === null) {
    return { requirements: [], acceptedLanguages: accepted };
  }
  const normalizedDescription = normalizeKeyword(input.description);
  if (normalizedDescription.length === 0) {
    return { requirements: [], acceptedLanguages: accepted };
  }

  const tokens = tokenizeDescription(input.description);

  const requirements: LanguageRequirement[] = [];

  // The detector scans for the UNION of `acceptedLanguages` and
  // `KNOWN_LANGUAGES`. This is required by the language-rejection
  // rule (Task 6, ): the rule must surface "French required"
  // as an unsupported required language even when French is NOT in
  // the candidate's accepted list. With an accepted-only scan, the
  // detector would never return French, and the rule's "fail" branch
  // would be unreachable.
  const slugsToScan: string[] = [];
  const seenSlugs = new Set<string>();
  for (const slug of input.acceptedLanguages) {
    if (slug.length === 0 || seenSlugs.has(slug)) {
      continue;
    }
    seenSlugs.add(slug);
    slugsToScan.push(slug);
  }
  for (const slug of KNOWN_LANGUAGES) {
    if (slug.length === 0 || seenSlugs.has(slug)) {
      continue;
    }
    seenSlugs.add(slug);
    slugsToScan.push(slug);
  }

  for (const acceptedSlug of slugsToScan) {
    if (acceptedSlug.length === 0) {
      continue;
    }
    const languageTokens = acceptedSlug.split(' ');
    if (languageTokens.length === 0 || languageTokens[0] === '') {
      continue;
    }

    const occurrences = findOccurrences(tokens.normalizedTokens, languageTokens);
    for (const langStart of occurrences) {
      const langEnd = langStart + languageTokens.length - 1;
      const windowStart = Math.max(0, langStart - WINDOW_SIZE);
      const windowEndExclusive = Math.min(
        tokens.normalizedTokens.length,
        langEnd + WINDOW_SIZE + 1,
      );

      const originalLanguageText = recoverLanguageText(tokens, langStart, languageTokens.length);
      const { name: canonicalName, normalizedName } = normalizeLanguageName(originalLanguageText);

      // De-duplicate identical phrases within a single language's window
      // so repeated matches (e.g. "Dutch required. Dutch required.") do
      // not produce duplicate entries for the same language occurrence.
      const seenPhrases = new Set<string>();
      let cursor = windowStart;
      while (cursor < windowEndExclusive) {
        const match = findLongestAt(tokens.normalizedTokens, cursor);
        if (match === null) {
          cursor += 1;
          continue;
        }
        if (!seenPhrases.has(match.phrase)) {
          seenPhrases.add(match.phrase);
          pushRequirement(requirements, match, canonicalName, normalizedName);
        }
        cursor += match.tokens.length;
      }
    }
  }

  return { requirements, acceptedLanguages: accepted };
}
