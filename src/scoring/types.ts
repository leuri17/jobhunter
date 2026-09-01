/**
 * Shared scoring types for .
 *
 * The 7 scoring categories from  are the foundation of the
 * rubric, the formula, the Zod structured-output schema, and the score
 * fingerprint. They are declared here (rather than inside `state.ts`)
 * so the Zod schema in `./schema.ts` can import the values without
 * dragging in the larger scoring state vocabulary.
 *
 * The numeric weights live in `../scoring/rubric.ts` — keeping
 * the type list here makes the schema independent of the rubric values,
 * which is the right layering for a frozen category set.
 */

export const SCORING_CATEGORIES = [
  'technicalSkills',
  'relevantExperience',
  'roleResponsibilityFit',
  'seniorityFit',
  'domainIndustryFit',
  'spokenLanguageCompatibility',
  'locationWorkplaceCompatibility',
] as const;

export type ScoringCategory = (typeof SCORING_CATEGORIES)[number];
