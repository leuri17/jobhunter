import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (typeof error.stack === 'string' && error.stack !== '') return error.stack;
    return `${error.name}: ${error.message}`;
  }
  if (error === undefined || error === null) return 'no error attached';
  return String(error);
}

export class StackTraceCapture implements CaptureStrategy {
  readonly artifactType = 'stack_trace' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    const payload = context.error === undefined ? 'no error attached' : describeError(context.error);
    return {
      artifactType: 'stack_trace',
      extension: 'txt',
      mimeType: 'text/plain',
      contents: payload,
    };
  }
}
