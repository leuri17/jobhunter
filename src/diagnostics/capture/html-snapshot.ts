import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export class HtmlSnapshotCapture implements CaptureStrategy {
  readonly artifactType = 'html_snapshot' as const;

  async capture(_context: CaptureContext): Promise<CaptureResult> {
    void _context;
    throw new MissingBrowserImplementationError(
      'browser_implementation_missing',
      'HtmlSnapshotCapture requires a Playwright-backed implementation (wired by TASK-013).',
      { artifactType: 'html_snapshot' },
    );
  }
}
