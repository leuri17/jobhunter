import { DATE_POSTED_F_TPR, type DatePostedSeconds, type WorkplaceTypeValue } from './labels.js';

export interface LinkedInSearchURLInput {
  readonly query: string;
  readonly geoId: string;
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export const LINKEDIN_JOBS_SEARCH_BASE = 'https://www.linkedin.com/jobs/search/';

export function buildLinkedInSearchParamMap(input: LinkedInSearchURLInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set('f_TPR', DATE_POSTED_F_TPR(input.datePosted));
  params.set('f_WT', input.workplaceTypes.join(','));
  params.set('geoId', input.geoId);
  params.set('keywords', input.query);
  params.set('sortBy', 'DD');
  return params;
}

export function buildLinkedInSearchURL(input: LinkedInSearchURLInput): string {
  const params = buildLinkedInSearchParamMap(input);
  const base = new URL(LINKEDIN_JOBS_SEARCH_BASE);
  base.search = params.toString();
  return base.toString();
}
