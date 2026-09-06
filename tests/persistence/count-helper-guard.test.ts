/**
 * CI guard: the count helpers in `src/persistence/repositories/`
 * must use Drizzle's `count()` aggregation, not the `.all().length`
 * row-materialisation pattern. The pattern was the subject of
 * issue #64 (B3-C.4.7) and was a measurable perf cost on the
 * runs-show page when `discovery_errors` accumulated.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('persistence count helper guard', () => {
  it('no `.all().length` row-materialisation in repositories', () => {
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
          '\.all\(\)\.length',
          'src/persistence/repositories',
        ],
        { encoding: 'utf8' },
      );
    } catch {
      // rg exits 1 when no matches; that's the success case here.
      return;
    }
    throw new Error(
      'Repositories still use the `.all().length` pattern:\n' +
        out +
        '\nReplace with `select({ n: count() }).from(...).get()` (Drizzle\'s ' +
        '`count()` aggregation). See issue #64.',
    );
  });
});
