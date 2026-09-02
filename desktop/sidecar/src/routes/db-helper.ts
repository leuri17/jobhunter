import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import { initializeDatabase, createRepositories, resolveRepoRootForMigrations } from '@jobhunter/core/persistence';

export async function openDbHandle() {
  const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
  return initializeDatabase(paths, { migrationsFolder: resolveRepoRootForMigrations() });
}

export { createRepositories };