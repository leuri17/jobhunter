import { UnsupportedSourceFormatError } from '../errors.js';
import type { SourceType } from '../source-types.js';
import { MarkdownExtractor } from './markdown.js';
import { PlainTextExtractor } from './plain-text.js';
import { PdfExtractor } from './pdf.js';
import type { Extractor } from './types.js';

export type { ExtractionResult, Extractor } from './types.js';
export { isSuccessfulExtraction } from './types.js';

export function resolveExtractor(sourceType: SourceType): Extractor {
  switch (sourceType) {
    case 'pdf':
      return new PdfExtractor();
    case 'markdown':
      return new MarkdownExtractor();
    case 'plain_text':
      return new PlainTextExtractor();
    default: {
      const exhaustive: never = sourceType;
      throw new UnsupportedSourceFormatError(`Unsupported source type: ${String(exhaustive)}`, {
        sourceType: String(exhaustive),
      });
    }
  }
}
