import { ensureDirectory, type PlatformPaths } from '../platform/paths.js';

import { createDatabaseConnection, type DatabaseConnection } from './connection.js';
import { runMigrations, type MigrationReport } from './migrations.js';

export interface InitializeDatabaseOptions {
  readonly migrationsFolder: string;
}

export interface DatabaseHandle extends DatabaseConnection {
  readonly filePath: string;
  readonly report: MigrationReport;
}

export async function initializeDatabase(
  paths: PlatformPaths,
  options: InitializeDatabaseOptions,
): Promise<DatabaseHandle> {
  await ensureDirectory(paths.data.directory, 'data');
  const filePath = paths.data.file('jobhunter.sqlite');
  const connection = createDatabaseConnection(filePath);
  let report: MigrationReport;
  try {
    report = runMigrations(connection, { migrationsFolder: options.migrationsFolder });
  } catch (cause) {
    connection.close();
    throw cause;
  }
  return {
    ...connection,
    filePath,
    report,
  };
}
