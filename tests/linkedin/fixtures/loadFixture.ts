import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

/**
 * The HTML fixtures seeded across the test tree.
 *
 * Wave A (TASK-012) seeds 3 fixtures (search results variations).
 * Wave C (TASK-013) adds 6 fixtures (panel + dedicated page variations
 * used by `src/linkedin/extraction/{panel-parser,dedicated-parser}.ts`).
 *
 * Each fixture is a representative saved HTML page that exercises
 * one branch of the parser / orchestrator's per-search walk.
 */
export type FixtureName =
  | 'search-results-basic'
  | 'search-results-no-results'
  | 'search-results-with-modal'
  // Wave C — TASK-013 extraction layer (SPEC §22.6 + §22.7)
  | 'panel-complete'
  | 'panel-partial'
  | 'panel-mismatch'
  | 'panel-parse-failure'
  | 'dedicated-complete'
  | 'dedicated-partial';

/**
 * Absolute path to this directory (resolved from this module's URL).
 * Used for the TASK-012 search-results fixtures.
 */
const FIXTURES_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Absolute path to the TASK-013 extraction fixtures directory.
 * Resolved RELATIVE to this module's URL (resolved at module-load
 * time, not at call time) so the loader works across worktrees,
 * pnpm hoisting, and `process.cwd()` resets.
 *
 * `../../extraction/fixtures/` walks two levels up from
 * `tests/linkedin/fixtures/` (`tests/linkedin/fixtures` → `tests/linkedin` →
 * `tests/`) then into `extraction/fixtures/`.
 */
const EXTRACTION_FIXTURES_DIR = fileURLToPath(
  new URL('../../extraction/fixtures/', import.meta.url),
);

/**
 * Per-fixture lookup map: maps the canonical name to the directory
 * it lives in (resolved lazily from this module's URL + the
 * extraction directory constant).
 *
 * The search-results fixtures live in this directory (next to the
 * loader); the TASK-013 extraction fixtures live in
 * `tests/extraction/fixtures/` per the plan's file-structure table.
 * The lookup keeps the union type single-sourced while still letting
 * each directory own its HTML files.
 */
const FIXTURE_INFO: Readonly<Record<FixtureName, readonly [string, string]>> = {
  // TASK-012 — search results walk (this directory)
  'search-results-basic': [FIXTURES_DIR, 'search-results-basic.html'],
  'search-results-no-results': [FIXTURES_DIR, 'search-results-no-results.html'],
  'search-results-with-modal': [FIXTURES_DIR, 'search-results-with-modal.html'],
  // TASK-013 — extraction layer (sibling directory)
  'panel-complete': [EXTRACTION_FIXTURES_DIR, 'panel-complete.html'],
  'panel-partial': [EXTRACTION_FIXTURES_DIR, 'panel-partial.html'],
  'panel-mismatch': [EXTRACTION_FIXTURES_DIR, 'panel-mismatch.html'],
  'panel-parse-failure': [EXTRACTION_FIXTURES_DIR, 'panel-parse-failure.html'],
  'dedicated-complete': [EXTRACTION_FIXTURES_DIR, 'dedicated-complete.html'],
  'dedicated-partial': [EXTRACTION_FIXTURES_DIR, 'dedicated-partial.html'],
};

/**
 * Read a saved fixture as a raw string. Used by tests that
 * round-trip the HTML through `linkedom.parseHTML` themselves.
 *
 * The relative `join` keeps the loader portable across worktrees +
 * `process.cwd()` resets (the directory is resolved from this
 * module's URL, not the cwd).
 */
export function loadFixture(name: FixtureName): string {
  const [dir, file] = FIXTURE_INFO[name];
  return readFileSync(join(dir, file), 'utf8');
}

/**
 * Read a saved fixture and parse it via `linkedom`. Returns the
 * `Document` + a typed `window` proxy. Most tests use this helper
 * because it skips the boilerplate of `parseHTML(...)` + `.defaultView`.
 */
export function loadFixtureAsDocument(name: FixtureName): Document {
  const html = loadFixture(name);
  const { document: doc } = parseHTML(html);
  return doc as unknown as Document;
}
