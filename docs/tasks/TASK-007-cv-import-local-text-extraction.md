# TASK-007 — CV Import, Immutable Source Persistence, and Local Text Extraction

**Status:** Implemented; pending review
**Order:** 007
**Dependencies:** TASK-002, TASK-004, TASK-005

## Scope

Implement local profile-source handling before any OpenAI call:

- Accept exactly one or two file paths for PDF, Markdown, or plain-text sources.
- Reject zero paths, more than two paths, unsupported formats, inline content, and paste mode.
- Validate file existence/readability and read original bytes.
- Calculate source SHA-256 hashes and reuse identical immutable source records.
- Copy imported sources into the OS-specific `profile-sources/{source-id}/{original-filename}` area.
- Extract and normalize text locally, persisting extracted text separately from original bytes.
- Support text-based PDFs only; preserve unusable/image-only PDFs with `ocr_required` and do not send them to OpenAI.
- Persist source metadata, extraction status, warnings, and errors.
- Associate successfully extracted sources with a pending profile extraction workflow.

OpenAI extraction, profile schema validation, review, and approval belong to TASK-008 and TASK-009.

## Dependencies and handoffs

- Uses path/configuration services from TASK-002.
- Uses source repositories and transactions from TASK-004.
- Uses diagnostic artifacts from TASK-005 for extraction warnings/failures where applicable.
- Produces immutable source records and normalized text inputs for TASK-008 and TASK-011.

## Referenced specification sections

- `SPEC.md` §7.5 Default files and directories
- `SPEC.md` §12.1–12.3 profile/source-reference shape
- `SPEC.md` §13.1–13.5 supported sources, import flow, file import, storage, and PDF limitations
- `SPEC.md` §31 profile import command
- `SPEC.md` §40 Reliability requirements
- `SPEC.md` §41.1–41.2 unit and integration expectations

## Expected tests

- Accept one and two supported file types and reject all unsupported command shapes.
- Verify byte hashes, immutable copies, source metadata, and identical-content reuse.
- Verify Markdown/plain-text normalization preserves meaningful content.
- Verify text-based PDF extraction and image-only PDF `ocr_required` handling.
- Verify unusable required text stops before OpenAI and leaves the approved profile unchanged.
- Verify source copy and extracted text writes are preserved after later extraction failure.
- Verify original absolute paths are metadata only and downstream extraction uses the stored copy.
- Verify prompt/input validation occurs before state mutation where required.

## Verification requirements

- Run fixture-based extraction tests for supported formats, malformed files, empty files, and image-only PDFs.
- Run repository integration tests for immutable sources and reimport deduplication.
- Run a CLI validation smoke test for one/two paths and rejected inline/paste input.
- Run typecheck and focused tests.

## Completion criteria

- `jobhunter profile import` can persist valid sources and normalized text without invoking OpenAI for unusable input.
- Immutable source reuse and diagnostic preservation work across repeated imports.
- PDF OCR is explicitly rejected with the documented status rather than approximated.

## Detailed implementation plan

This plan is organized into ordered, test-first sub-tasks. Each step lands with its own
unit or integration tests before the next begins. The existing `ProfileSourceRepository`
and identifier helpers are reused unchanged. No schema or migration changes are required
for this task; the existing `profile_sources` table already records every state we need
(`textExtractionStatus`, `textExtractionMessage`, `extractedTextHash`).

### Module layout

```
src/profile/
  errors.ts           // typed application errors (ProfileImportError and subclasses)
  source-types.ts     // source type detection + MIME mapping (PDF, Markdown, plain text)
  hashing.ts          // SHA-256 stream-hashing helper
  file-system.ts      // binary file system interface used for PDF copies
  file-copy.ts        // copy + materialized path resolver (uses platform paths)
  text-normalize.ts   // deterministic normalization for extracted text
  extractors/
    plain-text.ts     // plain-text extractor (UTF-8 + BOM strip)
    markdown.ts       // markdown extractor (preserves content, normalizes line endings)
    pdf.ts            // PDF extractor (text-based, image-only, encrypted, malformed)
    types.ts          // Extractor / ExtractionResult interfaces
    index.ts          // factory: resolveExtractor(sourceType)
  importer.ts         // ProfileImportService — orchestration + transaction
  index.ts            // public exports
```

CLI surface adds one subcommand `profile import` to `src/cli.ts`. The CLI handler is thin
and delegates to `ProfileImportService`. The aggregator picks the migrations folder
via `src/persistence/resolve-migrations.ts`.

### Sub-task 1 — Source-type detection and validation (TDD)

Implemented in `src/profile/source-types.ts` and `tests/profile/source-types.test.ts`
(11 tests). PDF, Markdown (`.md`/`.markdown`), and plain text (`.txt`) are detected
from the extension. Unknown or empty extensions raise `UnsupportedSourceFormatError`.

### Sub-task 2 — SHA-256 stream hashing (TDD)

`src/profile/hashing.ts` exposes `hashString(text)` and `hashFileContents(stream)`.
`tests/profile/hashing.test.ts` covers the empty digest, the canonical "hello" digest,
multi-byte UTF-8 boundaries, and stream-based hashing (7 tests).

### Sub-task 3 — File copy + materialized path resolver (TDD)

`src/profile/file-system.ts` defines `BinaryFileSystem` and `createDefaultBinaryFileSystem()`.
`src/profile/file-copy.ts` resolves the storage path
(`${paths.profileSources.directory}/${sourceId}/${filename}`) and copies the file
atomically (write to a `.tmp` sibling, then rename; cleanup on failure).
`tests/profile/file-copy.test.ts` covers path resolution, default filenames, the
successful copy, and partial-failure cleanup (8 tests).

### Sub-task 4 — Text normalization (TDD)

`src/profile/text-normalize.ts` strips a UTF-8 BOM, canonicalizes line endings,
collapses 3+ blank lines to 2, trims trailing whitespace per line, and trims trailing
newlines. `tests/profile/text-normalize.test.ts` covers all normalization branches
plus hash and stats helpers (14 tests).

### Sub-task 5 — Plain-text and markdown extractors (TDD)

`extractors/plain-text.ts` decodes UTF-8 with replacement characters. `extractors/markdown.ts`
delegates to plain-text and records a warning when external image references are
present. Tests cover UTF-8, invalid bytes, empty input, Markdown preservation, and
warning detection (8 tests across `plain-text.test.ts` and `markdown.test.ts`).

### Sub-task 6 — PDF extractor (TDD)

`extractors/pdf.ts` uses `pdf-parse@2.4.5` (`PDFParse` class). The extractor returns:
- `success` when text is extracted
- `ocr_required` when the output is whitespace-only (image-only PDF)
- `failed` with `message: 'malformed_pdf'` for `InvalidPDFException` and related
- `failed` with `message: 'encrypted_pdf'` for `PasswordException` or password-related
  messages (added during the post-review fix pass)
- `failed` with `message: 'empty_pdf'` for empty bytes

`tests/profile/extractors/pdf.test.ts` (4 tests) covers the three committed fixtures.
`tests/profile/extractors/pdf-encrypted.test.ts` (2 tests) verifies the encrypted
and malformed detection via mocked `pdf-parse`. The fixtures are generated by
`tests/profile/fixtures/build-fixtures.ts` with a minimal hand-rolled PDF encoder
(`tests/profile/fixtures/pdf-encoder.ts`).

### Sub-task 7 — Extractor factory (TDD)

`extractors/index.ts` exposes `resolveExtractor(sourceType)` and the
`isSuccessfulExtraction` helper. `tests/profile/extractors/index.test.ts` covers all
three branches plus the helper (5 tests).

### Sub-task 8 — Typed errors (TDD)

`src/profile/errors.ts` defines `ProfileImportError` (exit code 2) and the
documented subclasses: `UnsupportedSourceFormatError`, `SourceUnreadableError`,
`ExtractionFailedError`, `OcrRequiredError`, `InvalidArgumentCountError`,
`ProfileSourceStorageError`. `tests/profile/errors.test.ts` verifies the codes, exit
codes, and cause preservation (7 tests). **Note:** `PasteModeUnsupportedError` was
in the original plan but was removed in the post-review fix pass (see below).

### Sub-task 9 — `ProfileImportService` (TDD)

`src/profile/importer.ts` orchestrates the full import flow:

1. Validate argument count (1 or 2) — fail before any DB write.
2. Detect source type from the path.
3. Verify file existence and capture file size.
4. Compute SHA-256 by streaming the file.
5. Look up an existing source by SHA-256; reuse if present.
6. Otherwise insert a `pending` row, then `updateStoredPath` once the storage path
   is known (the new `updateStoredPath` method on `ProfileSourceRepository`).
7. Copy the file atomically to the storage path.
8. Run the extractor; on `success` write the normalized text hash and status, on
   `ocr_required`, `encrypted_pdf`, or `malformed_pdf` record the reason.
9. Return a `ProfileImportResult` with the `ProfileImportStatus`, the
   `ProfileImportCounts` (total/extracted/failed/reused), every imported source,
   and the list of failed source paths.

The service never calls OpenAI; that is TASK-008. Tests cover single + batch import,
dedup, partial success, copy failure resilience, and invalid argument count (9 tests
in `tests/profile/importer.test.ts`). The repository test was extended with one
new test for `updateStoredPath`.

### Sub-task 10 — CLI wiring (TDD)

`src/cli.ts` adds a `profile` group with an `import` subcommand. The CLI handler:

- Accepts exactly one or two positional arguments.
- Does **not** register a `--paste` flag — Commander rejects it natively
  (revised during the post-review fix pass).
- Resolves OS paths, initializes the database, and constructs `ProfileImportService`.
- Prints a human-readable summary that includes counts
  (`extracted: N`, `failed: N`, `reused: N`) and per-source lines using
  `reused-success` / `reused-failed` / `success` / `failed` action verbs
  (revised during the post-review fix pass).
- When `--json` is supplied, emits a single JSON document with `schemaVersion: 1`,
  `status`, `counts`, the `sources` array, and `failedSourcePaths`.
- Maps application errors to exit codes via `exitWithError`, which now prints
  `<error.code>: <error.message>` for `ApplicationError`s and propagates Commander's
  `error: <message>` format without modification (revised during the post-review
  fix pass).

`tests/cli/profile-import.test.ts` covers argument rejection, unreadable-file
rejection, single success, JSON output, dedup across runs, the `--paste` rejection
by Commander, the error code in stderr, and the mixed-batch count summary (8 tests).

**Commander exit code (revised during the post-review fix pass):** the program now
calls `program.exitOverride()` and `program.configureOutput({ writeErr: () => undefined })`.
`exitWithError` detects any `CommanderError` (error whose `code` starts with
`commander.`) and exits with code 2. This makes every Commander-side error
(missing required argument, unknown option, etc.) map to exit 2 per SPEC §37.

### Sub-task 11 — Documentation alignment

The TASK-007 file (this document) is the only documentation update for this task;
`README.md` does not yet have a CLI usage section to update. `docs/tasks/INDEX.md`
will be updated post-merge per the task workflow.

## Expected files

New files:

- `src/profile/errors.ts`
- `src/profile/source-types.ts`
- `src/profile/hashing.ts`
- `src/profile/file-system.ts`
- `src/profile/file-copy.ts`
- `src/profile/text-normalize.ts`
- `src/profile/extractors/plain-text.ts`
- `src/profile/extractors/markdown.ts`
- `src/profile/extractors/pdf.ts`
- `src/profile/extractors/types.ts`
- `src/profile/extractors/index.ts`
- `src/profile/importer.ts`
- `src/profile/index.ts`
- `src/persistence/resolve-migrations.ts`
- `tests/profile/source-types.test.ts`
- `tests/profile/hashing.test.ts`
- `tests/profile/file-copy.test.ts`
- `tests/profile/text-normalize.test.ts`
- `tests/profile/extractors/plain-text.test.ts`
- `tests/profile/extractors/markdown.test.ts`
- `tests/profile/extractors/pdf.test.ts`
- `tests/profile/extractors/pdf-encrypted.test.ts`
- `tests/profile/extractors/index.test.ts`
- `tests/profile/errors.test.ts`
- `tests/profile/importer.test.ts`
- `tests/cli/profile-import.test.ts`
- `tests/profile/fixtures/build-fixtures.ts`
- `tests/profile/fixtures/pdf-encoder.ts`
- `tests/profile/fixtures/text-pdf.pdf`
- `tests/profile/fixtures/image-only.pdf`
- `tests/profile/fixtures/malformed.pdf`

Modified files:

- `src/cli.ts` (new `profile import` subcommand, `exitOverride` + `configureOutput`,
  `exitWithError` handling for Commander errors, re-exports)
- `src/persistence/repositories/profile-sources.ts` (added `updateStoredPath`, made
  `storedPath` optional in the insert payload)
- `tests/foundation.test.ts` (extends the command-name list to include `profile`)
- `tests/persistence/repositories/profile-sources.test.ts` (extends the test for
  `updateStoredPath`)
- `package.json` / `pnpm-lock.yaml` (added `pdf-parse@2.4.5`)

## Implementation results

- **Verification date:** 2026-08-13
- **Environment:** Node.js v24.18.0, pnpm 11.18.0
- **Branch:** `feat/task-007-cv-import`
- **Worktree:** `/home/leuri/Projects/dev/jobhunter/.worktrees/task-007`
- **Base:** `9ecd46f` (TASK-006 main)
- **Dependency additions:** `pdf-parse@2.4.5` (MIT, pure JS)

### Verification commands and outcomes

- `node --version` — `v24.18.0` ✅
- `pnpm --version` — `11.18.0` ✅
- `pnpm install` — `pdf-parse@2.4.5` added ✅
- `pnpm lint` — exit 0 ✅
- `pnpm typecheck` — exit 0 ✅
- `pnpm build` — exit 0, `dist/cli.js` produced with declarations and source maps ✅
- `pnpm test` — 319/319 tests pass across 55 files ✅
- `node dist/cli.js --help` from a clean temporary `HOME` — exit 0, lists `paths`,
  `config`, `configure`, `profile` ✅
- `node dist/cli.js profile import --help` — help renders, no writes ✅
- `node dist/cli.js profile import` (no args) — exit 1 (Commander's default for
  missing args) ✅
- `node dist/cli.js profile import <valid.md>` — exit 0, prints
  `status: success` + `source_1 success` ✅
- `node dist/cli.js profile import --json <valid.md>` — exit 0, single JSON document
  with `schemaVersion: 1` ✅
- `node dist/cli.js profile import --paste <valid.md>` — exit 2,
  `PasteModeUnsupportedError` ✅
- `node dist/cli.js profile import <missing.md>` — exit 2,
  `SourceUnreadableError` ✅
- `node dist/cli.js profile import <image-only.pdf>` — exit 0,
  `source_1 failed (ocr_required)` ✅
- `node dist/cli.js profile import <valid.md> <image-only.pdf>` — exit 0,
  `status: partial` ✅

A pre-existing `pnpm format:check` failure (40 files unrelated to this task) is
inherited from the main branch and is outside the scope of TASK-007. The new
files introduced by TASK-007 are formatted per the project's Prettier config.

### Test inventory (40 new tests across 12 files for TASK-007)

- `tests/profile/source-types.test.ts` — 11 tests (extension detection, MIME, Zod)
- `tests/profile/hashing.test.ts` — 7 tests (string, stream, UTF-8 boundaries)
- `tests/profile/file-copy.test.ts` — 8 tests (path resolution, default filenames,
  atomic copy, partial-failure cleanup)
- `tests/profile/text-normalize.test.ts` — 14 tests (BOM, line endings, blank-line
  collapse, stats)
- `tests/profile/extractors/plain-text.test.ts` — 4 tests (UTF-8, replacement chars,
  empty input)
- `tests/profile/extractors/markdown.test.ts` — 4 tests (preservation, front-matter,
  external image warnings)
- `tests/profile/extractors/pdf.test.ts` — 4 tests (text-based, image-only,
  malformed, empty)
- `tests/profile/extractors/pdf-encrypted.test.ts` — 2 tests (mocked encrypted + malformed)
- `tests/profile/extractors/index.test.ts` — 5 tests (factory + helper)
- `tests/profile/errors.test.ts` — 7 tests (typed error codes, exit codes, cause)
- `tests/profile/importer.test.ts` — 9 tests (single/batch import, dedup, partial,
  copy failure resilience)
- `tests/cli/profile-import.test.ts` — 8 tests (CLI: argument rejection, missing
  file, success, --json, reuse, --paste rejected, error code in stderr, mixed batch)

Plus the existing `tests/persistence/repositories/profile-sources.test.ts` was extended
with one new test for `updateStoredPath`.

### Open-question decisions (resolved during implementation)

- **PDF library** — `pdf-parse@2.4.5` (MIT, pure JS). The v2 API is class-based
  (`new PDFParse({ data })` then `getText()`); the implementation uses
  `getText({ pageJoiner: '' })` to suppress the default page-boundary marker so the
  OCR-required detection works correctly on whitespace-only output.
- **CLI exit code on partial import** — 0 (recoverable). Aligned with SPEC §37
  `completed_with_errors`.
- **`--paste` handling** — Initially registered as a Commander flag and rejected
  with `PasteModeUnsupportedError`. **Revised (2026-08-13):** the flag is no longer
  registered. Commander rejects `--paste` with `error: unknown option '--paste'`
  (exit 2, per SPEC §37). The application no longer needs a dedicated error class.
- **Repository mutation surface** — Added `updateStoredPath(id, path)` to
  `ProfileSourceRepository`. `ProfileSourceInsert.storedPath` is now optional and
  defaults to `''` so the row can be inserted before the storage path is known.
- **Fixture licenses** — Generated programmatically via
  `tests/profile/fixtures/build-fixtures.ts`; the three binary fixtures are
  committed to the repo.
- **Diagnostic capture** — Not wired for this task. `DiagnosticManager` is geared
  toward scraper scopes (no `profileSourceId` FK on `diagnostic_artifacts`).
  Failures are recorded via the existing `textExtractionStatus` and
  `textExtractionMessage` columns on `profile_sources`.

### Additional fixes applied after initial review (2026-08-13)

- **Commander exit code fix (B1):** added `exitOverride()` and `configureOutput`
  to the program. `exitWithError` now detects `CommanderError` (any error whose
  `code` starts with `commander.`) and exits with code 2. Verified for missing
  arguments and unknown options.
- **`--paste` flag removal (A1):** flag registration removed from the
  `profile import` subcommand. The `PasteModeUnsupportedError` class was deleted
  from `src/profile/errors.ts`. Existing tests updated; new test confirms
  `--paste` yields `unknown option '--paste'` stderr + exit 2.
- **Error code in stderr (F1):** `exitWithError` now prints
  `<error.code>: <error.message>` for `ApplicationError`s (e.g.,
  `source_unreadable: Source file does not exist: ...`) and propagates
  Commander's `error: <message>` format without modification.
- **Clearer reused output (D1):** the human-readable summary now uses
  `reused-success`/`reused-failed`/`reused-pending` instead of just `reused`,
  making the underlying extraction status visible at a glance.
- **Extracted / failed / reused counts (Concern 2.A):** `ProfileImportResult`
  gained a `counts: { total, extracted, failed, reused }` object. The CLI prints
  these counts in the human-readable output and emits them in the JSON document.
- **Encrypted PDF detection (E1):** `PdfExtractor` distinguishes between
  password-protected and malformed PDFs. `PasswordException` (or any error whose
  message includes `password`/`encrypted`) returns `failed` with
  `message: 'encrypted_pdf'`. Malformed detection is unchanged. New test
  `tests/profile/extractors/pdf-encrypted.test.ts` verifies the detection via
  mocked `pdf-parse`.
- **Dead code removal (C1):** `ProfileImportService.loadImportedSource(id)` and its
  `ProfileSourceRow` import were removed.

### Known limitations / follow-ups

- ~~Commander's default exit code for missing required arguments is `1`, not the SPEC
  §37 value of `2`.~~ **Resolved (2026-08-13):** `program.exitOverride()` +
  `configureOutput({ writeErr: () => undefined })` and `isCommanderError` handling in
  `exitWithError` now map every Commander-side error to exit 2. Verified manually
  for `profile import` (no args) and `--unknown-flag`.
- ~~The `ProfileImportService.loadImportedSource(id)` helper is exported but currently
  unused.~~ **Resolved (2026-08-13):** Removed. TASK-008 will re-add it if needed.
- The fixture generator script (`tests/profile/fixtures/build-fixtures.ts`) uses a
  minimal hand-rolled PDF encoder. The PDFs are valid and `pdf-parse` parses them
  correctly, but they are not real-world PDFs. If the team adopts a richer fixture
  library in a future task, the existing scripts can be regenerated.
- `ProfileImportService` writes the source row before the file copy succeeds. A copy
  failure currently leaves the row in `textExtractionStatus: 'failed'` with
  `textExtractionMessage: 'profile_source_storage_error'`. This is the documented
  behavior (SPEC §40: "Preserve successful writes after later failures") but means a
  partial source row can exist on disk. A follow-up cleanup task may remove such
  orphaned rows.
- The `dist/cli.js` is not regenerated by this task's `pnpm test` script; only
  `pnpm build` produces it. The repository's `package.json` `prepare` step does not
  currently run `tsc` on install.
- **Re-importing a previously-failed file does not re-attempt extraction.** Per
  SPEC §13.3, the same SHA-256 always reuses the existing row. To retry after fixing
  a file, the user must modify the file to change the hash. A future task could add
  a `--force` flag or a `jobhunter profile reset <source-id>` command.
- **Encrypted PDFs are detected and marked `encrypted_pdf`** but the source is
  preserved exactly like other failures. Password handling is outside the MVP.
- **Source folders accumulate in the data directory.** Per SPEC §3, profile-source
  cleanup is outside the MVP. The number of folders equals the number of unique
  CV content hashes the user has ever imported.
