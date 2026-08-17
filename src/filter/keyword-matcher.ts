import { findKeywordMatchIndex } from './keyword-normalize.js';
import { type JobFilterConfig } from './schema.js';

/**
 * Orchestrator for the deterministic keyword matcher (SPEC §17.5, §18;
 * TASK-010 Task 3).
 *
 * `matchKeywords` walks the four keyword lists on the parsed
 * `JobFilterConfig` and runs the shared token-stream matcher against
 * BOTH the title and the description for each list. Every successful
 * match is reported as a `KeywordMatchHit` with the starting index of
 * the matched token window — the `field` of the hit records the LIST
 * the keyword came from (so callers can distinguish "title rule matched
 * a phrase in the description" from "description rule matched a phrase
 * in the title").
 *
 * Required-any semantics:
 *   - When both `title.requiredAnyKeywords` and
 *     `description.requiredAnyKeywords` are empty, the rule does not apply
 *     and `requiredAnySatisfied` is `true`.
 *   - When at least one of the two lists is non-empty, `requiredAnySatisfied`
 *     is `true` iff at least one keyword produced a hit.
 *
 * Domains must not call this function with a `null` field — `matchKeywords`
 * converts null fields to the empty string before delegating, so the
 * matcher reports no hit for a missing field.
 */

export interface KeywordMatchHit {
  readonly field: 'title' | 'description';
  readonly keyword: string;
  readonly matchedTokenIndex: number;
}

export interface KeywordMatchResult {
  readonly excludedHits: readonly KeywordMatchHit[];
  readonly requiredAnyHits: readonly KeywordMatchHit[];
  readonly requiredAnySatisfied: boolean;
}

interface JobFields {
  readonly title: string | null;
  readonly description: string | null;
}

type KeywordField = 'title' | 'description';

function collectHits(
  listField: KeywordField,
  jobTitle: string | null,
  jobDescription: string | null,
  keywords: readonly string[],
): KeywordMatchHit[] {
  const hits: KeywordMatchHit[] = [];
  for (const keyword of keywords) {
    const titleIndex = findKeywordMatchIndex(jobTitle ?? '', keyword);
    if (titleIndex >= 0) {
      hits.push({ field: listField, keyword, matchedTokenIndex: titleIndex });
    }
    const descriptionIndex = findKeywordMatchIndex(jobDescription ?? '', keyword);
    if (descriptionIndex >= 0) {
      hits.push({ field: listField, keyword, matchedTokenIndex: descriptionIndex });
    }
  }
  return hits;
}

/**
 * Run the deterministic keyword matcher against a job. See the file-level
 * JSDoc for required-any semantics.
 */
export function matchKeywords(config: JobFilterConfig, job: JobFields): KeywordMatchResult {
  const excludedHits: KeywordMatchHit[] = [
    ...collectHits('title', job.title, job.description, config.title.excludedKeywords),
    ...collectHits('description', job.title, job.description, config.description.excludedKeywords),
  ];

  const requiredAnyHits: KeywordMatchHit[] = [
    ...collectHits('title', job.title, job.description, config.title.requiredAnyKeywords),
    ...collectHits(
      'description',
      job.title,
      job.description,
      config.description.requiredAnyKeywords,
    ),
  ];

  const titleRequiredAnyEmpty = config.title.requiredAnyKeywords.length === 0;
  const descriptionRequiredAnyEmpty = config.description.requiredAnyKeywords.length === 0;
  const requiredAnySatisfied =
    (titleRequiredAnyEmpty && descriptionRequiredAnyEmpty) || requiredAnyHits.length > 0;

  return {
    excludedHits,
    requiredAnyHits,
    requiredAnySatisfied,
  };
}
