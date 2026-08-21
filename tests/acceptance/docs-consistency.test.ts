// tests/acceptance/docs-consistency.test.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';

/**
 * TASK-018 T4 — Documentation consistency guard.
 *
 * Cross-checks the four project docs (SPEC.md, AGENTS.md, GIT.md,
 * README.md) + the task ledger (docs/tasks/INDEX.md) for drift. The
 * 7 assertions below are the contract this file enforces. If any
 * assertion fails because a doc fell behind, fix the doc (per
 * TASK-018's minimal-update policy: add the missing name/reference
 * in place; do NOT rewrite surrounding content).
 *
 * The TASK-018 ✅-Implemented marker check (assertion 6, part 2) is
 * deferred to Task 6 via `it.skip(...)` — the INDEX.md row is
 * intentionally left as "Planned" until the implementation-results
 * commit flips it.
 */

const repoRoot = new URL('../..', import.meta.url);

function readProjectFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('Documentation consistency (SPEC / AGENTS / GIT / README / tasks INDEX)', () => {
  it('all 4 project docs exist', () => {
    for (const path of ['SPEC.md', 'AGENTS.md', 'GIT.md', 'README.md']) {
      expect(existsSync(new URL(path, repoRoot)), `${path} missing`).toBe(true);
    }
  });

  it('AGENTS.md references SPEC.md as source of truth', () => {
    const src = readProjectFile('AGENTS.md');
    expect(src).toMatch(/SPEC\.md/);
    expect(src).toMatch(/source of truth/i);
  });

  it('GIT.md documents branches, worktrees, commits, and merges', () => {
    const src = readProjectFile('GIT.md');
    expect(src).toMatch(/## 1\.\s*Branches/);
    expect(src).toMatch(/## 2\.\s*Worktrees/);
    expect(src).toMatch(/## 3\.\s*Commits/);
    expect(src).toMatch(/## 6\.\s*Merge strategy/);
    expect(src).toMatch(/squash/i);
  });

  it('README.md Quick start lists every registered Commander command', () => {
    const program = createProgram();
    const registered = new Set(
      program.commands.flatMap((c) => [c.name(), ...c.commands.map((s) => s.name())]),
    );
    const readme = readProjectFile('README.md');
    for (const name of registered) {
      expect(readme, `README.md does not mention command "${name}"`).toMatch(
        new RegExp(`\\b${name}\\b`),
      );
    }
  });

  it('README.md references the documented package scripts', () => {
    const readme = readProjectFile('README.md');
    const pkg = JSON.parse(readProjectFile('package.json')) as {
      scripts: Record<string, string>;
    };
    for (const script of ['dev', 'build', 'test', 'typecheck', 'lint']) {
      if (script in pkg.scripts) {
        expect(readme, `README.md does not mention "pnpm ${script}"`).toMatch(
          new RegExp(`pnpm\\s+${script}`),
        );
      }
    }
  });

  it('docs/tasks/INDEX.md lists every implemented task as a TASK-NNN row', () => {
    const indexSrc = readProjectFile('docs/tasks/INDEX.md');
    const implemented = readdirSync(new URL('docs/tasks', repoRoot))
      .filter((f) => /^TASK-\d{3}-.+\.md$/.test(f))
      .map((f) => f.match(/^TASK-(\d{3})/)![1]!);
    for (const id of implemented) {
      // Each row in the table starts with the task link. The
      // "Depends on" column shows the dependencies, not the task
      // ID itself — so we match the link anchor + the file
      // reference, both of which carry the task number.
      const rowPattern = new RegExp(
        `\\|\\s*\\[TASK-${id}\\]\\(\\./TASK-${id}-[^)]+\\.(md|markdown)\\)\\s*\\|`,
      );
      expect(indexSrc, `TASK-${id} not found in INDEX.md`).toMatch(rowPattern);
    }
  });

  // Guards the TASK-018 close: the row in `docs/tasks/INDEX.md` must
  // carry the `✅ Implemented` marker. This is the only file in the
  // acceptance suite that asserts closure state, not just structure.
  it('TASK-018 row carries the ✅ Implemented marker', () => {
    const indexSrc = readProjectFile('docs/tasks/INDEX.md');
    expect(indexSrc, 'TASK-018 row should be ✅ Implemented after close').toMatch(
      /TASK-018.*✅\s*Implemented/,
    );
  });

  it('SPEC.md §42 acceptance list has 43 numbered items', () => {
    const spec = readProjectFile('SPEC.md');
    const section42Start = spec.indexOf('## 42. MVP acceptance criteria');
    const section43Start = spec.indexOf('## 43.', section42Start);
    expect(section42Start, '§42 section not found').toBeGreaterThan(-1);
    expect(section43Start, '§43 section not found').toBeGreaterThan(-1);
    const section42 = spec.slice(section42Start, section43Start);
    const numbered = (section42.match(/^\s*(\d+)\.\s/gm) ?? []).map((s) =>
      Number(s.match(/^\s*(\d+)/)![1]),
    );
    expect(numbered.length).toBeGreaterThanOrEqual(43);
    expect(Math.max(...numbered)).toBeGreaterThanOrEqual(43);
  });
});
