import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { scoreResults } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export interface ScoreResultRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number | null;
  readonly filterResultId: number | null;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly promptVersion: string;
  readonly rubricVersion: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly scorerImplementationVersion: string;
  readonly categoryScores: readonly unknown[];
  readonly overallScore: number;
  readonly explanation: string | null;
  readonly keyMatches: readonly unknown[] | null;
  readonly importantGaps: readonly unknown[] | null;
  readonly importantConcerns: readonly unknown[] | null;
  readonly inferredSeniority: string | null;
  readonly recommendationSummary: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly active: boolean;
}

export interface ScoreResultInsert {
  readonly jobId: number;
  readonly pipelineRunId?: number | null;
  readonly filterResultId?: number | null;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly promptVersion: string;
  readonly rubricVersion: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly scorerImplementationVersion: string;
  readonly categoryScores: readonly unknown[];
  readonly overallScore: number;
  readonly explanation?: string | null;
  readonly keyMatches?: readonly unknown[] | null;
  readonly importantGaps?: readonly unknown[] | null;
  readonly importantConcerns?: readonly unknown[] | null;
  readonly inferredSeniority?: string | null;
  readonly recommendationSummary?: string | null;
  readonly success: boolean;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

function rowFromRecord(record: typeof scoreResults.$inferSelect): ScoreResultRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    filterResultId: record.filterResultId,
    fingerprint: record.fingerprint,
    timestamp: record.timestamp,
    promptVersion: record.promptVersion,
    rubricVersion: record.rubricVersion,
    model: record.model,
    reasoningEffort: record.reasoningEffort,
    scorerImplementationVersion: record.scorerImplementationVersion,
    categoryScores: unknownJson.decodeRequired(record.categoryScoresJson) as readonly unknown[],
    overallScore: record.overallScore,
    explanation: record.explanation,
    keyMatches: unknownJson.decode(record.keyMatchesJson) as readonly unknown[] | null,
    importantGaps: unknownJson.decode(record.importantGapsJson) as readonly unknown[] | null,
    importantConcerns: unknownJson.decode(record.importantConcernsJson) as
      readonly unknown[] | null,
    inferredSeniority: record.inferredSeniority,
    recommendationSummary: record.recommendationSummary,
    success: record.success,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    active: record.active,
  };
}

export class ScoreResultRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async activateResult(input: Omit<ScoreResultInsert, 'active'>): Promise<number> {
    return this.ctx.db.transaction((tx) => {
      tx.update(scoreResults)
        .set({ active: false })
        .where(and(eq(scoreResults.jobId, input.jobId), eq(scoreResults.active, true)))
        .run();
      const result = tx
        .insert(scoreResults)
        .values({
          jobId: input.jobId,
          pipelineRunId: input.pipelineRunId ?? null,
          filterResultId: input.filterResultId ?? null,
          fingerprint: input.fingerprint,
          timestamp: input.timestamp,
          promptVersion: input.promptVersion,
          rubricVersion: input.rubricVersion,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          scorerImplementationVersion: input.scorerImplementationVersion,
          categoryScoresJson: unknownJson.encode(input.categoryScores),
          overallScore: input.overallScore,
          explanation: input.explanation ?? null,
          keyMatchesJson:
            input.keyMatches === undefined || input.keyMatches === null
              ? null
              : unknownJson.encode(input.keyMatches),
          importantGapsJson:
            input.importantGaps === undefined || input.importantGaps === null
              ? null
              : unknownJson.encode(input.importantGaps),
          importantConcernsJson:
            input.importantConcerns === undefined || input.importantConcerns === null
              ? null
              : unknownJson.encode(input.importantConcerns),
          inferredSeniority: input.inferredSeniority ?? null,
          recommendationSummary: input.recommendationSummary ?? null,
          success: input.success,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          active: true,
        })
        .returning({ id: scoreResults.id })
        .all();
      const row = result[0];
      if (row === undefined) throw new Error('activateResult returned no rows');
      return row.id;
    });
  }

  async findActiveByJob(jobId: number, fingerprint: string): Promise<ScoreResultRow | null> {
    const rows = this.ctx.db
      .select()
      .from(scoreResults)
      .where(
        and(
          eq(scoreResults.jobId, jobId),
          eq(scoreResults.active, true),
          eq(scoreResults.fingerprint, fingerprint),
        ),
      )
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findById(id: number): Promise<ScoreResultRow | null> {
    const rows = this.ctx.db.select().from(scoreResults).where(eq(scoreResults.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByJob(jobId: number): Promise<readonly ScoreResultRow[]> {
    const rows = this.ctx.db.select().from(scoreResults).where(eq(scoreResults.jobId, jobId)).all();
    return rows.map(rowFromRecord);
  }

  async listByRun(pipelineRunId: number): Promise<readonly ScoreResultRow[]> {
    const rows = this.ctx.db
      .select()
      .from(scoreResults)
      .where(eq(scoreResults.pipelineRunId, pipelineRunId))
      .all();
    return rows.map(rowFromRecord);
  }

  async topByRun(pipelineRunId: number, limit: number): Promise<readonly ScoreResultRow[]> {
    const rows = this.ctx.db
      .select()
      .from(scoreResults)
      .where(
        and(
          eq(scoreResults.pipelineRunId, pipelineRunId),
          eq(scoreResults.active, true),
          eq(scoreResults.success, true),
        ),
      )
      .orderBy(desc(scoreResults.overallScore))
      .limit(limit)
      .all();
    return rows.map(rowFromRecord);
  }

  /**
   * List every active + successful score result for a run (TASK-016
   * Wave B, SPEC §35.2). Functionally equivalent to `topByRun` minus
   * the `LIMIT` + `ORDER BY` — the service layer uses this to count
   * `scored` jobs and to assemble the `RunShowPayload` `scoreCounts`.
   */
  async listActiveByRun(pipelineRunId: number): Promise<readonly ScoreResultRow[]> {
    const rows = this.ctx.db
      .select()
      .from(scoreResults)
      .where(
        and(
          eq(scoreResults.pipelineRunId, pipelineRunId),
          eq(scoreResults.active, true),
          eq(scoreResults.success, true),
        ),
      )
      .all();
    return rows.map(rowFromRecord);
  }
}
