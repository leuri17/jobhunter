import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Domain-boundary guard for `src/scoring/` (TASK-014, Wave E Task 13).
 *
 * Granular mirror of `tests/extraction/boundaries.test.ts`. AGENTS.md
 * §5 / §9: domain code must not depend on Commander, Inquirer,
 * Drizzle, OpenAI, or runtime Pino. The scoring layer additionally
 * MAY import from `src/profile/openai/` (the OpenAI client surface
 * — the cross-module dependency is the seam for the pure transport
 * + registry design from Task 0).
 *
 * Per AGENTS.md §5 + the TASK-014 plan rev1 §26:
 *   - The scoring service uses `this.repositories.transact(...)` —
 *     it goes through the repository facade and does NOT import
 *     `drizzle-orm` directly. NO `DRIZZLE_ORM_ALLOW_LIST` carve-out.
 *   - The `openai` runtime import stays in `src/profile/openai/client.ts`
 *     (TASK-008). `src/scoring/` MUST NOT import the `openai` package
 *     directly. Cross-module imports from `../profile/openai/` ARE
 *     allowed (the regex below correctly distinguishes `'openai'`
 *     from `'../profile/openai/client.js'`).
 *   - The scoring layer does not use Playwright at all, so no
 *     Playwright allow-list is needed. (Playwright is already in
 *     the codebase; this test does not assert anything about it.)
 *   - The scoring layer never calls `process.exit()`.
 *
 * File structure (end-state — 14 files):
 *   - `src/scoring/types.ts`               (pure type vocabulary)
 *   - `src/scoring/schema.ts`              (Zod source of truth + JSON Schema projection)
 *   - `src/scoring/state.ts`               (state vocabulary)
 *   - `src/scoring/errors.ts`              (typed errors)
 *   - `src/scoring/rubric.ts`              (frozen 7-category rubric)
 *   - `src/scoring/score-formula.ts`       (weighted sum + display formatter)
 *   - `src/scoring/rank.ts`                (deterministic ranking)
 *   - `src/scoring/fingerprint.ts`         (SHA-256 score fingerprint)
 *   - `src/scoring/plan.ts`                (ScoringPlan builder)
 *   - `src/scoring/log.ts`                 (Logger TYPE-only)
 *   - `src/scoring/index.ts`               (public barrel)
 *   - `src/scoring/prompt.ts`              (buildScoringPrompt, Wave D)
 *   - `src/scoring/eligibility.ts`         (isJobEligibleForScoring, Wave D)
 *   - `src/scoring/service.ts`             (ScoringService orchestrator, Wave D)
 */
const SCORING_DIR = join(process.cwd(), 'src', 'scoring');

const BANNED_IMPORTS = ['commander', '@inquirer/prompts', 'drizzle-orm', 'openai', 'pino'] as const;

/**
 * `service.ts` is the ONLY file under `src/scoring/` that may import
 * `drizzle-orm`. The orchestrator wraps the 3 per-job writes
 * (scoreResults UPDATE + INSERT + openaiRequestMetadata INSERT) in a
 * single sync `transact(...)` callback that calls `txRepos.db.update`,
 * `txRepos.db.insert` with `and()` + `eq()` helpers from drizzle-orm.
 * Pure helpers (`state.ts` / `errors.ts` / `rubric.ts` /
 * `score-formula.ts` / `rank.ts` / `fingerprint.ts` / `plan.ts` /
 * `log.ts` / `prompt.ts` / `eligibility.ts` / `index.ts` / `types.ts`
 * / `schema.ts`) MUST remain Drizzle-free.
 */
const DRIZZLE_ORM_ALLOW_LIST: ReadonlySet<string> = new Set(['src/scoring/service.ts']);

/** Regex that matches `process.exit(` but NOT `process.exitCode`. */
const PROCESS_EXIT_RE = /\bprocess\.exit\s*\(/;

function listScoringSourceFiles(dir: string): string[] {
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
      out.push(...listScoringSourceFiles(full));
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
  const specifier = `${escaped}(?:/[^'"]*)?`;
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

describe('src/scoring domain-boundary guard (Wave E Task 13)', () => {
  it('exists as a directory with the expected scoring files', () => {
    const files = listScoringSourceFiles(SCORING_DIR);
    // Task 0 (types + schema) + Wave A (8 files) + Wave E (index) + Wave D (3 files) = 14
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  it('every .ts file avoids banned imports (drizzle-orm allow-list carve-out for service.ts)', () => {
    const files = listScoringSourceFiles(SCORING_DIR);
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
    expect(DRIZZLE_ORM_ALLOW_LIST.has('src/scoring/service.ts')).toBe(true);
  });

  it('allows cross-module imports from src/profile/openai/ (the OpenAI client surface)', () => {
    // Sanity check: the importMatches regex must NOT match the relative
    // path '../profile/openai/client.js' when checking for the 'openai'
    // package. If this assertion fails, the boundaries test is broken.
    const example = "import { OpenAIClient } from '../profile/openai/client.js';";
    expect(importMatches(example, 'openai')).toBe(false);
    // And it MUST match the bare 'openai' package import.
    const example2 = "import OpenAI from 'openai';";
    expect(importMatches(example2, 'openai')).toBe(true);
  });

  it('the openai runtime import lives in src/profile/openai/client.ts (not in scoring)', () => {
    const clientPath = join(process.cwd(), 'src', 'profile', 'openai', 'client.ts');
    const source = readFileSync(clientPath, 'utf8');
    expect(importMatches(source, 'openai'), 'profile/openai/client.ts must import openai').toBe(
      true,
    );
  });

  it('no scoring file calls process.exit', () => {
    const files = listScoringSourceFiles(SCORING_DIR);
    for (const absolute of files) {
      const rel = relativeFromCwd(absolute);
      const source = readFileSync(absolute, 'utf8');
      expect(PROCESS_EXIT_RE.test(source), `${rel} must not call process.exit()`).toBe(false);
    }
  });
});
