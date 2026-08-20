import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createDatabaseConnection } from '../../../src/persistence/connection.js';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createRepositories } from '../../../src/persistence/repositories/index.js';
import {
  FakeOpenAIClient,
  type FakeOpenAIClientScript,
} from '../../../src/profile/openai/fake-client.js';
import { ScoringService } from '../../../src/scoring/service.js';

const REPO_ROOT = resolve(join(import.meta.dirname, '..', '..', '..'));

/**
 * Options for the fake scoring pipeline.
 */
export interface FakeScoringPipelineOptions {
  readonly fakeScripts: readonly FakeOpenAIClientScript[] | FakeOpenAIClientScript;
  readonly config: {
    readonly model: string;
    readonly reasoningEffort: 'low' | 'medium' | 'high';
    readonly concurrency: number;
  };
}

/**
 * Hermetic test harness for the scoring service.
 *
 * Wires the `FakeOpenAIClient` (from `src/profile/openai/fake-client.ts`)
 * into the real `ScoringService` over a real SQLite database in a
 * `mkdtempSync` temp directory. Mirrors the TASK-013 pattern at
 * `tests/extraction/service.test.ts`.
 *
 * `cleanup()` must be called after each test to release the temp
 * directory. Use `beforeEach` + `afterEach` in the test file.
 */
export class FakeScoringPipeline {
  readonly fakeClient: FakeOpenAIClient;
  readonly service: ScoringService;
  readonly repositories: ReturnType<typeof createRepositories>;
  readonly tmpDir: string;
  private readonly connection: ReturnType<typeof createDatabaseConnection>;

  constructor(options: FakeScoringPipelineOptions) {
    this.tmpDir = mkdtempSync(join(tmpdir(), 'jobhunter-scoring-'));
    this.connection = createDatabaseConnection(join(this.tmpDir, 'test.db'));
    runMigrations(this.connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    this.repositories = createRepositories(this.connection);
    this.fakeClient = new FakeOpenAIClient(options.fakeScripts);
    this.service = new ScoringService({
      repositories: this.repositories,
      openaiClient: this.fakeClient,
      config: options.config,
    });
  }

  /** Release the temp directory + close the DB connection. */
  async cleanup(): Promise<void> {
    this.connection.close();
    rmSync(this.tmpDir, { recursive: true, force: true });
  }
}
