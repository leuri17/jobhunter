import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

/**
 * Playwright-backed trace capture.
 *
 * Replaces the  stub (`capture/playwright-trace.ts:11`).
 * Reads the live `BrowserContext` from `CaptureContext.browserContext`
 * (populated by `DiagnosticManager.recordScraperError` from
 * `DiagnosticInput.browserContext`). When the context is absent
 * the strategy throws `MissingBrowserImplementationError` so the
 * manager's try/catch records a `capture_failed` failure.
 *
 * Lifecycle: the orchestrator calls
 * `browserContext.tracing.start()` at the START of the run and
 * `browserContext.tracing.stop({ path })` here. `tracing.stop` is
 * one-shot — once stopped, it cannot be stopped again. The strategy
 * writes the trace to a temp file, reads it back as a Buffer, and
 * returns it via `CaptureResult.contents`. `DiagnosticManager.persist`
 * then writes the Buffer to the diagnostics directory + inserts the
 * `diagnosticArtifacts` row.
 *
 *  deviation from the plan's `Deps` closure pattern: the brief
 * asked for the browser context to flow through `CaptureContext`
 * rather than a constructor-injected `getContext()` closure.
 */
export class LinkedInPlaywrightTraceCapture implements CaptureStrategy {
  readonly artifactType = 'playwright_trace' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    if (context.browserContext === undefined) {
      throw new MissingBrowserImplementationError(
        'browser_implementation_missing',
        'Playwright trace capture requires a browser context in the capture context.',
        { artifactType: 'playwright_trace' },
      );
    }
    const tracePath = join(tmpdir(), `jobhunter-trace-${randomUUID()}.zip`);
    try {
      // Playwright's `tracing.stop` is a one-shot. If tracing was
      // never started (e.g. the orchestrator skipped it), the call
      // throws — we surface that as `tracing_not_started` so the
      // manager records a typed failure rather than a generic
      // capture_failed.
      try {
        await context.browserContext.tracing.stop({ path: tracePath });
      } catch (cause) {
        throw new MissingBrowserImplementationError(
          'tracing_not_started',
          'Browser context tracing was not started; cannot stop a trace that was never begun.',
          { artifactType: 'playwright_trace' },
          cause instanceof Error ? cause : undefined,
        );
      }
      const contents = await readFile(tracePath);
      return {
        artifactType: 'playwright_trace',
        extension: 'zip',
        mimeType: 'application/zip',
        contents,
      };
    } finally {
      // Best-effort cleanup of the temp file. The manager's `persist`
      // writes the Buffer to the diagnostics directory + inserts the
      // row before this finally runs, so the Buffer is already
      // captured by the time we delete the temp.
      try {
        await unlink(tracePath);
      } catch {
        // Ignore: file may not exist if tracing.stop failed.
      }
    }
  }
}