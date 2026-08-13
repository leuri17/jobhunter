# TASK-007 Implementation Plan — CV Import, Immutable Source Persistence, and Local Text Extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
>
> **Status:** Implemented on 2026-08-13. All checkboxes are marked complete; the implementation matches the design captured in this plan (with the post-review revisions documented in `docs/tasks/TASK-007-cv-import-local-text-extraction.md`).

**Goal:** Build the local `jobhunter profile import` workflow plus the pure domain layer that detects source type, hashes bytes, copies files into OS-specific immutable storage, and extracts normalized text from PDF / Markdown / plain-text sources — all without any OpenAI call. Image-only PDFs are marked `ocr_required`; encrypted and malformed PDFs are marked `failed` with a documented reason. Imported source rows persist via the existing `ProfileSourceRepository` and are deduped by SHA-256 so re-imports reuse the existing record.

**Architecture:** A new `src/profile/` layer owns the profile-import domain. It is composed of small pure modules (`source-types`, `hashing`, `file-system`, `file-copy`, `text-normalize`, `extractors/*`) plus a thin `importer.ts` that orchestrates the import flow. The CLI registers a new `profile import` subcommand which calls `ProfileImportService` and prints a summary. `src/persistence/resolve-migrations.ts` resolves the migrations folder for the CLI binary. The `src/profile/` modules never import Commander, Inquirer, Playwright, OpenAI, or Drizzle; they only depend on `zod`, `pdf-parse` (PDF parsing), Node built-ins, and the typed repositories. The service depends on a `BinaryFileSystem` interface so the copy path can be tested with a fake filesystem.

**Tech Stack:** Adds `pdf-parse@2.4.5` (MIT, pure JS — the only new direct dependency; user-approved at plan time). Reuses `zod`, Node built-ins (`node:crypto`, `node:fs`, `node:fs/promises`, `node:path`), the existing `Repositories` facade, the existing `ProfileSourceRepository` (extended with `updateStoredPath`), and `vitest`. No new LLM provider, job source, UI framework, hosted service, or auth system.

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §6):** Files under `src/profile/` that are pure domain (`source-types.ts`, `hashing.ts`, `text-normalize.ts`, `extractors/plain-text.ts`, `extractors/markdown.ts`, `extractors/pdf.ts`, `extractors/index.ts`, `extractors/types.ts`) **must not** import Commander, Inquirer, Playwright, Drizzle, OpenAI, or Pino. They may import `zod`, `pdf-parse`, Node built-ins, and the typed repository contracts. `importer.ts` is the only file that depends on both the pure modules and the persistence layer.
- **Validation:** Zod at every external boundary. `SourceTypeSchema` and `extractedTextHash` enforce the documented shapes.
- **Errors:** Typed errors extending `ApplicationError` with `ExitCode.InvalidUsage` (2) for user-facing input problems. `ExtractionFailedError` is rethrown only for non-malformed/non-encrypted PDF errors that should bubble up as fatal.
- **Determinism:** SHA-256 hashing is deterministic. The text-normalization step is deterministic. The `textExtractionStatus: 'failed' | 'success' | 'pending'` and the per-row `textExtractionMessage` are persisted; a re-import reuses the row when the SHA-256 matches (per SPEC §13.3).
- **Tests:** Vitest. Pure-domain tests are deterministic. PDF extractor tests use committed fixtures; the encrypted-PDF test uses a mocked `pdf-parse` module. CLI smoke tests use the existing CLI test pattern with `cliFileSystem`. No live network. No live terminal.
- **No OpenAI calls in this task:** SPEC §13.2 explicitly says profile import stops before OpenAI; the `ProfileImportService` never instantiates an OpenAI client. OpenAI profile extraction is TASK-008.
- **CLI output:** `jobhunter profile import --json` (default `false`) emits a single JSON document to stdout. Human-readable errors go to stderr. The summary includes `extracted`, `failed`, and `reused` counts.

## File Structure

```
src/profile/
  errors.ts                # ProfileImportError + subclasses (Task 1)
  source-types.ts          # detectSourceTypeFromPath, mimeTypeFor, SourceTypeSchema (Task 2)
  hashing.ts               # hashString, hashFileContents (Task 3)
  file-system.ts           # BinaryFileSystem + createDefaultBinaryFileSystem (Task 4)
  file-copy.ts             # copySourceFileToStorage, defaultFilenameFor, resolveSourceStoragePath (Task 4)
  text-normalize.ts        # normalizeExtractedText, hashExtractedText, calculateExtractedTextStats (Task 5)
  extractors/
    types.ts               # Extractor + ExtractionResult (Task 6)
    plain-text.ts          # PlainTextExtractor (Task 6)
    markdown.ts            # MarkdownExtractor (Task 6)
    pdf.ts                 # PdfExtractor (Task 6)
    index.ts               # resolveExtractor, isSuccessfulExtraction (Task 6)
  importer.ts              # ProfileImportService (Task 7)
  index.ts                 # public re-exports (Task 8)
src/persistence/resolve-migrations.ts   # migrations folder resolver (Task 9)
src/persistence/repositories/profile-sources.ts  # MODIFIED: updateStoredPath + optional storedPath (Task 4)
src/cli.ts                 # MODIFIED: profile import subcommand + exitOverride + configureOutput (Task 9)
package.json               # MODIFIED: pdf-parse@2.4.5 (Task 1)
pnpm-lock.yaml             # regenerated by pnpm install
tests/profile/
  source-types.test.ts     # (Task 2)
  hashing.test.ts          # (Task 3)
  file-copy.test.ts        # (Task 4)
  text-normalize.test.ts   # (Task 5)
  errors.test.ts           # (Task 1)
  extractors/
    plain-text.test.ts     # (Task 6)
    markdown.test.ts       # (Task 6)
    pdf.test.ts            # (Task 6)
    pdf-encrypted.test.ts  # (Task 6, encrypted/malformed detection)
    index.test.ts          # (Task 6)
  importer.test.ts         # (Task 7)
tests/cli/profile-import.test.ts        # (Task 9)
tests/profile/fixtures/
  build-fixtures.ts        # PDF fixture generator (Task 6)
  pdf-encoder.ts           # minimal PDF builder (Task 6)
  text-pdf.pdf             # committed binary (Task 6)
  image-only.pdf           # committed binary (Task 6)
  malformed.pdf            # committed binary (Task 6)
tests/foundation.test.ts   # MODIFIED: extend command-name list to include `profile` (Task 9)
tests/persistence/repositories/profile-sources.test.ts  # MODIFIED: updateStoredPath test (Task 4)
```

Files change together by responsibility. The pure-domain modules (`source-types`, `hashing`, `text-normalize`, `extractors/*`) have **no** runtime dependencies on each other apart from `errors.ts` (used by `importer.ts`) and the small `extractors/types.ts` interface shared by all extractors. `importer.ts` is the only file that depends on both the pure modules and the persistence repositories.

---

### Task 1: Add `pdf-parse@2.4.5` and typed profile errors

**Files:**
- Modify: `package.json` (add `pdf-parse` to `dependencies`)
- Modify: `pnpm-lock.yaml` (regenerated by `pnpm install`)
- Create: `src/profile/errors.ts`

**Steps:**

- [x] **Step 1.1: Add `pdf-parse@2.4.5` to `package.json` dependencies**

```json
"dependencies": {
  "pdf-parse": "2.4.5",
  ...
}
```

Then run `pnpm install` to regenerate `pnpm-lock.yaml`. The package was approved at plan time (PDF library choice); this is a normal edit covered by the task.

- [x] **Step 1.2: Write `src/profile/errors.ts`**

Define `ProfileImportError` (exit code 2) and the documented subclasses:
`UnsupportedSourceFormatError` (`unsupported_format`),
`SourceUnreadableError` (`source_unreadable`),
`ExtractionFailedError` (`extraction_failed`),
`OcrRequiredError` (`ocr_required`),
`InvalidArgumentCountError` (`invalid_argument_count`),
`ProfileSourceStorageError` (`profile_source_storage_error`).
Each accepts `(message, metadata?, cause?)`; the cause parameter is preserved via `ApplicationError.cause`.

- [x] **Step 1.3: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0 ✅

- [x] **Step 1.4: Write `tests/profile/errors.test.ts`**

7 tests verifying codes, exit codes, and cause preservation for each subclass.

- [x] **Step 1.5: Run tests**

Run: `pnpm test -- tests/profile/errors.test.ts`
Expected: 7 pass ✅

---

### Task 2: Source-type detection and Zod schema

**Files:**
- Create: `src/profile/source-types.ts`
- Create: `tests/profile/source-types.test.ts`

**Interfaces:**

```ts
export const SUPPORTED_SOURCE_TYPES = ['pdf', 'markdown', 'plain_text'] as const;
export type SourceType = (typeof SUPPORTED_SOURCE_TYPES)[number];

export const SourceTypeSchema: z.ZodEnum<['pdf', 'markdown', 'plain_text']>;

export function detectSourceTypeFromPath(absolutePath: string): SourceType;
export function mimeTypeFor(sourceType: SourceType): string;
```

**Behavior rules (SPEC §13.1):**

- Supported extensions (case-insensitive): `.pdf`, `.md`, `.markdown`, `.txt`.
- `detectSourceTypeFromPath` trims the path, lowercases the extension, and looks it up in a static map.
- Unknown or empty extensions raise `UnsupportedSourceFormatError` with the original path in metadata.
- `mimeTypeFor('pdf')` → `application/pdf`; `markdown` → `text/markdown`; `plain_text` → `text/plain; charset=utf-8`.

**Steps:**

- [x] **Step 2.1: Write the failing test** in `tests/profile/source-types.test.ts` (11 tests).

- [x] **Step 2.2: Implement `src/profile/source-types.ts`** using `path.extname` + a static `EXTENSION_MAP` and the Zod enum.

- [x] **Step 2.3: Run tests**

Run: `pnpm test -- tests/profile/source-types.test.ts`
Expected: 11 pass ✅

---

### Task 3: SHA-256 stream hashing

**Files:**
- Create: `src/profile/hashing.ts`
- Create: `tests/profile/hashing.test.ts`

**Interfaces:**

```ts
export type ByteStream = AsyncIterable<Uint8Array> | NodeJS.ReadableStream;

export function hashString(text: string): string;        // returns 64-char lowercase hex
export function hashFileContents(stream: ByteStream): Promise<string>;
```

**Behavior rules:**

- Uses `node:crypto` `createHash('sha256')`.
- The empty input returns the canonical empty digest `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `hashString('hello')` returns `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.
- Stream chunks are concatenated by `for await ... of`.

**Steps:**

- [x] **Step 3.1: Write the failing test** in `tests/profile/hashing.test.ts` (7 tests).

- [x] **Step 3.2: Implement `src/profile/hashing.ts`** with `hashString` and `hashFileContents`.

- [x] **Step 3.3: Run tests**

Run: `pnpm test -- tests/profile/hashing.test.ts`
Expected: 7 pass ✅

---

### Task 4: Binary file system + atomic copy + materialized path + repository mutation

**Files:**
- Create: `src/profile/file-system.ts`
- Create: `src/profile/file-copy.ts`
- Create: `tests/profile/file-copy.test.ts`
- Modify: `src/persistence/repositories/profile-sources.ts` (add `updateStoredPath`, make `storedPath` optional)
- Modify: `tests/persistence/repositories/profile-sources.test.ts` (extend with `updateStoredPath` test)

**Interfaces:**

```ts
// src/profile/file-system.ts
export interface BinaryFileSystem {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}
export function createDefaultBinaryFileSystem(): BinaryFileSystem;

// src/profile/file-copy.ts
export function resolveSourceStoragePath(
  paths: PlatformPaths,
  sourceId: number,
  originalFilename: string,
): string; // returns `${paths.profileSources.directory}/${sourceId}/${filename}`

export function defaultFilenameFor(sourceType: SourceType, originalPath: string): string;
export interface CopySourceFileOptions {
  readonly sourcePath: string;
  readonly destination: string;
  readonly fileSystem: BinaryFileSystem;
}
export async function copySourceFileToStorage(options: CopySourceFileOptions): Promise<void>;
```

**Behavior rules (SPEC §13.4):**

- Storage path is always `${profileSources.directory}/${sourceId}/${filename}`.
- `defaultFilenameFor` returns `path.basename(originalPath)`, falling back to `cv.pdf` / `cv.md` / `cv.txt` for empty basenames.
- `copySourceFileToStorage`:
  1. Verifies the source exists; otherwise throws `SourceUnreadableError`.
  2. Creates the parent directory recursively.
  3. Writes bytes to a sibling `.tmp` path, then `rename`s to the destination.
  4. On failure, best-effort cleans up the `.tmp` file and throws `ProfileSourceStorageError` (or `SourceUnreadableError` for ENOENT).
- `ProfileSourceRepository.insert` accepts a payload without `storedPath` (defaulting to `''`).
- `ProfileSourceRepository.updateStoredPath(id, path)` is a new method that updates the row in place.

**Steps:**

- [x] **Step 4.1: Write `src/profile/file-system.ts`** with `BinaryFileSystem` and the default implementation backed by `node:fs/promises`.

- [x] **Step 4.2: Write the failing test** in `tests/profile/file-copy.test.ts` (8 tests covering path resolution, default filenames, atomic copy, failure cleanup).

- [x] **Step 4.3: Implement `src/profile/file-copy.ts`** with `resolveSourceStoragePath`, `defaultFilenameFor`, and `copySourceFileToStorage`.

- [x] **Step 4.4: Modify `src/persistence/repositories/profile-sources.ts`**:
  - Make `ProfileSourceInsert.storedPath` optional (default `''`).
  - Add `async updateStoredPath(id: number, storedPath: string): Promise<void>`.

- [x] **Step 4.5: Add `updateStoredPath` test** to `tests/persistence/repositories/profile-sources.test.ts`.

- [x] **Step 4.6: Run tests**

Run: `pnpm test -- tests/profile/file-copy.test.ts tests/persistence/repositories/profile-sources.test.ts`
Expected: 13 pass ✅

---

### Task 5: Text normalization

**Files:**
- Create: `src/profile/text-normalize.ts`
- Create: `tests/profile/text-normalize.test.ts`

**Interfaces:**

```ts
export function normalizeExtractedText(input: string): string;
export function hashExtractedText(text: string): string;
export interface ExtractedTextStats {
  readonly normalizedLength: number;
  readonly lineCount: number;
}
export function calculateExtractedTextStats(text: string): ExtractedTextStats;
```

**Behavior rules:**

- Strip a UTF-8 BOM at the start of the input.
- Replace `\r\n` and `\r` with `\n`.
- Collapse runs of 3+ blank lines to 2 blank lines.
- Trim trailing whitespace on each line.
- Trim trailing newlines from the end.
- Return `''` for empty or whitespace-only input.
- `hashExtractedText` is `hashString(normalizeExtractedText(text))`.
- `calculateExtractedTextStats` returns `{ normalizedLength, lineCount }` (line count of the normalized text).

**Steps:**

- [x] **Step 5.1: Write the failing test** in `tests/profile/text-normalize.test.ts` (14 tests).

- [x] **Step 5.2: Implement `src/profile/text-normalize.ts`** with the normalization pipeline.

- [x] **Step 5.3: Run tests**

Run: `pnpm test -- tests/profile/text-normalize.test.ts`
Expected: 14 pass ✅

---

### Task 6: Text and PDF extractors (with encrypted-PDF detection)

**Files:**
- Create: `src/profile/extractors/types.ts`
- Create: `src/profile/extractors/plain-text.ts`
- Create: `src/profile/extractors/markdown.ts`
- Create: `src/profile/extractors/pdf.ts`
- Create: `src/profile/extractors/index.ts`
- Create: `tests/profile/extractors/plain-text.test.ts`
- Create: `tests/profile/extractors/markdown.test.ts`
- Create: `tests/profile/extractors/pdf.test.ts`
- Create: `tests/profile/extractors/pdf-encrypted.test.ts`
- Create: `tests/profile/extractors/index.test.ts`
- Create: `tests/profile/fixtures/build-fixtures.ts`
- Create: `tests/profile/fixtures/pdf-encoder.ts`
- Commit: `tests/profile/fixtures/text-pdf.pdf`, `image-only.pdf`, `malformed.pdf` (binary)

**Interfaces:**

```ts
// src/profile/extractors/types.ts
export type ExtractionResult =
  | { readonly status: 'success'; readonly text: string; readonly warnings: readonly string[] }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ocr_required'; readonly message: string };

export interface Extractor {
  extract(bytes: Uint8Array): Promise<ExtractionResult>;
}
export function isSuccessfulExtraction(
  result: ExtractionResult,
): result is { status: 'success'; text: string; warnings: readonly string[] };

// src/profile/extractors/index.ts
export function resolveExtractor(sourceType: SourceType): Extractor;
```

**Behavior rules (SPEC §13.1, §13.5):**

- `PlainTextExtractor` decodes UTF-8 with replacement characters; never throws.
- `MarkdownExtractor` delegates to plain-text and records a warning for external image references.
- `PdfExtractor` uses `pdf-parse@2.4.5` (`new PDFParse({ data })`, then `getText({ pageJoiner: '' })` to suppress the page-boundary marker).
  - Empty bytes → `{ status: 'failed', message: 'empty_pdf' }`.
  - Whitespace-only output → `{ status: 'ocr_required', message: '...' }`.
  - `InvalidPDFException` (or any error whose message contains `invalid pdf` / `invalidpdf` / `malformed pdf`) → `{ status: 'failed', message: 'malformed_pdf' }`.
  - `PasswordException` (or any error whose message contains `password` / `encrypted`) → `{ status: 'failed', message: 'encrypted_pdf' }`.
  - Other errors → throw `ExtractionFailedError` (fatal, exit 1).
- `resolveExtractor` returns the right extractor for each source type and throws for unknown.

**PDF fixtures (Task 6.0 — pre-step):**

`tests/profile/fixtures/build-fixtures.ts` is a one-shot script that writes three minimal valid PDFs into the fixtures directory:
- `text-pdf.pdf` — a single page that paints the literal text "Hello JobHunter" via a `BT /F1 12 Tf 100 700 Td (Hello JobHunter) Tj ET` content stream.
- `image-only.pdf` — a single page that contains only a `0 0 612 792 re f` (filled rectangle) content stream with no text operators. `pdf-parse` returns only the page-boundary marker text (suppressed via `pageJoiner: ''`).
- `malformed.pdf` — 32 bytes that begin with the `%PDF-1.4` magic but contain no parseable structure. `pdf-parse` throws `InvalidPDFException` ("Invalid PDF structure.").

The fixtures are generated by `tests/profile/fixtures/build-fixtures.ts` using a minimal hand-rolled PDF encoder (`tests/profile/fixtures/pdf-encoder.ts`). The build script is not run as part of the test suite; the binaries are committed.

**Steps:**

- [x] **Step 6.0: Generate the three PDF fixtures**

Run: `pnpm tsx tests/profile/fixtures/build-fixtures.ts`
Expected: writes `text-pdf.pdf`, `image-only.pdf`, `malformed.pdf` into `tests/profile/fixtures/`.

- [x] **Step 6.1: Write `src/profile/extractors/types.ts`**

Define `ExtractionResult`, `Extractor`, and `isSuccessfulExtraction`.

- [x] **Step 6.2: Write `src/profile/extractors/plain-text.ts` and `markdown.ts`**

`PlainTextExtractor` decodes UTF-8 with `fatal: false`. `MarkdownExtractor` delegates and adds a warning when external image references are present.

- [x] **Step 6.3: Write the failing tests** in `tests/profile/extractors/plain-text.test.ts` (4 tests) and `markdown.test.ts` (4 tests).

- [x] **Step 6.4: Write `src/profile/extractors/pdf.ts`** with the encrypted-PDF detection path (E1) layered before the malformed-PDF detection.

- [x] **Step 6.5: Write the failing tests** in `tests/profile/extractors/pdf.test.ts` (4 tests with the real fixtures) and `pdf-encrypted.test.ts` (2 tests with mocked `pdf-parse`).

- [x] **Step 6.6: Write `src/profile/extractors/index.ts`** with `resolveExtractor` and re-exports.

- [x] **Step 6.7: Write the failing test** in `tests/profile/extractors/index.test.ts` (5 tests).

- [x] **Step 6.8: Run all extractor tests**

Run: `pnpm test -- tests/profile/extractors/`
Expected: 19 pass ✅

---

### Task 7: `ProfileImportService` orchestration

**Files:**
- Create: `src/profile/importer.ts`
- Create: `tests/profile/importer.test.ts`

**Interfaces:**

```ts
export interface ImportedSource {
  readonly id: number;
  readonly path: string;
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly sha256: string;
  readonly fileSize: number;
  readonly storedPath: string;
  readonly textExtractionStatus: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage: string | null;
  readonly extractedTextHash: string | null;
  readonly reused: boolean;
  readonly warnings: readonly string[];
}

export interface ProfileImportCounts {
  readonly total: number;
  readonly extracted: number;
  readonly failed: number;
  readonly reused: number;
}

export type ProfileImportStatus = 'success' | 'partial' | 'failure';

export interface ProfileImportResult {
  readonly status: ProfileImportStatus;
  readonly counts: ProfileImportCounts;
  readonly sources: readonly ImportedSource[];
  readonly failedSourcePaths: readonly string[];
}

export interface ProfileImportLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface ProfileImportServiceOptions {
  readonly paths: PlatformPaths;
  readonly repositories: Repositories;
  readonly fileSystem?: BinaryFileSystem;
  readonly now?: () => Date;
  readonly logger?: ProfileImportLogger;
}

export class ProfileImportService {
  constructor(options: ProfileImportServiceOptions);
  async importSources(rawPaths: readonly string[]): Promise<ProfileImportResult>;
}
```

**Behavior rules (SPEC §13.2, §13.3, §13.4, §13.5):**

1. Validate argument count: 1 or 2. Throw `InvalidArgumentCountError` otherwise.
2. For each path:
   1. Resolve the absolute path; detect the source type.
   2. Verify the file exists (`SourceUnreadableError` if not).
   3. Stream-hash the file (SHA-256) and capture `fileSize`.
   4. Look up `profileSources.findBySha256`. If present, return the existing record with `reused: true`.
   5. Otherwise:
      - Insert a `pending` row.
      - Resolve the storage path, then `updateStoredPath` with the new path.
      - Copy the file atomically. On copy failure, record `textExtractionStatus: 'failed'` with `textExtractionMessage: 'profile_source_storage_error'`.
      - Read the stored bytes and run the extractor.
      - On `success`, write the normalized text hash and `'success'`.
      - On `ocr_required`, `encrypted_pdf`, or `malformed_pdf`, record the corresponding reason.
3. Compute `status`:
   - `failure` if no sources were imported (defensive — argument validation already prevents this).
   - `success` if every source is `success`.
   - `partial` if at least one source is `success` and at least one is `failed`.
   - `failure` if every source is `failed`.
4. Compute `counts: { total, extracted, failed, reused }` over the result list.
5. The service never calls OpenAI.

**Steps:**

- [x] **Step 7.1: Write the failing tests** in `tests/profile/importer.test.ts` (9 tests covering single + batch import, dedup, partial success, copy failure resilience, and invalid argument count).

- [x] **Step 7.2: Implement `src/profile/importer.ts`** with `ProfileImportService` and the helper types above.

- [x] **Step 7.3: Run tests**

Run: `pnpm test -- tests/profile/importer.test.ts`
Expected: 9 pass ✅

---

### Task 8: `src/profile/index.ts` public exports

**Files:**
- Create: `src/profile/index.ts`

**Steps:**

- [x] **Step 8.1: Write `src/profile/index.ts`** re-exporting the public surface:

  - `SourceType` and helpers from `source-types.ts`
  - All error classes from `errors.ts`
  - `hashFileContents`, `hashString` from `hashing.ts`
  - `normalizeExtractedText`, `hashExtractedText`, `calculateExtractedTextStats` from `text-normalize.ts`
  - `resolveExtractor`, `isSuccessfulExtraction`, `ExtractionResult`, `Extractor` from `extractors/index.ts`
  - `ProfileImportService` and the result / counts / status / logger / options types from `importer.ts`
  - `BinaryFileSystem`, `createDefaultBinaryFileSystem` from `file-system.ts`
  - `copySourceFileToStorage`, `defaultFilenameFor`, `resolveSourceStoragePath` from `file-copy.ts`

- [x] **Step 8.2: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0 ✅

---

### Task 9: CLI wiring + `resolveRepoRootForMigrations` + foundation test update

**Files:**
- Create: `src/persistence/resolve-migrations.ts`
- Modify: `src/cli.ts` (add `profile` group + `import` subcommand, add `exitOverride()` + `configureOutput`, update `exitWithError`, add `isCommanderError` helper)
- Modify: `tests/foundation.test.ts` (extend command-name list to include `profile`)
- Create: `tests/cli/profile-import.test.ts`

**`src/persistence/resolve-migrations.ts`:**

```ts
export function resolveRepoRoot(): string;          // .../<repo>
export function resolveRepoRootForMigrations(): string; // .../<repo>/drizzle
```

Uses `import.meta.url` so the binary at `dist/cli.js` and the source at `src/cli.ts` both resolve to the repo root.

**`src/cli.ts` changes:**

- Add `program.exitOverride()` and `program.configureOutput({ writeErr: () => undefined })` so Commander throws instead of exiting. `exitWithError` catches `CommanderError` (any error whose `code` starts with `commander.`) and exits 2.
- Update `exitWithError` to print `<error.code>: <error.message>` for `ApplicationError` and propagate Commander's `error: <message>` format unchanged.
- Register the `profile` group and `profile import` subcommand:
  - Arguments: `<path>` (required) and `[path]` (optional second).
  - Option: `--json` (default `false`).
  - **No `--paste` flag is registered** — Commander rejects it natively with `error: unknown option '--paste'`, exit 2.
- `profileImportCommand`:
  - Resolves platform paths and initializes the database.
  - Constructs `Repositories` and `ProfileImportService`.
  - Calls `service.importSources(rawPaths)`.
  - On JSON, emits a single JSON document with `schemaVersion: 1`, `status`, `counts`, the `sources` array, and `failedSourcePaths`.
  - Otherwise, prints a human-readable summary:
    ```
    status: success
      extracted: 1
      failed: 0
      reused: 0
      source_1  success  cv.md
    ```
    Reused lines use `reused-success` / `reused-failed` / `reused-pending` to surface the underlying status.

**Steps:**

- [x] **Step 9.1: Write `src/persistence/resolve-migrations.ts`**.

- [x] **Step 9.2: Update `src/cli.ts`**:
  - Add `exitOverride()` + `configureOutput` to the program.
  - Add `isCommanderError` and update `exitWithError`.
  - Add the `profile` group + `import` subcommand.
  - Add the `profileImportCommand` function.
  - Update the re-exports at the bottom of the file.

- [x] **Step 9.3: Update `tests/foundation.test.ts`** to expect `['paths', 'config', 'configure', 'profile']`.

- [x] **Step 9.4: Write `tests/cli/profile-import.test.ts`** (8 tests) covering:
  - Missing required argument → exit 2, `error: missing required argument 'path'`.
  - Unreadable file → exit 2, `source_unreadable: Source file does not exist: ...`.
  - Successful import → exit 0, stdout contains `source_1`, `success`, `extracted: 1`.
  - JSON output → exit 0, single JSON document with `schemaVersion: 1` and `counts`.
  - Reuse → exit 0, stdout contains `reused-success` and `reused: 1`.
  - `--paste` rejected by Commander → exit 2, `error: unknown option '--paste'`.
  - Application error code in stderr → `source_unreadable:` visible.
  - Mixed batch with counts → `status: partial`, `extracted: 1`, `failed: 1`, `reused: 1`, `reused-failed`, `(ocr_required)`.

  The test runner patches `process.exit` to capture the exit code and must also catch `CommanderError` (since `exitOverride` replaces `process.exit` with a `throw`).

- [x] **Step 9.5: Run all tests**

Run: `pnpm test`
Expected: 321 pass across 56 files ✅

---

### Task 10: Run full verification suite

**Steps:**

- [x] **Step 10.1: `pnpm lint`**
Expected: exit 0 ✅

- [x] **Step 10.2: `pnpm typecheck`**
Expected: exit 0 ✅

- [x] **Step 10.3: `pnpm build`**
Expected: exit 0 ✅

- [x] **Step 10.4: `pnpm test`**
Expected: 321/321 tests pass across 56 files ✅

- [x] **Step 10.5: Manual CLI smoke checks** (each command run from a clean temporary `HOME`):

```bash
HOME=/tmp/jh-final-$$ node dist/cli.js profile import <valid.md>
# expected: exit 0, `status: success`, `extracted: 1`, `failed: 0`, `reused: 0`, `source_1  success  cv.md`

HOME=/tmp/jh-final-$$ node dist/cli.js profile import --json <valid.md>
# expected: exit 0, single JSON document with schemaVersion: 1, status: success, counts

HOME=/tmp/jh-final-$$ node dist/cli.js profile import <valid.md>   # re-import the same file
# expected: exit 0, `source_1  reused-success  cv.md`, `reused: 1`

HOME=/tmp/jh-final-$$ node dist/cli.js profile import --paste <valid.md>
# expected: exit 2, `error: unknown option '--paste'`

HOME=/tmp/jh-final-$$ node dist/cli.js profile import <missing.md>
# expected: exit 2, `source_unreadable: Source file does not exist: <path>`

HOME=/tmp/jh-final-$$ node dist/cli.js profile import <image-only.pdf>
# expected: exit 0, `status: failure`, `failed: 1`, `source_2  failed  image-only.pdf (ocr_required)`

HOME=/tmp/jh-final-$$ node dist/cli.js profile import <valid.md> <image-only.pdf>
# expected: exit 0, `status: partial`, `extracted: 1`, `failed: 1`, `reused: 2`, `reused-failed`, `(ocr_required)`

HOME=/tmp/jh-final-$$ node dist/cli.js profile import
# expected: exit 2, `error: missing required argument 'path'`

HOME=/tmp/jh-final-$$ node dist/cli.js --unknown-flag
# expected: exit 2, `error: unknown option '--unknown-flag'`
```

All commands observed exit 2 for invalid usage and exit 0 for recoverable outcomes. ✅

---

## Test inventory (40 new tests across 12 files for TASK-007)

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
- `tests/profile/extractors/pdf-encrypted.test.ts` — 2 tests (mocked encrypted +
  malformed)
- `tests/profile/extractors/index.test.ts` — 5 tests (factory + helper)
- `tests/profile/errors.test.ts` — 7 tests (typed error codes, exit codes, cause)
- `tests/profile/importer.test.ts` — 9 tests (single/batch import, dedup, partial,
  copy failure resilience)
- `tests/cli/profile-import.test.ts` — 8 tests (CLI: argument rejection, missing
  file, success, --json, reuse, --paste rejected, error code in stderr, mixed batch)

Plus the existing `tests/persistence/repositories/profile-sources.test.ts` was extended
with one new test for `updateStoredPath`.

## Notes for the implementer

- The PDF parser API is class-based (`new PDFParse({ data })` then `getText()`). The
  `pageJoiner: ''` option suppresses the default page-boundary marker so the
  OCR-required detection works on whitespace-only output.
- `ProfileImportService` writes the source row before the file copy succeeds. A copy
  failure leaves a `textExtractionStatus: 'failed'` row with
  `textExtractionMessage: 'profile_source_storage_error'`. This is documented
  per SPEC §40.
- The `--paste` flag is intentionally **not** registered. Commander rejects it
  natively with exit code 2.
- The `ProfileImportService` never calls OpenAI; that is TASK-008.
- `ProfileImportService.loadImportedSource(id)` was **removed** during the
  post-review pass (C1). It was unused dead code; TASK-008 will re-add it if needed.
