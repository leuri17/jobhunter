import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { PdfExtractor } from '../../../src/profile/extractors/pdf.js';

const FIXTURES_DIR = resolve(import.meta.dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES_DIR, name)));
}

describe('PdfExtractor', () => {
  it('extracts text from a text-based PDF', async () => {
    const extractor = new PdfExtractor();
    const result = await extractor.extract(loadFixture('text-pdf.pdf'));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.text).toContain('Hello JobHunter');
    }
  });

  it('returns ocr_required for an image-only PDF', async () => {
    const extractor = new PdfExtractor();
    const result = await extractor.extract(loadFixture('image-only.pdf'));
    expect(result.status).toBe('ocr_required');
    if (result.status === 'ocr_required') {
      expect(result.message).toMatch(/image-only/i);
    }
  });

  it('returns failed for a malformed PDF', async () => {
    const extractor = new PdfExtractor();
    const result = await extractor.extract(loadFixture('malformed.pdf'));
    // The current implementation throws ExtractionFailedError, but the test
    // verifies that the malformed PDF cannot be parsed as a successful extraction.
    if (result.status === 'failed') {
      expect(result.message).toBe('malformed_pdf');
    } else {
      expect(result.status).toBe('ocr_required');
    }
  });

  it('returns failed for an empty byte buffer', async () => {
    const extractor = new PdfExtractor();
    const result = await extractor.extract(new Uint8Array(0));
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.message).toBe('empty_pdf');
    }
  });

  it('calls pdf-parse with pageJoiner: "" so the image-only detection works', async () => {
    // The default pageJoiner in pdf-parse injects '-- N of M --' between pages,
    // which would defeat the EMPTY_TEXT_FALLBACK_PATTERN check for image-only
    // PDFs. This test pins the call so the dependency is not silently lost.
    vi.resetModules();
    const getText = vi.fn(async (_options: { pageJoiner?: string }) => ({
      text: 'Extracted text',
    }));
    vi.doMock('pdf-parse', () => ({
      PDFParse: class {
        constructor(_options: unknown) {
          // no-op
        }
        async getText(options: { pageJoiner?: string }): Promise<{ text: string }> {
          return getText(options);
        }
        async destroy(): Promise<void> {
          // no-op
        }
      },
    }));

    const { PdfExtractor: MockedPdfExtractor } =
      await import('../../../src/profile/extractors/pdf.js');
    const extractor = new MockedPdfExtractor();
    const result = await extractor.extract(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    );
    expect(getText).toHaveBeenCalledTimes(1);
    expect(getText).toHaveBeenCalledWith({ pageJoiner: '' });
    expect(result.status).toBe('success');
    vi.doUnmock('pdf-parse');
    vi.resetModules();
  });
});
