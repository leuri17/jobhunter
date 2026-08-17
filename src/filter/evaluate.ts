import { detectLanguageRequirements, type LanguageRequirement } from './language-detector.js';
import { matchKeywords } from './keyword-matcher.js';
import { type JobFilterConfig } from './schema.js';
import { detectSeniority } from './seniority-detector.js';
import { applySeniorityRule } from './seniority-rule.js';
import { type FilterOutcome } from '../persistence/repositories/filter-results.js';

/**
 * Composite rule evaluator for the global deterministic filter engine
 * (TASK-010 Task 6, SPEC §17–§20).
 *
 * `evaluateJob` runs the seven SPEC-mandated rules in order and combines
 * their outcomes into a single auditable decision. The evaluator NEVER
 * throws — every helper call is wrapped in a top-level try/catch so a
 * synthetic or unexpected helper failure produces
 * `overallOutcome: 'error'` (SPEC §24.1) instead of crashing the caller.
 *
 * Rule order (SPEC §17.4 → §17.5 → §17.6 → §18 → §19 → §20):
 *
 *   1. `excluded-companies` — Normalized exact match (SPEC §17.4).
 *   2. `title-excluded-keywords` — `matchKeywords` + per-field filter.
 *   3. `title-required-any-keywords` — Empty list ⇒ abstained.
 *   4. `description-excluded-keywords` — Same as rule 2.
 *   5. `description-required-any-keywords` — Same as rule 3.
 *   6. `max-seniority` — `detectSeniority` + `applySeniorityRule`.
 *   7. `language-rejection` — `detectLanguageRequirements` per required language.
 *
 * Overall outcome mapping (SPEC §24.1):
 *
 *   - Any rule `failed` → `overallOutcome: 'rejected'`,
 *     `rejectionReasons` = list of failed rule `reason` strings.
 *   - Internal evaluator error → `overallOutcome: 'error'`,
 *     `rejectionReasons: []` (errors are NOT rejections).
 *   - All rules `passed` or `abstained` → `overallOutcome: 'accepted'`.
 *
 * Domain-boundary note (AGENTS.md §5, §9): this module imports only
 * the schema, the keyword matcher, the seniority detector / rule, the
 * language detector, and the `FilterOutcome` type alias from the
 * persistence layer (no database IO). It must not import Commander,
 * Inquirer, Playwright, Drizzle, OpenAI, or Pino. The
 * `tests/filter/boundaries.test.ts` guard enforces this.
 */

export interface JobInput {
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
}

export interface RuleEvaluation {
  readonly ruleId: string;
  readonly field: 'company' | 'title' | 'description' | 'seniority' | 'languages';
  readonly outcome: 'passed' | 'failed' | 'abstained';
  readonly details: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export interface FilterEvaluationResult {
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly RuleEvaluation[];
  readonly rulesPassed: readonly RuleEvaluation[];
  readonly rulesFailed: readonly RuleEvaluation[];
  readonly rejectionReasons: readonly string[];
}

/**
 * Normalize a string for company-name comparison: lowercase, trim, and
 * collapse internal whitespace runs to a single space. The function is
 * total — non-string inputs would have been filtered upstream by Zod.
 */
function normalizeCompanyName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Run a single rule evaluator while guaranteeing that no exception
 * propagates to the caller. The function returns either the
 * RuleEvaluation the rule produced or an `error` record with
 * `reason: 'evaluator_internal_error'`.
 *
 * Used by `evaluateJob` to honour the SPEC §24.1 contract: a malformed
 * rule implementation surfaces as a filter `error`, never as a
 * rejection and never as a thrown exception.
 */
function safeEvaluate(
  ruleId: RuleEvaluation['ruleId'],
  field: RuleEvaluation['field'],
  producer: () => RuleEvaluation | readonly RuleEvaluation[],
): readonly RuleEvaluation[] {
  try {
    const produced = producer();
    if (Array.isArray(produced)) {
      return produced;
    }
    return [produced as RuleEvaluation];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return [
      {
        ruleId,
        field,
        outcome: 'failed',
        reason: 'evaluator_internal_error',
        details: { errorMessage },
      },
    ];
  }
}

/**
 * Rule 1 — `excluded-companies` (SPEC §17.4).
 *
 * Normalize the company (lowercase, trim, collapse whitespace) and
 * compare it against the normalized form of every entry in
 * `config.excludedCompanies`. A hit fails the rule with the
 * original-case name from the config, so the audit reason reads
 * `excluded_company:<originalName>`. A `null` or empty company is
 * treated as "no possible exclusion" and passes (SPEC §17.4
 * "no hit ⇒ passed"); an empty excluded list trivially passes too.
 */
function evaluateExcludedCompanies(
  config: JobFilterConfig,
  job: JobInput,
): readonly RuleEvaluation[] {
  if (job.company === null) {
    return [
      {
        ruleId: 'excluded-companies',
        field: 'company',
        outcome: 'passed',
        reason: 'company_not_provided',
        details: { reason_detail: 'company_null' },
      },
    ];
  }
  const normalizedJobCompany = normalizeCompanyName(job.company);
  if (normalizedJobCompany.length === 0) {
    return [
      {
        ruleId: 'excluded-companies',
        field: 'company',
        outcome: 'passed',
        reason: 'company_not_provided',
        details: { reason_detail: 'company_empty' },
      },
    ];
  }
  for (const entry of config.excludedCompanies) {
    const normalizedEntry = normalizeCompanyName(entry);
    if (normalizedEntry.length === 0) {
      continue;
    }
    if (normalizedEntry === normalizedJobCompany) {
      return [
        {
          ruleId: 'excluded-companies',
          field: 'company',
          outcome: 'failed',
          reason: `excluded_company:${entry}`,
          details: { matchedEntry: entry },
        },
      ];
    }
  }
  return [
    {
      ruleId: 'excluded-companies',
      field: 'company',
      outcome: 'passed',
      reason: 'company_not_excluded',
      details: {},
    },
  ];
}

/**
 * Rule 2 — `title-excluded-keywords` (SPEC §17.5 + §18).
 *
 * Delegates to `matchKeywords` and filters the excluded hits for
 * `field === 'title'`. A hit fails the rule with the configured
 * keyword and the matched token window's matched text
 * (`title_excluded_keyword:<keyword>:<matchedToken>`). The
 * `matchedToken` is the configured keyword itself — for a
 * single-token keyword the matched text is the same; for a
 * multi-token keyword the matched window is reported verbatim so
 * the audit reason reads `<keyword>:<keyword>`.
 */
function evaluateTitleExcludedKeywords(
  config: JobFilterConfig,
  job: JobInput,
): readonly RuleEvaluation[] {
  if (job.title === null) {
    return [
      {
        ruleId: 'title-excluded-keywords',
        field: 'title',
        outcome: 'abstained',
        reason: 'title_not_provided',
        details: {},
      },
    ];
  }
  const match = matchKeywords(config, { title: job.title, description: null });
  const titleHits = match.excludedHits.filter((hit) => hit.field === 'title');
  if (titleHits.length > 0) {
    const first = titleHits[0];
    if (first === undefined) {
      // Unreachable: length > 0 was just asserted.
      return [
        {
          ruleId: 'title-excluded-keywords',
          field: 'title',
          outcome: 'abstained',
          reason: 'title_excluded_keyword_internal',
          details: {},
        },
      ];
    }
    return [
      {
        ruleId: 'title-excluded-keywords',
        field: 'title',
        outcome: 'failed',
        reason: `title_excluded_keyword:${first.keyword}:${first.keyword}`,
        details: {
          keyword: first.keyword,
          matchedToken: first.keyword,
          matchedTokenIndex: first.matchedTokenIndex,
        },
      },
    ];
  }
  return [
    {
      ruleId: 'title-excluded-keywords',
      field: 'title',
      outcome: 'passed',
      reason: 'no_title_excluded_keyword',
      details: {},
    },
  ];
}

/**
 * Rule 3 — `title-required-any-keywords` (SPEC §17.5 + §18).
 *
 * Empty list ⇒ the rule does not apply and abstains. Non-empty with at
 * least one hit ⇒ passes. Non-empty with zero hits ⇒ fails.
 */
function evaluateTitleRequiredAny(
  config: JobFilterConfig,
  job: JobInput,
): readonly RuleEvaluation[] {
  const list = config.title.requiredAnyKeywords;
  if (list.length === 0) {
    return [
      {
        ruleId: 'title-required-any-keywords',
        field: 'title',
        outcome: 'abstained',
        reason: 'title_required_any_not_applicable',
        details: {},
      },
    ];
  }
  if (job.title === null) {
    return [
      {
        ruleId: 'title-required-any-keywords',
        field: 'title',
        outcome: 'abstained',
        reason: 'title_required_any_not_applicable',
        details: { reason_detail: 'title_null' },
      },
    ];
  }
  const match = matchKeywords(config, { title: job.title, description: null });
  const titleHits = match.requiredAnyHits.filter((hit) => hit.field === 'title');
  if (titleHits.length > 0) {
    return [
      {
        ruleId: 'title-required-any-keywords',
        field: 'title',
        outcome: 'passed',
        reason: 'title_required_any_match',
        details: { matchedKeyword: titleHits[0]?.keyword ?? null },
      },
    ];
  }
  return [
    {
      ruleId: 'title-required-any-keywords',
      field: 'title',
      outcome: 'failed',
      reason: 'title_required_any_no_match',
      details: {},
    },
  ];
}

/**
 * Rule 4 — `description-excluded-keywords`. Mirrors rule 2.
 */
function evaluateDescriptionExcludedKeywords(
  config: JobFilterConfig,
  job: JobInput,
): readonly RuleEvaluation[] {
  if (job.description === null) {
    return [
      {
        ruleId: 'description-excluded-keywords',
        field: 'description',
        outcome: 'abstained',
        reason: 'description_not_provided',
        details: {},
      },
    ];
  }
  const match = matchKeywords(config, { title: null, description: job.description });
  const descriptionHits = match.excludedHits.filter((hit) => hit.field === 'description');
  if (descriptionHits.length > 0) {
    const first = descriptionHits[0];
    if (first === undefined) {
      return [
        {
          ruleId: 'description-excluded-keywords',
          field: 'description',
          outcome: 'abstained',
          reason: 'description_excluded_keyword_internal',
          details: {},
        },
      ];
    }
    return [
      {
        ruleId: 'description-excluded-keywords',
        field: 'description',
        outcome: 'failed',
        reason: `description_excluded_keyword:${first.keyword}:${first.keyword}`,
        details: {
          keyword: first.keyword,
          matchedToken: first.keyword,
          matchedTokenIndex: first.matchedTokenIndex,
        },
      },
    ];
  }
  return [
    {
      ruleId: 'description-excluded-keywords',
      field: 'description',
      outcome: 'passed',
      reason: 'no_description_excluded_keyword',
      details: {},
    },
  ];
}

/**
 * Rule 5 — `description-required-any-keywords`. Mirrors rule 3.
 */
function evaluateDescriptionRequiredAny(
  config: JobFilterConfig,
  job: JobInput,
): readonly RuleEvaluation[] {
  const list = config.description.requiredAnyKeywords;
  if (list.length === 0) {
    return [
      {
        ruleId: 'description-required-any-keywords',
        field: 'description',
        outcome: 'abstained',
        reason: 'description_required_any_not_applicable',
        details: {},
      },
    ];
  }
  if (job.description === null) {
    return [
      {
        ruleId: 'description-required-any-keywords',
        field: 'description',
        outcome: 'abstained',
        reason: 'description_required_any_not_applicable',
        details: { reason_detail: 'description_null' },
      },
    ];
  }
  const match = matchKeywords(config, { title: null, description: job.description });
  const descriptionHits = match.requiredAnyHits.filter((hit) => hit.field === 'description');
  if (descriptionHits.length > 0) {
    return [
      {
        ruleId: 'description-required-any-keywords',
        field: 'description',
        outcome: 'passed',
        reason: 'description_required_any_match',
        details: { matchedKeyword: descriptionHits[0]?.keyword ?? null },
      },
    ];
  }
  return [
    {
      ruleId: 'description-required-any-keywords',
      field: 'description',
      outcome: 'failed',
      reason: 'description_required_any_no_match',
      details: {},
    },
  ];
}

/**
 * Rule 6 — `max-seniority` (SPEC §19).
 */
function evaluateMaxSeniority(config: JobFilterConfig, job: JobInput): readonly RuleEvaluation[] {
  if (config.seniority.maximum === null) {
    return [
      {
        ruleId: 'max-seniority',
        field: 'seniority',
        outcome: 'abstained',
        reason: 'seniority_maximum_not_set',
        details: {},
      },
    ];
  }
  const detection = detectSeniority(job.title);
  if (detection.detected === 'unknown') {
    return [
      {
        ruleId: 'max-seniority',
        field: 'seniority',
        outcome: 'abstained',
        reason: 'seniority_unknown',
        details: {},
      },
    ];
  }
  const result = applySeniorityRule(config.seniority.maximum, detection);
  if (result.outcome === 'rejected') {
    return [
      {
        ruleId: 'max-seniority',
        field: 'seniority',
        outcome: 'failed',
        reason: `seniority_exceeds_maximum:${result.detected}`,
        details: {
          detected: result.detected,
          maximum: result.matchedAgainst,
          matchedPhrases: detection.matchedPhrases.map((m) => m.phrase),
        },
      },
    ];
  }
  return [
    {
      ruleId: 'max-seniority',
      field: 'seniority',
      outcome: 'passed',
      reason: 'seniority_within_maximum',
      details: {
        detected: result.detected,
        maximum: result.matchedAgainst,
        matchedPhrases: detection.matchedPhrases.map((m) => m.phrase),
      },
    },
  ];
}

/**
 * Rule 7 — `language-rejection` (SPEC §20).
 *
 * The rule emits ONE RuleEvaluation per required language check, plus
 * ONE RuleEvaluation for each abstention branch. This shape honours
 * the brief's "the rule fails for that language" language: every
 * required language gets its own audit record, so the bilingual case
 * (Dutch + French both failing) produces two distinct
 * `unsupported_language:<lang>` reasons in `rejectionReasons`.
 */
function evaluateLanguageRejection(
  config: JobFilterConfig,
  job: JobInput,
): readonly RuleEvaluation[] {
  if (!config.languages.rejectWhenExplicitlyRequiresOtherLanguage) {
    return [
      {
        ruleId: 'language-rejection',
        field: 'languages',
        outcome: 'abstained',
        reason: 'language_rejection_disabled',
        details: {},
      },
    ];
  }
  const detection = detectLanguageRequirements({
    description: job.description,
    acceptedLanguages: config.languages.accepted,
  });
  if (detection.requirements.length === 0) {
    return [
      {
        ruleId: 'language-rejection',
        field: 'languages',
        outcome: 'abstained',
        reason: 'language_no_required_phrase',
        details: {},
      },
    ];
  }
  const required = detection.requirements.filter(
    (req: LanguageRequirement) => req.kind === 'required',
  );
  const allAmbiguous = detection.requirements.every(
    (req: LanguageRequirement) => req.kind === 'ambiguous',
  );
  if (allAmbiguous) {
    return [
      {
        ruleId: 'language-rejection',
        field: 'languages',
        outcome: 'abstained',
        reason: 'language_only_ambiguous',
        details: {},
      },
    ];
  }
  if (required.length === 0) {
    // Only reference phrases (or a mix of reference + ambiguous) — SPEC
    // §20.3: abstain, do not reject.
    return [
      {
        ruleId: 'language-rejection',
        field: 'languages',
        outcome: 'abstained',
        reason: 'language_only_reference',
        details: {},
      },
    ];
  }
  const acceptedSet = new Set<string>(config.languages.accepted);
  const evaluations: RuleEvaluation[] = [];
  let anyUnsupported = false;
  for (const req of required) {
    if (acceptedSet.has(req.normalizedLanguage)) {
      evaluations.push({
        ruleId: 'language-rejection',
        field: 'languages',
        outcome: 'passed',
        reason: `language_in_accepted:${req.language}`,
        details: {
          language: req.language,
          normalizedLanguage: req.normalizedLanguage,
          matchedPhrase: req.matchedPhrase,
        },
      });
    } else {
      anyUnsupported = true;
      evaluations.push({
        ruleId: 'language-rejection',
        field: 'languages',
        outcome: 'failed',
        reason: `unsupported_language:${req.language}`,
        details: {
          language: req.language,
          normalizedLanguage: req.normalizedLanguage,
          matchedPhrase: req.matchedPhrase,
        },
      });
    }
  }
  // SPEC §20.3 + brief: "If at least one required language is in
  // accepted, the rule passes (if there are no fails)." Our evaluations
  // already encode that — the failed entries drive `rejectionReasons`,
  // the passed entries fill `rulesPassed`. No extra synthesis needed.
  // The `anyUnsupported` flag is kept for clarity but is not used; the
  // audit partition (`rulesFailed`) is the source of truth.
  void anyUnsupported;
  return evaluations;
}

/**
 * Compose the seven rules into a single auditable decision.
 *
 * The function never throws. Helper exceptions are caught and surfaced
 * as `overallOutcome: 'error'` with the offending rule reported via
 * `evaluator_internal_error` (SPEC §24.1).
 */
export function evaluateJob(config: JobFilterConfig, job: JobInput): FilterEvaluationResult {
  try {
    const rulesEvaluated: RuleEvaluation[] = [
      ...safeEvaluate('excluded-companies', 'company', () =>
        evaluateExcludedCompanies(config, job),
      ),
      ...safeEvaluate('title-excluded-keywords', 'title', () =>
        evaluateTitleExcludedKeywords(config, job),
      ),
      ...safeEvaluate('title-required-any-keywords', 'title', () =>
        evaluateTitleRequiredAny(config, job),
      ),
      ...safeEvaluate('description-excluded-keywords', 'description', () =>
        evaluateDescriptionExcludedKeywords(config, job),
      ),
      ...safeEvaluate('description-required-any-keywords', 'description', () =>
        evaluateDescriptionRequiredAny(config, job),
      ),
      ...safeEvaluate('max-seniority', 'seniority', () => evaluateMaxSeniority(config, job)),
      ...safeEvaluate('language-rejection', 'languages', () =>
        evaluateLanguageRejection(config, job),
      ),
    ];

    // An internal-error record (from `safeEvaluate`) takes precedence
    // over a per-rule failure. SPEC §24.1: errors are NOT rejections.
    const hasInternalError = rulesEvaluated.some(
      (rule) => rule.reason === 'evaluator_internal_error',
    );
    if (hasInternalError) {
      return {
        overallOutcome: 'error',
        rulesEvaluated,
        rulesPassed: rulesEvaluated.filter((rule) => rule.outcome === 'passed'),
        rulesFailed: rulesEvaluated.filter((rule) => rule.outcome === 'failed'),
        rejectionReasons: [],
      };
    }

    const rulesFailed = rulesEvaluated.filter((rule) => rule.outcome === 'failed');
    const rulesPassed = rulesEvaluated.filter((rule) => rule.outcome === 'passed');
    if (rulesFailed.length > 0) {
      return {
        overallOutcome: 'rejected',
        rulesEvaluated,
        rulesPassed,
        rulesFailed,
        rejectionReasons: rulesFailed.map((rule) => rule.reason),
      };
    }
    return {
      overallOutcome: 'accepted',
      rulesEvaluated,
      rulesPassed,
      rulesFailed,
      rejectionReasons: [],
    };
  } catch (error) {
    // The last-line guard: even the `safeEvaluate` plumbing should not
    // be able to throw, but a top-level try/catch ensures the function
    // contract is honoured if a future refactor introduces a bug.
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorRule: RuleEvaluation = {
      ruleId: 'evaluator_internal_error',
      field: 'title',
      outcome: 'failed',
      reason: 'evaluator_internal_error',
      details: { errorMessage, scope: 'top_level' },
    };
    return {
      overallOutcome: 'error',
      rulesEvaluated: [errorRule],
      rulesPassed: [],
      rulesFailed: [errorRule],
      rejectionReasons: [],
    };
  }
}
