import type { ScoringCategory } from './types.js';

/**
 * Version of the scoring rubric. Bump on any change to weights or
 * descriptions. The version is part of the score fingerprint (SPEC
 * §27.3) so a rubric bump invalidates every cached score.
 */
export const RUBRIC_VERSION = 1 as const;
export type RubricVersion = typeof RUBRIC_VERSION;

export interface RubricEntry {
  readonly weight: number;
  readonly description: string;
}

/**
 * Frozen 7-category scoring rubric from . Weights must sum
 * to exactly 1.0 (asserted in `tests/scoring/rubric.test.ts`); JobHunter
 * computes the weighted overall score from this table — OpenAI does
 * NOT.
 */
export const RUBRIC: Readonly<Record<ScoringCategory, RubricEntry>> = {
  technicalSkills: {
    weight: 0.3,
    description: "Match between job requirements and the candidate's technical skills.",
  },
  relevantExperience: {
    weight: 0.25,
    description: 'Years and relevance of experience in similar roles or domains.',
  },
  roleResponsibilityFit: {
    weight: 0.2,
    description: "Alignment between the job's responsibilities and the candidate's preferred role.",
  },
  seniorityFit: {
    weight: 0.1,
    description: "Match between the job's seniority level and the candidate's experience.",
  },
  domainIndustryFit: {
    weight: 0.05,
    description: "Match between the job's industry and the candidate's domain experience.",
  },
  spokenLanguageCompatibility: {
    weight: 0.05,
    description: "Match between the job's required languages and the candidate's spoken languages.",
  },
  locationWorkplaceCompatibility: {
    weight: 0.05,
    description: "Match between the job's location/workplace and the candidate's preferences.",
  },
};

export function getRubricWeight(category: ScoringCategory): number {
  return RUBRIC[category].weight;
}

export function getRubricDescription(category: ScoringCategory): string {
  return RUBRIC[category].description;
}
