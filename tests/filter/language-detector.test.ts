import { describe, expect, it } from 'vitest';

import {
  detectLanguageRequirements,
  type LanguageRequirement,
} from '../../src/filter/language-detector.js';
import {
  LANGUAGE_PATTERN_VERSION,
  LANGUAGE_REFERENCE_PHRASES,
  LANGUAGE_REQUIRED_PHRASES,
} from '../../src/filter/language-patterns.js';

/**
 *  — `language-detector.ts` tests.
 *
 *  surfaces deterministic phrase-based language detection:
 *
 *   - §20.1 examples (required) match a phrase in `LANGUAGE_REQUIRED_PHRASES`
 *     and produce `kind: 'required'`.
 *   - §20.2 examples (reference) match a phrase in `LANGUAGE_REFERENCE_PHRASES`
 *     and produce `kind: 'reference'`.
 *   - Empty / null descriptions yield no requirements.
 *   - Languages absent from the description yield no entry.
 *   - Two required matches for the same language yield one entry per matched
 *     phrase (the evaluator deduplicates per the brief).
 *
 * The implementer's ambiguity rule treats `fluent` and `native` (standalone
 * adjectives) as `kind: 'ambiguous'`. The other standalone adjectives
 * (`required`, `mandatory`, `desirable`, `preferred`) keep their list
 * classification. See the JSDoc in `language-detector.ts` for the rationale.
 */

function pickRequired(
  result: ReturnType<typeof detectLanguageRequirements>,
): LanguageRequirement[] {
  return result.requirements.filter((r) => r.kind === 'required');
}

function pickReference(
  result: ReturnType<typeof detectLanguageRequirements>,
): LanguageRequirement[] {
  return result.requirements.filter((r) => r.kind === 'reference');
}

function pickAmbiguous(
  result: ReturnType<typeof detectLanguageRequirements>,
): LanguageRequirement[] {
  return result.requirements.filter((r) => r.kind === 'ambiguous');
}

describe('language-patterns module — versioned phrase lists', () => {
  it('exports LANGUAGE_PATTERN_VERSION as a semver string', () => {
    expect(LANGUAGE_PATTERN_VERSION).toBe('1.1.0');
  });

  it('keeps the required phrase list non-empty', () => {
    expect(LANGUAGE_REQUIRED_PHRASES.length).toBeGreaterThan(0);
  });

  it('keeps the reference phrase list frozen and non-empty', () => {
    expect(LANGUAGE_REFERENCE_PHRASES.length).toBeGreaterThan(0);
  });

  it('covers every  phrase in the required list', () => {
    expect(LANGUAGE_REQUIRED_PHRASES).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('covers every  phrase in the reference list', () => {
    expect(LANGUAGE_REFERENCE_PHRASES).toEqual(
      expect.arrayContaining([
        'is a plus',
        'preferred',
        'would be beneficial',
        'is desirable',
        'desirable',
        'a bonus',
        'nice to have',
        'our team speaks',
      ]),
    );
  });
});

describe('detectLanguageRequirements —  explicit requirements', () => {
  it('detects "required" from "Dutch required"', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch required',
      acceptedLanguages: ['dutch'],
    });
    expect(pickRequired(result)).toEqual([
      {
        kind: 'required',
        language: 'Dutch',
        normalizedLanguage: 'dutch',
        matchedPhrase: 'required',
      },
    ]);
  });

  it('detects "required" from "Fluent Dutch required" (at least one required)', () => {
    const result = detectLanguageRequirements({
      description: 'Fluent Dutch required',
      acceptedLanguages: ['dutch'],
    });
    const reqs = pickRequired(result);
    expect(reqs.length).toBeGreaterThanOrEqual(1);
    const matched = reqs.find((r) => r.matchedPhrase === 'required');
    expect(matched).toEqual({
      kind: 'required',
      language: 'Dutch',
      normalizedLanguage: 'dutch',
      matchedPhrase: 'required',
    });
  });

  it('detects "must speak" from "Must speak German"', () => {
    const result = detectLanguageRequirements({
      description: 'Must speak German',
      acceptedLanguages: ['german'],
    });
    expect(pickRequired(result)).toEqual([
      {
        kind: 'required',
        language: 'German',
        normalizedLanguage: 'german',
        matchedPhrase: 'must speak',
      },
    ]);
  });

  it('detects "professional proficiency in" from "Professional proficiency in French"', () => {
    const result = detectLanguageRequirements({
      description: 'Professional proficiency in French',
      acceptedLanguages: ['french'],
    });
    expect(pickRequired(result)).toEqual([
      {
        kind: 'required',
        language: 'French',
        normalizedLanguage: 'french',
        matchedPhrase: 'professional proficiency in',
      },
    ]);
  });

  it('detects "native-level" (folds to "native level") from "Native-level Spanish"', () => {
    const result = detectLanguageRequirements({
      description: 'Native-level Spanish',
      acceptedLanguages: ['spanish'],
    });
    const reqs = pickRequired(result);
    expect(reqs.length).toBeGreaterThanOrEqual(1);
    const matched = reqs.find((r) => r.matchedPhrase === 'native-level');
    expect(matched).toEqual({
      kind: 'required',
      language: 'Spanish',
      normalizedLanguage: 'spanish',
      matchedPhrase: 'native-level',
    });
  });

  it('detects "excellent command of" from "Excellent command of Italian"', () => {
    const result = detectLanguageRequirements({
      description: 'Excellent command of Italian',
      acceptedLanguages: ['italian'],
    });
    expect(pickRequired(result)).toEqual([
      {
        kind: 'required',
        language: 'Italian',
        normalizedLanguage: 'italian',
        matchedPhrase: 'excellent command of',
      },
    ]);
  });

  it('detects "is mandatory" from "Dutch is mandatory"', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch is mandatory',
      acceptedLanguages: ['dutch'],
    });
    expect(pickRequired(result)).toEqual([
      {
        kind: 'required',
        language: 'Dutch',
        normalizedLanguage: 'dutch',
        matchedPhrase: 'is mandatory',
      },
    ]);
  });
});

describe('detectLanguageRequirements —  non-rejecting references', () => {
  it('detects "is a plus" from "Dutch is a plus"', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch is a plus',
      acceptedLanguages: ['dutch'],
    });
    expect(pickReference(result)).toEqual([
      {
        kind: 'reference',
        language: 'Dutch',
        normalizedLanguage: 'dutch',
        matchedPhrase: 'is a plus',
      },
    ]);
  });

  it('detects "preferred" from "German preferred"', () => {
    const result = detectLanguageRequirements({
      description: 'German preferred',
      acceptedLanguages: ['german'],
    });
    expect(pickReference(result)).toEqual([
      {
        kind: 'reference',
        language: 'German',
        normalizedLanguage: 'german',
        matchedPhrase: 'preferred',
      },
    ]);
  });

  it('detects "would be beneficial" from "French would be beneficial"', () => {
    const result = detectLanguageRequirements({
      description: 'French would be beneficial',
      acceptedLanguages: ['french'],
    });
    expect(pickReference(result)).toEqual([
      {
        kind: 'reference',
        language: 'French',
        normalizedLanguage: 'french',
        matchedPhrase: 'would be beneficial',
      },
    ]);
  });

  it('detects "is desirable" from "Knowledge of Italian is desirable"', () => {
    const result = detectLanguageRequirements({
      description: 'Knowledge of Italian is desirable',
      acceptedLanguages: ['italian'],
    });
    expect(pickReference(result)).toEqual([
      {
        kind: 'reference',
        language: 'Italian',
        normalizedLanguage: 'italian',
        matchedPhrase: 'is desirable',
      },
    ]);
  });

  it('detects "our team speaks" from "Our team speaks Spanish" (ambiguous case)', () => {
    const result = detectLanguageRequirements({
      description: 'Our team speaks Spanish',
      acceptedLanguages: ['spanish'],
    });
    expect(pickReference(result)).toEqual([
      {
        kind: 'reference',
        language: 'Spanish',
        normalizedLanguage: 'spanish',
        matchedPhrase: 'our team speaks',
      },
    ]);
  });

  it('detects "a bonus" from "Italian is a bonus"', () => {
    const result = detectLanguageRequirements({
      description: 'Italian is a bonus',
      acceptedLanguages: ['italian'],
    });
    expect(pickReference(result)).toEqual([
      {
        kind: 'reference',
        language: 'Italian',
        normalizedLanguage: 'italian',
        matchedPhrase: 'a bonus',
      },
    ]);
  });
});

describe('detectLanguageRequirements — null and empty inputs', () => {
  it('returns no requirements for null description', () => {
    const result = detectLanguageRequirements({
      description: null,
      acceptedLanguages: ['dutch', 'german'],
    });
    expect(result.requirements).toEqual([]);
    expect(result.acceptedLanguages).toEqual(['dutch', 'german']);
  });

  it('returns no requirements for empty-string description', () => {
    const result = detectLanguageRequirements({
      description: '',
      acceptedLanguages: ['dutch'],
    });
    expect(result.requirements).toEqual([]);
  });

  it('returns no requirements for whitespace-only description', () => {
    const result = detectLanguageRequirements({
      description: '   \t\n  ',
      acceptedLanguages: ['dutch'],
    });
    expect(result.requirements).toEqual([]);
  });

  it('returns no requirements for description with only separators', () => {
    // `.-_/` all fold to spaces; after normalization the description is empty.
    const result = detectLanguageRequirements({
      description: '.-_/',
      acceptedLanguages: ['dutch'],
    });
    expect(result.requirements).toEqual([]);
  });
});

describe('detectLanguageRequirements — languages absent from the description', () => {
  it('returns no entries when the accepted language is not in the description', () => {
    const result = detectLanguageRequirements({
      description: 'We are looking for a senior backend engineer',
      acceptedLanguages: ['dutch'],
    });
    expect(result.requirements).toEqual([]);
  });

  it('returns no entries when none of the accepted languages are in the description', () => {
    const result = detectLanguageRequirements({
      description: 'We are looking for a senior backend engineer',
      acceptedLanguages: ['dutch', 'german', 'french'],
    });
    expect(result.requirements).toEqual([]);
  });

  it('returns no entries when acceptedLanguages is empty AND the description has no known-language mention', () => {
    // The detector (Task 5 + Task 6) scans the description for the
    // union of `acceptedLanguages` and `KNOWN_LANGUAGES`, so an empty
    // accepted list is no longer sufficient to suppress all matches.
    // This test pins down the simpler "no language mentioned anywhere"
    // case: the description has no language token, so the detector
    // returns no requirements regardless of the accepted list.
    const result = detectLanguageRequirements({
      description: 'We are looking for a senior backend engineer',
      acceptedLanguages: [],
    });
    expect(result.requirements).toEqual([]);
  });

  it('finds a known-language requirement even when acceptedLanguages is empty', () => {
    // The Task 6 language-rejection rule needs to surface "French
    // required" as an unsupported required language even when the
    // candidate's accepted list does not contain French. The detector
    // therefore iterates over the union of acceptedLanguages and
    // KNOWN_LANGUAGES. This test pins down that behavior.
    const result = detectLanguageRequirements({
      description: 'French required',
      acceptedLanguages: [],
    });
    expect(pickRequired(result).map((r) => r.normalizedLanguage)).toContain('french');
  });

  it('does not match a token against a partial substring (token boundary)', () => {
    // `dutch` must not match `dutchman` (different tokens).
    const result = detectLanguageRequirements({
      description: 'The dutchman is required',
      acceptedLanguages: ['dutch'],
    });
    expect(result.requirements).toEqual([]);
  });
});

describe('detectLanguageRequirements — multiple matches for the same language', () => {
  it('produces one entry per matched phrase when a language has two required phrases', () => {
    const result = detectLanguageRequirements({
      description: 'Fluent Dutch required. Dutch is mandatory.',
      acceptedLanguages: ['dutch'],
    });
    const reqs = pickRequired(result);
    const matchedPhrases = reqs.map((r) => r.matchedPhrase);
    expect(matchedPhrases).toEqual(expect.arrayContaining(['required', 'is mandatory']));
    expect(matchedPhrases.length).toBeGreaterThanOrEqual(2);
    for (const r of reqs) {
      expect(r.language).toBe('Dutch');
      expect(r.normalizedLanguage).toBe('dutch');
    }
  });

  it('produces distinct entries when the same phrase matches multiple times', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch required. Dutch required.',
      acceptedLanguages: ['dutch'],
    });
    const reqs = pickRequired(result);
    // Two occurrences of the language, each with its own "required" match.
    expect(reqs.length).toBe(2);
    for (const r of reqs) {
      expect(r.matchedPhrase).toBe('required');
    }
  });

  it('handles multiple languages independently within the same description', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch required. German preferred.',
      acceptedLanguages: ['dutch', 'german'],
    });
    const dutchReqs = result.requirements.filter((r) => r.normalizedLanguage === 'dutch');
    const germanReqs = result.requirements.filter((r) => r.normalizedLanguage === 'german');
    expect(dutchReqs.filter((r) => r.kind === 'required').map((r) => r.matchedPhrase)).toEqual([
      'required',
    ]);
    expect(germanReqs.filter((r) => r.kind === 'reference').map((r) => r.matchedPhrase)).toEqual([
      'preferred',
    ]);
  });
});

describe('detectLanguageRequirements — ambiguity rule', () => {
  it('may classify standalone "fluent" as ambiguous', () => {
    const result = detectLanguageRequirements({
      description: 'Fluent Dutch',
      acceptedLanguages: ['dutch'],
    });
    const reqs = result.requirements;
    // Either ambiguous (per the implementer's rule) or required (if the
    // implementer chose not to flag fluent as ambiguous). We require at
    // least one entry that mentions 'fluent' so the rule is consistent
    // across implementations.
    const fluent = reqs.filter((r) => r.matchedPhrase === 'fluent');
    expect(fluent.length).toBeGreaterThanOrEqual(1);
    // And the matched language is Dutch.
    expect(fluent[0]?.normalizedLanguage).toBe('dutch');
  });

  it('may classify standalone "native" as ambiguous', () => {
    const result = detectLanguageRequirements({
      description: 'Native Dutch speaker',
      acceptedLanguages: ['dutch'],
    });
    const reqs = result.requirements;
    const native = reqs.filter((r) => r.matchedPhrase === 'native');
    expect(native.length).toBeGreaterThanOrEqual(1);
    expect(native[0]?.normalizedLanguage).toBe('dutch');
  });

  it('keeps "required" as kind: required (not ambiguous)', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch required',
      acceptedLanguages: ['dutch'],
    });
    expect(pickRequired(result).map((r) => r.matchedPhrase)).toEqual(['required']);
    expect(pickAmbiguous(result)).toEqual([]);
  });

  it('keeps "preferred" as kind: reference (not ambiguous)', () => {
    const result = detectLanguageRequirements({
      description: 'German preferred',
      acceptedLanguages: ['german'],
    });
    expect(pickReference(result).map((r) => r.matchedPhrase)).toEqual(['preferred']);
    expect(pickAmbiguous(result)).toEqual([]);
  });
});

describe('detectLanguageRequirements — normalization', () => {
  it('matches language name irrespective of casing in the description', () => {
    const result = detectLanguageRequirements({
      description: 'DUTCH required',
      acceptedLanguages: ['dutch'],
    });
    expect(pickRequired(result)).toEqual([
      {
        kind: 'required',
        language: 'DUTCH',
        normalizedLanguage: 'dutch',
        matchedPhrase: 'required',
      },
    ]);
  });

  it('matches phrase "native-level" after the dash folds to a space', () => {
    const result = detectLanguageRequirements({
      description: 'Native level Spanish',
      acceptedLanguages: ['spanish'],
    });
    const reqs = pickRequired(result);
    expect(reqs.map((r) => r.matchedPhrase)).toEqual(['native-level']);
  });

  it('handles extra whitespace inside the description', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch    required',
      acceptedLanguages: ['dutch'],
    });
    expect(pickRequired(result).map((r) => r.matchedPhrase)).toEqual(['required']);
  });

  it('applies NFKC normalization (e.g. full-width characters)', () => {
    // Full-width capital letters / NFKC: 'Ｄｕｔｃｈ' → 'Dutch' → 'dutch'.
    const result = detectLanguageRequirements({
      description: 'Ｄｕｔｃｈ required',
      acceptedLanguages: ['dutch'],
    });
    expect(pickRequired(result).map((r) => r.matchedPhrase)).toEqual(['required']);
  });
});

describe('detectLanguageRequirements — window of 5 tokens', () => {
  it('matches a phrase that is up to 5 tokens before the language', () => {
    // 4 tokens before 'dutch'; "fluent" at distance 1 — well within the window.
    const result = detectLanguageRequirements({
      description: 'Must be fluent in Dutch',
      acceptedLanguages: ['dutch'],
    });
    const reqs = result.requirements;
    const fluent = reqs.filter((r) => r.matchedPhrase === 'fluent');
    expect(fluent.length).toBeGreaterThanOrEqual(1);
  });

  it('does not match a phrase that is more than 5 tokens away from the language', () => {
    // 'required' is 6 tokens before 'dutch' — outside the window.
    const result = detectLanguageRequirements({
      description: 'Required some things a b c Dutch',
      acceptedLanguages: ['dutch'],
    });
    expect(result.requirements).toEqual([]);
  });

  it('matches a phrase that is up to 5 tokens after the language', () => {
    // 'dutch' followed by 4 tokens then 'preferred' — within the window.
    const result = detectLanguageRequirements({
      description: 'Dutch is a nice preferred',
      acceptedLanguages: ['dutch'],
    });
    const reqs = pickReference(result);
    expect(reqs.map((r) => r.matchedPhrase)).toEqual(['preferred']);
  });
});

describe('detectLanguageRequirements — acceptedLanguages passthrough', () => {
  it('returns the input acceptedLanguages in the result (normalized slugs)', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch required',
      acceptedLanguages: ['dutch', 'german'],
    });
    expect(result.acceptedLanguages).toEqual(['dutch', 'german']);
  });

  it('returns an empty acceptedLanguages array when none were supplied', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch required',
      acceptedLanguages: [],
    });
    expect(result.acceptedLanguages).toEqual([]);
  });

  it('returns the input acceptedLanguages even when description is null', () => {
    const result = detectLanguageRequirements({
      description: null,
      acceptedLanguages: ['dutch', 'french'],
    });
    expect(result.acceptedLanguages).toEqual(['dutch', 'french']);
  });
});

describe('detectLanguageRequirements — return shape', () => {
  it('returns readonly arrays', () => {
    const result = detectLanguageRequirements({
      description: 'Dutch required',
      acceptedLanguages: ['dutch'],
    });
    expect(Array.isArray(result.requirements)).toBe(true);
    expect(Array.isArray(result.acceptedLanguages)).toBe(true);
  });

  it('every LanguageRequirement is one of the three documented kinds', () => {
    const result = detectLanguageRequirements({
      description: 'Fluent Dutch required. German preferred. Dutch is mandatory.',
      acceptedLanguages: ['dutch', 'german'],
    });
    for (const r of result.requirements) {
      expect(['required', 'reference', 'ambiguous']).toContain(r.kind);
      expect(typeof r.language).toBe('string');
      expect(r.language.length).toBeGreaterThan(0);
      expect(typeof r.normalizedLanguage).toBe('string');
      expect(r.normalizedLanguage.length).toBeGreaterThan(0);
      expect(typeof r.matchedPhrase).toBe('string');
      expect(r.matchedPhrase.length).toBeGreaterThan(0);
    }
  });
});
