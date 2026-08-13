import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export class ScreenshotCapture implements CaptureStrategy {
  readonly artifactType = 'screenshot' as const;

  async capture(_context: CaptureContext): Promise<CaptureResult> {
    void _context;
    throw new MissingBrowserImplementationError(
      'browser_implementation_missing',
      'ScreenshotCapture requires a Playwright-backed implementation (wired by TASK-012/13).',
      { artifactType: 'screenshot' },
    );
  }
}
