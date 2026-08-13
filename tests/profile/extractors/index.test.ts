import { describe, expect, it } from 'vitest';

import { isSuccessfulExtraction, resolveExtractor } from '../../../src/profile/extractors/index.js';
import { MarkdownExtractor } from '../../../src/profile/extractors/markdown.js';
import { PdfExtractor } from '../../../src/profile/extractors/pdf.js';
import { PlainTextExtractor } from '../../../src/profile/extractors/plain-text.js';

describe('resolveExtractor', () => {
  it('returns the PDF extractor for pdf sources', () => {
    expect(resolveExtractor('pdf')).toBeInstanceOf(PdfExtractor);
  });

  it('returns the Markdown extractor for markdown sources', () => {
    expect(resolveExtractor('markdown')).toBeInstanceOf(MarkdownExtractor);
  });

  it('returns the PlainText extractor for plain_text sources', () => {
    expect(resolveExtractor('plain_text')).toBeInstanceOf(PlainTextExtractor);
  });
});

describe('isSuccessfulExtraction', () => {
  it('returns true for successful extraction results', () => {
    expect(isSuccessfulExtraction({ status: 'success', text: 'x', warnings: [] })).toBe(true);
  });

  it('returns false for failed and ocr_required results', () => {
    expect(isSuccessfulExtraction({ status: 'failed', message: 'x' })).toBe(false);
    expect(isSuccessfulExtraction({ status: 'ocr_required', message: 'x' })).toBe(false);
  });
});
