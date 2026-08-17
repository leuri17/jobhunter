import { afterEach, describe, expect, it, vi } from 'vitest';

import * as keywordMatcher from '../../src/filter/keyword-matcher.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';
import { evaluateJob, type JobInput, type RuleEvaluation } from '../../src/filter/evaluate.js';

/**
 * TASK-010 Task 6 — `evaluate.ts` tests.
 *
 * `evaluateJob` composes the seven deterministic filter rules from
 * SPEC §17–§20 into a single auditable decision. The tests cover:
 *
 *   1. End-to-end behaviour for each rule in isolation.
 *   2. The no-rule-evaluates baseline (every rule abstains or passes).
 *   3. The "filter errors are not rejections" error path (synthetic
 *      helper failure → `overallOutcome: 'error'`, `rejectionReasons: []`).
 *   4. Required-any empty list → rule abstains, overall is unaffected.
 *   5. Bilingual job: two unsupported required languages → two reasons.
 *   6. Stale input with `null` title / `null` description → no crash,
 *      affected rules abstain.
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

const SAMPLE_JOB: JobInput = {
  title: 'Senior Backend Engineer Node.js',
  company: 'Acme Corp',
  location: 'Amsterdam, NL',
  description:
    'We are looking for a machine learning engineer with experience ' +
    'in distributed systems and TypeScript.',
};

function findRule(
  evaluations: readonly RuleEvaluation[],
  ruleId: string,
): RuleEvaluation | undefined {
  return evaluations.find((entry) => entry.ruleId === ruleId);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('evaluateJob — baseline (no rule applies)', () => {
  it('returns accepted with empty rejection reasons when every rule abstains or passes', () => {
    const result = evaluateJob(minimalConfig(), SAMPLE_JOB);
    expect(result.overallOutcome).toBe('accepted');
    expect(result.rejectionReasons).toEqual([]);
    expect(result.rulesFailed).toEqual([]);
    // 7 rules total; with the minimal config:
    //   - excluded-companies         → passed (Acme Corp not in [])
    //   - title-excluded-keywords    → passed (no excluded list)
    //   - title-required-any-keywords → abstained (empty list)
    //   - description-excluded-keywords → passed (no excluded list)
    //   - description-required-any-keywords → abstained (empty list)
    //   - max-seniority              → abstained (maximum === null)
    //   - language-rejection         → abstained (flag off)
    // So rulesPassed has 3 entries, the remaining 4 are abstained.
    expect(result.rulesPassed).toHaveLength(3);
    expect(result.rulesEvaluated).toHaveLength(7);
  });

  it('partitions rulesEvaluated into rulesPassed and rulesFailed (no abstains counted separately)', () => {
    const result = evaluateJob(minimalConfig(), SAMPLE_JOB);
    const passedIds = result.rulesPassed.map((r) => r.ruleId).sort();
    const failedIds = result.rulesFailed.map((r) => r.ruleId).sort();
    expect(failedIds).toEqual([]); // sanity: no failures
    expect(passedIds).toEqual([
      'description-excluded-keywords',
      'excluded-companies',
      'title-excluded-keywords',
    ]);
  });
});

describe('evaluateJob — rule 1: excluded-companies', () => {
  it('fails with the original-case name when the company matches an excluded entry', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['Acme Corp', 'Beta LLC'],
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('rejected');
    expect(result.rejectionReasons).toEqual(['excluded_company:Acme Corp']);
    const rule = findRule(result.rulesFailed, 'excluded-companies');
    expect(rule).toBeDefined();
    expect(rule?.outcome).toBe('failed');
    expect(rule?.reason).toBe('excluded_company:Acme Corp');
  });

  it('matches case-insensitively (whitespace + casing)', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['ACME  CORP'],
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('rejected');
    // The reason carries the original (config-side) casing, not the
    // normalized form.
    expect(result.rejectionReasons).toEqual(['excluded_company:ACME  CORP']);
  });

  it('passes when the company is null and the excluded list is empty', () => {
    const result = evaluateJob(minimalConfig(), { ...SAMPLE_JOB, company: null });
    expect(result.overallOutcome).toBe('accepted');
    const rule = findRule(result.rulesPassed, 'excluded-companies');
    expect(rule).toBeDefined();
    expect(rule?.outcome).toBe('passed');
  });

  it('passes for null company even when excludedCompanies is non-empty (no hit ⇒ passed)', () => {
    // SPEC §17.4 "no hit ⇒ passed" — a null company has no possible
    // exclusion, so the rule passes. This is intentionally different
    // from title/description abstention, which the brief calls out
    // explicitly ("Stale input with null title / null description ⇒
    // rules abstained for affected sections").
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['Acme Corp'],
    };
    const result = evaluateJob(config, { ...SAMPLE_JOB, company: null });
    expect(result.overallOutcome).toBe('accepted');
    const rule = findRule(result.rulesPassed, 'excluded-companies');
    expect(rule).toBeDefined();
    expect(rule?.outcome).toBe('passed');
    expect(result.rejectionReasons).toEqual([]);
  });
});

describe('evaluateJob — rule 2: title-excluded-keywords', () => {
  it('fails when a title excluded keyword matches the title', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      title: { ...minimalConfig().title, excludedKeywords: ['senior'] },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('rejected');
    expect(result.rejectionReasons).toContain('title_excluded_keyword:senior:senior');
    const rule = findRule(result.rulesFailed, 'title-excluded-keywords');
    expect(rule?.reason).toBe('title_excluded_keyword:senior:senior');
  });

  it('passes when the title excluded list is empty', () => {
    const result = evaluateJob(minimalConfig(), SAMPLE_JOB);
    const rule = findRule(result.rulesPassed, 'title-excluded-keywords');
    expect(rule).toBeDefined();
  });

  it('abstains for null title', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      title: { ...minimalConfig().title, excludedKeywords: ['senior'] },
    };
    const result = evaluateJob(config, { ...SAMPLE_JOB, title: null });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'title-excluded-keywords');
    expect(rule?.outcome).toBe('abstained');
    expect(result.overallOutcome).toBe('accepted');
  });
});

describe('evaluateJob — rule 3: title-required-any-keywords', () => {
  it('abstains when the title required-any list is empty', () => {
    // The minimal config has empty required-any lists on both fields.
    // The rule does NOT apply, so the overall is unaffected.
    const result = evaluateJob(minimalConfig(), SAMPLE_JOB);
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'title-required-any-keywords');
    expect(rule?.outcome).toBe('abstained');
    expect(rule?.reason).toBe('title_required_any_not_applicable');
    expect(result.overallOutcome).toBe('accepted');
    expect(result.rejectionReasons).toEqual([]);
  });

  it('fails when the title required-any list is non-empty and no keyword matches', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      title: { ...minimalConfig().title, requiredAnyKeywords: ['rust'] },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('rejected');
    expect(result.rejectionReasons).toContain('title_required_any_no_match');
    const rule = findRule(result.rulesFailed, 'title-required-any-keywords');
    expect(rule?.reason).toBe('title_required_any_no_match');
  });

  it('passes when the title required-any list is non-empty and at least one keyword matches', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      title: { ...minimalConfig().title, requiredAnyKeywords: ['node.js', 'rust'] },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('accepted');
    const rule = findRule(result.rulesPassed, 'title-required-any-keywords');
    expect(rule).toBeDefined();
    expect(rule?.outcome).toBe('passed');
  });

  it('abstains for null title even when the required-any list is non-empty', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      title: { ...minimalConfig().title, requiredAnyKeywords: ['node.js'] },
    };
    const result = evaluateJob(config, { ...SAMPLE_JOB, title: null });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'title-required-any-keywords');
    expect(rule?.outcome).toBe('abstained');
  });
});

describe('evaluateJob — rule 4: description-excluded-keywords', () => {
  it('fails when a description excluded keyword matches the description', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      description: { ...minimalConfig().description, excludedKeywords: ['machine learning'] },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('rejected');
    expect(result.rejectionReasons).toContain(
      'description_excluded_keyword:machine learning:machine learning',
    );
    const rule = findRule(result.rulesFailed, 'description-excluded-keywords');
    expect(rule?.reason).toBe('description_excluded_keyword:machine learning:machine learning');
  });

  it('abstains for null description', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      description: { ...minimalConfig().description, excludedKeywords: ['machine learning'] },
    };
    const result = evaluateJob(config, { ...SAMPLE_JOB, description: null });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'description-excluded-keywords');
    expect(rule?.outcome).toBe('abstained');
  });
});

describe('evaluateJob — rule 5: description-required-any-keywords', () => {
  it('abstains when the description required-any list is empty', () => {
    const result = evaluateJob(minimalConfig(), SAMPLE_JOB);
    const rule = result.rulesEvaluated.find(
      (r) => r.ruleId === 'description-required-any-keywords',
    );
    expect(rule?.outcome).toBe('abstained');
    expect(rule?.reason).toBe('description_required_any_not_applicable');
  });

  it('fails when the description required-any list is non-empty and no keyword matches', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      description: { ...minimalConfig().description, requiredAnyKeywords: ['cobol'] },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('rejected');
    expect(result.rejectionReasons).toContain('description_required_any_no_match');
    const rule = findRule(result.rulesFailed, 'description-required-any-keywords');
    expect(rule?.reason).toBe('description_required_any_no_match');
  });

  it('passes when the description required-any list is non-empty and at least one keyword matches', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      description: {
        ...minimalConfig().description,
        requiredAnyKeywords: ['typescript', 'cobol'],
      },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('accepted');
    const rule = findRule(result.rulesPassed, 'description-required-any-keywords');
    expect(rule).toBeDefined();
  });
});

describe('evaluateJob — rule 6: max-seniority', () => {
  it('abstains when the maximum is null (rule disabled)', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      seniority: { maximum: null },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'max-seniority');
    expect(rule?.outcome).toBe('abstained');
    expect(result.overallOutcome).toBe('accepted');
  });

  it('abstains when the title has no seniority marker (detected === unknown)', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      seniority: { maximum: 'senior' },
    };
    const result = evaluateJob(config, {
      ...SAMPLE_JOB,
      title: 'Software Engineer', // no seniority phrase
    });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'max-seniority');
    expect(rule?.outcome).toBe('abstained');
    expect(result.overallOutcome).toBe('accepted');
  });

  it('abstains for null title even when the maximum is set', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      seniority: { maximum: 'senior' },
    };
    const result = evaluateJob(config, { ...SAMPLE_JOB, title: null });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'max-seniority');
    expect(rule?.outcome).toBe('abstained');
  });

  it('passes when the detected seniority is at or below the maximum', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      seniority: { maximum: 'senior' },
    };
    // Title "Senior Backend Engineer" → detected 'senior' ≤ 'senior' → passed.
    const result = evaluateJob(config, SAMPLE_JOB);
    const rule = findRule(result.rulesPassed, 'max-seniority');
    expect(rule).toBeDefined();
    expect(rule?.outcome).toBe('passed');
    expect(result.overallOutcome).toBe('accepted');
  });

  it('fails when the detected seniority exceeds the maximum', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      seniority: { maximum: 'mid' },
    };
    // Title "Senior Backend Engineer" → detected 'senior' > 'mid' → failed.
    const result = evaluateJob(config, SAMPLE_JOB);
    expect(result.overallOutcome).toBe('rejected');
    expect(result.rejectionReasons).toContain('seniority_exceeds_maximum:senior');
    const rule = findRule(result.rulesFailed, 'max-seniority');
    expect(rule?.reason).toBe('seniority_exceeds_maximum:senior');
  });
});

describe('evaluateJob — rule 7: language-rejection', () => {
  it('abstains when the flag is off regardless of the description', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['dutch'],
        rejectWhenExplicitlyRequiresOtherLanguage: false,
      },
    };
    const result = evaluateJob(config, {
      ...SAMPLE_JOB,
      description: 'French required',
    });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'language-rejection');
    expect(rule?.outcome).toBe('abstained');
    expect(rule?.reason).toBe('language_rejection_disabled');
    expect(result.overallOutcome).toBe('accepted');
  });

  it('abstains when no required phrase is detected in the description', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['dutch'],
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const result = evaluateJob(config, SAMPLE_JOB);
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'language-rejection');
    expect(rule?.outcome).toBe('abstained');
    expect(rule?.reason).toBe('language_no_required_phrase');
    expect(result.overallOutcome).toBe('accepted');
  });

  it('abstains when the only matches are reference phrases (not required)', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['dutch'],
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const result = evaluateJob(config, {
      ...SAMPLE_JOB,
      description: 'German preferred',
    });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'language-rejection');
    expect(rule?.outcome).toBe('abstained');
    expect(result.overallOutcome).toBe('accepted');
  });

  it('abstains when the only matches are ambiguous phrases (e.g. "fluent Dutch")', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['dutch', 'german'],
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    // `fluent` is classified as ambiguous by the detector. With nothing
    // other than the ambiguous match, the rule abstains.
    const result = evaluateJob(config, {
      ...SAMPLE_JOB,
      description: 'Fluent Dutch',
    });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'language-rejection');
    expect(rule?.outcome).toBe('abstained');
  });

  it('fails when a required language is not in the accepted list', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['dutch'],
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const result = evaluateJob(config, {
      ...SAMPLE_JOB,
      description: 'French required',
    });
    expect(result.overallOutcome).toBe('rejected');
    expect(result.rejectionReasons).toContain('unsupported_language:French');
    const rule = findRule(result.rulesFailed, 'language-rejection');
    expect(rule?.reason).toBe('unsupported_language:French');
  });

  it('passes when a required language is in the accepted list', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['dutch'],
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const result = evaluateJob(config, {
      ...SAMPLE_JOB,
      description: 'Dutch required',
    });
    const rule = findRule(result.rulesPassed, 'language-rejection');
    expect(rule).toBeDefined();
    expect(result.overallOutcome).toBe('accepted');
  });

  it('fails for a bilingual job (Dutch required, French required, none accepted)', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['german'], // neither Dutch nor French is accepted
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const result = evaluateJob(config, {
      ...SAMPLE_JOB,
      description: 'Dutch required. French required.',
    });
    expect(result.overallOutcome).toBe('rejected');
    // Two reasons: one per unsupported required language.
    expect(result.rejectionReasons).toContain('unsupported_language:Dutch');
    expect(result.rejectionReasons).toContain('unsupported_language:French');
    expect(result.rejectionReasons).toHaveLength(2);
  });

  it('abstains when the description is null and the flag is on', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      languages: {
        accepted: ['dutch'],
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const result = evaluateJob(config, { ...SAMPLE_JOB, description: null });
    const rule = result.rulesEvaluated.find((r) => r.ruleId === 'language-rejection');
    expect(rule?.outcome).toBe('abstained');
    expect(rule?.reason).toBe('language_no_required_phrase');
  });
});

describe('evaluateJob — stale input (null title and null description)', () => {
  it('does not crash; affected rules abstain; overall is accepted', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      title: { excludedKeywords: ['java'], requiredAnyKeywords: ['typescript'] },
      description: { excludedKeywords: ['php'], requiredAnyKeywords: ['typescript'] },
      seniority: { maximum: 'senior' },
      languages: {
        accepted: ['dutch'],
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const job: JobInput = { title: null, company: null, location: null, description: null };
    const result = evaluateJob(config, job);
    expect(result.overallOutcome).toBe('accepted');
    // Rules that depend on title or description abstain.
    const titleExcluded = findRule(result.rulesEvaluated, 'title-excluded-keywords');
    expect(titleExcluded?.outcome).toBe('abstained');
    const descExcluded = findRule(result.rulesEvaluated, 'description-excluded-keywords');
    expect(descExcluded?.outcome).toBe('abstained');
    const seniority = findRule(result.rulesEvaluated, 'max-seniority');
    expect(seniority?.outcome).toBe('abstained');
    const language = findRule(result.rulesEvaluated, 'language-rejection');
    expect(language?.outcome).toBe('abstained');
    expect(result.rejectionReasons).toEqual([]);
  });
});

describe('evaluateJob — error handling (filter errors are not rejections)', () => {
  it('returns overallOutcome "error" with empty rejectionReasons when a helper throws', () => {
    // Monkey-patch `matchKeywords` to throw. This is the cleanest way to
    // force the synthetic error path because the evaluator catches any
    // exception thrown by the helpers and reports it as an internal
    // evaluator error.
    const spy = vi.spyOn(keywordMatcher, 'matchKeywords').mockImplementation(() => {
      throw new Error('synthetic helper failure');
    });

    const result = evaluateJob(minimalConfig(), SAMPLE_JOB);

    // The spy is invoked at least once; restore it before assertions in
    // case the evaluator retries the call.
    expect(spy).toHaveBeenCalled();

    // The overall decision is "error", NOT "rejected".
    expect(result.overallOutcome).toBe('error');
    // The error is recorded in rulesEvaluated, not in rejectionReasons.
    expect(result.rejectionReasons).toEqual([]);
    const errorRule = result.rulesEvaluated.find((r) => r.reason === 'evaluator_internal_error');
    expect(errorRule).toBeDefined();
    expect(errorRule?.outcome).toBe('failed');
    // Details carry the error message so downstream consumers can audit
    // what went wrong.
    expect((errorRule?.details as { errorMessage?: unknown }).errorMessage).toBe(
      'synthetic helper failure',
    );
    // The error rule is also reflected in rulesFailed.
    expect(result.rulesFailed.find((r) => r.reason === 'evaluator_internal_error')).toBeDefined();
  });
});
