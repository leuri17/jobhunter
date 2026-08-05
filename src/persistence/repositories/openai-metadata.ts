import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import { openaiRequestMetadata } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type OpenAIOperationType = 'profile_extraction' | 'job_scoring';
export type OpenAIEntityRefType = 'profile_version' | 'score_result';

export interface OpenAIRequestMetadataRow {
  readonly id: number;
  readonly operationType: OpenAIOperationType;
  readonly relatedEntityType: OpenAIEntityRefType | null;
  readonly relatedEntityId: number | null;
  readonly inputHashes: readonly unknown[];
  readonly promptVersion: string;
  readonly structuredOutputSchemaVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly configJson: unknown;
  readonly tokenUsage: unknown | null;
  readonly validatedOutput: unknown | null;
  readonly attemptCount: number;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface OpenAIRequestMetadataInsert {
  readonly operationType: OpenAIOperationType;
  readonly relatedEntityType?: OpenAIEntityRefType | null;
  readonly relatedEntityId?: number | null;
  readonly inputHashes: readonly unknown[];
  readonly promptVersion: string;
  readonly structuredOutputSchemaVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly configJson: unknown;
  readonly tokenUsage?: unknown | null;
  readonly validatedOutput?: unknown | null;
  readonly attemptCount: number;
  readonly startTimestamp: string;
  readonly endTimestamp?: string | null;
  readonly success: boolean;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

function rowFromRecord(record: typeof openaiRequestMetadata.$inferSelect): OpenAIRequestMetadataRow {
  return {
    id: record.id,
    operationType: record.operationType,
    relatedEntityType: record.relatedEntityType,
    relatedEntityId: record.relatedEntityId,
    inputHashes: unknownJson.decodeRequired(record.inputHashesJson) as readonly unknown[],
    promptVersion: record.promptVersion,
    structuredOutputSchemaVersion: record.structuredOutputSchemaVersion,
    model: record.model,
    reasoningEffort: record.reasoningEffort,
    configJson: unknownJson.decodeRequired(record.configJson),
    tokenUsage: unknownJson.decode(record.tokenUsageJson),
    validatedOutput: unknownJson.decode(record.validatedOutputJson),
    attemptCount: record.attemptCount,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    success: record.success,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
  };
}

export class OpenAIRequestMetadataRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: OpenAIRequestMetadataInsert): Promise<number> {
    const result = this.ctx.db
      .insert(openaiRequestMetadata)
      .values({
        operationType: input.operationType,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        inputHashesJson: unknownJson.encode(input.inputHashes),
        promptVersion: input.promptVersion,
        structuredOutputSchemaVersion: input.structuredOutputSchemaVersion,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        configJson: unknownJson.encode(input.configJson),
        tokenUsageJson: input.tokenUsage === undefined || input.tokenUsage === null ? null : unknownJson.encode(input.tokenUsage),
        validatedOutputJson: input.validatedOutput === undefined || input.validatedOutput === null ? null : unknownJson.encode(input.validatedOutput),
        attemptCount: input.attemptCount,
        startTimestamp: input.startTimestamp,
        endTimestamp: input.endTimestamp ?? null,
        success: input.success,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .returning({ id: openaiRequestMetadata.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('insert returned no rows');
    return row.id;
  }

  async findById(id: number): Promise<OpenAIRequestMetadataRow | null> {
    const rows = this.ctx.db.select().from(openaiRequestMetadata).where(eq(openaiRequestMetadata.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByOperation(
    operationType: OpenAIOperationType,
    opts?: { sinceTimestamp?: string; limit?: number },
  ): Promise<readonly OpenAIRequestMetadataRow[]> {
    const base = this.ctx.db.select().from(openaiRequestMetadata);
    const filtered = opts?.sinceTimestamp === undefined
      ? base.where(eq(openaiRequestMetadata.operationType, operationType))
      : base.where(and(eq(openaiRequestMetadata.operationType, operationType), gte(openaiRequestMetadata.startTimestamp, opts.sinceTimestamp)));
    const ordered = filtered.orderBy(desc(openaiRequestMetadata.startTimestamp));
    const limited = opts?.limit === undefined ? ordered : ordered.limit(opts.limit);
    const rows = limited.all();
    return rows.map(rowFromRecord);
  }

  async listByRelatedEntity(
    entityType: OpenAIEntityRefType,
    entityId: number,
  ): Promise<readonly OpenAIRequestMetadataRow[]> {
    const rows = this.ctx.db
      .select()
      .from(openaiRequestMetadata)
      .where(and(eq(openaiRequestMetadata.relatedEntityType, entityType), eq(openaiRequestMetadata.relatedEntityId, entityId)))
      .orderBy(desc(openaiRequestMetadata.startTimestamp))
      .all();
    return rows.map(rowFromRecord);
  }
}
