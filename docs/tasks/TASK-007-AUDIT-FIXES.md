# TASK-007-AUDIT-FIXES — Post-Audit Remediation for TASK-007

**Status:** Awaiting approval
**Order:** Audit follow-up (post TASK-007 squash merge)
**Dependencies:** TASK-007 (commit `80d8e9a` on `main`)
**Source audit:** `docs/tasks/AUDIT-TASK-007-2026-08-13.md`

## Scope

Address every actionable finding from the TASK-007 code audit (3 Critical, 9 Important, 10 Minor; 5 Verification items, of which 2 are confirmed and 3 deferred). All 22 items are reorganized into 8 sub-tasks (A–H) below. Each sub-task lands with its own commit on a single feature branch and ends with an independently testable deliverable.

**In scope:**

- C1 — Persist `warnings` JSON column on `profile_sources` (schema migration + Zod + repository + service + CLI surface).
- C2 + M5 — Reject `.`, `..`, and NUL bytes in `defaultFilenameFor`.
- C3 — Remove dead `EncryptedPDFException` branch from the PDF extractor.
- I1 — Move SHA-256 dedup into the service; repository becomes `INSERT OR ERROR`.
- I2 — JSDoc explaining the `reused` count overlap.
- I3 — Harden the CLI test patching pattern with helper + `try/finally`.
- I4 — Drop the unused `export` from `resolveRepoRoot`.
- I5 — Remove the no-op `void repositories;`.
- I6 — Move `rm` to the top-level import in `BinaryFileSystem`.
- I9 — Document the `pageJoiner: ''` dependency and add a unit test.
- M1 — Collapse the duplicate `configShowCommand` branches.
- M2 — Rename `summaryLine` / `cliJson` to `formatSummary` / `formatSummaryJson`.
- M3 — Remove `trailerStart` + relocate `logTable` out of `pdf-encoder.ts`.
- M4 — Export `noopLogger` from `src/profile/index.ts`.
- M6 — Document the 3+ blank-lines → 2 rule in `text-normalize.ts`.
- M8 — Document the OS-specific absolute-path behavior in `ImportedSource.path`.
- M10 — Surface `warnings` in the CLI summary line and JSON output.
- V3 — Document the `latin1` byte-preserving assumption in the fixture encoder.

**Out of scope (deferred):**

- V1 — `pnpm format:check` failing on 37 files on `main`. Separate `chore/format-repo` task per AGENTS.md §13.
- I7 — PDF bytes read twice (streaming hash + readBytes). Documented as a known limitation for MVP CVs.
- I8 — Richer `text-pdf.pdf` fixture. Documented as a known limitation.
- M7 — Fixture regeneration test. Documented as optional.
- I4 + I5 are paired as the audit recommends.
- Verification items V2, V4, V5 are confirmed and require no code change.

## Dependencies and handoffs

- Complements TASK-007. The audit's C1 finding is a regression against the original TASK-007 plan ("Persist source metadata, extraction status, warnings, and errors"), so this work completes TASK-007's stated contract.
- Unblocks TASK-008 (OpenAI profile extraction) which expects the `warnings` column to exist by the time it reads stored source records.
- No changes to public CLI commands; the JSON output gains a `warnings` field per source (already present in current implementation; this fix makes it accurate).
- No new dependencies. No new top-level CLI subcommands.

## Referenced specification sections

- `SPEC.md` §13.4 Source storage (warnings/errors in metadata — C1 directly closes this SPEC gap).
- `SPEC.md` §36 Machine-readable output (JSON shape — `warnings` field is additive, non-breaking).
- `SPEC.md` §37 Exit codes (no change).
- `SPEC.md` §40 Reliability requirements (resource cleanup verified by V2).
- `SPEC.md` §41.1, §41.2 Unit and integration test expectations (each sub-task lists its tests).

## Expected tests

- **C1**: migration applies; existing rows retain `warnings = '[]'`; new rows persist the array; service populates the field from the markdown extractor; CLI surface includes the warnings.
- **C2 + M5**: `defaultFilenameFor` rejects `.`, `..`, and NUL bytes with `UnsupportedSourceFormatError`.
- **I1**: `ProfileSourceRepository.insert` raises on UNIQUE-constraint collision; service throws dedup error cleanly when the lookup race loses.
- **M10**: Summary line shows `(N warnings: code1, code2)`; JSON output includes `warnings`.
- **I9**: PDF extractor's `getText` is called with `pageJoiner: ''` (verified via mock assertion).
- **M3**: `tests/profile/fixtures/build-fixtures.ts` does not import `trailerStart`; the resulting fixture byte hashes are unchanged.
- All pre-existing TASK-007 tests still pass (no regressions).

## Verification requirements

- `pnpm lint` — exit 0.
- `pnpm typecheck` — exit 0.
- `pnpm build` — exit 0, `dist/cli.js` produced.
- `pnpm test` — all tests pass (baseline 319 + new tests).
- `node dist/cli.js profile import <valid.md>` — exit 0, summary line shows warnings count when applicable.
- `node dist/cli.js profile import <valid.md> --json` — exit 0, JSON document includes `warnings` arrays.
- Migration applied cleanly against a database with existing TASK-007 rows.

## Completion criteria

- All 22 audit items moved out of `[ ] Open` in `AUDIT-TASK-007-2026-08-13.md` (either `[x] Fixed` or marked `Deferred` with rationale).
- `pnpm test` passes against the existing test suite plus the new tests.
- `pnpm format:check` status for files touched by this task is clean (the pre-existing 37-file failure is acknowledged but not addressed; the files this task touches must format clean).
- No new top-level dependencies.
- The audit file's "Suggested fix order" is satisfied in the order recorded by the commit history.

## Detailed implementation plan

Each sub-task is a separate commit on a single branch
`fix/task-007-audit-fixes` (per `GIT.md` §1 branch naming). Sub-tasks land in order; each commit
ends with passing tests, typecheck, and lint.

### Sub-task A — Critical correctness: warnings column, path validation, dead code (C1, C2, M5, C3)

**Addresses:** C1, C2, M5, C3.

**Files:**

- Modify: `src/persistence/schema.ts` — add `warnings: text('warnings')` (nullable, JSON-encoded array).
- Modify: `src/persistence/repositories/profile-sources.ts` — add `warnings: readonly string[]` to `ProfileSourceRow` and `ProfileSourceInsert`; read/write the JSON column.
- Modify: `src/persistence/migrations.ts` (or generated SQL) — new migration file `0002-<drizzle-name>.sql` that adds the `warnings` column with default `'[]'`.
- Modify: `src/persistence/database.ts` if needed — ensure migration is registered.
- Modify: `src/profile/importer.ts` — populate `warnings` on insert; read it on reuse; serialize via `JSON.stringify` on write and `JSON.parse` on read (with Zod validation).
- Modify: `src/profile/file-copy.ts` — `defaultFilenameFor` rejects `.`, `..`, NUL bytes, empty strings, and trailing whitespace with `UnsupportedSourceFormatError`.
- Modify: `src/profile/extractors/pdf.ts` — remove `EncryptedPDFException` from `ENCRYPTED_PDF_NAMES`.
- Modify: `src/profile/errors.ts` — ensure `UnsupportedSourceFormatError` is the right base class for the new rejection path (or extend if a more specific class is needed).
- Modify: `tests/persistence/repositories/profile-sources.test.ts` — add tests for `warnings` round-trip.
- Modify: `tests/profile/file-copy.test.ts` — add tests for `.`, `..`, NUL, empty.
- Modify: `tests/profile/extractors/pdf-encrypted.test.ts` — confirm removal of `EncryptedPDFException` does not regress the encrypted detection.
- Modify: `tests/profile/importer.test.ts` — add test that an imported markdown file with external image references persists the warning.

**Approach for C1:**

1. Decide the canonical type: `string[]` serialized as JSON.
2. Migration adds `warnings TEXT NOT NULL DEFAULT '[]'`.
3. Repository reads the field, parses JSON, validates with Zod (`z.array(z.string())`).
4. Service passes `extraction.warnings` (currently always `[]` from PDF/plain-text, populated from `markdown.ts`) to the repository on insert and update.
5. CLI surface (M10, done in Sub-task C) is the consumer.

**Approach for C2 + M5:**

In `defaultFilenameFor`, after extracting `path.basename(originalPath).trim()`:

- If the result is empty → `UnsupportedSourceFormatError` (no fallback to `cv.{ext}`).
- If the result contains a NUL byte → `UnsupportedSourceFormatError`.
- If the result is exactly `.` or `..` → `UnsupportedSourceFormatError`.
- The fallback `cv.pdf` / `cv.md` / `cv.txt` is removed because the empty case is now an error.

Defense-in-depth: in `resolveSourceStoragePath`, assert that the resolved path is still inside `paths.profileSources.directory/{sourceId}/`. Throw `ProfileSourceStorageError` if not.

**Approach for C3:**

Remove `'EncryptedPDFException'` from the `ENCRYPTED_PDF_NAMES` set in `pdf.ts`. The string-based fallback (`message.includes('encrypted')`) already covers the real signal.

**Tests:**

- `tests/persistence/repositories/profile-sources.test.ts` — round-trip `warnings: ['markdown_contains_external_image_references']`.
- `tests/profile/file-copy.test.ts` — new cases for `..`, `.`, `'\0'`, `''`.
- `tests/profile/extractors/pdf-encrypted.test.ts` — encrypted PDF still detected via the remaining string fallback.
- `tests/profile/importer.test.ts` — markdown file with `<img src="https://...">` writes the warning to the row.

**Verification:**

- `pnpm test -- tests/persistence tests/profile/file-copy.ts tests/profile/extractors/pdf-encrypted.test.ts tests/profile/importer.test.ts`
- Manually apply migration to a copy of the existing DB and verify row content with `sqlite3`.

### Sub-task B — Service owns dedup (I1)

**Addresses:** I1.

**Files:**

- Modify: `src/persistence/repositories/profile-sources.ts` — remove the `findBySha256` pre-check from `insert`. The repository now performs a pure INSERT and treats the UNIQUE-constraint violation as a typed error.
- Modify: `src/persistence/repository-errors.ts` (or equivalent) — add `DuplicateSha256Error` (extends `ApplicationError`, exit code 2 or 1 per AGENTS.md §10; the audit does not specify, default to 1 for "internal error" since the service should never trigger it).
- Modify: `src/profile/importer.ts` — `importOne` already calls `findBySha256` first; no service change needed. Add a JSDoc explaining that the repository no longer dedups.
- Modify: `tests/persistence/repositories/profile-sources.test.ts` — replace the "insert returns existing id" test with "insert throws `DuplicateSha256Error` on collision".
- Modify: `tests/profile/importer.test.ts` — confirm the existing dedup tests still pass (service-level dedup is unchanged).

**Rationale:**

The audit's recommendation is the cleanest. The repository's defensive check is redundant because the service already dedups. Future callers that bypass the service will either:
- Need to dedup themselves (and the repository should fail loud to surface the bug), or
- Use a different write path (e.g., the future "force re-import" task).

**Tests:**

- `tests/persistence/repositories/profile-sources.test.ts` — insert collision throws `DuplicateSha256Error`.
- `tests/profile/importer.test.ts` — existing dedup tests pass unchanged.

**Verification:**

- `pnpm test -- tests/persistence tests/profile/importer.test.ts`

### Sub-task C — Surface warnings in CLI (M10)

**Addresses:** M10.

**Files:**

- Modify: `src/cli.ts` — extend `summaryLine` (rename to `formatSummary` in Sub-task G) to append `(N warning: code)` or `(N warnings: code1, code2)` to the per-source line.
- Modify: `src/cli.ts` — JSON output already includes `warnings` per source; verify the field is accurate (currently `ImportedSource.warnings` is correct after Sub-task A wires the persistence).
- Modify: `tests/cli/profile-import.test.ts` — add tests for the warning-affixed summary line and the JSON output.

**Human-readable format:**

```text
status: success
  extracted: 1
  failed: 0
  reused: 0
  source_1  success  cv.md (1 warning: markdown_contains_external_image_references)
```

For two or more warnings, join with `, ` and use plural form. For reused sources, the warning count comes from the DB row.

**Tests:**

- `tests/cli/profile-import.test.ts` — markdown file with external image references shows the warning in the summary and JSON.

**Verification:**

- `node dist/cli.js profile import <markdown-with-img.md>` — exit 0, summary line shows warning.
- `node dist/cli.js profile import <markdown-with-img.md> --json` — exit 0, JSON contains `warnings: ["markdown_contains_external_image_references"]`.

### Sub-task D — Semantics: JSDoc on `ProfileImportCounts` (I2)

**Addresses:** I2.

**Files:**

- Modify: `src/profile/importer.ts` — add JSDoc to `ProfileImportCounts` explaining that `reused` is the count of sources whose hash is already on disk and may overlap with `extracted` or `failed`.

**JSDoc text:**

```ts
/**
 * Counts of sources processed by a single `profile import` invocation.
 *
 * `reused` counts sources whose SHA-256 already existed in the database. A
 * reused source is also counted in `extracted` or `failed` when its stored
 * `textExtractionStatus` is `success` or `failed` respectively. The `total`
 * field is the sum of all sources processed (including reused ones).
 */
```

**No new tests.** Documentation change only.

**Verification:**

- `pnpm typecheck` — JSDoc does not break the build.

### Sub-task E — Trivial cleanups (I4, I5, I6, M3)

**Addresses:** I4, I5, I6, M3.

**Files:**

- Modify: `src/persistence/resolve-migrations.ts` — remove `export` from `resolveRepoRoot` (kept `resolveRepoRootForMigrations` exported).
- Modify: `src/cli.ts` — delete `void repositories;` line.
- Modify: `src/profile/file-system.ts` — add `rm` to the top-level `import { ... } from 'node:fs/promises'`.
- Modify: `tests/profile/fixtures/pdf-encoder.ts` — remove `trailerStart` variable and `void trailerStart;` line.
- Modify: `tests/profile/fixtures/build-fixtures.ts` — inline `logTable` (or keep it as a local helper if it stays in the script).
- Verify: regenerated fixture byte hashes are unchanged (sanity check by running `pnpm test -- tests/profile/extractors/pdf.test.ts`).

**Tests:**

- Existing tests cover the import shape and fixture generation. No new tests needed.

**Verification:**

- `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Sub-task F — Hardening & documentation (I3, I9, M4, M6, M8, V3)

**Addresses:** I3, I9, M4, M6, M8, V3.

**Files:**

- Modify: `tests/cli/profile-import.test.ts` — wrap each test in `try/finally` to restore the `process.exit`/`process.stdout` patches. Add a small helper `withMockedProcessExit(exit: jest.Mock, callback: () => Promise<void>)` that handles restore.
- Modify: `src/profile/extractors/pdf.ts` — add a comment above `getText({ pageJoiner: '' })` explaining that the empty joiner is required for the `EMPTY_TEXT_FALLBACK_PATTERN` to detect image-only PDFs.
- Modify: `tests/profile/extractors/pdf.test.ts` — add a unit test that asserts `getText` is called with `pageJoiner: ''` (mock `pdf-parse`).
- Modify: `src/profile/index.ts` — export `noopLogger`.
- Modify: `src/profile/text-normalize.ts` — add JSDoc to the blank-line collapse rule.
- Modify: `src/profile/importer.ts` — add JSDoc to `ImportedSource.path` noting that it is `path.resolve(rawPath)` and uses the OS-native format.
- Modify: `tests/profile/fixtures/pdf-encoder.ts` — add JSDoc to the `latin1` decoder calls documenting the byte-preserving assumption.

**Tests:**

- `tests/profile/extractors/pdf.test.ts` — new mock-based test for `pageJoiner: ''`.
- `tests/cli/profile-import.test.ts` — refactor (no new tests, but the helper makes the existing tests more robust).

**Verification:**

- `pnpm test -- tests/cli/profile-import.test.ts tests/profile/extractors/pdf.test.ts`

### Sub-task G — Cosmetic renames (M1, M2)

**Addresses:** M1, M2.

**Files:**

- Modify: `src/cli.ts` — collapse `configShowCommand` to a single branch (both `if` and `else` write the same string).
- Modify: `src/cli.ts` — rename `summaryLine` → `formatSummary`, `cliJson` → `formatSummaryJson`. Update internal references and tests.

**Tests:**

- `tests/cli/profile-import.test.ts` — update test references to the new function names.

**Verification:**

- `pnpm test -- tests/cli`
- `pnpm lint` (the rename may temporarily trip unused-var lint rules).

### Sub-task H — Update audit status and document deferrals

**Addresses:** I7, I8, M7, and the audit file itself.

**Files:**

- Modify: `docs/tasks/AUDIT-TASK-007-2026-08-13.md` — update each item's `Status` to `[x] Fixed` or `Deferred` and add a `Fix notes:` entry summarizing the chosen fix. Per the audit's instructions, do not edit historical `Issue`/`Recommendation` text.

**Deferrals to record:**

- I7 — `Defer` (documented known limitation; MVP CVs are <5 MB).
- I8 — `Defer` (documented known limitation; current fixture is sufficient).
- M7 — `Defer` (optional; can be added later).
- V1 — `Out of scope` (separate `chore/format-repo` task per AGENTS.md).

**Verification:**

- `git diff docs/tasks/AUDIT-TASK-007-2026-08-13.md` — every item has either `[x]` or `[Deferred]` and a `Fix notes:` line.

## Expected files

**Modified:**

- `src/persistence/schema.ts` (C1)
- `src/persistence/repositories/profile-sources.ts` (C1, I1)
- `src/persistence/migrations.ts` (C1 — new migration registered)
- `src/persistence/migrations/0002-*.sql` (C1 — new file via Drizzle)
- `src/persistence/repository-errors.ts` (I1 — new `DuplicateSha256Error`)
- `src/persistence/resolve-migrations.ts` (I4)
- `src/profile/importer.ts` (C1, Iz, D, M6, M8)
- `src/profile/file-copy.ts` (C2, M5)
- `src/profile/extractors/pdf.ts` (C3, I9)
- `src/profile/file-system.ts` (I6)
- `src/profile/index.ts` (M4)
- `src/profile/text-normalize.ts` (M6)
- `src/cli.ts` (I5, M1, M2, M10)
- `tests/cli/profile-import.test.ts` (M10, I3, M2)
- `tests/persistence/repositories/profile-sources.test.ts` (C1, I1)
- `tests/profile/file-copy.test.ts` (C2, M5)
- `tests/profile/extractors/pdf.test.ts` (I9)
- `tests/profile/extractors/pdf-encrypted.test.ts` (C3)
- `tests/profile/importer.test.ts` (C1)
- `tests/profile/fixtures/pdf-encoder.ts` (M3, V3)
- `tests/profile/fixtures/build-fixtures.ts` (M3)
- `docs/tasks/AUDIT-TASK-007-2026-08-13.md` (H — status updates)

**No new top-level dependencies.**

## Risks

- **C1 migration** — must be safe against existing databases. The new column is `NOT NULL DEFAULT '[]'` so existing rows get a valid value. The migration must not block the pre-existing `textExtractionMessage` column. The audit's recommendation is option (a) (JSON column), which is the smallest change.
- **C2 + M5 breaking change** — `defaultFilenameFor` previously fell back to `cv.{ext}` for empty inputs. The new behavior rejects empty inputs. This is a tightening of validation; existing CV users always pass a real path, so the risk is minimal.
- **I1 repository contract change** — `insert` now throws on collision instead of returning the existing id. The only caller is `ProfileImportService.importOne`, which already dedups. Any future caller that didn't dedup would now fail loudly (correct behavior).
- **M10 JSON output** — `warnings` is already in the JSON output; this fix makes the field accurate. No shape change.
- **Migration on existing data** — the migration adds a column with a default. Drizzle will generate the appropriate SQL. The migration must be tested against a copy of the existing DB before merge.

## Deferrals and out-of-scope

- **V1** — `pnpm format:check` on the full repo. Separate `chore/format-repo` task per AGENTS.md §13. The files this task touches will format clean.
- **I7** — PDF bytes read twice. Documented as a known limitation in the audit's "Deferred" section.
- **I8** — Richer `text-pdf.pdf` fixture. Documented as a known limitation.
- **M7** — Fixture regeneration test. Optional.
- **I4 + I5** — paired as the audit recommends.

## Test inventory (expected additions)

- `tests/persistence/repositories/profile-sources.test.ts` — ~2 new tests (warnings round-trip, insert collision throws).
- `tests/profile/file-copy.test.ts` — ~4 new tests (`.`, `..`, NUL, empty).
- `tests/profile/extractors/pdf.test.ts` — 1 new test (mock asserts `pageJoiner: ''`).
- `tests/profile/importer.test.ts` — 1 new test (markdown warning persists).
- `tests/cli/profile-import.test.ts` — 2 new tests (summary line + JSON with warnings), refactor for try/finally.

Expected total new tests: ~10. Expected final test count: ~329.

## Open questions / decisions (resolved with the user)

- **C1 shape** — JSON column on `profile_sources` (option a). Approved.
- **I1 location** — service owns dedup, repository is `INSERT OR ERROR`. Approved.
- **I2 semantics** — JSDoc only. Approved.
- **Task scope** — single task with internal sub-tasks. Approved.
- **V1 scope** — separate `chore/format-repo` task. Approved.
- **M10 visibility** — surface in CLI summary and JSON output. Approved.
- **I4 + I5** — paired in Sub-task E.
- **Migration strategy** — `pnpm drizzle-kit generate` to produce the SQL file, then commit.
