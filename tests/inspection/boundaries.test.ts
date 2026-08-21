import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Domain-boundary guard for `src/inspection/` (TASK-016 Wave D Task 14).
 *
 * AGENTS.md §5: domain code must not depend on Commander, Inquirer,
 * Drizzle, OpenAI, or runtime Pino. The inspection layer is split into:
 *   - `src/inspection/`              — pure helpers (columns, format,
 *                                     truncate, state, json-schemas,
 *                                     errors, index). No repository I/O.
 *   - `src/inspection/services/`    — read-side services. May import
 *                                     `src/persistence/repositories/`
 *                                     (the seam for repository I/O) but
 *                                     MUST NOT import `drizzle-orm`,
 *                                     `commander`, `@inquirer/prompts`,
 *                                     `openai`, runtime `pino`, or call
 *                                     `process.exit()`.
 *
 * This file mirrors `tests/scoring/boundaries.test.ts` (the closest
 * precedent for the same module-style split between pure helpers +
 * repository-aware services).
 *
 * Type-only `drizzle-orm` imports in the services layer are allowed
 * because TypeScript erases them at runtime — the regex below matches
 * both `import type ... from 'drizzle-orm'` and `import ... from
 * 'drizzle-orm'`; the carve-out is implemented by the `import type`
 * exclusion.
 */

const INSPECTION_DIR = join(process.cwd(), 'src', 'inspection');

const SERVICES_DIR = join(INSPECTION_DIR, 'services');

/** Regex that matches `process.exit(` but NOT `process.exitCode`. */
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(/;

/**
 * Regex that matches a RUNTIME import of a banned package. `import
 * type ... from ...` is intentionally NOT matched because TypeScript
 * erases the import. This is the same shape used by
 * `tests/pipeline/boundaries.test.ts`.
 */
const RUNTIME_IMPORT_RE = (moduleName: string): RegExp => {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^import\\s+(?!type\\s).*from\\s+['"]${escaped}(?:/[^'"]*)?['"]`, 'm');
};

interface BannedImport {
  readonly moduleName: string;
  readonly pattern: RegExp;
}

const BANNED_PURE_HELPERS: readonly BannedImport[] = [
  { moduleName: 'commander', pattern: RUNTIME_IMPORT_RE('commander') },
  { moduleName: '@inquirer/prompts', pattern: RUNTIME_IMPORT_RE('@inquirer/prompts') },
  { moduleName: 'drizzle-orm', pattern: RUNTIME_IMPORT_RE('drizzle-orm') },
  { moduleName: 'openai', pattern: RUNTIME_IMPORT_RE('openai') },
  { moduleName: 'pino', pattern: RUNTIME_IMPORT_RE('pino') },
];

const BANNED_SERVICES: readonly BannedImport[] = [
  { moduleName: 'commander', pattern: RUNTIME_IMPORT_RE('commander') },
  { moduleName: '@inquirer/prompts', pattern: RUNTIME_IMPORT_RE('@inquirer/prompts') },
  { moduleName: 'drizzle-orm', pattern: RUNTIME_IMPORT_RE('drizzle-orm') },
  { moduleName: 'openai', pattern: RUNTIME_IMPORT_RE('openai') },
  { moduleName: 'pino', pattern: RUNTIME_IMPORT_RE('pino') },
];

function listInspectionFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listInspectionFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function isInServicesDir(absolute: string): boolean {
  const prefix = `${SERVICES_DIR}${process.platform === 'win32' ? '\\' : '/'}`;
  return absolute.startsWith(prefix);
}

function relativeFromCwd(absolute: string): string {
  const cwd = process.cwd();
  const sep = process.platform === 'win32' ? '\\' : '/';
  const prefix = `${cwd}${sep}`;
  if (absolute.startsWith(prefix)) {
    return absolute.slice(prefix.length).split(sep).join('/');
  }
  return absolute;
}

describe('src/inspection domain-boundary guard (TASK-016 Wave D Task 14)', () => {
  it('exists as a directory with both pure helpers + services', () => {
    const pureFiles = listInspectionFiles(INSPECTION_DIR).filter((f) => !isInServicesDir(f));
    const serviceFiles = listInspectionFiles(SERVICES_DIR);
    expect(pureFiles.length).toBeGreaterThan(0);
    expect(serviceFiles.length).toBeGreaterThan(0);
  });

  describe('pure helpers under src/inspection/ (no services/)', () => {
    const pureFiles = listInspectionFiles(INSPECTION_DIR).filter((f) => !isInServicesDir(f));

    for (const absolute of pureFiles) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');

      it(`${rel} does not import any banned package`, () => {
        for (const banned of BANNED_PURE_HELPERS) {
          expect(
            banned.pattern.test(source),
            `${rel} must not runtime-import ${banned.moduleName}`,
          ).toBe(false);
        }
      });

      it(`${rel} does not call process.exit()`, () => {
        expect(PROCESS_EXIT_RE.test(source), `${rel} must not call process.exit()`).toBe(false);
      });
    }
  });

  describe('read-side services under src/inspection/services/', () => {
    const serviceFiles = listInspectionFiles(SERVICES_DIR);

    for (const absolute of serviceFiles) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');

      it(`${rel} does not import any banned package`, () => {
        for (const banned of BANNED_SERVICES) {
          expect(
            banned.pattern.test(source),
            `${rel} must not runtime-import ${banned.moduleName}`,
          ).toBe(false);
        }
      });

      it(`${rel} does not call process.exit()`, () => {
        expect(PROCESS_EXIT_RE.test(source), `${rel} must not call process.exit()`).toBe(false);
      });
    }
  });
});
