import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Domain-boundary guard for `src/linkedin/`.
 *
 * AGENTS.md §5 / §9: domain code must not depend on Drizzle, OpenAI, or
 * runtime Pino. The Playwright allow-list covers
 * every file that imports Playwright (type-only OR runtime). The
 * `fake-session.ts` + `fake-page.ts` modules are exempt because they
 * have ZERO Playwright references — they only need to be reachable
 * from `fake-session.ts`'s allow-list entry (their relative path
 * puts them under `src/linkedin/` but the boundaries test verifies
 * they import no Playwright anywhere).
 *
 * File structure after :
 *   - `src/linkedin/state.ts`              (pure types)
 *   - `src/linkedin/errors.ts`             (typed error family)
 *   - `src/linkedin/selectors.ts`          (selector constants)
 *   - `src/linkedin/card-id.ts`            (pure parser, linkedom-typed)
 *   - `src/linkedin/overlay.ts`            (Playwright TYPES only — )
 *   - `src/linkedin/load-more.ts`          (Playwright TYPES only — )
 *   - `src/linkedin/log.ts`                (Logger TYPE-only — no runtime Pino)
 *   - `src/linkedin/browser-session.ts`    (Playwright TYPES only — )
 *   - `src/linkedin/playwright-session.ts` (Playwright RUNTIME — sole importer)
 *   - `src/linkedin/fake-session.ts`       (no Playwright import — test helper)
 *   - `src/linkedin/fake-page.ts`          (no Playwright import — test helper)
 *
 *  will add `discovery-service.ts`;  finalises the allow-list.
 */

const LINKEDIN_DIR = join(process.cwd(), 'src', 'linkedin');

const BANNED_IMPORTS = [
  'drizzle-orm',
  'openai',
  'pino',
  // 'playwright' is ALLOWED only for files in PLAYWRIGHT_ALLOW_LIST (: 4 entries).
] as const;

/**
 *  carve-out: `extraction/service.ts` is the ONLY file under
 * `src/linkedin/extraction/` that may import `drizzle-orm`. The
 * orchestrator wraps 3 per-job writes (extractionAttempts insert +
 * jobs update + discoveryEvents patch) in a single sync
 * `db.transaction(...)`; the raw Drizzle table references
 * (`jobs`, `discoveryEvents`, `extractionAttempts`) + the `eq`
 * helper come from this import. Pure helpers
 * (`state.ts` / `errors.ts` / `normalize.ts` / `required-fields.ts`
 * / `status.ts` / `detail-url.ts` / `log.ts`) and the parsers
 * (`panel-parser.ts` / `dedicated-parser.ts`) MUST remain
 * Drizzle-free. 's `tests/extraction/boundaries.test.ts` is
 * the granular mirror of this carve-out.
 */
const DRIZZLE_ORM_ALLOW_LIST: ReadonlySet<string> = new Set(['src/linkedin/extraction/service.ts']);

/**
 *  allow-list. The boundary test asserts this set contains
 * EXACTLY these entries, locking the file structure against accidental
 * additions without a corresponding test update.
 *
 * The two type-only files (`overlay.ts`, `load-more.ts`, `browser-session.ts`)
 * are checked by `RUNTIME_PLAYWRIGHT_IMPORT_RE` to ensure they use
 * `import type { ... } from 'playwright'` only. The runtime importer
 * (`playwright-session.ts`) is the ONLY file allowed to do
 * `import { chromium } from 'playwright'`.
 *
 * `fake-session.ts` + `fake-page.ts` are NOT in the allow-list — they
 * must not import Playwright at all. The "files outside the allow-list"
 * test below enforces this.
 */
const PLAYWRIGHT_ALLOW_LIST: ReadonlySet<string> = new Set([
  'src/linkedin/overlay.ts', // Playwright TYPES only
  'src/linkedin/load-more.ts', // Playwright TYPES only
  'src/linkedin/browser-session.ts', // Playwright TYPES only
  'src/linkedin/navigation.ts', // Playwright TYPES only
  'src/linkedin/discovery-service.ts', // Playwright TYPES only
  'src/linkedin/playwright-session.ts', // Playwright RUNTIME (sole importer)
]);

/**
 * Distinguishes runtime `playwright` imports from type-only imports
 * (the negative lookahead `(?!type\s)` rejects `import type { Page }
 * from 'playwright'` while matching `import { foo } from 'playwright'`).
 */
const RUNTIME_PLAYWRIGHT_IMPORT_RE = /^\s*import\s+(?!type\s)[^;]*['"]playwright['"]/m;

/** Regex that matches `process.exit(` but NOT `process.exitCode`. */
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(/;

function listLinkedinSourceFiles(dir: string): string[] {
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
      out.push(...listLinkedinSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function _fakePageAllowed(rel: string): boolean {
  // `fake-page.ts` lives next to `fake-session.ts` and is reachable
  // from it. It also has ZERO Playwright references (it's a pure
  // stub). The file path is `src/linkedin/fake-page.ts` — the
  // boundaries test only flags Playwright imports, so this allow-
  // list entry is informational, not enforced (the runtime
  // Playwright import test below would not flag the file anyway).
  void rel;
  return true;
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

describe('src/linkedin domain-boundary guard', () => {
  it('exists as a directory with at least the 26 modules after ', () => {
    const files = listLinkedinSourceFiles(LINKEDIN_DIR);
    // Final  state: 15  files (state, errors, selectors,
    // card-id, overlay, load-more, log, browser-session,
    // playwright-session, fake-session, fake-page, navigation,
    // truncate-metadata, discovery-service, index) + 11
    // extraction files (state, errors, normalize, required-fields,
    // status, detail-url, log, panel-parser, dedicated-parser,
    // service, index) = 26 files.
    expect(files.length).toBeGreaterThanOrEqual(26);
  });

  it('every .ts file under src/linkedin/ avoids the banned imports (with carve-out)', () => {
    const files = listLinkedinSourceFiles(LINKEDIN_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      for (const banned of BANNED_IMPORTS) {
        //  carve-out: `drizzle-orm` is allowed inside
        // `src/linkedin/extraction/service.ts` (per Task 13 sketch
        // — the orchestrator wraps 3 per-job writes in a single
        // sync `db.transaction` and the schema-table references
        // require the import). 's
        // `tests/extraction/boundaries.test.ts` is the granular
        // mirror of this carve-out.
        if (banned === 'drizzle-orm' && DRIZZLE_ORM_ALLOW_LIST.has(rel)) {
          continue;
        }
        expect(importMatches(source, banned), `${rel} must not import ${banned}`).toBe(false);
      }
    }
  });

  it('encodes the  Playwright allow-list (6 entries)', () => {
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/overlay.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/load-more.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/browser-session.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/navigation.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/discovery-service.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.has('src/linkedin/playwright-session.ts')).toBe(true);
    expect(PLAYWRIGHT_ALLOW_LIST.size).toBe(6);
  });

  it('runtime Playwright importer is exactly playwright-session.ts (sole runtime importer)', () => {
    const files = listLinkedinSourceFiles(LINKEDIN_DIR);
    const runtimeImporters: string[] = [];
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      if (RUNTIME_PLAYWRIGHT_IMPORT_RE.test(source)) {
        runtimeImporters.push(rel);
      }
    }
    expect(runtimeImporters).toEqual(['src/linkedin/playwright-session.ts']);
  });

  it('files in the Playwright allow-list that are NOT the runtime importer use TYPE-ONLY imports', () => {
    for (const rel of PLAYWRIGHT_ALLOW_LIST) {
      if (rel === 'src/linkedin/playwright-session.ts') continue;
      const absolute = join(LINKEDIN_DIR, rel.split('/').pop() ?? '');
      const source = readFileSync(absolute, 'utf8');
      expect(
        RUNTIME_PLAYWRIGHT_IMPORT_RE.test(source),
        `${rel} must not have a runtime playwright import (use \`import type\`)`,
      ).toBe(false);
    }
  });

  it('files outside the Playwright allow-list do not have a RUNTIME playwright import', () => {
    // `fake-session.ts` + `fake-page.ts` are allowed to use `import type`
    // from 'playwright' (they cast to `Page` / `Route` so the interface
    // is satisfied) but they must NOT have a runtime import. The other
    // files outside the allow-list (state, errors, selectors, card-id,
    // log) must not reference Playwright at all.
    const files = listLinkedinSourceFiles(LINKEDIN_DIR);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      if (PLAYWRIGHT_ALLOW_LIST.has(rel)) continue;
      const source = readFileSync(absolute, 'utf8');
      expect(
        RUNTIME_PLAYWRIGHT_IMPORT_RE.test(source),
        `${rel} must not have a runtime playwright import (it is not in the  allow-list)`,
      ).toBe(false);
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

  it('no src/linkedin/ file calls process.exit', () => {
    const files = listLinkedinSourceFiles(LINKEDIN_DIR);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      expect(PROCESS_EXIT_RE.test(source), `${rel} must not call process.exit()`).toBe(false);
    }
  });
});
