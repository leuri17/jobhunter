# TASK-007 — CV Import, Immutable Source Persistence, and Local Text Extraction

**Status:** Planned; not approved for implementation
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
