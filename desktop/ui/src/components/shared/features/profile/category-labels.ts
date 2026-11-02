import { SKILL_CATEGORIES } from '@jobhunter/core/profile';

const LABELS: Record<(typeof SKILL_CATEGORIES)[number], string> = {
  programming_language: 'Programming languages',
  framework: 'Frameworks',
  library: 'Libraries',
  database: 'Databases',
  cloud: 'Cloud',
  devops: 'DevOps',
  testing: 'Testing',
  architecture: 'Architecture',
  tool: 'Tools',
  methodology: 'Methodologies',
  domain: 'Domains',
  soft_skill: 'Soft skills',
  other: 'Other',
};

export function categoryLabel(category: (typeof SKILL_CATEGORIES)[number]): string {
  return LABELS[category] ?? category;
}

export { SKILL_CATEGORIES };
