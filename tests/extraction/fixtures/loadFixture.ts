/**
 * Re-export of the shared `loadFixture` helper for the TASK-013
 * extraction tests (Wave C, SPEC §22.6 + §22.7).
 *
 * The HTML fixtures for the extraction layer (`panel-*.html` +
 * `dedicated-*.html`) live in this directory; their `FixtureName`
 * entries + file paths are registered in the canonical loader at
 * `tests/linkedin/fixtures/loadFixture.ts`. This module re-exports
 * the helper so the extraction tests' `tests/extraction/fixtures/*`
 * directory is self-contained — a wave C test never has to reach
 * across to `tests/linkedin/fixtures/` for the API surface.
 *
 * The locator map itself stays singular (no divergence between the
 * two `loadFixture` exports — both resolve against the same union
 * type and the same file lookup).
 */
export {
  loadFixture,
  loadFixtureAsDocument,
  type FixtureName,
} from '../../linkedin/fixtures/loadFixture.js';
