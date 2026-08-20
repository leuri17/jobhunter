import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

/**
 * Playwright-backed screenshot capture (TASK-012 Plan Task 8, SPEC §39).
 *
 * Replaces the Wave A stub (`capture/screenshot.ts:11` placeholder).
 * Reads the live `Page` from `CaptureContext.page` (populated by
 * `DiagnosticManager.recordScraperError` from `DiagnosticInput.page`).
 * When the page is absent — e.g. when the capture strategy is invoked
 * outside the Playwright run — the strategy throws
 * `MissingBrowserImplementationError` so the manager's try/catch
 * records a `capture_failed` failure rather than crashing.
 *
 * Wave C deviation from the plan's `Deps` closure pattern: the brief
 * asked for the page to flow through `CaptureContext` rather than a
 * constructor-injected `getPage()` closure. This keeps the strategy
 * stateless + easier to test in isolation.
 */
export class ScreenshotCapture implements CaptureStrategy {
  readonly artifactType = 'screenshot' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    if (context.page === undefined) {
      throw new MissingBrowserImplementationError(
        'browser_implementation_missing',
        'Screenshot capture requires a Playwright page in the capture context.',
        { artifactType: 'screenshot' },
      );
    }
    const raw = await context.page.screenshot({ fullPage: true });
    // Normalize to Buffer: Playwright returns `Promise<Buffer>` in
    // production, but tests + future CDP bridges may return a plain
    // `Uint8Array`. `Buffer.from(uint8)` copies the bytes; `Buffer.from(buffer)`
    // is a no-op view.
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    return {
      artifactType: 'screenshot',
      extension: 'png',
      mimeType: 'image/png',
      contents: buffer,
    };
  }
}