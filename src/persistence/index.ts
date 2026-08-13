export { DatabaseError, MigrationError, ApplicationError, ExitCode } from './errors.js';
export { createDatabaseConnection, type DatabaseConnection } from './connection.js';
export { runMigrations, type MigrationReport, type RunMigrationsOptions } from './migrations.js';
export {
  initializeDatabase,
  type DatabaseHandle,
  type InitializeDatabaseOptions,
} from './database.js';
export { schema, type Schema } from './schema.js';

// TASK-004 additions
export { InvalidIdentifierError } from './identifier-errors.js';
export {
  formatId,
  resolveId,
  resolveJobIdentifier,
  parsePrefixedId,
  IDENTIFIER_PREFIXES,
  JOB_PREFIX,
  NUMERIC_JOB_PATTERN,
  type IdentifierKind,
  type JobIdentifierResolution,
} from './identifiers.js';
export { RecordNotFoundError, DuplicateSha256Error } from './repository-errors.js';
export {
  Repositories,
  createRepositories,
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
  type RepositoryContext,
  type DrizzleDB,
} from './repositories/index.js';
export { withTransaction, type DrizzleTransaction } from './transactions.js';
