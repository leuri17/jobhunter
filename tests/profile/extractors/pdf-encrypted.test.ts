import { describe, expect, it, vi } from 'vitest';

describe('PdfExtractor encrypted PDF detection (mocked)', () => {
  it('returns encrypted_pdf when the parser throws a password-related error', async () => {
    vi.resetModules();
    vi.doMock('pdf-parse', () => ({
      PDFParse: class {
        constructor(_options: unknown) {
          // no-op
        }
        async getText(): Promise<{ text: string }> {
          const error = new Error('No password given');
          error.name = 'PasswordException';
          throw error;
        }
        async destroy(): Promise<void> {
          // no-op
        }
      },
    }));

    const { PdfExtractor } = await import('../../../src/profile/extractors/pdf.js');
    const extractor = new PdfExtractor();
    const result = await extractor.extract(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), // %PDF-1.4
    );
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.message).toBe('encrypted_pdf');
    }
    vi.doUnmock('pdf-parse');
    vi.resetModules();
  });

  it('returns malformed_pdf when the parser throws an InvalidPDFException', async () => {
    vi.resetModules();
    vi.doMock('pdf-parse', () => ({
      PDFParse: class {
        constructor(_options: unknown) {
          // no-op
        }
        async getText(): Promise<{ text: string }> {
          const error = new Error('Invalid PDF structure');
          error.name = 'InvalidPDFException';
          throw error;
        }
        async destroy(): Promise<void> {
          // no-op
        }
      },
    }));

    const { PdfExtractor } = await import('../../../src/profile/extractors/pdf.js');
    const extractor = new PdfExtractor();
    const result = await extractor.extract(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    );
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.message).toBe('malformed_pdf');
    }
    vi.doUnmock('pdf-parse');
    vi.resetModules();
  });
});
