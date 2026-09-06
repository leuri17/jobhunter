/**
 * CI guard: production code must read the `errorCode` of a caught
 * error via `instanceof ApplicationError`, not the duck-typed
 * `'code' in error` check. The duck-typed check would let any plain
 * object or third-party library error (e.g. raw OpenAI SDK errors)
 * flow through as an application-defined error code and pollute
 * history reports and UI status badges. See issue #38.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('errorCode instanceof guard', () => {
  it('no `code` in error` duck-typed error-code reads in production', () => {
    // Allow the dev-only test fixtures that explicitly exercise the
    // duck-typed path or stub their own error shape. The guard fails
    // for any production source under `src/`.
    let out: string;
    try {
      out = execFileSync(
        'rg',
        [
          '-n',
          '--no-heading',
          '-g',
          '!node_modules',
          '-g',
          '!dist',
          '-g',
          '!drizzle',
          '-g',
          '!tests',
          // Match the duck-typed `error as { code: string }` casts
          // that the issue called out. We intentionally include the
          // surrounding test (any `error as { code` shape) so a
          // future copy-paste of the old pattern into a production
          // file is caught.
          'as\\s*\\{[^}]*code:\\s*string',
          'src',
        ],
        { encoding: 'utf8' },
      );
    } catch {
      // rg exits 1 when no matches; that's the success case.
      return;
    }
    if (out.trim() === '') return;
    expect.fail(
      'Production code casts caught errors via `as { code: string }`:\n' +
        out +
        '\nReplace with `instanceof ApplicationError` and read `.code` from the typed class.',
    );
  });
});
