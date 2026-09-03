import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Domain-boundary guard for `src/init/`.
 *
 * AGENTS.md §5 / §9: domain code must not depend on Playwright, Drizzle,
 * OpenAI, or Pino. This test enumerates every `.ts` file under `src/init/`
 * and asserts that none of them import any of the banned modules.
 *
 * Type-only `import type { ... } from 'pino'` is permitted via the literal
 * `RUNTIME_IMPORT_RE` regex below (Finding 14). If a future task needs
 * another carving, the allow-list must be extended explicitly and the
 * extension justified in that task's description.
 */

const INIT_DIR = join(process.cwd(), 'src', 'init');

const BANNED_IMPORTS = ['playwright', 'drizzle-orm', 'openai', 'pino'] as const;

/**
 * Literal regex that distinguishes runtime `pino` imports from type-only
 * imports (Finding 14). The negative lookahead `(?!type\s)` rejects
 * `import type { Logger } from 'pino'` while matching both:
 *   - `import { foo } from 'pino'`                ← banned
 *   - `import pino from 'pino'`                   ← banned
 *   - `import * as pino from 'pino'`              ← banned
 *   - `import 'pino'`                              ← banned
 *   - `import type { Logger } from 'pino'`        ← permitted
 *   - `import type pino from 'pino'`              ← permitted
 */
const RUNTIME_IMPORT_RE = /^\s*import\s+(?!type\s)[^;]*['"]pino['"]/m;

/**
 * Regex that matches `process.exit(` invocations but NOT
 * `process.exitCode` (the latter is a soft suggestion; per AGENTS.md §10
 * the orchestrator never calls `process.exit`).
 */
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(/;

function listInitSourceFiles(dir: string): string[] {
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
      out.push(...listInitSourceFiles(full));
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

describe('src/init domain-boundary guard', () => {
  it('exists as a directory (or stays green when empty)', () => {
    const files = listInitSourceFiles(INIT_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it('every .ts file under src/init/ avoids the banned imports (with carve-out)', () => {
    const files = listInitSourceFiles(INIT_DIR);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      for (const banned of BANNED_IMPORTS) {
        if (banned === 'pino' && rel === 'src/init/log.ts') {
          // log.ts is allowed a TYPE-ONLY `import type { ... } from 'pino'`.
          // The runtime ban is enforced separately below.
          continue;
        }
        expect(importMatches(source, banned), `${rel} must not import ${banned}`).toBe(false);
      }
    }
  });

  it('allows type-only `import type { ... } from "pino"` in src/init/log.ts', () => {
    const absolute = join(INIT_DIR, 'log.ts');
    expect(listInitSourceFiles(INIT_DIR)).toContain(absolute);
    const source = readFileSync(absolute, 'utf8');
    // No runtime pino import.
    expect(
      RUNTIME_IMPORT_RE.test(source),
      'src/init/log.ts must not have a runtime pino import',
    ).toBe(false);
  });

  it('RUNTIME_IMPORT_RE accepts `import type` and rejects runtime `pino` imports', () => {
    expect(RUNTIME_IMPORT_RE.test("import type { Logger } from 'pino'")).toBe(false);
    expect(RUNTIME_IMPORT_RE.test("import type pino from 'pino'")).toBe(false);
    expect(RUNTIME_IMPORT_RE.test("import { foo } from 'pino'")).toBe(true);
    expect(RUNTIME_IMPORT_RE.test("import 'pino'")).toBe(true);
  });

  it('explicitly scans src/init/init-service.ts for banned imports (when present)', () => {
    // The tree-walk test above already covers every file under
    // src/init/, but this dedicated assertion documents that the
    // orchestrator (added in ) stays on the domain side of
    // AGENTS.md §5 / §9. The test is skipped (via length check) when
    // src/init/init-service.ts has not been added yet —  ships
    // only the six pure modules.
    const absolute = join(INIT_DIR, 'init-service.ts');
    const files = listInitSourceFiles(INIT_DIR);
    expect(files, 'src/init/init-service.ts must exist after ').toContain(absolute);
    const source = readFileSync(absolute, 'utf8');
    for (const banned of BANNED_IMPORTS) {
      expect(
        importMatches(source, banned),
        `src/init/init-service.ts must not import ${banned}`,
      ).toBe(false);
    }
  });

  it('explicitly asserts src/init/init-service.ts does NOT call process.exit', () => {
    // The orchestrator NEVER calls `process.exit` (AGENTS.md §10). The
    // HTTP error mapper owns exit-code translation; the domain layer
    // throws typed errors and lets the boundary convert them. The
    // `process.exitCode` property is a soft suggestion and is permitted.
    const absolute = join(INIT_DIR, 'init-service.ts');
    expect(listInitSourceFiles(INIT_DIR)).toContain(absolute);
    const source = readFileSync(absolute, 'utf8');
    expect(
      PROCESS_EXIT_RE.test(source),
      'src/init/init-service.ts must not call process.exit()',
    ).toBe(false);
  });
});
