import { PDFParse } from 'pdf-parse';

import { ExtractionFailedError } from '../errors.js';
import type { ExtractionResult, Extractor } from './types.js';

const EMPTY_TEXT_FALLBACK_PATTERN = /^[\s]*$/;

const MALFORMED_PDF_NAMES: ReadonlySet<string> = new Set([
  'InvalidPDFException',
  'MissingPDFException',
  'UnexpectedResponseException',
]);

const ENCRYPTED_PDF_NAMES: ReadonlySet<string> = new Set(['PasswordException']);

function isMalformedPdfError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const name = cause.name;
  if (MALFORMED_PDF_NAMES.has(name)) return true;
  const message = cause.message.toLowerCase();
  return (
    message.includes('invalid pdf') ||
    message.includes('invalidpdf') ||
    message.includes('malformed pdf')
  );
}

function isEncryptedPdfError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const name = cause.name;
  if (ENCRYPTED_PDF_NAMES.has(name)) return true;
  const message = cause.message.toLowerCase();
  return (
    message.includes('password') ||
    message.includes('encrypted') ||
    message.includes('owner password') ||
    message.includes('user password')
  );
}

export class PdfExtractor implements Extractor {
  async extract(bytes: Uint8Array): Promise<ExtractionResult> {
    if (bytes.byteLength === 0) {
      return {
        status: 'failed',
        message: 'empty_pdf',
      };
    }

    // Copy the bytes so pdf-parse's transfer of the underlying buffer to its
    // worker thread does not invalidate the caller's buffer.
    const buffer = new Uint8Array(bytes.byteLength);
    buffer.set(bytes);

    let parser: PDFParse | null = null;
    let rawText: string;
    try {
      parser = new PDFParse({ data: buffer });
      // The empty pageJoiner is required for the EMPTY_TEXT_FALLBACK_PATTERN
      // below to detect image-only PDFs. The default pageJoiner is '-- N of M --'
      // which would make a whitespace-only PDF produce a non-empty string,
      // defeating the image-only detection. If you change this, update the
      // matching assertion in tests/profile/extractors/pdf.test.ts.
      const result = await parser.getText({ pageJoiner: '' });
      rawText = result.text ?? '';
    } catch (cause) {
      if (isEncryptedPdfError(cause)) {
        return {
          status: 'failed',
          message: 'encrypted_pdf',
        };
      }
      if (isMalformedPdfError(cause)) {
        return {
          status: 'failed',
          message: 'malformed_pdf',
        };
      }
      throw new ExtractionFailedError(
        `PDF text extraction failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { byteLength: bytes.byteLength },
        cause instanceof Error ? cause : undefined,
      );
    } finally {
      if (parser !== null) {
        try {
          await parser.destroy();
        } catch {
          // best-effort cleanup
        }
      }
    }

    if (EMPTY_TEXT_FALLBACK_PATTERN.test(rawText)) {
      return {
        status: 'ocr_required',
        message: 'PDF contains no extractable text; it appears to be image-only.',
      };
    }

    return {
      status: 'success',
      text: rawText,
      warnings: [],
    };
  }
}
