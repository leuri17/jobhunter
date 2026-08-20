import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

/**
 * The three HTML fixtures Wave E seeds in this directory. Each
 * fixture is a representative saved HTML page that exercises one
 * branch of the orchestrator's per-search walk.
 */
export type FixtureName =
  'search-results-basic' | 'search-results-no-results' | 'search-results-with-modal';

const FIXTURE_FILES: Readonly<Record<FixtureName, string>> = {
  'search-results-basic': 'search-results-basic.html',
  'search-results-no-results': 'search-results-no-results.html',
  'search-results-with-modal': 'search-results-with-modal.html',
};

const FIXTURES_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Read a saved fixture as a raw string. Used by tests that
 * round-trip the HTML through `linkedom.parseHTML` themselves.
 */
export function loadFixture(name: FixtureName): string {
  return readFileSync(join(FIXTURES_DIR, FIXTURE_FILES[name]), 'utf8');
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
