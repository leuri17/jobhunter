export {
  DatabaseError,
  MigrationError,
  ApplicationError,
  ExitCode,
} from './errors.js';
export {
  createDatabaseConnection,
  type DatabaseConnection,
} from './connection.js';
export {
  runMigrations,
  type MigrationReport,
  type RunMigrationsOptions,
} from './migrations.js';
export {
  initializeDatabase,
  type DatabaseHandle,
  type InitializeDatabaseOptions,
} from './database.js';
export { schema, type Schema } from './schema.js';
