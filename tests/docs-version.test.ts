/**
 * CI guard: every pnpm version string in the live user-facing docs
 * (README.md, CONTRIBUTING.md) must match the canonical version pinned
 * in `package.json#packageManager`. Catches drift where one doc says
 * 11.18.0 and another says 11.25.0.
 *
 * Scope is intentionally narrow: only the two files that carry pnpm
 * install instructions. Historical plan files under docs/superpowers/
 * are archive snapshots from prior work and are not expected to track
 * the current version.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';

const PNPM_VERSION_RE = /pnpm\s+(\d+\.\d+\.\d+)/g;
const SCOPED_DOCS = ['README.md', 'CONTRIBUTING.md'] as const;

describe('pnpm version documentation guard', () => {
  it('every pnpm version string in README and CONTRIBUTING matches package.json#packageManager', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string };
    const m = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? '');
    if (m === null || m[1] === undefined) {
      throw new Error(
        `package.json#packageManager is "${pkg.packageManager}"; expected "pnpm@<X>.<Y>.<Z>".`,
      );
    }
    const canonical = m[1];

    const mismatches: string[] = [];
    for (const path of SCOPED_DOCS) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(PNPM_VERSION_RE)) {
        if (match[1] !== canonical) {
          mismatches.push(`${path}: pnpm ${match[1]}`);
        }
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `pnpm version drift in docs (canonical: ${canonical}):\n` +
          mismatches.map((m) => `  ${m}`).join('\n') +
          `\nUpdate to match package.json#packageManager, or run \`corepack use pnpm@${canonical}\` if the doc was right.`,
      );
    }
  });
});
