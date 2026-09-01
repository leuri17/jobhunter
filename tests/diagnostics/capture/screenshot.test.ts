import { describe, expect, it } from 'vitest';

import { ScreenshotCapture } from '../../../src/diagnostics/capture/screenshot.js';
import { MissingBrowserImplementationError } from '../../../src/diagnostics/errors.js';
import type { CaptureContext } from '../../../src/diagnostics/capture/types.js';

/**
 * Minimal `Page`-shaped stub for the screenshot capture tests. The
 * test only exercises `page.screenshot()` so we model just that
 * surface. We deliberately do NOT import from `src/linkedin/fake-page.ts`
 * to keep `tests/diagnostics/` independent of the `src/linkedin/`
 * surface (cross-domain test imports are an anti-pattern).
 */
interface ScreenshotPage {
  readonly screenshot: (options: { fullPage?: boolean }) => Promise<Buffer | Uint8Array>;
}

function makeScreenshotPage(
  result: Buffer | Uint8Array | (() => Promise<Buffer | Uint8Array>),
): ScreenshotPage {
  return {
    screenshot: async () => {
      if (typeof result === 'function') return result();
      return result;
    },
  };
}

const BASE_CONTEXT: Omit<CaptureContext, 'page' | 'browserContext'> = {
  scope: { pipelineRunId: 7 },
  timestamp: '2026-08-13T10:00:00.000Z',
};

describe('ScreenshotCapture', () => {
  it('returns a PNG buffer when ctx.page.screenshot() resolves with bytes', async () => {
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG magic bytes
    const page = makeScreenshotPage(bytes);
    const cap = new ScreenshotCapture();
    const result = await cap.capture({ ...BASE_CONTEXT, page: page as never });
    expect(result.artifactType).toBe('screenshot');
    expect(result.extension).toBe('png');
    expect(result.mimeType).toBe('image/png');
    expect(Buffer.isBuffer(result.contents)).toBe(true);
    expect((result.contents as Buffer).equals(bytes)).toBe(true);
  });

  it('propagates errors from ctx.page.screenshot() (no internal try/catch)', async () => {
    const boom = new Error('navigation in progress');
    const page = makeScreenshotPage(() => Promise.reject(boom));
    const cap = new ScreenshotCapture();
    await expect(cap.capture({ ...BASE_CONTEXT, page: page as never })).rejects.toBe(boom);
  });

  it('throws MissingBrowserImplementationError when ctx.page is undefined', async () => {
    const cap = new ScreenshotCapture();
    let caught: unknown;
    try {
      await cap.capture({ ...BASE_CONTEXT });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingBrowserImplementationError);
    const err = caught as MissingBrowserImplementationError;
    expect(err.code).toBe('browser_implementation_missing');
    expect(err.message).toContain('Playwright page');
    expect(err.metadata).toEqual({ artifactType: 'screenshot' });
  });

  it('returns a Buffer when page.screenshot() resolves with a Uint8Array', async () => {
    const u8 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const page = makeScreenshotPage(u8);
    const cap = new ScreenshotCapture();
    const result = await cap.capture({ ...BASE_CONTEXT, page: page as never });
    expect(Buffer.isBuffer(result.contents)).toBe(true);
    expect((result.contents as Buffer).length).toBe(8);
  });

  it('ignores the `fullPage` option (the strategy always passes fullPage: true)', async () => {
    // Regression guard: ensure the strategy actually requests
    // `fullPage: true` so a partial-view screenshot is never
    // captured by accident.
    let capturedOptions: { fullPage?: boolean } | undefined;
    const page: ScreenshotPage = {
      screenshot: async (options) => {
        capturedOptions = options;
        return Buffer.from('png');
      },
    };
    const cap = new ScreenshotCapture();
    await cap.capture({ ...BASE_CONTEXT, page: page as never });
    expect(capturedOptions).toEqual({ fullPage: true });
  });
});