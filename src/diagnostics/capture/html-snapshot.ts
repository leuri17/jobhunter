import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

/**
 * Playwright-backed HTML snapshot capture (TASK-013 Wave B, SPEC §39.1).
 *
 * Replaces the Wave A stub (`capture/html-snapshot.ts:7-13`). Reads the
 * live `Page` from `CaptureContext.page` (populated by
 * `DiagnosticManager.recordScraperError` from `DiagnosticInput.page`).
 * When the page is absent — e.g. when the strategy is invoked outside a
 * Playwright run — the strategy throws `MissingBrowserImplementationError`
 * so the manager's try/catch records a `capture_failed` failure rather
 * than crashing the orchestrator.
 *
 * Implementation notes (per TASK-013 Decision 13 refined):
 * - Uses `await page.content()` rather than `document.documentElement.outerHTML`
 *   so the snapshot includes the `<!DOCTYPE>` declaration and the `<meta
 *   charset>` tag.
 * - HTML is returned as a string with mimeType `text/html; charset=utf-8`.
 *   The manager's `persist` method applies the `Redactor` to text/* mime
 *   types per its existing logic; the redactor's regex set is conservative
 *   enough that it does not corrupt valid HTML markup in the anonymous
 *   LinkedIn context (the page content does NOT contain cookies, session
 *   tokens, or `localStorage` per Decision 14).
 */
export class HtmlSnapshotCapture implements CaptureStrategy {
  readonly artifactType = 'html_snapshot' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    const page = context.page;
    if (page === undefined) {
      throw new MissingBrowserImplementationError(
        'browser_implementation_missing',
        'HtmlSnapshotCapture requires a Playwright page in the capture context.',
        { artifactType: this.artifactType },
      );
    }
    try {
      const html = await page.content();
      return {
        artifactType: this.artifactType,
        extension: 'html',
        mimeType: 'text/html; charset=utf-8',
        contents: html,
      };
    } catch (cause) {
      throw new MissingBrowserImplementationError(
        'html_snapshot_failed',
        'HtmlSnapshotCapture failed to read page content.',
        { artifactType: this.artifactType },
        cause instanceof Error ? cause : undefined,
      );
    }
  }
}