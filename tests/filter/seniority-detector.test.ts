import { describe, expect, it } from 'vitest';

import { detectSeniority } from '../../src/filter/seniority-detector.js';

/**
 *  — `seniority-detector.ts` tests.
 *
 *  example mapping covers the deterministic seniority detection
 * surface for job titles. The detector walks a normalized title's token
 * stream against the inline phrase map and returns:
 *
 *   - `{ detected: 'unknown', matchedPhrases: [] }` for null / empty /
 *     unlabelled titles;
 *   - the highest-rank detected level otherwise, alongside the sorted list
 *     of matched phrases.
 *
 * Multi-word phrases (`entry level`, `engineering manager`, `head of`,
 * `tech lead`, `team lead`, `vice president`, `mid level` after the
 * separator-fold of `mid-level`) are stored as single space-separated
 * keys and matched against the normalized token stream.
 */

describe('detectSeniority —  example titles', () => {
  it('returns unknown for an unlabelled Software Engineer title', () => {
    const result = detectSeniority('Software Engineer');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('returns unknown for an unlabelled Frontend Developer title', () => {
    const result = detectSeniority('Frontend Developer');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('detects senior from "Senior Software Engineer"', () => {
    const result = detectSeniority('Senior Software Engineer');
    expect(result.detected).toBe('senior');
    const phrases = result.matchedPhrases.map((m) => m.phrase);
    expect(phrases).toContain('senior');
  });

  it('detects junior from "Junior Developer"', () => {
    const result = detectSeniority('Junior Developer');
    expect(result.detected).toBe('junior');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('junior');
  });

  it('detects intern from "Intern"', () => {
    const result = detectSeniority('Intern');
    expect(result.detected).toBe('intern');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('intern');
  });

  it('detects staff from "Staff Engineer"', () => {
    const result = detectSeniority('Staff Engineer');
    expect(result.detected).toBe('staff');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('staff');
  });

  it('detects principal from "Principal Engineer"', () => {
    const result = detectSeniority('Principal Engineer');
    expect(result.detected).toBe('principal');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('principal');
  });

  it('detects lead from "Tech Lead" (multi-word phrase)', () => {
    const result = detectSeniority('Tech Lead');
    expect(result.detected).toBe('lead');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('tech lead');
  });

  it('detects lead from "Team Lead" (multi-word phrase)', () => {
    const result = detectSeniority('Team Lead');
    expect(result.detected).toBe('lead');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('team lead');
  });

  it('detects manager from "Engineering Manager" (multi-word phrase)', () => {
    const result = detectSeniority('Engineering Manager');
    expect(result.detected).toBe('manager');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('engineering manager');
  });

  it('detects director from "Director of Engineering"', () => {
    const result = detectSeniority('Director of Engineering');
    expect(result.detected).toBe('director');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('director');
  });

  it('detects director from "Head of Engineering" (multi-word phrase)', () => {
    const result = detectSeniority('Head of Engineering');
    expect(result.detected).toBe('director');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('head of');
  });

  it('detects executive from "VP of Engineering"', () => {
    const result = detectSeniority('VP of Engineering');
    expect(result.detected).toBe('executive');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('vp');
  });

  it('detects executive from "Chief Technology Officer"', () => {
    const result = detectSeniority('Chief Technology Officer');
    expect(result.detected).toBe('executive');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('chief');
  });

  it('detects mid from "Mid-level" (after hyphen-to-space normalization)', () => {
    const result = detectSeniority('Mid-level');
    expect(result.detected).toBe('mid');
    const phrases = result.matchedPhrases.map((m) => m.phrase);
    expect(phrases).toContain('mid');
    expect(phrases).toContain('mid level');
  });

  it('detects junior from "entry level" (multi-word phrase)', () => {
    const result = detectSeniority('entry level');
    expect(result.detected).toBe('junior');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('entry level');
  });
});

describe('detectSeniority — highest-rank wins', () => {
  it('picks manager (higher rank) over senior in "Senior Engineering Manager"', () => {
    const result = detectSeniority('Senior Engineering Manager');
    expect(result.detected).toBe('manager');
    const phrases = result.matchedPhrases.map((m) => m.phrase);
    expect(phrases).toContain('senior');
    expect(phrases).toContain('engineering manager');
  });

  it('picks executive (higher rank) over senior in "Senior VP"', () => {
    const result = detectSeniority('Senior VP');
    expect(result.detected).toBe('executive');
    const phrases = result.matchedPhrases.map((m) => m.phrase);
    expect(phrases).toContain('senior');
    expect(phrases).toContain('vp');
  });

  it('picks executive (higher rank) over director in "Head of VP Strategy"', () => {
    const result = detectSeniority('Head of VP Strategy');
    expect(result.detected).toBe('executive');
    const phrases = result.matchedPhrases.map((m) => m.phrase);
    expect(phrases).toContain('head of');
    expect(phrases).toContain('vp');
  });
});

describe('detectSeniority — null and empty inputs', () => {
  it('returns unknown for null input', () => {
    const result = detectSeniority(null);
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('returns unknown for an empty-string input', () => {
    const result = detectSeniority('');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('returns unknown for whitespace-only input', () => {
    const result = detectSeniority('   \t\n');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('returns unknown for a title of only separator characters', () => {
    // `.-_/` all fold to spaces; after trimming the title is empty.
    const result = detectSeniority('.-_/');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });
});

describe('detectSeniority — unlabelled titles', () => {
  it('returns unknown for a non-seniority single word', () => {
    const result = detectSeniority('act');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('returns unknown for "Software Engineer"', () => {
    const result = detectSeniority('Software Engineer');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });
});

describe('detectSeniority — token boundaries', () => {
  it('does NOT match `vp` against `vpasdf`', () => {
    const result = detectSeniority('vpasdf');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('does NOT match `cto` against `actor`', () => {
    const result = detectSeniority('actor');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('does NOT match `sr` against `sr-` or surrounding punctuation inside a single token', () => {
    const result = detectSeniority('srx');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });

  it('does NOT match `junior` against `juniorship`', () => {
    const result = detectSeniority('juniorship');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });
});

describe('detectSeniority — normalization', () => {
  it('matches `sr` after `Sr.` is folded to a space-separated token', () => {
    const result = detectSeniority('Sr. Software Engineer');
    expect(result.detected).toBe('senior');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('sr');
  });

  it('handles mixed-case title text', () => {
    const result = detectSeniority('SENIOR ENGINEER');
    expect(result.detected).toBe('senior');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('senior');
  });

  it('detects internship from "Internship"', () => {
    const result = detectSeniority('Software Engineering Internship');
    expect(result.detected).toBe('intern');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('internship');
  });

  it('detects trainee from "Trainee"', () => {
    const result = detectSeniority('Engineering Trainee');
    expect(result.detected).toBe('intern');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('trainee');
  });

  it('detects intermediate from "Intermediate Developer"', () => {
    const result = detectSeniority('Intermediate Developer');
    expect(result.detected).toBe('mid');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('intermediate');
  });

  it('detects junior from "Graduate Engineer"', () => {
    const result = detectSeniority('Graduate Engineer');
    expect(result.detected).toBe('junior');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('graduate');
  });
});

describe('detectSeniority — multi-word phrase coverage', () => {
  it('matches "vice president" as a single multi-word phrase', () => {
    const result = detectSeniority('Vice President of Engineering');
    expect(result.detected).toBe('executive');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('vice president');
  });

  it('matches "engineering manager" inside "engineering manager of X"', () => {
    const result = detectSeniority('Engineering Manager of Platform');
    expect(result.detected).toBe('manager');
    expect(result.matchedPhrases.map((m) => m.phrase)).toContain('engineering manager');
  });

  it('does NOT match `head of` when an intervening word breaks consecutiveness', () => {
    // `head of` is a multi-word phrase in the  map; inserting a
    // token between `head` and `of` must defeat the match.
    const result = detectSeniority('head workplace of engineering');
    expect(result.detected).toBe('unknown');
    expect(result.matchedPhrases).toEqual([]);
  });
});

describe('detectSeniority — return shape', () => {
  it('returns a frozen-shape result with readonly matchedPhrases', () => {
    const result = detectSeniority('Senior Engineer');
    expect(result).toEqual({
      detected: 'senior',
      matchedPhrases: expect.any(Array),
    });
    // The detected level is one of the 11 known outcomes (including unknown).
    const knownLevels = [
      'intern',
      'junior',
      'mid',
      'senior',
      'staff',
      'principal',
      'lead',
      'manager',
      'director',
      'executive',
      'unknown',
    ] as const;
    expect(knownLevels).toContain(result.detected);
    for (const match of result.matchedPhrases) {
      expect(match.phrase.length).toBeGreaterThan(0);
      // The level is a known non-unknown outcome.
      expect(knownLevels).toContain(match.level);
      expect(match.level).not.toBe('unknown');
    }
  });

  it('matches are sorted by ascending rank in SENIORITY_LEVELS', () => {
    const result = detectSeniority('Senior Engineering Manager');
    // The matched phrases are [senior (rank 3), engineering manager (rank 7)]
    // in ascending rank order; detected is the highest (last).
    expect(result.matchedPhrases[0]?.level).toBe('senior');
    expect(result.matchedPhrases.at(-1)?.level).toBe('manager');
    expect(result.detected).toBe('manager');
  });
});
