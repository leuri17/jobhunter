import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Domain-boundary guard for `src/filter/`.
 *
 * AGENTS.md §5 / §9: domain code must not depend on Playwright, Drizzle,
 * OpenAI, or Pino. This test enumerates every `.ts` file under `src/filter/`
 * and asserts that none of them import any of the banned modules.
 *
 * If a future task needs another carving, the allow-list must be extended
 * explicitly and the extension justified in that task's description.
 */

const FILTER_DIR = join(process.cwd(), 'src', 'filter');

const BANNED_IMPORTS = ['playwright', 'drizzle-orm', 'openai', 'pino'] as const;

function listFilterSourceFiles(dir: string): string[] {
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
      out.push(...listFilterSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function importMatches(source: string, moduleName: string): boolean {
  // ESM `import ... from 'x'` and `import 'x'`.
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const specifier = `${escaped}(?:/[^']*)?`;
  const fromPattern = new RegExp(`from\\s+['"]${specifier}['"]`, 'g');
  const bareImportPattern = new RegExp(`import\\s+['"]${specifier}['"]`, 'g');
  // CJS `require('x')` for completeness (we do not use require, but the guard
  // should still catch accidental additions).
  const requirePattern = new RegExp(`require\\(\\s*['"]${specifier}['"]`, 'g');
  return fromPattern.test(source) || bareImportPattern.test(source) || requirePattern.test(source);
}

function relativeFromCwd(absolute: string): string {
  const cwd = process.cwd();
  const prefix = `${cwd}${process.platform === 'win32' ? '\\' : '/'}`;
  if (absolute.startsWith(prefix)) {
    return absolute
      .slice(prefix.length)
      .split(process.platform === 'win32' ? '\\' : '/')
      .join('/');
  }
  return absolute;
}

describe('src/filter domain-boundary guard', () => {
  it('exists as a directory (or stays green when empty)', () => {
    const files = listFilterSourceFiles(FILTER_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it('every .ts file under src/filter/ avoids the banned imports', () => {
    const files = listFilterSourceFiles(FILTER_DIR);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      for (const banned of BANNED_IMPORTS) {
        expect(importMatches(source, banned), `${rel} must not import ${banned}`).toBe(false);
      }
    }
  });

  it('explicitly scans src/filter/evaluate.ts (Task 6) for banned imports', () => {
    // The tree-walk test above already covers every file under
    // src/filter/, but this dedicated assertion documents that the
    // composite rule evaluator added by Task 6 stays on the domain
    // side of AGENTS.md §5 / §9.
    const absolute = join(FILTER_DIR, 'evaluate.ts');
    expect(listFilterSourceFiles(FILTER_DIR)).toContain(absolute);
    const source = readFileSync(absolute, 'utf8');
    for (const banned of BANNED_IMPORTS) {
      expect(
        importMatches(source, banned),
        `src/filter/evaluate.ts must not import ${banned}`,
      ).toBe(false);
    }
  });
});
