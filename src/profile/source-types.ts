import path from 'node:path';

import { z } from 'zod';

import { UnsupportedSourceFormatError } from './errors.js';

export const SUPPORTED_SOURCE_TYPES = ['pdf', 'markdown', 'plain_text'] as const;
export type SourceType = (typeof SUPPORTED_SOURCE_TYPES)[number];

export const SourceTypeSchema = z.enum(SUPPORTED_SOURCE_TYPES);

const EXTENSION_MAP: Readonly<Record<string, SourceType>> = {
  '.pdf': 'pdf',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'plain_text',
};

export function detectSourceTypeFromPath(absolutePath: string): SourceType {
  if (typeof absolutePath !== 'string' || absolutePath.trim() === '') {
    throw new UnsupportedSourceFormatError('Expected a non-empty file path.', {
      path: absolutePath,
    });
  }
  const trimmed = absolutePath.trim();
  const extension = path.extname(trimmed).toLowerCase();
  const detected = EXTENSION_MAP[extension];
  if (detected === undefined) {
    throw new UnsupportedSourceFormatError(
      `Unsupported file format for path "${trimmed}". Supported extensions: .pdf, .md, .markdown, .txt.`,
      { path: trimmed, extension: extension === '' ? null : extension },
    );
  }
  return detected;
}

export function mimeTypeFor(sourceType: SourceType): string {
  switch (sourceType) {
    case 'pdf':
      return 'application/pdf';
    case 'markdown':
      return 'text/markdown';
    case 'plain_text':
      return 'text/plain; charset=utf-8';
    default: {
      const exhaustive: never = sourceType;
      throw new Error(`Unsupported source type: ${String(exhaustive)}`);
    }
  }
}
