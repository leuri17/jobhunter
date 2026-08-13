import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repository root from the current module.
 *
 * The CLI binary is compiled to `dist/`, so the source-relative path is
 * `../..` from the dist output (cli.js -> dist/ -> repo root). For dev mode
 * (`tsx src/cli.ts`), the source path is `../..` from src/cli.ts.
 *
 * In both cases the migrations folder lives at <repoRoot>/drizzle.
 */
function resolveRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here is .../<repo>/dist/cli.js (production) or .../<repo>/src/cli.ts (dev).
  const repoRoot = resolve(here, '..', '..');
  return repoRoot;
}

export function resolveRepoRootForMigrations(): string {
  return resolve(resolveRepoRoot(), 'drizzle');
}
