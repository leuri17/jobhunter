/**
 * CI guard: every pnpm version string in the docs (README, CONTRIBUTING)
 * must match the canonical version pinned in `package.json#packageManager`.
 * Catches drift where one doc says 11.18.0 and another says 11.25.0.
 */
import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('pnpm version documentation guard', () => {
  it('every pnpm version string in docs matches package.json#packageManager', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      packageManager?: string;
    };
    const pinned = pkg.packageManager ?? '';
    const m = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pinned);
    if (m === null || m[1] === undefined) {
      throw new Error(
        `package.json#packageManager is "${pinned}"; expected "pnpm@<X>.<Y>.<Z>". ` +
          `The CI guard cannot derive a version to compare against.`,
      );
    }
    const canonical = m[1];

    const out = execFileSync(
      'rg',
      [
        '--no-heading',
        '--no-line-number',
        '-g',
        '!node_modules',
        '-g',
        '!drizzle',
        '-g',
        '!docs/audit',
        '-o',
        'pnpm\\s+\\d+\\.\\d+\\.\\d+',
        'README.md',
        'CONTRIBUTING.md',
        'docs',
      ],
      { encoding: 'utf8' },
    ).trim();

    if (out === '') return;
    const mismatches: string[] = [];
    for (const line of out.split('\n')) {
      const version = /pnpm\s+(\d+\.\d+\.\d+)/.exec(line);
      if (version === null || version[1] === undefined) continue;
      if (version[1] !== canonical) {
        mismatches.push(`  ${line} (expected ${canonical})`);
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `pnpm version drift in docs (canonical: ${canonical}):\n${mismatches.join('\n')}\n` +
          `Update the docs to match package.json#packageManager, or run ` +
          `\`corepack use pnpm@${canonical}\` if the doc was right.`,
      );
    }
  });
});
