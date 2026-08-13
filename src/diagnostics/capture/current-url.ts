import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export class CurrentUrlCapture implements CaptureStrategy {
  readonly artifactType = 'current_url' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    const payload =
      typeof context.currentUrl === 'string' && context.currentUrl !== ''
        ? context.currentUrl
        : 'no url captured';
    return {
      artifactType: 'current_url',
      extension: 'txt',
      mimeType: 'text/plain',
      contents: payload,
    };
  }
}
