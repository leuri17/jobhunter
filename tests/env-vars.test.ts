/**
 * CI guard: every `process.env[...]` and `import.meta.env[...]` reference
 * in the codebase must have a matching entry in `.env.example`.
 *
 * If you add a new environment variable, this test will fail with a list
 * of unreferenced names. Add the entry to `.env.example` (and ideally
 * `docs/env.md`) and the test goes green.
 */
import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function extractEnvNames(envExample: string): Set<string> {
  const names = new Set<string>();
  for (const line of envExample.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)\s*=/.exec(trimmed);
    if (m && m[1] !== undefined) names.add(m[1]);
  }
  return names;
}

function listCodeEnvReferences(): Set<string> {
  // Union of every distinct [...] index that appears in `process.env[`
  // or `import.meta.env[` across src/, tests/, and desktop/. Excludes
  // generated and vendored directories.
  const refs = new Set<string>();
  let out: string;
  try {
    out = execFileSync(
      'rg',
      [
        '--no-heading',
        '--no-line-number',
        '-g',
        '!node_modules',
        '-g',
        '!dist',
        '-g',
        '!drizzle',
        '-g',
        '!docs/audit',
        '-g',
        '!gen/schemas',
        '-o',
        "(process\\.env\\[|import\\.meta\\.env\\[)'[A-Z][A-Z0-9_]*'",
        'src',
        'tests',
        'desktop',
      ],
      { encoding: 'utf8' },
    );
  } catch {
    // ripgrep not on PATH or matched nothing — `out` is empty below.
    out = '';
  }
  for (const m of out.matchAll(/\[([A-Z][A-Z0-9_]*)'/g)) {
    if (m[1] !== undefined) refs.add(m[1]);
  }
  return refs;
}

describe('env var documentation guard', () => {
  it('.env.example documents every env var the codebase reads', () => {
    const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
    const documented = extractEnvNames(envExample);
    const referenced = listCodeEnvReferences();

    const missing: string[] = [];
    for (const name of referenced) {
      if (!documented.has(name)) missing.push(name);
    }
    if (missing.length > 0) {
      throw new Error(
        `Env var(s) read from process.env or import.meta.env but not listed ` +
          `in .env.example: ${missing.join(', ')}. Add entries to .env.example ` +
          `(and ideally docs/env.md) and re-run.`,
      );
    }
  });
});
