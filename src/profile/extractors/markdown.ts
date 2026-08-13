import type { Extractor, ExtractionResult } from './types.js';

const EXTERNAL_IMAGE_RE = /!\[[^\]]*\]\((?:https?:|\/\/)/i;

export class MarkdownExtractor implements Extractor {
  async extract(bytes: Uint8Array): Promise<ExtractionResult> {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const warnings: string[] = [];
    if (EXTERNAL_IMAGE_RE.test(text)) {
      warnings.push('markdown_contains_external_image_references');
    }
    return {
      status: 'success',
      text,
      warnings,
    };
  }
}
