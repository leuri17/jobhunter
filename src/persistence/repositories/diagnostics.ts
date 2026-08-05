import { eq } from 'drizzle-orm';

import { diagnosticArtifacts } from '../schema.js';
import type { RepositoryContext } from './types.js';

export type DiagnosticArtifactType =
  | 'screenshot' | 'current_url' | 'stack_trace' | 'playwright_trace' | 'html_snapshot' | 'log_file';

export interface DiagnosticArtifactRow {
  readonly id: number;
  readonly pipelineRunId: number | null;
  readonly searchExecutionId: number | null;
  readonly jobId: number | null;
  readonly discoveryErrorId: number | null;
  readonly extractionAttemptId: number | null;
  readonly artifactType: DiagnosticArtifactType;
  readonly storedPath: string;
  readonly relativePath: string;
  readonly mimeType: string | null;
  readonly fileSize: number | null;
  readonly createdAt: string;
  readonly errorCode: string | null;
  readonly description: string | null;
}

export interface DiagnosticArtifactInsert {
  readonly pipelineRunId?: number | null;
  readonly searchExecutionId?: number | null;
  readonly jobId?: number | null;
  readonly discoveryErrorId?: number | null;
  readonly extractionAttemptId?: number | null;
  readonly artifactType: DiagnosticArtifactType;
  readonly storedPath: string;
  readonly relativePath: string;
  readonly mimeType?: string | null;
  readonly fileSize?: number | null;
  readonly createdAt: string;
  readonly errorCode?: string | null;
  readonly description?: string | null;
}

function rowFromRecord(record: typeof diagnosticArtifacts.$inferSelect): DiagnosticArtifactRow {
  return {
    id: record.id,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    jobId: record.jobId,
    discoveryErrorId: record.discoveryErrorId,
    extractionAttemptId: record.extractionAttemptId,
    artifactType: record.artifactType,
    storedPath: record.storedPath,
    relativePath: record.relativePath,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    createdAt: record.createdAt,
    errorCode: record.errorCode,
    description: record.description,
  };
}

export class DiagnosticArtifactRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: DiagnosticArtifactInsert): Promise<number> {
    const result = this.ctx.db.insert(diagnosticArtifacts).values({
      pipelineRunId: input.pipelineRunId ?? null,
      searchExecutionId: input.searchExecutionId ?? null,
      jobId: input.jobId ?? null,
      discoveryErrorId: input.discoveryErrorId ?? null,
      extractionAttemptId: input.extractionAttemptId ?? null,
      artifactType: input.artifactType,
      storedPath: input.storedPath,
      relativePath: input.relativePath,
      mimeType: input.mimeType ?? null,
      fileSize: input.fileSize ?? null,
      createdAt: input.createdAt,
      errorCode: input.errorCode ?? null,
      description: input.description ?? null,
    }).returning({ id: diagnosticArtifacts.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('insert returned no rows');
    return row.id;
  }

  async findById(id: number): Promise<DiagnosticArtifactRow | null> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByRun(pipelineRunId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.pipelineRunId, pipelineRunId)).all();
    return rows.map(rowFromRecord);
  }

  async listBySearch(searchExecutionId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.searchExecutionId, searchExecutionId)).all();
    return rows.map(rowFromRecord);
  }

  async listByJob(jobId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.jobId, jobId)).all();
    return rows.map(rowFromRecord);
  }

  async listByDiscoveryError(discoveryErrorId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.discoveryErrorId, discoveryErrorId)).all();
    return rows.map(rowFromRecord);
  }

  async listByExtractionAttempt(extractionAttemptId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.extractionAttemptId, extractionAttemptId)).all();
    return rows.map(rowFromRecord);
  }
}
