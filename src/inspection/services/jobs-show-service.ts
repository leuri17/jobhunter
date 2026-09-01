/**
 * JobsShowService — read-side service for `jobs show <job-id>`
 *
 * Resolves the CLI identifier (either `job_<int>` or the numeric
 * LinkedIn `sourceJobId`), fetches the full job row + discovery
 * history + latest active filter result + latest active score
 * result, and assembles the public `JobShowPayload` envelope.
 *
 * Domain boundary: this service imports `src/persistence/repositories/`
 * — the only module under `src/inspection/` allowed to do so.
 */

import { InspectionNotFoundError } from '../errors.js';
import type { JobShowPayload } from '../state.js';
import { formatDisplayScore } from '../../scoring/score-formula.js';
import { resolveJobIdentifier } from '../../persistence/identifiers.js';
import type { Repositories } from '../../persistence/repositories/index.js';

export interface JobsShowServiceOptions {
  readonly repositories: Repositories;
}

/**
 * Construct the canonical LinkedIn URL for a job.
 * Pure helper — no DB I/O.
 */
export function linkedinJobUrl(sourceJobId: string): string {
  return `https://www.linkedin.com/jobs/view/${sourceJobId}`;
}

/**
 * Read-only service backing `jobs show <job-id>`.
 *
 * Throws `InspectionNotFoundError` (InvalidUsage = 2) when:
 *   - The identifier is malformed (`jobs_show_invalid_identifier`).
 *   - No job matches the resolved identifier (`jobs_show_not_found`).
 */
export class JobsShowService {
  constructor(private readonly repositories: Repositories) {}

  async show(identifier: string): Promise<JobShowPayload> {
    // Step 1: resolve the identifier into `{ jobId? , sourceJobId? }`.
    // `resolveJobIdentifier` throws `InvalidIdentifierError` on every
    // malformed form; we translate that into the inspection-typed error.
    let resolution: { readonly jobId?: number; readonly sourceJobId?: string };
    try {
      resolution = resolveJobIdentifier(identifier);
    } catch {
      throw new InspectionNotFoundError(
        'jobs_show_invalid_identifier',
        `jobs show: identifier "${identifier}" is not a valid job reference.`,
        { identifier },
      );
    }

    // Step 2: fetch the JobRow. Try jobId first (canonical), fall back
    // to sourceJobId (numeric LinkedIn form).
    let row =
      resolution.jobId !== undefined
        ? await this.repositories.jobs.findById(resolution.jobId)
        : null;
    if (row === null && resolution.sourceJobId !== undefined) {
      row = await this.repositories.jobs.findBySourceJobId(resolution.sourceJobId);
    }
    if (row === null) {
      throw new InspectionNotFoundError(
        'jobs_show_not_found',
        `jobs show: no job found for "${identifier}".`,
        {
          identifier,
          jobId: resolution.jobId ?? null,
          sourceJobId: resolution.sourceJobId ?? null,
        },
      );
    }

    // Step 3: fetch the supporting rows in parallel.
    const [discoveryHistory, filterResults, scoreResults, attempts] = await Promise.all([
      this.repositories.jobs.listDiscoveryEventsByJob(row.id),
      this.repositories.filterResults.listByJob(row.id),
      this.repositories.scoreResults.listByJob(row.id),
      this.repositories.jobs.listExtractionAttemptsByJob(row.id),
    ]);

    void attempts; // attempts feed the  test fixtures; the show
    // payload does not surface them directly per .

    // Step 4: assemble the payload from the latest active rows.
    const activeFilter = filterResults.find((f) => f.active) ?? null;
    const activeScore = scoreResults.find((s) => s.active) ?? null;
    const historyHasAny = filterResults.length > 0;
    const scoreHistoryHasAny = scoreResults.length > 0;

    return {
      id: `job_${row.id}`,
      internalId: row.id,
      sourceJobId: row.sourceJobId,
      linkedinUrl: linkedinJobUrl(row.sourceJobId),
      title: row.title,
      company: row.company,
      location: row.location,
      description: row.description,
      extractionStatus: row.extractionStatus,
      successfulMethod: row.successfulMethod,
      discoveryHistory: discoveryHistory.map((e) => ({
        runId: e.pipelineRunId,
        searchExecutionId: e.searchExecutionId,
        timestamp: e.timestamp,
        isNew: e.isNew,
      })),
      currentFilter: {
        outcome: activeFilter === null ? null : activeFilter.overallOutcome,
        fingerprint: activeFilter === null ? null : activeFilter.fingerprint,
        rejectionReasons:
          activeFilter === null || activeFilter.rejectionReasons === null
            ? []
            : rejectionReasonsAsStrings(activeFilter.rejectionReasons),
        filteredAt: activeFilter === null ? null : activeFilter.timestamp,
        hasHistory: historyHasAny,
      },
      currentScore: {
        overallScore: activeScore === null ? null : activeScore.overallScore,
        displayScore: activeScore === null ? null : formatDisplayScore(activeScore.overallScore),
        categoryScores: scoreCategoryScores(activeScore),
        explanation: activeScore?.explanation ?? null,
        matches: scoreStringField(activeScore?.keyMatches),
        gaps: scoreStringField(activeScore?.importantGaps),
        concerns: scoreStringField(activeScore?.importantConcerns),
        inferredSeniority: activeScore?.inferredSeniority ?? null,
        recommendationSummary: activeScore?.recommendationSummary ?? null,
        timestamp: activeScore === null ? null : activeScore.timestamp,
        hasHistory: scoreHistoryHasAny,
      },
      timestamps: {
        firstDiscoveredAt: row.firstDiscoveryTimestamp,
        lastRediscoveryAt: row.lastRediscoveryTimestamp,
        lastExtractionAttemptAt: row.lastExtractionAttemptTimestamp,
        createdAt: row.createdTimestamp,
        updatedAt: row.updatedTimestamp,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Project a persisted JSON column typed `readonly unknown[] | null`
 * into a `readonly string[]`. Non-string values are stringified.
 */
function rejectionReasonsAsStrings(value: readonly unknown[]): readonly string[] {
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string') out.push(v);
    else out.push(String(v));
  }
  return out;
}

function scoreStringField(value: readonly unknown[] | null | undefined): readonly string[] {
  if (value === null || value === undefined) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string') out.push(v);
    else out.push(String(v));
  }
  return out;
}

/**
 * Project the persisted `categoryScores` JSON column into the
 * `{category, score, explanation}` shape consumed by the renderer.
 *
 * The score-result row stores the full 7-category map (matching
 * `SCORING_CATEGORIES` from `src/scoring/types.ts`). The shape
 * stored is `{ category: { score: number, explanation: string, evidence: readonly string[] } }`;
 * for the show payload the `evidence` field is dropped.
 */
function scoreCategoryScores(
  activeScore:
    | {
        readonly categoryScores: readonly unknown[];
        readonly success: boolean;
      }
    | null
    | undefined,
): readonly { readonly category: string; readonly score: number; readonly explanation: string }[] {
  if (activeScore === null || activeScore === undefined) return [];
  const raw = activeScore.categoryScores;
  if (!Array.isArray(raw)) return [];
  const out: { readonly category: string; readonly score: number; readonly explanation: string }[] =
    [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const category = typeof e['category'] === 'string' ? e['category'] : null;
    const score = typeof e['score'] === 'number' ? e['score'] : null;
    const explanation = typeof e['explanation'] === 'string' ? e['explanation'] : '';
    if (category === null || score === null) continue;
    out.push({ category, score, explanation });
  }
  return out;
}
