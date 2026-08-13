import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_SOURCE_TYPES,
  SourceTypeSchema,
  detectSourceTypeFromPath,
  mimeTypeFor,
} from '../../src/profile/source-types.js';
import { UnsupportedSourceFormatError } from '../../src/profile/errors.js';

describe('detectSourceTypeFromPath', () => {
  it('detects PDF from .pdf extension (case-insensitive)', () => {
    expect(detectSourceTypeFromPath('/tmp/cv.pdf')).toBe('pdf');
    expect(detectSourceTypeFromPath('/tmp/CV.PDF')).toBe('pdf');
    expect(detectSourceTypeFromPath('/tmp/Cv.Pdf')).toBe('pdf');
  });

  it('detects Markdown from .md and .markdown extensions', () => {
    expect(detectSourceTypeFromPath('/tmp/cv.md')).toBe('markdown');
    expect(detectSourceTypeFromPath('/tmp/cv.MARKDOWN')).toBe('markdown');
    expect(detectSourceTypeFromPath('/tmp/profile.markdown')).toBe('markdown');
  });

  it('detects plain text from .txt extension', () => {
    expect(detectSourceTypeFromPath('/tmp/cv.txt')).toBe('plain_text');
    expect(detectSourceTypeFromPath('/tmp/cv.TXT')).toBe('plain_text');
  });

  it('strips trailing whitespace before detecting the extension', () => {
    expect(detectSourceTypeFromPath('/tmp/cv.md   ')).toBe('markdown');
  });

  it('rejects empty strings with unsupported_format', () => {
    expect(() => detectSourceTypeFromPath('')).toThrow(UnsupportedSourceFormatError);
  });

  it('rejects unknown extensions with unsupported_format', () => {
    expect(() => detectSourceTypeFromPath('/tmp/cv.docx')).toThrow(UnsupportedSourceFormatError);
    expect(() => detectSourceTypeFromPath('/tmp/cv')).toThrow(UnsupportedSourceFormatError);
  });

  it('rejects paths that resolve to directories with unsupported_format', () => {
    expect(() => detectSourceTypeFromPath('/tmp')).toThrow(UnsupportedSourceFormatError);
    expect(() => detectSourceTypeFromPath('/tmp/.')).toThrow(UnsupportedSourceFormatError);
  });

  it('attached UnsupportedSourceFormatError metadata includes the original path', () => {
    try {
      detectSourceTypeFromPath('/tmp/cv.docx');
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSourceFormatError);
      if (error instanceof UnsupportedSourceFormatError) {
        expect(error.code).toBe('unsupported_format');
        expect(error.metadata).toMatchObject({ path: '/tmp/cv.docx' });
      }
    }
  });
});

describe('mimeTypeFor', () => {
  it('returns the canonical MIME type for each supported type', () => {
    expect(mimeTypeFor('pdf')).toBe('application/pdf');
    expect(mimeTypeFor('markdown')).toBe('text/markdown');
    expect(mimeTypeFor('plain_text')).toBe('text/plain; charset=utf-8');
  });
});

describe('SourceTypeSchema', () => {
  it('accepts only the supported source types', () => {
    for (const value of SUPPORTED_SOURCE_TYPES) {
      expect(SourceTypeSchema.parse(value)).toBe(value);
    }
  });

  it('rejects unknown values', () => {
    expect(() => SourceTypeSchema.parse('docx')).toThrow();
    expect(() => SourceTypeSchema.parse(null)).toThrow();
    expect(() => SourceTypeSchema.parse(undefined)).toThrow();
  });
});
