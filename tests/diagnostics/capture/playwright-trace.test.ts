import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LinkedInPlaywrightTraceCapture } from '../../../src/diagnostics/capture/playwright-trace.js';
import {
  LinkedInPlaywrightTraceCapture as LinkedInPlaywrightTraceCaptureFromIndex,
  PlaywrightTraceCapture,
} from '../../../src/diagnostics/capture/index.js';
import { MissingBrowserImplementationError } from '../../../src/diagnostics/errors.js';
import type { CaptureContext } from '../../../src/diagnostics/capture/types.js';

/**
 * Minimal `BrowserContext`-shaped stub for the trace capture tests.
 * The strategy calls `context.tracing.stop({ path })` and expects a
 * `.zip` file to be written at the given path. The fake writes a
 * stub zip payload so the test does not need real Playwright.
 */
interface TraceContext {
  tracing: {
    stop: (options: { path: string }) => Promise<void>;
  };
  pages: () => Array<{ url: () => string }>;
}

const STUB_ZIP_BYTES = Buffer.from('PK\x03\x04stub-trace-contents\x00', 'binary');

function makeTraceContext(opts: {
  readonly zipBytes?: Buffer;
  readonly stopThrows?: boolean;
  readonly pageUrl?: string;
} = {}): { context: TraceContext; writtenTo: string[] } {
  const writtenTo: string[] = [];
  const context: TraceContext = {
    pages: () => (opts.pageUrl ? [{ url: () => opts.pageUrl! }] : []),
    tracing: {
      stop: async (options) => {
        writtenTo.push(options.path);
        if (opts.stopThrows) {
          throw new Error('tracing was never started');
        }
        writeFileSync(options.path, opts.zipBytes ?? STUB_ZIP_BYTES);
      },
    },
  };
  return { context, writtenTo };
}

const BASE_CONTEXT: Omit<CaptureContext, 'page' | 'browserContext'> = {
  scope: { pipelineRunId: 7 },
  timestamp: '2026-08-13T10:00:00.000Z',
};

describe('LinkedInPlaywrightTraceCapture (Wave C)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jobhunter-trace-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Track files the strategy creates so afterEach can clean them up.
  function recordTempFile(): void {
    // The strategy uses os.tmpdir() — we don't own the path. Best
    // effort: ignore; afterEach removes tempDir which is a
    // different (test-isolated) directory.
    void tempDir;
  }

  it('returns a zip Buffer when ctx.browserContext.tracing.stop resolves', async () => {
    recordTempFile();
    const { context, writtenTo } = makeTraceContext();
    const cap = new LinkedInPlaywrightTraceCapture();
    const result = await cap.capture({ ...BASE_CONTEXT, browserContext: context as never });
    expect(result.artifactType).toBe('playwright_trace');
    expect(result.extension).toBe('zip');
    expect(result.mimeType).toBe('application/zip');
    expect(Buffer.isBuffer(result.contents)).toBe(true);
    expect((result.contents as Buffer).equals(STUB_ZIP_BYTES)).toBe(true);
    expect(writtenTo).toHaveLength(1);
    // The strategy cleans up its temp file in the finally block.
    expect(existsSync(writtenTo[0]!)).toBe(false);
  });

  it('throws MissingBrowserImplementationError when ctx.browserContext is undefined', async () => {
    const cap = new LinkedInPlaywrightTraceCapture();
    let caught: unknown;
    try {
      await cap.capture({ ...BASE_CONTEXT });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingBrowserImplementationError);
    const err = caught as MissingBrowserImplementationError;
    expect(err.code).toBe('browser_implementation_missing');
    expect(err.message).toContain('browser context');
    expect(err.metadata).toEqual({ artifactType: 'playwright_trace' });
  });

  it('wraps tracing.stop() failures in MissingBrowserImplementationError(tracing_not_started)', async () => {
    const { context } = makeTraceContext({ stopThrows: true });
    const cap = new LinkedInPlaywrightTraceCapture();
    let caught: unknown;
    try {
      await cap.capture({ ...BASE_CONTEXT, browserContext: context as never });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingBrowserImplementationError);
    const err = caught as MissingBrowserImplementationError;
    expect(err.code).toBe('tracing_not_started');
    expect(err.message).toContain('tracing was not started');
    expect(err.metadata).toEqual({ artifactType: 'playwright_trace' });
    // The original Playwright error is preserved as `cause` for diagnostics.
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe('tracing was never started');
  });

  it('returns a Buffer even when the temp file is a different size', async () => {
    recordTempFile();
    const customBytes = Buffer.from('custom-zip-payload');
    const { context } = makeTraceContext({ zipBytes: customBytes });
    const cap = new LinkedInPlaywrightTraceCapture();
    const result = await cap.capture({ ...BASE_CONTEXT, browserContext: context as never });
    expect((result.contents as Buffer).equals(customBytes)).toBe(true);
  });

  it('cleans up the temp file even when the manager would later re-throw', async () => {
    recordTempFile();
    const { context, writtenTo } = makeTraceContext();
    const cap = new LinkedInPlaywrightTraceCapture();
    await cap.capture({ ...BASE_CONTEXT, browserContext: context as never });
    // The strategy's `finally` block unlinks the temp file.
    expect(existsSync(writtenTo[0]!)).toBe(false);
  });

  it('exposes the legacy PlaywrightTraceCapture name via the index barrel', () => {
    // The `PlaywrightTraceCapture` symbol in `capture/index.ts` is
    // a re-export alias for `LinkedInPlaywrightTraceCapture`. This
    // preserves backward compat with Wave A consumers.
    expect(PlaywrightTraceCapture).toBe(LinkedInPlaywrightTraceCapture);
    // The index also re-exports the new name directly for forward compat.
    expect(LinkedInPlaywrightTraceCaptureFromIndex).toBe(LinkedInPlaywrightTraceCapture);
  });
});