import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repository root from the current module.
 *
 * This module is preserved for the sidecar's migration loader to
 * import. The migrations folder lives at <repoRoot>/drizzle.
 */
function resolveRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here is .../<repo>/src/persistence/resolve-migrations.ts.
  const repoRoot = resolve(here, '..', '..');
  return repoRoot;
}

export function resolveRepoRootForMigrations(): string {
  return resolve(resolveRepoRoot(), 'drizzle');
}
