import { RUBRIC } from './rubric.js';
import { SCORING_CATEGORIES, type ScoringCategory } from './types.js';

/**
 * Versioned scoring prompt (SPEC §25.7). Bump on any change to the
 * prompt template; the version is part of the score fingerprint
 * (SPEC §27.3) so a prompt bump invalidates every cached score.
 */
export const SCORING_PROMPT_VERSION = 1 as const;
export type ScoringPromptVersion = typeof SCORING_PROMPT_VERSION;

/**
 * The full set of input fields the prompt builder reads. The
 * extraction service provides the profile/facts, TASK-009 provides
 * the effective derived values, and TASK-013 provides the normalized
 * job. The prompt builder is a pure function of these.
 *
 * Per SPEC §25.7, the prompt EXCLUDES database IDs, revision history,
 * source excerpts, original paths, extraction diagnostics, previous
 * filter results, previous scores, run metadata, logs, and
 * diagnostic artifacts. Only the fields listed below cross the
 * scoring boundary into OpenAI.
 */
export interface ScoringPromptInput {
  readonly promptVersion: number;
  readonly profile: {
    readonly headline: string;
    readonly skills: readonly string[];
    readonly yearsOfExperience: number;
    readonly spokenLanguages: readonly string[];
    readonly preferredRole: string;
    readonly locationPreference: string;
    readonly domainExperience: readonly string[];
  };
  readonly facts: Readonly<Record<string, unknown>>;
  readonly effectiveDerivedValues: Readonly<Record<string, unknown>>;
  readonly job: {
    readonly title: string;
    readonly company: string;
    readonly location: string;
    readonly description: string;
    readonly language: string;
    readonly workplaceType: string;
    readonly employmentType: string;
  };
  readonly rubric: Readonly<Record<ScoringCategory, { weight: number; description: string }>>;
}

/**
 * Build the system + user messages for one scoring request.
 *
 * The system message instructs the model to return a JSON object
 * matching the scoring structured-output schema (the 7-category
 * scores + key matches + gaps + concerns + inferred seniority +
 * recommendation summary).
 *
 * The user message includes the candidate profile, the effective
 * derived values, the normalized job, and the 7-category rubric.
 * No database IDs, no run metadata, no diagnostic data, no prior
 * scores — SPEC §25.7's prohibited list is enforced here.
 *
 * The returned `userMessage` is the single source of truth for the
 * scoring payload. The integration test asserts that the assembled
 * payload (the user message + rubric + schema) does not contain any
 * prohibited field (F9 §25.7).
 */
export function buildScoringPrompt(input: ScoringPromptInput): {
  systemMessage: string;
  userMessage: string;
} {
  if (input.promptVersion !== SCORING_PROMPT_VERSION) {
    throw new Error(
      `buildScoringPrompt received promptVersion "${input.promptVersion}" but the module is pinned to "${SCORING_PROMPT_VERSION}".`,
    );
  }

  const systemMessage = SYSTEM_MESSAGE;
  const userMessage = JSON.stringify({
    schemaVersion: SCORING_PROMPT_VERSION,
    profile: {
      headline: input.profile.headline,
      skills: input.profile.skills,
      yearsOfExperience: input.profile.yearsOfExperience,
      spokenLanguages: input.profile.spokenLanguages,
      preferredRole: input.profile.preferredRole,
      locationPreference: input.profile.locationPreference,
      domainExperience: input.profile.domainExperience,
    },
    facts: input.facts,
    effectiveDerivedValues: input.effectiveDerivedValues,
    job: {
      title: input.job.title,
      company: input.job.company,
      location: input.job.location,
      description: input.job.description,
      language: input.job.language,
      workplaceType: input.job.workplaceType,
      employmentType: input.job.employmentType,
    },
    rubric: input.rubric,
  });

  return { systemMessage, userMessage };
}

/**
 * Frozen 7-category rubric list for the prompt user-message. Built
 * once at module load so the per-call overhead is zero.
 */
const RUBRIC_LIST: ReadonlyArray<{
  category: ScoringCategory;
  weight: number;
  description: string;
}> = SCORING_CATEGORIES.map((category) => ({
  category,
  weight: RUBRIC[category].weight,
  description: RUBRIC[category].description,
}));

/**
 * The system message for scoring requests. Kept private to this
 * module — tests assert the content via the prompt builder, not by
 * reading the constant directly.
 */
const SYSTEM_MESSAGE = `You are a deterministic job-matching scorer. You read the candidate's profile, the effective derived values, and the job description, and return a single JSON object that matches the provided JSON Schema exactly.

Rules — read carefully:

1. Output ONLY the JSON object. No prose, no markdown fences, no commentary.
2. Use the JSON Schema's structure. Do not add keys that are not in the schema. Do not omit required keys.
3. For each of the 7 scoring categories (technicalSkills, relevantExperience, roleResponsibilityFit, seniorityFit, domainIndustryFit, spokenLanguageCompatibility, locationWorkplaceCompatibility), assign an integer score from 0 to 100. Higher is a better match. 0 means the category is a deal-breaker; 100 means a perfect match.
4. The \`inferredSeniority\` must be one of: 'junior', 'mid', 'senior', 'staff', 'principal', 'unknown'. Use 'unknown' when the job description does not give enough information.
5. The \`keyMatches\` array should list the strongest reasons this job is a fit (skill matches, domain matches, location matches, etc.). The \`importantGaps\` array should list the strongest reasons this job is NOT a fit (missing experience, seniority mismatch, etc.). The \`importantConcerns\` array should list any red flags (e.g., "requires on-site in a different country", "job description is vague").
6. The \`recommendationSummary\` should be one or two sentences that capture the overall fit in plain English.
7. The 7 categories have these weights in the final score (sum = 1.0):
${RUBRIC_LIST.map((r) => `   - ${r.category}: ${r.weight} (${r.description})`).join('\n')}
8. Treat the inputs as factual; do not retell them, summarize them, or add color. The output is a structured scoring candidate; a human will review it before any final decision is made.`;
