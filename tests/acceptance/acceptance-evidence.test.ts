// tests/acceptance/acceptance-evidence.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * TASK-018 — §42 MVP acceptance evidence matrix.
 *
 * For each acceptance item this test asserts the cited evidence
 * path exists. The matrix is the test list — it is durable,
 * runnable, and self-checking. If any cited test file is deleted
 * without an approved task update, this test fails.
 *
 * Evidence convention:
 *   - `tests/<area>/...` — unit/integration test that exercises the behavior.
 *   - `src/<module>` — production module that implements the behavior (presence).
 *   - `*.fixture.json` / `*.html` — saved LinkedIn fixture (presence).
 *
 * The matrix below MUST be kept in sync with SPEC.md §42. Any new
 * acceptance item requires both an entry in SPEC.md and an entry
 * here.
 */

interface AcceptanceItem {
  readonly id: string;
  readonly title: string;
  readonly evidencePaths: readonly string[];
  /** When set, also assert that the file at evidencePaths[strongerFileIndex] contains the given regex. */
  readonly stronger?: {
    readonly fileIndex: number;
    readonly pattern: RegExp;
    readonly description: string;
  };
}

// `repoRoot` stays a file URL so `new URL(p, repoRoot)` works (the URL
// constructor needs a URL base, not a bare pathname). `existsSync` and
// `readFileSync` both accept a file URL directly, so we never need to convert
// back to a pathname for fs calls.
const repoRoot = new URL('../..', import.meta.url);

const ITEMS: readonly AcceptanceItem[] = [
  {
    id: 'AC-01',
    title: 'Install with pinned runtime — evidence: package.json (engines.node, packageManager)',
    evidencePaths: ['package.json'],
    stronger: {
      fileIndex: 0,
      pattern: /"engines"\s*:\s*{[^}]*"node"\s*:\s*"[^"]*"|"packageManager"\s*:\s*"pnpm@/,
      description: 'package.json pins engines.node and packageManager',
    },
  },
  {
    id: 'AC-02',
    title: 'Run `jobhunter init` — evidence: tests/cli/init.test.ts',
    evidencePaths: ['tests/cli/init.test.ts'],
  },
  {
    id: 'AC-03',
    title: 'Resume interrupted init — evidence: tests/init/init-service.test.ts (resume cases)',
    evidencePaths: ['tests/init/init-service.test.ts'],
  },
  {
    id: 'AC-04',
    title:
      'Configure multiple search queries interactively — evidence: tests/search/matrix.test.ts + tests/cli/configure-filters.test.ts',
    evidencePaths: ['tests/search/matrix.test.ts', 'tests/cli/configure-filters.test.ts'],
    stronger: {
      fileIndex: 0,
      pattern: /geoId/,
      description: 'matrix.test.ts references geoId (multi-query geometry)',
    },
  },
  {
    id: 'AC-05',
    title:
      'Paste LinkedIn URLs, extract geoId — evidence: tests/search/url-parser.test.ts + tests/search/locations.test.ts',
    evidencePaths: ['tests/search/url-parser.test.ts', 'tests/search/locations.test.ts'],
  },
  {
    id: 'AC-06',
    title:
      'Human-readable prompts (date-posted, workplace-type) — evidence: tests/search/prompts.test.ts',
    evidencePaths: ['tests/search/prompts.test.ts'],
  },
  {
    id: 'AC-07',
    title: 'Persist valid config.json — evidence: tests/config/updater.test.ts (atomic write)',
    evidencePaths: ['tests/config/updater.test.ts'],
  },
  {
    id: 'AC-08',
    title: 'Import one or two CV files — evidence: tests/cli/profile-import.test.ts',
    evidencePaths: ['tests/cli/profile-import.test.ts'],
  },
  {
    id: 'AC-09',
    title:
      'Local text + OpenAI extraction in `profile import` — evidence: tests/profile/importer.test.ts + tests/profile/extraction-service.test.ts',
    evidencePaths: ['tests/profile/importer.test.ts', 'tests/profile/extraction-service.test.ts'],
  },
  {
    id: 'AC-10',
    title: 'Preserve immutable source copies — evidence: tests/profile/file-copy.test.ts',
    evidencePaths: ['tests/profile/file-copy.test.ts'],
  },
  {
    id: 'AC-11',
    title:
      'Reject image-only PDFs (`ocr_required`) — evidence: tests/profile/extractors/pdf.test.ts',
    evidencePaths: ['tests/profile/extractors/pdf.test.ts'],
  },
  {
    id: 'AC-12',
    title: 'Extract a structured profile — evidence: tests/profile/extraction-service.test.ts',
    evidencePaths: ['tests/profile/extraction-service.test.ts'],
  },
  {
    id: 'AC-13',
    title: 'Merge complementary sources — evidence: tests/profile/post-process.test.ts',
    evidencePaths: ['tests/profile/post-process.test.ts'],
  },
  {
    id: 'AC-14',
    title: 'Surface source conflicts — evidence: tests/profile/conflicts.test.ts',
    evidencePaths: ['tests/profile/conflicts.test.ts'],
  },
  {
    id: 'AC-15',
    title: 'Edit profile interactively — evidence: tests/profile/editing/state-machine.test.ts',
    evidencePaths: ['tests/profile/editing/state-machine.test.ts'],
  },
  {
    id: 'AC-16',
    title: 'Override derived values — evidence: tests/profile/review/override-application.test.ts',
    evidencePaths: ['tests/profile/review/override-application.test.ts'],
  },
  {
    id: 'AC-17',
    title: 'Explicitly approve profile — evidence: tests/profile/approval-service.test.ts',
    evidencePaths: ['tests/profile/approval-service.test.ts'],
  },
  {
    id: 'AC-18',
    title: 'Configure one global filter set — evidence: tests/cli/configure-filters.test.ts',
    evidencePaths: ['tests/cli/configure-filters.test.ts'],
  },
  {
    id: 'AC-19',
    title:
      'Initialize accepted languages from approved profile — evidence: tests/filter/configure-service.test.ts (askAcceptedLanguages seeded from profile)',
    evidencePaths: ['tests/filter/configure-service.test.ts'],
  },
  {
    id: 'AC-20',
    title: 'Run `jobhunter run` — evidence: tests/pipeline/orchestrator.test.ts',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts'],
  },
  {
    id: 'AC-21',
    title: 'Generate every query/location combo — evidence: tests/search/matrix.test.ts',
    evidencePaths: ['tests/search/matrix.test.ts'],
  },
  {
    id: 'AC-22',
    title:
      'Build LinkedIn URLs with f_TPR, f_WT, geoId, keywords, sortBy=DD — evidence: tests/search/url-builder.test.ts',
    evidencePaths: ['tests/search/url-builder.test.ts'],
    stronger: {
      fileIndex: 0,
      pattern: /sortBy=DD|"DD"/,
      description: 'url-builder.test.ts asserts sortBy=DD',
    },
  },
  {
    id: 'AC-23',
    title:
      'Discover jobs from public LinkedIn pages — evidence: tests/linkedin/discovery-service.test.ts',
    evidencePaths: ['tests/linkedin/discovery-service.test.ts'],
  },
  {
    id: 'AC-24',
    title: 'Continue until bounded end condition — evidence: tests/linkedin/load-more.test.ts',
    evidencePaths: ['tests/linkedin/load-more.test.ts'],
  },
  {
    id: 'AC-25',
    title: 'Extract from embedded panel — evidence: tests/extraction/panel-parser.test.ts',
    evidencePaths: ['tests/extraction/panel-parser.test.ts'],
  },
  {
    id: 'AC-26',
    title: 'Fall back to dedicated job page — evidence: tests/extraction/dedicated-parser.test.ts',
    evidencePaths: ['tests/extraction/dedicated-parser.test.ts'],
  },
  {
    id: 'AC-27',
    title:
      'Persist complete/partial/failed/discovery-error outcomes — evidence: tests/persistence/repositories/jobs.test.ts (extraction_status cases)',
    evidencePaths: ['tests/persistence/repositories/jobs.test.ts'],
    stronger: {
      fileIndex: 0,
      pattern: /extractionStatus/,
      description: 'jobs.test.ts exercises extractionStatus (complete/partial/failed)',
    },
  },
  {
    id: 'AC-28',
    title:
      'Skip existing complete jobs — evidence: tests/pipeline/orchestrator.test.ts (skip path)',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts'],
  },
  {
    id: 'AC-29',
    title:
      'Skip automatic retries for partial jobs — evidence: tests/pipeline/orchestrator.test.ts (partial skip)',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts'],
  },
  {
    id: 'AC-30',
    title: 'Apply deterministic global filters — evidence: tests/filter/service.test.ts',
    evidencePaths: ['tests/filter/service.test.ts'],
  },
  {
    id: 'AC-31',
    title:
      'Store explicit rejection reasons — evidence: tests/persistence/repositories/filter-results.test.ts (rejectionReasons column)',
    evidencePaths: ['tests/persistence/repositories/filter-results.test.ts'],
    stronger: {
      fileIndex: 0,
      pattern: /rejectionReasons/,
      description: 'filter-results.test.ts exercises rejectionReasons field',
    },
  },
  {
    id: 'AC-32',
    title:
      'Show + confirm OpenAI scoring plan — evidence: tests/pipeline/orchestrator.test.ts (confirmation path)',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts'],
  },
  {
    id: 'AC-33',
    title:
      'Score one job per request, controlled concurrency — evidence: tests/scoring/service.test.ts (concurrency cases)',
    evidencePaths: ['tests/scoring/service.test.ts'],
  },
  {
    id: 'AC-34',
    title: 'Calculate weighted score in JobHunter — evidence: tests/scoring/score-formula.test.ts',
    evidencePaths: ['tests/scoring/score-formula.test.ts'],
  },
  {
    id: 'AC-35',
    title:
      'Reuse current filter + score results — evidence: tests/filter/service.test.ts (reused) + tests/scoring/service.test.ts (reused)',
    evidencePaths: ['tests/filter/service.test.ts', 'tests/scoring/service.test.ts'],
  },
  {
    id: 'AC-36',
    title:
      'Treat changed-input results as stale — evidence: tests/filter/service.test.ts (stale) + tests/scoring/service.test.ts (stale)',
    evidencePaths: ['tests/filter/service.test.ts', 'tests/scoring/service.test.ts'],
  },
  {
    id: 'AC-37',
    title:
      'Reevaluate stored jobs explicitly through all scopes — evidence: tests/reevaluation/service.test.ts + tests/cli/jobs-reevaluate.test.ts',
    evidencePaths: ['tests/reevaluation/service.test.ts', 'tests/cli/jobs-reevaluate.test.ts'],
  },
  {
    id: 'AC-38',
    title:
      'Display top 20 current scores after run — evidence: tests/pipeline/format.test.ts (topN table)',
    evidencePaths: ['tests/pipeline/format.test.ts'],
  },
  {
    id: 'AC-39',
    title: 'List jobs through explicit state flags — evidence: tests/cli/jobs-list.test.ts',
    evidencePaths: ['tests/cli/jobs-list.test.ts'],
  },
  {
    id: 'AC-40',
    title:
      'Use adaptive width-aware tables — evidence: tests/inspection/columns.test.ts + tests/pipeline/format.test.ts',
    evidencePaths: ['tests/inspection/columns.test.ts', 'tests/pipeline/format.test.ts'],
  },
  {
    id: 'AC-41',
    title:
      'Inspect individual jobs and runs — evidence: tests/cli/jobs-show.test.ts + tests/cli/runs-show.test.ts',
    evidencePaths: ['tests/cli/jobs-show.test.ts', 'tests/cli/runs-show.test.ts'],
  },
  {
    id: 'AC-42',
    title:
      'Produce versioned JSON output — evidence: tests/cli/paths-json.test.ts + tests/inspection/json-schemas.test.ts + tests/reevaluation/json-schemas.test.ts',
    evidencePaths: [
      'tests/cli/paths-json.test.ts',
      'tests/inspection/json-schemas.test.ts',
      'tests/reevaluation/json-schemas.test.ts',
    ],
    stronger: {
      fileIndex: 1,
      pattern: /schemaVersion/,
      description: 'inspection/json-schemas.test.ts pins schemaVersion contract',
    },
  },
  {
    id: 'AC-43',
    title:
      'Preserve completed work after recoverable errors / cancellation — evidence: tests/pipeline/orchestrator.test.ts (cancellation path)',
    evidencePaths: ['tests/pipeline/orchestrator.test.ts'],
  },
];

describe('SPEC.md §42 — MVP acceptance evidence matrix', () => {
  for (const item of ITEMS) {
    it(`${item.id}: ${item.title}`, () => {
      for (const p of item.evidencePaths) {
        expect(existsSync(new URL(p, repoRoot))).toBe(true);
      }
      if (item.stronger) {
        const target = item.evidencePaths[item.stronger.fileIndex];
        if (target === undefined) {
          throw new Error(`${item.id}: stronger.fileIndex ${item.stronger.fileIndex} out of range`);
        }
        const src = readFileSync(new URL(target, repoRoot), 'utf8');
        expect(src, `${item.id}: ${item.stronger.description}`).toMatch(item.stronger.pattern);
      }
    });
  }
});
