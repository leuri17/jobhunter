import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Domain-boundary guard for `src/linkedin/extraction/` (TASK-013
 * Plan Task 14, Wave E).
 *
 * Granular mirror of `tests/linkedin/boundaries.test.ts`. AGENTS.md
 * §5 / §9: domain code must not depend on Commander, Inquirer,
 * Playwright (runtime), Drizzle, OpenAI, or runtime Pino. The
 * Playwright allow-list covers the 3 extraction files that need a
 * Playwright seam — `panel-parser.ts`, `dedicated-parser.ts`, and
 * the orchestrator `service.ts` (type-only). The Drizzle
 * `service.ts` carve-out is mirrored here.
 *
 * Per AGENTS.md §5: extraction domain code does not import
 * Commander, Inquirer, OpenAI, or runtime Pino. Runtime Playwright
 * is reserved for `src/linkedin/playwright-session.ts`. `drizzle-orm`
 * is allowed only inside `service.ts` (Wave D carve-out — the
 * orchestrator wraps 3 per-job writes in a single sync
 * `db.transaction`).
 *
 * File structure (Wave E end-state — 11 files):
 *   - `src/linkedin/extraction/state.ts`             (pure types)
 *   - `src/linkedin/extraction/errors.ts`            (typed errors)
 *   - `src/linkedin/extraction/normalize.ts`         (pure helpers)
 *   - `src/linkedin/extraction/required-fields.ts`   (pure validator)
 *   - `src/linkedin/extraction/status.ts`           (pure status calc)
 *   - `src/linkedin/extraction/detail-url.ts`        (pure URL builder)
 *   - `src/linkedin/extraction/log.ts`               (Logger TYPE-only)
 *   - `src/linkedin/extraction/panel-parser.ts`      (Playwright TYPES)
 *   - `src/linkedin/extraction/dedicated-parser.ts`  (Playwright TYPES)
 *   - `src/linkedin/extraction/service.ts`           (Playwright TYPES + Drizzle carve-out)
 *   - `src/linkedin/extraction/index.ts`             (Wave E barrel)
 */
const EXTRACTION_DIR = join(process.cwd(), 'src', 'linkedin', 'extraction');

const BANNED_IMPORTS = ['commander', '@inquirer/prompts', 'drizzle-orm', 'openai', 'pino'] as const;

/**
 * Wave D carve-out: `extraction/service.ts` is the ONLY file under
 * `src/linkedin/extraction/` that may import `drizzle-orm`. The
 * orchestrator wraps 3 per-job writes (extractionAttempts insert +
 * jobs update + discoveryEvents patch) in a single sync
 * `db.transaction(...)`; the raw Drizzle table references
 * (`jobs`, `discoveryEvents`, `extractionAttempts`) + the `eq`
 * helper come from this import. Pure helpers (`state.ts` /
 * `errors.ts` / `normalize.ts` / `required-fields.ts` / `status.ts`
 * / `detail-url.ts` / `log.ts` / `index.ts`) and the parsers
 * (`panel-parser.ts` / `dedicated-parser.ts`) MUST remain
 * Drizzle-free.
 */
const DRIZZLE_ORM_ALLOW_LIST: ReadonlySet<string> = new Set(['src/linkedin/extraction/service.ts']);

/**
 * Playwright allow-list: only the 3 extraction files that need
 * Playwright types may import from `playwright` — and only as
 * `import type`. Runtime Playwright values flow through
 * `src/linkedin/playwright-session.ts` (the sole runtime importer).
 */
const PLAYWRIGHT_ALLOW_LIST: ReadonlySet<string> = new Set([
  'src/linkedin/extraction/panel-parser.ts',
  'src/linkedin/extraction/dedicated-parser.ts',
  'src/linkedin/extraction/service.ts',
]);

/**
 * Distinguishes runtime `playwright` imports from type-only imports.
 */
const RUNTIME_PLAYWRIGHT_IMPORT_RE = /^\s*import\s+(?!type\s)[^;]*['"]playwright['"]/m;

/** Regex that matches `process.exit(` but NOT `process.exitCode`. */
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(/;

function listExtractionSourceFiles(dir: string): string[] {
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
      out.push(...listExtractionSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function importMatches(source: string, moduleName: string): boolean {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const specifier = `${escaped}(?:/[^']*)?`;
  const fromPattern = new RegExp(`from\\s+['"]${specifier}['"]`, 'g');
  const bareImportPattern = new RegExp(`import\\s+['"]${specifier}['"]`, 'g');
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

describe('src/linkedin/extraction domain-boundary guard (Wave E)', () => {
  it('exists as a directory with all 11 extraction files', () => {
    const files = listExtractionSourceFiles(EXTRACTION_DIR);
    // Wave A: state, errors, normalize, required-fields, status,
    // detail-url, log (7)
    // Wave C: panel-parser, dedicated-parser (2)
    // Wave D: service (1)
    // Wave E: index (1)
    // Total: 11
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  it('every .ts file avoids banned imports (drizzle-orm allow-list carve-out for service.ts)', () => {
    const files = listExtractionSourceFiles(EXTRACTION_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      for (const banned of BANNED_IMPORTS) {
        if (banned === 'drizzle-orm' && DRIZZLE_ORM_ALLOW_LIST.has(rel)) {
          continue;
        }
        expect(importMatches(source, banned), `${rel} must not import ${banned}`).toBe(false);
      }
    }
  });

  it('DRIZZLE_ORM_ALLOW_LIST has exactly one entry (service.ts)', () => {
    expect(DRIZZLE_ORM_ALLOW_LIST.size).toBe(1);
    expect(DRIZZLE_ORM_ALLOW_LIST.has('src/linkedin/extraction/service.ts')).toBe(true);
  });

  it('PLAYWRIGHT_ALLOW_LIST has exactly 3 entries (panel-parser, dedicated-parser, service)', () => {
    expect(PLAYWRIGHT_ALLOW_LIST.size).toBe(3);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/extraction/panel-parser.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/extraction/dedicated-parser.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/extraction/service.ts')).toBe(true);
  });

  it('files in the Playwright allow-list use TYPE-ONLY imports', () => {
    for (const rel of PLAYWRIGHT_ALLOW_LIST) {
      const absolute = join(EXTRACTION_DIR, rel.split('/').pop() ?? '');
      const source = readFileSync(absolute, 'utf8');
      expect(
        RUNTIME_PLAYWRIGHT_IMPORT_RE.test(source),
        `${rel} must not have a runtime playwright import (use \`import type\`)`,
      ).toBe(false);
    }
  });

  it('files outside the Playwright allow-list have no Playwright import at all', () => {
    const files = listExtractionSourceFiles(EXTRACTION_DIR);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      if (PLAYWRIGHT_ALLOW_LIST.has(rel)) continue;
      const source = readFileSync(absolute, 'utf8');
      expect(
        RUNTIME_PLAYWRIGHT_IMPORT_RE.test(source),
        `${rel} must not have a runtime playwright import`,
      ).toBe(false);
      // Also assert no type-only or runtime playwright reference at all.
      expect(importMatches(source, 'playwright'), `${rel} must not import playwright at all`).toBe(
        false,
      );
    }
  });

  it('RUNTIME_PLAYWRIGHT_IMPORT_RE accepts `import type` and rejects runtime playwright imports', () => {
    expect(RUNTIME_PLAYWRIGHT_IMPORT_RE.test("import type { Page } from 'playwright'")).toBe(false);
    expect(RUNTIME_PLAYWRIGHT_IMPORT_RE.test("import type { Locator } from 'playwright'")).toBe(
      false,
    );
    expect(RUNTIME_PLAYWRIGHT_IMPORT_RE.test("import { chromium } from 'playwright'")).toBe(true);
    expect(RUNTIME_PLAYWRIGHT_IMPORT_RE.test("import 'playwright'")).toBe(true);
  });

  it('no extraction file calls process.exit', () => {
    const files = listExtractionSourceFiles(EXTRACTION_DIR);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      expect(PROCESS_EXIT_RE.test(source), `${rel} must not call process.exit()`).toBe(false);
    }
  });
});
