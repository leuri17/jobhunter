import { describe, expect, it } from 'vitest';

import { PlainTextExtractor } from '../../../src/profile/extractors/plain-text.js';

describe('PlainTextExtractor', () => {
  it('extracts simple ASCII text', async () => {
    const extractor = new PlainTextExtractor();
    const result = await extractor.extract(new TextEncoder().encode('hello world'));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.text).toBe('hello world');
      expect(result.warnings).toEqual([]);
    }
  });

  it('preserves UTF-8 multibyte sequences', async () => {
    const extractor = new PlainTextExtractor();
    const result = await extractor.extract(new TextEncoder().encode('café résumé'));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.text).toBe('café résumé');
    }
  });

  it('replaces invalid UTF-8 bytes with the replacement character', async () => {
    const extractor = new PlainTextExtractor();
    const bytes = new Uint8Array([0x68, 0x69, 0xff, 0xfe, 0x21]);
    const result = await extractor.extract(bytes);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.text).toContain('\uFFFD');
      expect(result.text).toContain('hi');
      expect(result.text).toContain('!');
    }
  });

  it('returns an empty string for an empty input', async () => {
    const extractor = new PlainTextExtractor();
    const result = await extractor.extract(new Uint8Array(0));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.text).toBe('');
    }
  });
});
