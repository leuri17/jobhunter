export type ExtractionResult =
  | { readonly status: 'success'; readonly text: string; readonly warnings: readonly string[] }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ocr_required'; readonly message: string };

export interface Extractor {
  extract(bytes: Uint8Array): Promise<ExtractionResult>;
}

export function isSuccessfulExtraction(
  result: ExtractionResult,
): result is { status: 'success'; text: string; warnings: readonly string[] } {
  return result.status === 'success';
}
