import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export class PlaywrightTraceCapture implements CaptureStrategy {
  readonly artifactType = 'playwright_trace' as const;

  async capture(_context: CaptureContext): Promise<CaptureResult> {
    void _context;
    throw new MissingBrowserImplementationError(
      'browser_implementation_missing',
      'PlaywrightTraceCapture requires a Playwright-backed implementation (wired by TASK-012).',
      { artifactType: 'playwright_trace' },
    );
  }
}
