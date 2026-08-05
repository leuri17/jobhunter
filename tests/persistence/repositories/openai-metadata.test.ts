import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { OpenAIRequestMetadataRepository } from '../../../src/persistence/repositories/openai-metadata.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('OpenAIRequestMetadataRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: OpenAIRequestMetadataRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-openai-metadata-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new OpenAIRequestMetadataRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts and finds a metadata row', async () => {
    const id = await repo.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result',
      relatedEntityId: 42,
      inputHashes: [{ jobId: 42 }, { profileVersionId: 7 }],
      promptVersion: 'p1',
      structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      configJson: { temperature: 0 },
      tokenUsage: { promptTokens: 100, completionTokens: 50 },
      attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z',
      endTimestamp: '2026-08-05T10:00:01.000Z',
      success: true,
    });
    const row = await repo.findById(id);
    expect(row?.id).toBe(id);
    expect(row?.operationType).toBe('job_scoring');
    expect(row?.relatedEntityId).toBe(42);
    expect(row?.validatedOutput).toBeNull();
  });

  it('listByOperation filters by operation type', async () => {
    await repo.insert({
      operationType: 'profile_extraction',
      inputHashes: [],
      promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z', success: true,
    });
    const scoreId = await repo.insert({
      operationType: 'job_scoring',
      inputHashes: [],
      promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:01:00.000Z', success: true,
    });
    const scoreRows = await repo.listByOperation('job_scoring');
    expect(scoreRows.map((r) => r.id)).toContain(scoreId);
    const profileRows = await repo.listByOperation('profile_extraction');
    expect(profileRows.every((r) => r.operationType === 'profile_extraction')).toBe(true);
  });

  it('listByRelatedEntity returns rows for a given entity', async () => {
    await repo.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result', relatedEntityId: 100,
      inputHashes: [], promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z', success: true,
    });
    await repo.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result', relatedEntityId: 200,
      inputHashes: [], promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:01:00.000Z', success: true,
    });
    const rows = await repo.listByRelatedEntity('score_result', 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relatedEntityId).toBe(100);
  });
});
