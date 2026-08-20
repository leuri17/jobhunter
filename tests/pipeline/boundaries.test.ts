import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'vitest';

const PIPELINE_DIR = resolve(import.meta.dirname, '..', '..', 'src', 'pipeline');

/**
 * Match a RUNTIME import of a banned package. `import type ...` is
 * intentionally NOT matched — domain code may use type-only imports
 * of Playwright + Drizzle for their `Page`, `RepositoryContext`,
 * `SearchExecutionRow`, etc. types. Mirrors the carve-out in
 * `tests/extraction/boundaries.test.ts` + `tests/scoring/boundaries.test.ts`.
 */
const BANNED = [
  /^import\s+(?!type\s).*from\s+['"]playwright['"]/m,
  /^import\s+(?!type\s).*from\s+['"]drizzle-orm['"]/m,
  /^import\s+(?!type\s).*from\s+['"]openai['"]/m,
  /^import\s+(?!type\s).*from\s+['"]commander['"]/m,
  /^import\s+(?!type\s).*from\s+['"]pino['"]/m,
];

const ALLOWED_INQUIRER = ['prompts-inquirer.ts'];

describe('src/pipeline boundaries', () => {
  const files = readdirSync(PIPELINE_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    it(`${file} does not import banned packages directly`, () => {
      const path = join(PIPELINE_DIR, file);
      const content = readFileSync(path, 'utf8');
      if (file === 'version.ts') return; // walks up to read package.json
      for (const pattern of BANNED) {
        if (pattern.test(content)) {
          throw new Error(`${file} imports a banned package: ${pattern}`);
        }
      }
    });

    it(`${file} does not import @inquirer/prompts except in the carve-out file`, () => {
      if (ALLOWED_INQUIRER.includes(file)) return;
      const path = join(PIPELINE_DIR, file);
      const content = readFileSync(path, 'utf8');
      if (/from\s+['"]@inquirer\/prompts['"]/.test(content)) {
        throw new Error(
          `${file} imports @inquirer/prompts; only ${ALLOWED_INQUIRER.join(',')} may.`,
        );
      }
    });
  }
});
