import { describe, expect, it } from 'vitest';

import {
  __test_stringifyNumericIds,
  noopLinkedInExtractionLogger,
  noopLinkedInExtractionLoggerInstance,
  pinoLinkedInExtractionLogger,
  type LinkedInExtractionLogger,
} from '../../src/linkedin/extraction/log.js';
import type { Logger, LogContext } from '../../src/logging/logger.js';

/**
 * Tests for `src/linkedin/extraction/log.ts`
 * (TASK-013 Plan Task 5).
 *
 * Asserts:
 *   - The noop adapter does not throw on any method.
 *   - The pino adapter emits the documented `event` per method,
 *     stringifies numeric IDs, and uses info/warn levels correctly.
 *
 * The fake `Logger` records every call so we can assert on the
 * `(context, message)` tuple shape directly.
 */

interface CapturedCall {
  readonly level: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal';
  readonly context: LogContext;
  readonly message: string;
}

function fakeLogger(): Logger & { readonly calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const make = (level: CapturedCall['level']) => (context: LogContext, message: string) => {
    calls.push({ level, context, message });
  };
  return {
    calls,
    trace: make('trace'),
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    fatal: make('fatal'),
    child: () => fakeLogger(),
  };
}

function findCall(calls: readonly CapturedCall[], event: string): CapturedCall | undefined {
  return calls.find((c) => c.context['event'] === event);
}

describe('src/linkedin/extraction/log — Wave A', () => {
  describe('noopLinkedInExtractionLogger', () => {
    it('returns a fresh object on every call', () => {
      const a = noopLinkedInExtractionLogger();
      const b = noopLinkedInExtractionLogger();
      expect(a).not.toBe(b);
      expect(typeof a.extractionStart).toBe('function');
      expect(typeof b.extractionStart).toBe('function');
    });

    it('every method is callable and returns undefined', () => {
      const l = noopLinkedInExtractionLogger();
      expect(l.extractionStart({ jobId: 1, sourceJobId: '123456' })).toBeUndefined();
      expect(l.extractionComplete({ jobId: 1, kind: 'complete' })).toBeUndefined();
      expect(l.extractionSkip({ jobId: 1, reason: 'already_complete' })).toBeUndefined();
      expect(l.extractionFail({ jobId: 1, errorCode: 'panel_load_timeout' })).toBeUndefined();
      expect(
        l.extractionFail({
          jobId: 1,
          errorCode: 'panel_load_timeout',
          method: 'search_detail_panel',
        }),
      ).toBeUndefined();
      expect(
        l.panelMismatch({
          jobId: 1,
          expectedSourceJobId: '123456',
          actualSourceJobId: '999999',
        }),
      ).toBeUndefined();
      expect(l.fallbackStart({ jobId: 1, url: 'https://x' })).toBeUndefined();
      expect(l.fallbackClose({ jobId: 1 })).toBeUndefined();
    });

    it('the const instance is a valid LinkedInExtractionLogger', () => {
      const l: LinkedInExtractionLogger = noopLinkedInExtractionLoggerInstance;
      expect(typeof l.extractionStart).toBe('function');
      expect(l.extractionStart({ jobId: 1, sourceJobId: '123456' })).toBeUndefined();
    });
  });

  describe('pinoLinkedInExtractionLogger', () => {
    it('extractionStart emits an info event with component + event + stringified jobId + sourceJobId', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.extractionStart({ jobId: 42, sourceJobId: '123456' });
      const call = findCall(logger.calls, 'job.extraction.start');
      expect(call).toBeDefined();
      expect(call?.level).toBe('info');
      expect(call?.context['component']).toBe('linkedin_extraction');
      expect(call?.context['event']).toBe('job.extraction.start');
      // Numeric ID is stringified to match LogContext's `string` shape.
      expect(call?.context['jobId']).toBe('42');
      expect(call?.context['sourceJobId']).toBe('123456');
      expect(call?.message).toBe('extraction started');
    });

    it('extractionComplete emits an info event with the kind payload', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.extractionComplete({ jobId: 1, kind: 'complete' });
      const call = findCall(logger.calls, 'job.extraction.complete');
      expect(call).toBeDefined();
      expect(call?.level).toBe('info');
      expect(call?.context['kind']).toBe('complete');
      expect(call?.context['jobId']).toBe('1');
    });

    it('extractionComplete works for every ExtractionKind value', () => {
      for (const kind of ['complete', 'partial', 'failed', 'skipped', 'cancelled'] as const) {
        const logger = fakeLogger();
        const l = pinoLinkedInExtractionLogger(logger);
        l.extractionComplete({ jobId: 1, kind });
        const call = findCall(logger.calls, 'job.extraction.complete');
        expect(call?.context['kind']).toBe(kind);
      }
    });

    it('extractionSkip emits an info event with the reason', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.extractionSkip({ jobId: 7, reason: 'complete_job_already_exists' });
      const call = findCall(logger.calls, 'job.extraction.skip');
      expect(call).toBeDefined();
      expect(call?.level).toBe('info');
      expect(call?.context['reason']).toBe('complete_job_already_exists');
      expect(call?.context['jobId']).toBe('7');
    });

    it('extractionFail emits a warn event with errorCode + optional method', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.extractionFail({ jobId: 3, errorCode: 'panel_load_timeout' });
      const call = findCall(logger.calls, 'job.extraction.fail');
      expect(call).toBeDefined();
      expect(call?.level).toBe('warn');
      expect(call?.context['errorCode']).toBe('panel_load_timeout');
      expect(call?.context['jobId']).toBe('3');
      // `method` was not supplied → must NOT be present in the
      // emitted context (exactOptionalPropertyTypes).
      expect(call?.context).not.toHaveProperty('method');
    });

    it('extractionFail includes the method when supplied', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.extractionFail({
        jobId: 3,
        errorCode: 'panel_load_timeout',
        method: 'search_detail_panel',
      });
      const call = findCall(logger.calls, 'job.extraction.fail');
      expect(call?.context['method']).toBe('search_detail_panel');
    });

    it('panelMismatch emits a warn event with expected + actual', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.panelMismatch({
        jobId: 5,
        expectedSourceJobId: '123456',
        actualSourceJobId: '999999',
      });
      const call = findCall(logger.calls, 'job.panel.mismatch');
      expect(call).toBeDefined();
      expect(call?.level).toBe('warn');
      expect(call?.context['expectedSourceJobId']).toBe('123456');
      expect(call?.context['actualSourceJobId']).toBe('999999');
      expect(call?.context['jobId']).toBe('5');
    });

    it('fallbackStart emits an info event with the URL', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.fallbackStart({ jobId: 11, url: 'https://www.linkedin.com/jobs/view/123456/' });
      const call = findCall(logger.calls, 'job.fallback.start');
      expect(call).toBeDefined();
      expect(call?.level).toBe('info');
      expect(call?.context['url']).toBe('https://www.linkedin.com/jobs/view/123456/');
      expect(call?.context['jobId']).toBe('11');
    });

    it('fallbackClose emits an info event with just the jobId', () => {
      const logger = fakeLogger();
      const l = pinoLinkedInExtractionLogger(logger);
      l.fallbackClose({ jobId: 11 });
      const call = findCall(logger.calls, 'job.fallback.close');
      expect(call).toBeDefined();
      expect(call?.level).toBe('info');
      expect(call?.context['jobId']).toBe('11');
    });

    it('numeric IDs are stringified (jobId 42 → "42")', () => {
      // Direct exercise of the helper to lock the contract.
      const out = __test_stringifyNumericIds({ jobId: 42, sourceJobId: '123456', count: 7 });
      expect(out['jobId']).toBe('42');
      expect(out['sourceJobId']).toBe('123456');
      expect(out['count']).toBe('7');
    });

    it('non-numeric fields pass through unchanged', () => {
      const out = __test_stringifyNumericIds({
        jobId: 1,
        url: 'https://x',
        expectedSourceJobId: 'a',
        kind: 'complete',
      });
      expect(out['url']).toBe('https://x');
      expect(out['expectedSourceJobId']).toBe('a');
      expect(out['kind']).toBe('complete');
      expect(out['jobId']).toBe('1');
    });
  });
});
