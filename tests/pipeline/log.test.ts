import { describe, expect, it, vi } from 'vitest';
import { noopPipelineLogger, pinoPipelineLogger } from '../../src/pipeline/log.js';

describe('PipelineLogger', () => {
  it('noopPipelineLogger does not throw', () => {
    const logger = noopPipelineLogger();
    expect(() => logger.runStart({ runId: 1 })).not.toThrow();
    expect(() => logger.searchFail({ searchId: 2, errorCode: 'x', message: 'y' })).not.toThrow();
  });

  it('pinoPipelineLogger emits structured events', () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const fakeLogger = { info, warn, error } as never;
    const logger = pinoPipelineLogger(fakeLogger);
    logger.runStart({ runId: 42 });
    // Note: codebase Logger.LogContext.runId is typed as `string`,
    // so the adapter stringifies numeric IDs before forwarding.
    expect(info).toHaveBeenCalledWith({ event: 'run.start', runId: '42' }, 'run started');
    logger.searchFail({ searchId: 7, errorCode: 'linkedin_blocked', message: 'oops' });
    expect(warn).toHaveBeenCalledWith(
      { event: 'search.fail', searchId: '7', errorCode: 'linkedin_blocked', message: 'oops' },
      'search failed',
    );
    logger.runFail({ runId: 42, errorCode: 'x', message: 'y' });
    expect(error).toHaveBeenCalledWith(
      { event: 'run.fail', runId: '42', errorCode: 'x', message: 'y' },
      'run failed',
    );
  });
});