import type { DatabaseConnection } from '../connection.js';
import type { DrizzleTransaction } from '../transactions.js';
import { ApplicationMetadataRepository } from './application-metadata.js';
import { DiagnosticArtifactRepository } from './diagnostics.js';
import { FilterConfigurationRepository } from './filter-configurations.js';
import { FilterResultRepository } from './filter-results.js';
import { JobRepository } from './jobs.js';
import { OpenAIRequestMetadataRepository } from './openai-metadata.js';
import { PipelineRunRepository } from './pipeline-runs.js';
import { ProfileSourceRepository } from './profile-sources.js';
import { ProfileVersionRepository } from './profile-versions.js';
import { ScoreResultRepository } from './score-results.js';
import type { DrizzleDB, RepositoryContext } from './types.js';

export class Repositories {
  readonly profileSources: ProfileSourceRepository;
  readonly profileVersions: ProfileVersionRepository;
  readonly filterConfigurations: FilterConfigurationRepository;
  readonly pipelineRuns: PipelineRunRepository;
  readonly jobs: JobRepository;
  readonly filterResults: FilterResultRepository;
  readonly scoreResults: ScoreResultRepository;
  readonly openaiMetadata: OpenAIRequestMetadataRepository;
  readonly diagnostics: DiagnosticArtifactRepository;
  readonly applicationMetadata: ApplicationMetadataRepository;
  /**
   * The underlying Drizzle database. Inside a `transact` callback this is the
   * transaction handle, so callers can perform sync Drizzle operations against
   * the same savepoint as the rest of the transaction.
   */
  readonly db: DrizzleDB;
  private readonly ctx: RepositoryContext;

  constructor(ctx: RepositoryContext) {
    this.ctx = ctx;
    this.db = ctx.db;
    this.profileSources = new ProfileSourceRepository(ctx);
    this.profileVersions = new ProfileVersionRepository(ctx);
    this.filterConfigurations = new FilterConfigurationRepository(ctx);
    this.pipelineRuns = new PipelineRunRepository(ctx);
    this.jobs = new JobRepository(ctx);
    this.filterResults = new FilterResultRepository(ctx);
    this.scoreResults = new ScoreResultRepository(ctx);
    this.openaiMetadata = new OpenAIRequestMetadataRepository(ctx);
    this.diagnostics = new DiagnosticArtifactRepository(ctx);
    this.applicationMetadata = new ApplicationMetadataRepository(ctx);
  }

  /**
   * Run a synchronous block of repository writes inside a single transaction.
   * The block receives a Repositories instance bound to the transaction; every
   * call inside sees the same `tx` handle and participates in the same savepoint.
   *
   * The callback MUST be synchronous: better-sqlite3's transaction wrapper
   * rejects callbacks that return a Promise. Use `txRepos.db` for sync Drizzle
   * operations; the sub-repository methods (which are async) can be invoked
   * AFTER the transaction returns, on the outer `connection.db`.
   */
  transact<T>(fn: (repos: Repositories) => T): T {
    return this.ctx.db.transaction((tx: DrizzleTransaction) => {
      const txRepos = new Repositories({ db: tx });
      return fn(txRepos);
    });
  }
}

export function createRepositories(connection: DatabaseConnection): Repositories {
  return new Repositories({ db: connection.db });
}

export {
  ApplicationMetadataRepository,
  DiagnosticArtifactRepository,
  FilterConfigurationRepository,
  FilterResultRepository,
  JobRepository,
  OpenAIRequestMetadataRepository,
  PipelineRunRepository,
  ProfileSourceRepository,
  ProfileVersionRepository,
  ScoreResultRepository,
};
export type { RepositoryContext, DrizzleDB } from './types.js';
