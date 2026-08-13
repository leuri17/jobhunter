import type { Extractor, ExtractionResult } from './types.js';

export class PlainTextExtractor implements Extractor {
  async extract(bytes: Uint8Array): Promise<ExtractionResult> {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return {
      status: 'success',
      text,
      warnings: [],
    };
  }
}
