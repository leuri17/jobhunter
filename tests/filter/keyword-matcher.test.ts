import { describe, expect, it } from 'vitest';

import { matchKeywords, type KeywordMatchHit } from '../../src/filter/keyword-matcher.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';

/**
 * TASK-010 Task 3 — `keyword-matcher.ts` tests.
 *
 * `matchKeywords` walks the four keyword lists (`title.excludedKeywords`,
 * `title.requiredAnyKeywords`, `description.excludedKeywords`,
 * `description.requiredAnyKeywords`) and, for each entry, runs the
 * token-stream matcher against the corresponding field. Hits are reported
 * individually with the starting index of the matched token window.
 *
 * `requiredAnySatisfied` is `true` when:
 *   - both required-any lists are empty (the rule does not apply), OR
 *   - at least one keyword produced a hit.
 */

function minimalConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: [],
    title: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    description: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    seniority: {
      maximum: null,
    },
    languages: {
      accepted: [],
      rejectWhenExplicitlyRequiresOtherLanguage: false,
    },
  };
}

function withLists(
  title: { excluded: string[]; requiredAny: string[] },
  description: { excluded: string[]; requiredAny: string[] },
): JobFilterConfig {
  return {
    ...minimalConfig(),
    title: {
      excludedKeywords: title.excluded,
      requiredAnyKeywords: title.requiredAny,
    },
    description: {
      excludedKeywords: description.excluded,
      requiredAnyKeywords: description.requiredAny,
    },
  };
}

const SAMPLE_JOB = {
  title: 'Senior Backend Engineer Node.js',
  description:
    'We are looking for a machine learning engineer with experience ' +
    'in distributed systems and TypeScript.',
};

describe('matchKeywords — empty configuration', () => {
  it('returns no hits and a satisfied required-any when every list is empty', () => {
    const result = matchKeywords(minimalConfig(), SAMPLE_JOB);
    expect(result.excludedHits).toEqual([]);
    expect(result.requiredAnyHits).toEqual([]);
    expect(result.requiredAnySatisfied).toBe(true);
  });
});

describe('matchKeywords — excluded keywords', () => {
  it('reports a hit when a title excluded keyword matches the title', () => {
    const config = withLists(
      { excluded: ['senior'], requiredAny: [] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toHaveLength(1);
    expect(result.excludedHits[0]).toEqual({
      field: 'title',
      keyword: 'senior',
      matchedTokenIndex: 0,
    });
  });

  it('reports a hit when a title excluded keyword matches the description', () => {
    const config = withLists(
      { excluded: ['distributed systems'], requiredAny: [] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toHaveLength(1);
    expect(result.excludedHits[0]).toEqual({
      field: 'title',
      keyword: 'distributed systems',
      matchedTokenIndex: expect.any(Number) as unknown as number,
    });
  });

  it('reports a hit when a description excluded keyword matches the description', () => {
    const config = withLists(
      { excluded: [], requiredAny: [] },
      { excluded: ['machine learning'], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toHaveLength(1);
    expect(result.excludedHits[0]).toEqual({
      field: 'description',
      keyword: 'machine learning',
      matchedTokenIndex: expect.any(Number) as unknown as number,
    });
  });

  it('reports no hit when an excluded keyword does not match anywhere', () => {
    const config = withLists(
      { excluded: ['sales'], requiredAny: [] },
      { excluded: ['clearance required'], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toEqual([]);
  });

  it('reports multiple hits when multiple excluded keywords match', () => {
    const config = withLists(
      { excluded: ['senior'], requiredAny: [] },
      { excluded: ['typescript'], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toHaveLength(2);
    const fields = result.excludedHits.map((hit) => hit.field);
    expect(fields).toContain('title');
    expect(fields).toContain('description');
  });

  it('matches the same excluded keyword against both fields and reports two hits', () => {
    const config = withLists(
      { excluded: ['engineer'], requiredAny: [] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    // The brief: title.excludedKeywords matches against BOTH title and
    // description. The keyword `engineer` appears in both fields, so two
    // hits are reported — both tagged with `field: 'title'` because the
    // keyword comes from the title list.
    expect(result.excludedHits).toHaveLength(2);
    expect(
      result.excludedHits.every((hit) => hit.field === 'title' && hit.keyword === 'engineer'),
    ).toBe(true);
  });

  it('reports an excluded hit for a punctuation-variant keyword', () => {
    const config = withLists(
      { excluded: ['node-js'], requiredAny: [] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toHaveLength(1);
    expect(result.excludedHits[0]?.field).toBe('title');
  });

  it('does NOT match a keyword across token boundaries (JavaScript ≠ Java)', () => {
    const config = withLists(
      { excluded: ['java'], requiredAny: [] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toEqual([]);
  });

  it('treats a null title as empty (no hit)', () => {
    const config = withLists(
      { excluded: ['senior'], requiredAny: [] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, { title: null, description: SAMPLE_JOB.description });
    expect(result.excludedHits).toEqual([]);
  });

  it('treats a null description as empty (no hit)', () => {
    const config = withLists(
      { excluded: [], requiredAny: [] },
      { excluded: ['typescript'], requiredAny: [] },
    );
    const result = matchKeywords(config, { title: SAMPLE_JOB.title, description: null });
    expect(result.excludedHits).toEqual([]);
  });
});

describe('matchKeywords — required-any keywords', () => {
  it('reports a hit when a title required-any keyword matches the title', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['node.js'] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnyHits).toHaveLength(1);
    expect(result.requiredAnyHits[0]).toEqual({
      field: 'title',
      keyword: 'node.js',
      matchedTokenIndex: expect.any(Number) as unknown as number,
    });
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports a hit when a title required-any keyword matches the description', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['typescript'] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnyHits).toHaveLength(1);
    expect(result.requiredAnyHits[0]?.field).toBe('title');
    expect(result.requiredAnyHits[0]?.keyword).toBe('typescript');
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports a hit when a description required-any keyword matches the description', () => {
    const config = withLists(
      { excluded: [], requiredAny: [] },
      { excluded: [], requiredAny: ['machine learning'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnyHits).toHaveLength(1);
    expect(result.requiredAnyHits[0]).toEqual({
      field: 'description',
      keyword: 'machine learning',
      matchedTokenIndex: expect.any(Number) as unknown as number,
    });
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports a hit when a description required-any keyword matches the title', () => {
    const config = withLists(
      { excluded: [], requiredAny: [] },
      { excluded: [], requiredAny: ['backend'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnyHits).toHaveLength(1);
    expect(result.requiredAnyHits[0]?.field).toBe('description');
    expect(result.requiredAnyHits[0]?.keyword).toBe('backend');
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports requiredAnySatisfied=true when both required-any lists are empty', () => {
    const config = withLists({ excluded: [], requiredAny: [] }, { excluded: [], requiredAny: [] });
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnyHits).toEqual([]);
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports requiredAnySatisfied=true when only the title required-any list is empty', () => {
    const config = withLists(
      { excluded: [], requiredAny: [] },
      { excluded: [], requiredAny: ['typescript'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports requiredAnySatisfied=true when only the description required-any list is empty', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['typescript'] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports requiredAnySatisfied=false when neither required-any list has a hit', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['rust'] },
      { excluded: [], requiredAny: ['go'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnyHits).toEqual([]);
    expect(result.requiredAnySatisfied).toBe(false);
  });

  it('reports requiredAnySatisfied=true when only the title required-any produces a hit', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['node.js'] },
      { excluded: [], requiredAny: ['rust'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports requiredAnySatisfied=true when only the description required-any produces a hit', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['rust'] },
      { excluded: [], requiredAny: ['typescript'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('reports every successful match (multiple required-any hits are preserved)', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['node.js', 'senior'] },
      { excluded: [], requiredAny: ['typescript', 'machine learning'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.requiredAnyHits).toHaveLength(4);
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('records matchedTokenIndex = 0 for a keyword that matches at the start of the field', () => {
    const config = withLists(
      { excluded: [], requiredAny: ['senior'] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    const hit = result.requiredAnyHits.find(
      (entry) => entry.keyword === 'senior' && entry.field === 'title',
    );
    expect(hit).toBeDefined();
    expect(hit?.matchedTokenIndex).toBe(0);
  });

  it('records matchedTokenIndex that points at the start of the matching window for a multi-word keyword', () => {
    const config = withLists(
      { excluded: [], requiredAny: [] },
      { excluded: [], requiredAny: ['machine learning'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    const hit = result.requiredAnyHits.find(
      (entry) => entry.keyword === 'machine learning' && entry.field === 'description',
    );
    expect(hit).toBeDefined();
    expect(hit?.matchedTokenIndex).toBeGreaterThan(0);
  });

  it('treats a null title as empty (no hit when no match in description either)', () => {
    // The brief: title.requiredAnyKeywords matches against both title and
    // description. With a null title, the title-side match is skipped, but
    // the description-side match still runs. To produce a true "no hit"
    // scenario we use a keyword that exists in the title but not in the
    // description.
    const config = withLists(
      { excluded: [], requiredAny: ['backend'] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, { title: null, description: SAMPLE_JOB.description });
    expect(result.requiredAnyHits).toEqual([]);
    expect(result.requiredAnySatisfied).toBe(false);
  });

  it('still matches title required-any keywords in the description when title is null', () => {
    // The brief: title.requiredAnyKeywords matches against both title and
    // description. With a null title, the description-side match still
    // runs and produces a hit.
    const config = withLists(
      { excluded: [], requiredAny: ['typescript'] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, { title: null, description: SAMPLE_JOB.description });
    expect(result.requiredAnyHits).toHaveLength(1);
    expect(result.requiredAnyHits[0]).toEqual({
      field: 'title',
      keyword: 'typescript',
      matchedTokenIndex: 14,
    });
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('treats a null description as empty (no hit, required-any fails)', () => {
    const config = withLists(
      { excluded: [], requiredAny: [] },
      { excluded: [], requiredAny: ['typescript'] },
    );
    const result = matchKeywords(config, { title: SAMPLE_JOB.title, description: null });
    expect(result.requiredAnyHits).toEqual([]);
    expect(result.requiredAnySatisfied).toBe(false);
  });

  it('still satisfies required-any when only one of the two fields is null and the other list is empty', () => {
    // Both required-any lists empty → trivially satisfied.
    const config = withLists({ excluded: [], requiredAny: [] }, { excluded: [], requiredAny: [] });
    const result = matchKeywords(config, { title: null, description: null });
    expect(result.requiredAnySatisfied).toBe(true);
  });
});

describe('matchKeywords — combined behavior', () => {
  it('reports excluded and required-any hits independently', () => {
    const config = withLists(
      { excluded: ['sales'], requiredAny: ['typescript'] },
      { excluded: ['clearance required'], requiredAny: ['machine learning'] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    expect(result.excludedHits).toEqual([]);
    expect(result.requiredAnyHits).toHaveLength(2);
    expect(result.requiredAnySatisfied).toBe(true);
  });

  it('returns frozen-shape result arrays (immutable view returned by the function)', () => {
    const config = withLists(
      { excluded: ['senior'], requiredAny: ['typescript'] },
      { excluded: [], requiredAny: [] },
    );
    const result = matchKeywords(config, SAMPLE_JOB);
    // The result type uses `readonly` arrays, so the TypeScript compiler
    // already enforces immutability. We sanity-check the runtime shape here.
    expect(Array.isArray(result.excludedHits)).toBe(true);
    expect(Array.isArray(result.requiredAnyHits)).toBe(true);
    expect(result.excludedHits[0]).toBeDefined();
    const sample: KeywordMatchHit = result.excludedHits[0] as KeywordMatchHit;
    expect(typeof sample.field).toBe('string');
    expect(typeof sample.keyword).toBe('string');
    expect(typeof sample.matchedTokenIndex).toBe('number');
  });

  it('returns the same result on repeated invocation with the same input', () => {
    const config = withLists(
      { excluded: ['senior'], requiredAny: ['typescript'] },
      { excluded: [], requiredAny: ['machine learning'] },
    );
    const first = matchKeywords(config, SAMPLE_JOB);
    const second = matchKeywords(config, SAMPLE_JOB);
    expect(second).toEqual(first);
  });
});
