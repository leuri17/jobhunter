import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Domain-boundary guard for `src/reevaluation/` (TASK-017 Wave A
 * Task 11, AGENTS.md §5 + §9).
 *
 * AGENTS.md §5: domain code must not depend on Commander, Inquirer,
 * Playwright, the `openai` SDK, or runtime `pino`. The reevaluation
 * layer is split into:
 *   - Pure layer: `src/reevaluation/{state,errors,plan,format,json-schemas,index}.ts`.
 *     No repository I/O, no service composition, no OpenAI calls.
 *     MAY import from `src/pipeline/format.js` ONLY inside
 *     `src/reevaluation/format.ts` (the documented seam for the
 *     `formatScoringPlanForReevaluation` re-export — Decision 14).
 *   - Service layer: `src/reevaluation/service.ts` (Wave C, NOT YET
 *     CREATED at this point in the plan).
 *
 * The pure layer MUST NOT import from `src/{filter,scoring,pipeline,persistence}`
 * (the documented carve-out is the single `src/pipeline/format.js`
 * import inside `src/reevaluation/format.ts`).
 *
 * This file mirrors `tests/inspection/boundaries.test.ts` — same
 * regex approach, same allow-list carving for one documented
 * cross-module re-export.
 *
 * Type-only `drizzle-orm` imports are allowed in the service layer
 * because TypeScript erases them at runtime. The regex below matches
 * both `import type ... from ...` and `import ... from ...`; the
 * service-layer carve-out is implemented via the explicit
 * `pipelineFormatAllowList`.
 */

const REEVALUATION_DIR = join(process.cwd(), 'src', 'reevaluation');

/** Regex that matches `process.exit(` but NOT `process.exitCode`. */
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(/;

/**
 * Regex that matches a RUNTIME import of a banned package. `import
 * type ... from ...` is intentionally NOT matched because TypeScript
 * erases the import. Mirrors the shape from
 * `tests/inspection/boundaries.test.ts:46-49`.
 */
const RUNTIME_IMPORT_RE = (moduleName: string): RegExp => {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^import\\s+(?!type\\s).*from\\s+['"]${escaped}(?:/[^'"]*)?['"]`, 'm');
};

interface BannedImport {
  readonly moduleName: string;
  readonly pattern: RegExp;
}

/** Banned packages for the WHOLE `src/reevaluation/` module (AGENTS.md §5 + §9). */
const BANNED: readonly BannedImport[] = [
  { moduleName: 'commander', pattern: RUNTIME_IMPORT_RE('commander') },
  { moduleName: '@inquirer/prompts', pattern: RUNTIME_IMPORT_RE('@inquirer/prompts') },
  { moduleName: 'playwright', pattern: RUNTIME_IMPORT_RE('playwright') },
  { moduleName: 'openai', pattern: RUNTIME_IMPORT_RE('openai') },
  { moduleName: 'pino', pattern: RUNTIME_IMPORT_RE('pino') },
];

/**
 * `src/pipeline/format.js` is the ONLY file under `src/pipeline/`
 * that the pure layer may import. The allow-list is keyed on the
 * importing source file (`src/reevaluation/format.ts`) — every other
 * file under `src/reevaluation/` MUST NOT import from any
 * `src/pipeline/` path.
 */
const PIPELINE_FORMAT_ALLOW_LIST: ReadonlySet<string> = new Set(['src/reevaluation/format.ts']);

/** Regex that matches a RUNTIME import from `src/pipeline/` paths. */
const PIPELINE_RUNTIME_IMPORT_RE = /^import\s+(?!type\s).*from\s+['"](?:\.\.\/)+pipeline\//m;

/**
 * Runtime-import guard for `src/{filter,scoring,persistence}/` paths.
 * These are the documented forbidden directories for the pure layer
 * (the `service.ts` Wave C file may import from them but does not
 * exist yet at this point in the plan).
 */
const PURE_FORBIDDEN_RUNTIME_IMPORT_RE = (subdir: string): RegExp => {
  return new RegExp(
    `^import\\s+(?!type\\s).*from\\s+['"](?:\\.\\.\\/)+${subdir}\\/(?:[^'"]*?)['"]`,
    'm',
  );
};

const FORBIDDEN_PURE_DIR_IMPORTS: readonly { readonly dir: string; readonly pattern: RegExp }[] = [
  { dir: 'filter', pattern: PURE_FORBIDDEN_RUNTIME_IMPORT_RE('filter') },
  { dir: 'scoring', pattern: PURE_FORBIDDEN_RUNTIME_IMPORT_RE('scoring') },
  { dir: 'persistence', pattern: PURE_FORBIDDEN_RUNTIME_IMPORT_RE('persistence') },
];

function listReevaluationFiles(dir: string): string[] {
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
      out.push(...listReevaluationFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
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

describe('src/reevaluation domain-boundary guard (TASK-017 Wave A Task 11)', () => {
  it('exists as a directory with pure-helper files', () => {
    const files = listReevaluationFiles(REEVALUATION_DIR);
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  describe('pure-helper files (state/errors/plan/format/json-schemas/index/log)', () => {
    // The plan groups `src/reevaluation/{service,fingerprint}.ts`
    // together (Task 7) as the only modules under `src/reevaluation/`
    // allowed to import from `src/{filter,scoring,pipeline,persistence}`.
    // Every other file in this directory MUST remain free of those
    // runtime imports — the test below enforces that. The service-layer
    // files are bounded only by the general banned-packages + process.exit
    // checks (run unconditionally on every `.ts` file in the directory).
    const pureFiles = listReevaluationFiles(REEVALUATION_DIR).filter(
      (f) => !f.endsWith('service.ts') && !f.endsWith('fingerprint.ts'),
    );

    for (const absolute of pureFiles) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');

      it(`${rel} does not runtime-import any banned package`, () => {
        for (const banned of BANNED) {
          expect(
            banned.pattern.test(source),
            `${rel} must not runtime-import ${banned.moduleName}`,
          ).toBe(false);
        }
      });

      it(`${rel} does not call process.exit()`, () => {
        expect(PROCESS_EXIT_RE.test(source), `${rel} must not call process.exit()`).toBe(false);
      });

      it(`${rel} does not runtime-import from src/pipeline/ (single allow-list carve-out for src/reevaluation/format.ts)`, () => {
        if (PIPELINE_FORMAT_ALLOW_LIST.has(rel)) {
          // `src/reevaluation/format.ts` is the documented exception
          // (Decision 14 — `formatScoringPlanForReevaluation`).
          return;
        }
        expect(
          PIPELINE_RUNTIME_IMPORT_RE.test(source),
          `${rel} must not runtime-import from src/pipeline/`,
        ).toBe(false);
      });

      for (const forbidden of FORBIDDEN_PURE_DIR_IMPORTS) {
        it(`${rel} does not runtime-import from src/${forbidden.dir}/`, () => {
          expect(
            forbidden.pattern.test(source),
            `${rel} must not runtime-import from src/${forbidden.dir}/`,
          ).toBe(false);
        });
      }
    }
  });

  it('PIPELINE_FORMAT_ALLOW_LIST has exactly one entry (format.ts)', () => {
    expect(PIPELINE_FORMAT_ALLOW_LIST.size).toBe(1);
    expect(PIPELINE_FORMAT_ALLOW_LIST.has('src/reevaluation/format.ts')).toBe(true);
  });
});
