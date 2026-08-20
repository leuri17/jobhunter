import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read the application version from the nearest package.json.
 *
 * Walks up from import.meta.url until a package.json is found.
 * The name field must be 'jobhunter' to match the right package.
 * Returns '0.0.0' when the package.json or the version field is missing.
 */
export function getApplicationVersion(): string {
  try {
    const startDir = dirname(fileURLToPath(import.meta.url));
    let dir = startDir;
    for (let i = 0; i < 8; i += 1) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        if (parsed.name === 'jobhunter' && typeof parsed.version === 'string') {
          return parsed.version;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through
  }
  return '0.0.0';
}
