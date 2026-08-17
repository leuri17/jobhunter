/**
 * Version-controlled phrase patterns for language detection (SPEC §20).
 *
 * The detector (`language-detector.ts`) consumes two phrase lists:
 *
 *   - `LANGUAGE_REQUIRED_PHRASES` — SPEC §20.1 explicit-requirement phrases
 *     that imply a job *requires* the language (e.g. "is required",
 *     "must speak", "professional proficiency in", "native-level",
 *     "excellent command of", "is mandatory").
 *
 *   - `LANGUAGE_REFERENCE_PHRASES` — SPEC §20.2 non-rejecting phrases that
 *     only mention the language as a nice-to-have or context (e.g.
 *     "is a plus", "preferred", "would be beneficial", "is desirable",
 *     "our team speaks").
 *
 * `LANGUAGE_PATTERN_VERSION` is the semver identifier for the current
 * dictionary. Bump it (and re-record the audit) when entries change.
 *
 * The lists are `as const` arrays — frozen at compile time. Adding a phrase
 * is an explicit, version-tracked change. The detector decides whether a
 * matched phrase is `required`, `reference`, or `ambiguous`; the lists
 * themselves carry no such classification.
 */

export const LANGUAGE_REQUIRED_PHRASES: readonly string[] = [
  'is required',
  'required',
  'must speak',
  'must have',
  'professional proficiency in',
  'native-level',
  'native',
  'excellent command of',
  'is mandatory',
  'mandatory',
  'fluent',
];

export const LANGUAGE_REFERENCE_PHRASES: readonly string[] = [
  'is a plus',
  'preferred',
  'would be beneficial',
  'is desirable',
  'desirable',
  'a bonus',
  'nice to have',
  'our team speaks',
];

/**
 * Canonical list of every language the detector knows how to recognize in a
 * job description (SPEC §20; TASK-010 Task 5 + Task 6).
 *
 * The detector scans the description for occurrences of *every* slug in
 * this list, not just the candidate's accepted languages. The
 * language-rejection rule (Task 6) needs to find languages the candidate
 * does NOT speak — that is impossible to do with an "accepted only"
 * scan, so the detector iterates over the union of
 * `acceptedLanguages` and `KNOWN_LANGUAGES`.
 *
 * Each entry is a normalized language slug (lowercase, whitespace-
 * collapsed, diacritic-stripped, alias-resolved) — the same form
 * `normalizeLanguageName` produces. The set is intentionally small:
 * it covers the languages JobHunter users are likely to encounter in
 * European job descriptions. Adding a new slug here is a version-tracked
 * decision (bump `LANGUAGE_PATTERN_VERSION`).
 */
export const KNOWN_LANGUAGES: readonly string[] = [
  'arabic',
  'catalan',
  'chinese',
  'czech',
  'danish',
  'dutch',
  'english',
  'estonian',
  'finnish',
  'french',
  'german',
  'greek',
  'hebrew',
  'hindi',
  'hungarian',
  'indonesian',
  'italian',
  'japanese',
  'korean',
  'latvian',
  'lithuanian',
  'norwegian',
  'polish',
  'portuguese',
  'romanian',
  'russian',
  'slovak',
  'slovenian',
  'spanish',
  'swedish',
  'thai',
  'turkish',
  'ukrainian',
  'vietnamese',
];

export const LANGUAGE_PATTERN_VERSION = '1.1.0' as const;
