import { SENIORITY_LEVELS } from '../profile/schema.js';
import { normalizeKeyword } from './keyword-normalize.js';

/**
 * Deterministic seniority detection from job titles (; ).
 *
 * The detector inspects ONLY the normalized title's token stream against
 * the inline  phrase map. When multiple phrases match, the
 * highest detected rank (per `SENIORITY_LEVELS` order in
 * `src/profile/schema.ts`) wins. Unlabelled titles return `unknown` with
 * an empty `matchedPhrases` array.
 *
 * Normalization goes through `normalizeKeyword` (Task 3): NFKC, lowercase,
 * separator-fold (`.`, `-`, `_`, `/` → space), whitespace collapse, trim.
 * That step turns `Sr. Software Engineer` into the tokens `sr`, `software`,
 * `engineer` so the single-token entry `sr` matches.
 *
 * Multi-word phrases such as `entry level`, `engineering manager`,
 * `head of`, `tech lead`, `team lead`, `vice president`, and `mid level`
 * (after `mid-level` folds to `mid level`) are stored as single
 * space-separated keys and matched against the consecutive tokens of the
 * normalized title.
 *
 * The phrase map is intentionally inline (the brief notes that extraction
 * to a versioned constant is deferred until the dictionary grows beyond
 * its current size).
 */

export type DetectedSeniority =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'lead'
  | 'manager'
  | 'director'
  | 'executive'
  | 'unknown';

/** A `DetectedSeniority` with `unknown` removed — the value type for non-unlabelled titles. */
export type KnownSeniority = Exclude<DetectedSeniority, 'unknown'>;

export interface SeniorityMatchedPhrase {
  readonly phrase: string;
  readonly level: KnownSeniority;
}

export interface SeniorityDetectionResult {
  readonly detected: DetectedSeniority;
  readonly matchedPhrases: readonly SeniorityMatchedPhrase[];
}

/**
 *  example mapping. Multi-word entries are stored as
 * single space-separated keys whose tokens appear consecutively in the
 * normalized title's token stream.
 *
 * The map is frozen; lookups should treat missing keys as "no match".
 */
const SENIORITY_PHRASE_MAP: Readonly<Record<string, KnownSeniority>> = Object.freeze({
  // intern
  intern: 'intern',
  internship: 'intern',
  trainee: 'intern',
  // junior
  junior: 'junior',
  jr: 'junior',
  graduate: 'junior',
  'entry level': 'junior',
  // mid
  mid: 'mid',
  // `mid-level` folds via the separator step to `mid level`.
  'mid level': 'mid',
  intermediate: 'mid',
  // senior
  senior: 'senior',
  // `Sr.` folds via the separator step to the `sr` token.
  sr: 'senior',
  // staff
  staff: 'staff',
  // principal
  principal: 'principal',
  // lead
  lead: 'lead',
  'tech lead': 'lead',
  'team lead': 'lead',
  // manager
  manager: 'manager',
  'engineering manager': 'manager',
  // director
  director: 'director',
  'head of': 'director',
  // executive
  vp: 'executive',
  'vice president': 'executive',
  chief: 'executive',
  cto: 'executive',
});

/**
 * The current longest phrase in `SENIORITY_PHRASE_MAP`. The detector slides
 * a window of length 1..MAX_PHRASE_TOKEN_LENGTH across the normalized
 * token stream and looks each window up in the phrase map.
 *
 * Bump only when adding an entry with more than two normalized tokens.
 */
const MAX_PHRASE_TOKEN_LENGTH = 2;

function rankOf(level: KnownSeniority): number {
  return SENIORITY_LEVELS.indexOf(level);
}

function findMatches(tokens: readonly string[]): SeniorityMatchedPhrase[] {
  const matches: SeniorityMatchedPhrase[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    const maxWindow = Math.min(tokens.length - start, MAX_PHRASE_TOKEN_LENGTH);
    for (let length = 1; length <= maxWindow; length += 1) {
      const phrase = tokens.slice(start, start + length).join(' ');
      const level = SENIORITY_PHRASE_MAP[phrase];
      if (level !== undefined) {
        matches.push({ phrase, level });
      }
    }
  }
  return matches;
}

function pickHighest(matches: readonly SeniorityMatchedPhrase[]): KnownSeniority | null {
  if (matches.length === 0) {
    return null;
  }
  let best: SeniorityMatchedPhrase | null = null;
  for (const match of matches) {
    if (best === null || rankOf(match.level) > rankOf(best.level)) {
      best = match;
    }
  }
  return best?.level ?? null;
}

/**
 * Inspect a job title for seniority markers.
 *
 * Returns `{ detected: 'unknown', matchedPhrases: [] }` when the title is
 * `null`, empty after normalization, or contains no phrase from the
 *  mapping. Otherwise the returned `detected` is the highest
 * detected rank across all matched phrases; `matchedPhrases` is the full
 * list of matches sorted by ascending rank, so `matchedPhrases.at(-1)`
 * always matches `detected`.
 */
export function detectSeniority(title: string | null): SeniorityDetectionResult {
  if (title === null) {
    return { detected: 'unknown', matchedPhrases: [] };
  }
  const normalized = normalizeKeyword(title);
  if (normalized.length === 0) {
    return { detected: 'unknown', matchedPhrases: [] };
  }
  const tokens = normalized.split(' ');
  const matches = findMatches(tokens);
  if (matches.length === 0) {
    return { detected: 'unknown', matchedPhrases: [] };
  }
  // Stable ascending-rank sort: the highest rank ends up at the end of
  // the array, so `matches.at(-1)?.level === detected`.
  const sorted = [...matches].sort((a, b) => rankOf(a.level) - rankOf(b.level));
  const highest = pickHighest(sorted);
  if (highest === null) {
    return { detected: 'unknown', matchedPhrases: [] };
  }
  return { detected: highest, matchedPhrases: sorted };
}
