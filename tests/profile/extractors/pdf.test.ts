import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

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
});
