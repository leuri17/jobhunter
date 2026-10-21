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

  it('noopPipelineLogger runSummary does not throw', () => {
    const logger = noopPipelineLogger();
    expect(() =>
      logger.runSummary({
        runId: 1,
        status: 'completed',
        durationMs: 1234,
        searchesPlanned: 1,
        searchesCompleted: 1,
        jobsDiscovered: 10,
        newCompleteJobs: 8,
        jobsAccepted: 5,
        jobsRejected: 3,
        jobsScored: 5,
        scoresReused: 2,
        failedExtractions: 0,
        filterErrors: 0,
        scoringErrors: 0,
        promptTokens: 100,
        completionTokens: 50,
      }),
    ).not.toThrow();
  });

  it('pinoPipelineLogger emits run.summary with counts, duration and token totals', () => {
    const info = vi.fn();
    const fakeLogger = { info, warn: vi.fn(), error: vi.fn() } as never;
    const logger = pinoPipelineLogger(fakeLogger);

    logger.runSummary({
      runId: 42,
      status: 'completed',
      durationMs: 54321,
      searchesPlanned: 3,
      searchesCompleted: 3,
      jobsDiscovered: 20,
      newCompleteJobs: 15,
      jobsAccepted: 9,
      jobsRejected: 6,
      jobsScored: 9,
      scoresReused: 4,
      failedExtractions: 1,
      filterErrors: 0,
      scoringErrors: 2,
      promptTokens: 1234,
      completionTokens: 567,
    });

    expect(info).toHaveBeenCalledWith(
      {
        event: 'run.summary',
        runId: '42',
        status: 'completed',
        durationMs: 54321,
        searchesPlanned: 3,
        searchesCompleted: 3,
        jobsDiscovered: 20,
        newCompleteJobs: 15,
        jobsAccepted: 9,
        jobsRejected: 6,
        jobsScored: 9,
        scoresReused: 4,
        failedExtractions: 1,
        filterErrors: 0,
        scoringErrors: 2,
        promptTokens: 1234,
        completionTokens: 567,
      },
      'run summary',
    );
  });

  it('noopPipelineLogger job events do not throw', () => {
    const logger = noopPipelineLogger();
    expect(() =>
      logger.jobFiltered({
        runId: 1,
        jobId: 2,
        outcome: 'rejected',
        rejectionReasons: ['title.excluded_keyword'],
        reused: false,
      }),
    ).not.toThrow();
    expect(() =>
      logger.jobFilterFail({ runId: 1, jobId: 2, errorCode: 'x', message: 'y' }),
    ).not.toThrow();
  });

  it('pinoPipelineLogger emits job.filter.rejected with the exclusion reasons', () => {
    const info = vi.fn();
    const fakeLogger = { info, warn: vi.fn(), error: vi.fn() } as never;
    const logger = pinoPipelineLogger(fakeLogger);

    logger.jobFiltered({
      runId: 9,
      jobId: 77,
      outcome: 'rejected',
      rejectionReasons: ['title.excluded_keyword', 'seniority.above_maximum'],
      reused: false,
    });

    expect(info).toHaveBeenCalledWith(
      {
        event: 'job.filter.rejected',
        runId: '9',
        jobId: '77',
        outcome: 'rejected',
        rejectionReasons: ['title.excluded_keyword', 'seniority.above_maximum'],
        reused: false,
      },
      'job filter rejected',
    );
  });

  it('pinoPipelineLogger emits job.filter.accepted with reused=true on a cache hit', () => {
    const info = vi.fn();
    const fakeLogger = { info, warn: vi.fn(), error: vi.fn() } as never;
    const logger = pinoPipelineLogger(fakeLogger);

    logger.jobFiltered({
      runId: 1,
      jobId: 5,
      outcome: 'accepted',
      rejectionReasons: [],
      reused: true,
    });

    expect(info).toHaveBeenCalledWith(
      {
        event: 'job.filter.accepted',
        runId: '1',
        jobId: '5',
        outcome: 'accepted',
        rejectionReasons: [],
        reused: true,
      },
      'job filter accepted',
    );
  });

  it('pinoPipelineLogger emits job.filter.fail at warn', () => {
    const warn = vi.fn();
    const fakeLogger = { info: vi.fn(), warn, error: vi.fn() } as never;
    const logger = pinoPipelineLogger(fakeLogger);

    logger.jobFilterFail({
      runId: 3,
      jobId: 8,
      errorCode: 'filter_apply_failed',
      message: 'boom',
    });

    expect(warn).toHaveBeenCalledWith(
      {
        event: 'job.filter.fail',
        runId: '3',
        jobId: '8',
        errorCode: 'filter_apply_failed',
        message: 'boom',
      },
      'job filter failed',
    );
  });
});
