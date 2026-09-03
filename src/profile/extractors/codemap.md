# src/profile/extractors/

## Responsibility

Implements the source-format strategies used to extract resume/CV content from raw file bytes.
Markdown and plain-text sources are decoded as UTF-8, while PDFs are parsed for embedded text.
All strategies return the shared `ExtractionResult` union so callers can handle success and failure uniformly.

## Design

- Follows the Strategy pattern through the `Extractor` interface in `types.ts`.
- `Extractor.extract(bytes: Uint8Array)` is the common asynchronous format-independent entry point.
- `ExtractionResult` is a discriminated union with `success`, `failed`, and `ocr_required` statuses.
- `isSuccessfulExtraction` narrows successful results to text plus warnings.
- `index.ts` is the strategy registry: `resolveExtractor(sourceType)` maps `SourceType` values to instances.
- The exhaustive `resolveExtractor` default throws `UnsupportedSourceFormatError` for unknown values.
- `markdown.ts` exports `MarkdownExtractor`, the logical `extractMarkdown` step implemented by `extract`.
- `pdf.ts` exports `PdfExtractor`, the logical `extractPdf` step implemented by `extract`.
- `plain-text.ts` exports `PlainTextExtractor`, the logical `extractPlainText` step implemented by `extract`.

## Flow

1. File-type detection runs upstream and produces a supported `SourceType` (`pdf`, `markdown`, or `plain_text`).
2. `ExtractionService` calls `resolveExtractor(sourceType)` to obtain the matching strategy.
3. The caller supplies source bytes to the selected `Extractor.extract` method.
4. `MarkdownExtractor` decodes UTF-8 bytes and warns about external image references.
5. `PlainTextExtractor` decodes UTF-8 bytes and returns the normalized text without warnings.
6. `PdfExtractor` rejects empty input, parses with `pdf-parse`, and classifies malformed or encrypted documents.
7. A PDF without extractable text returns `ocr_required` instead of pretending extraction succeeded.
8. The service receives `ExtractionResult` and routes its normalized text to structured profile extraction.
9. OpenAI-backed processing in `src/profile/openai/` converts extracted resume content into profile data.

## Integration

- The primary consumer is `src/profile/extraction-service.ts`, which imports and calls `resolveExtractor`.
- File-type detection and source classification happen before extraction, so extractors do not perform type sniffing.
- `SourceType` is defined upstream in `src/profile/source-types.ts` and constrains registry selection.
- Domain errors from `src/profile/errors.ts` normalize unsupported formats and unexpected PDF failures.
- `src/profile/extractors/index.ts` is the public facade for `resolveExtractor`, `Extractor`, `ExtractionResult`, and `isSuccessfulExtraction`.
- Extractors return extracted text only; structured CV fields are produced downstream by the OpenAI integration.
