import { describe, expect, it } from 'vitest';

import { noopScoringLogger, pinoScoringLogger, type ScoringLogger } from '../../src/scoring/log.js';
import type { Logger, LogContext } from '../../src/logging/logger.js';

/** A logger that records every call for assertion. */
function recordingLogger(): {
  logger: Logger;
  events: { level: string; context: LogContext; message: string }[];
} {
  const events: { level: string; context: LogContext; message: string }[] = [];
  const record = (level: string) => (context: LogContext, message: string) => {
    events.push({ level, context, message });
  };
  const logger: Logger = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    child: () => logger,
  };
  return { logger, events };
}

describe('noopScoringLogger', () => {
  it('returns a logger whose methods do not throw', () => {
    const log: ScoringLogger = noopScoringLogger();
    expect(() => log.scoringStart({ jobId: 1, sourceJobId: 'j1', fingerprint: 'f' })).not.toThrow();
    expect(() =>
      log.scoringComplete({ jobId: 1, kind: 'complete', overallScore: 75, displayScore: '75.0' }),
    ).not.toThrow();
    expect(() => log.scoringSkip({ jobId: 1, reason: 'ineligible' })).not.toThrow();
    expect(() => log.scoringFail({ jobId: 1, errorCode: 'openai_timeout' })).not.toThrow();
    expect(() =>
      log.scoringReuse({
        jobId: 1,
        fingerprint: 'f',
        previousScoreTimestamp: '2026-01-01T00:00:00Z',
      }),
    ).not.toThrow();
  });
});

describe('pinoScoringLogger', () => {
  it('emits scoring.start with the expected event + stringified jobId', () => {
    const { logger, events } = recordingLogger();
    const log = pinoScoringLogger(logger);
    log.scoringStart({ jobId: 42, sourceJobId: 'j42', fingerprint: 'abc' });
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('info');
    expect(events[0]?.context['event']).toBe('scoring.start');
    expect(events[0]?.context['jobId']).toBe('42');
    expect(events[0]?.context['sourceJobId']).toBe('j42');
    expect(events[0]?.context['fingerprint']).toBe('abc');
  });

  it('emits scoring.complete with the expected event + optional fields', () => {
    const { logger, events } = recordingLogger();
    const log = pinoScoringLogger(logger);
    log.scoringComplete({ jobId: 1, kind: 'complete', overallScore: 75.5, displayScore: '75.5' });
    expect(events[0]?.context['event']).toBe('scoring.complete');
    expect(events[0]?.context['kind']).toBe('complete');
    expect(events[0]?.context['overallScore']).toBe(75.5);
    expect(events[0]?.context['displayScore']).toBe('75.5');
  });

  it('emits scoring.fail at warn level', () => {
    const { logger, events } = recordingLogger();
    const log = pinoScoringLogger(logger);
    log.scoringFail({ jobId: 7, errorCode: 'openai_timeout' });
    expect(events[0]?.level).toBe('warn');
    expect(events[0]?.context['event']).toBe('scoring.fail');
    expect(events[0]?.context['errorCode']).toBe('openai_timeout');
  });

  it('emits scoring.skip at info level', () => {
    const { logger, events } = recordingLogger();
    const log = pinoScoringLogger(logger);
    log.scoringSkip({ jobId: 3, reason: 'ineligible' });
    expect(events[0]?.level).toBe('info');
    expect(events[0]?.context['event']).toBe('scoring.skip');
    expect(events[0]?.context['reason']).toBe('ineligible');
  });

  it('emits scoring.reuse at info level', () => {
    const { logger, events } = recordingLogger();
    const log = pinoScoringLogger(logger);
    log.scoringReuse({
      jobId: 9,
      fingerprint: 'f',
      previousScoreTimestamp: '2026-08-20T00:00:00Z',
    });
    expect(events[0]?.level).toBe('info');
    expect(events[0]?.context['event']).toBe('scoring.reuse');
    expect(events[0]?.context['previousScoreTimestamp']).toBe('2026-08-20T00:00:00Z');
  });
});
