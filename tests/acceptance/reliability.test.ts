// tests/acceptance/reliability.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ReliabilityItem {
  readonly id: string;
  readonly requirement: string;
  readonly evidencePaths: readonly string[];
  /**
   * Content checks that go beyond file existence. Each entry says: in the
   * file at `path` (resolved relative to the repo root), assert that
   * `pattern` matches somewhere in the file's text. Use this when the
   * presence of the file alone is too weak — e.g. bounded retries is only
   * really proven by the `maxAttempts` constant showing up in `retry.ts`.
   */
  readonly stronger?: readonly { readonly path: string; readonly pattern: RegExp }[];
}

// `repoRoot` stays a file URL so `new URL(p, repoRoot)` works (the URL
// constructor requires a URL base, not a bare pathname). `existsSync` and
// `readFileSync` both accept file URLs directly, so no conversion is
// needed for the fs calls below.
const repoRoot = new URL('../..', import.meta.url);

const ITEMS: readonly ReliabilityItem[] = [
  {
    id: 'R-01',
    requirement:
      'Bounded retries — evidence: tests/linkedin/navigation.test.ts (timeout guard) + src/profile/openai/retry.ts (maxAttempts constant)',
    evidencePaths: ['tests/linkedin/navigation.test.ts', 'src/profile/openai/retry.ts'],
    stronger: [{ path: 'src/profile/openai/retry.ts', pattern: /maxAttempts/ }],
  },
  {
    id: 'R-02',
    requirement:
      'Bounded waits — evidence: src/scoring/service.ts (concurrency limit) + src/linkedin/discovery-service.ts (maxIterations) + src/config/schema.ts (timeouts keys)',
    evidencePaths: [
      'src/scoring/service.ts',
      'src/linkedin/discovery-service.ts',
      'src/config/schema.ts',
    ],
    stronger: [{ path: 'src/config/schema.ts', pattern: /timeouts/ }],
  },
  {
    id: 'R-03',
    requirement:
      'Avoid infinite scrolling — evidence: src/linkedin/load-more.ts (maxIterations guard) + src/linkedin/discovery-service.ts',
    evidencePaths: ['src/linkedin/load-more.ts', 'src/linkedin/discovery-service.ts'],
  },
  {
    id: 'R-04',
    requirement:
      'Deduplicate by LinkedIn job ID — evidence: tests/persistence/repositories/jobs.test.ts (findBySourceJobId / recordNewJob dedup)',
    evidencePaths: ['tests/persistence/repositories/jobs.test.ts'],
  },
  {
    id: 'R-05',
    requirement:
      'Isolate per-job failures — evidence: tests/pipeline/orchestrator.test.ts (per-job try/catch) + tests/reevaluation/service.test.ts (runOneScore isolation)',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts', 'tests/reevaluation/service.test.ts'],
  },
  {
    id: 'R-06',
    requirement:
      'Preserve successful writes after later failures — evidence: tests/persistence/connection.test.ts (transaction rollback tests) + tests/pipeline/orchestrator.test.ts (cancellation preserves state)',
    evidencePaths: ['tests/persistence/connection.test.ts', 'tests/pipeline/orchestrator.test.ts'],
  },
  {
    id: 'R-07',
    requirement:
      'Validate structured OpenAI output — evidence: tests/profile/openai/response-schemas.test.ts (Zod registry) + tests/profile/openai/structured-output.test.ts (Zod validation)',
    evidencePaths: [
      'tests/profile/openai/response-schemas.test.ts',
      'tests/profile/openai/structured-output.test.ts',
    ],
  },
  {
    id: 'R-08',
    requirement:
      'Close browser resources on success + failure — evidence: tests/linkedin/browser-session.test.ts (fake-session close lifecycle) + src/cli.ts (try/finally handle.close())',
    evidencePaths: ['tests/linkedin/browser-session.test.ts', 'src/cli.ts'],
    stronger: [{ path: 'src/cli.ts', pattern: /finally\s*\{[\s\S]*?handle\.close\(\)/ }],
  },
  {
    id: 'R-09',
    requirement:
      'Keep partial jobs out of filtering + scoring — evidence: tests/filter/service.test.ts (partial skip) + tests/scoring/service.test.ts (eligibility)',
    evidencePaths: ['tests/filter/service.test.ts', 'tests/scoring/service.test.ts'],
  },
  {
    id: 'R-10',
    requirement:
      'Skip extraction for complete jobs — evidence: tests/pipeline/orchestrator.test.ts (complete-skip path)',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts'],
  },
  {
    id: 'R-11',
    requirement:
      'Skip automatic retries for partial jobs — evidence: tests/pipeline/orchestrator.test.ts (partial-skip path)',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts'],
  },
  {
    id: 'R-12',
    requirement:
      'Reuse valid filter + score results — evidence: tests/filter/service.test.ts (reused branch) + tests/scoring/service.test.ts (reused branch)',
    evidencePaths: ['tests/filter/service.test.ts', 'tests/scoring/service.test.ts'],
  },
  {
    id: 'R-13',
    requirement:
      'Invalidate stale results — evidence: tests/filter/service.test.ts (fingerprint-mismatch) + tests/scoring/service.test.ts + tests/reevaluation/service.test.ts',
    evidencePaths: [
      'tests/filter/service.test.ts',
      'tests/scoring/service.test.ts',
      'tests/reevaluation/service.test.ts',
    ],
  },
  {
    id: 'R-14',
    requirement:
      'Preserve history — evidence: tests/persistence/repositories/filter-results.test.ts (active flag flip) + tests/persistence/repositories/score-results.test.ts',
    evidencePaths: [
      'tests/persistence/repositories/filter-results.test.ts',
      'tests/persistence/repositories/score-results.test.ts',
    ],
  },
  {
    id: 'R-15',
    requirement:
      'Write configuration atomically — evidence: tests/config/updater.test.ts (rename-based atomic write) + src/config/updater.ts (rename call)',
    evidencePaths: ['tests/config/updater.test.ts', 'src/config/updater.ts'],
    stronger: [{ path: 'src/config/updater.ts', pattern: /rename/ }],
  },
  {
    id: 'R-16',
    requirement:
      'Avoid logging secrets — evidence: tests/logging/logger.test.ts (redaction cases) + src/logging/logger.ts (redact paths)',
    evidencePaths: ['tests/logging/logger.test.ts', 'src/logging/logger.ts'],
    stronger: [{ path: 'src/logging/logger.ts', pattern: /redact/ }],
  },
  {
    id: 'R-17',
    requirement: 'Keep JSON stdout valid and isolated from logs',
    evidencePaths: [
      'tests/cli/paths-json.test.ts',
      'tests/cli/jobs-list.test.ts',
      'tests/acceptance/cli-adapters.test.ts',
    ],
    stronger: [
      {
        path: 'src/cli.ts',
        pattern: /stdout:\s*process\.stderr/,
      },
    ],
  },
];

describe('SPEC.md §40 — Reliability requirements matrix', () => {
  for (const item of ITEMS) {
    it(`${item.id}: ${item.requirement}`, () => {
      for (const p of item.evidencePaths) {
        expect(existsSync(new URL(p, repoRoot))).toBe(true);
      }
      for (const s of item.stronger ?? []) {
        const src = readFileSync(new URL(s.path, repoRoot), 'utf8');
        expect(src, `${item.id}: stronger pattern on ${s.path}`).toMatch(s.pattern);
      }
    });
  }
});
