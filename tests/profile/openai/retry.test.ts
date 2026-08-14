import { describe, expect, it } from 'vitest';

import {
  OpenAIInvalidOutputError,
  OpenAIRateLimitError,
  OpenAIServerError,
  ProfileExtractionError,
} from '../../../src/profile/openai/errors.js';
import {
  runWithRetry,
  type AttemptRecord,
  type RetryOptions,
} from '../../../src/profile/openai/retry.js';

function baseOptions(overrides: Partial<RetryOptions> = {}): RetryOptions {
  return {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    jitter: 'full',
    sleep: async () => undefined,
    now: () => 0,
    ...overrides,
  };
}

describe('runWithRetry', () => {
  it('succeeds on the first attempt', async () => {
    const result = await runWithRetry(async () => 'ok', baseOptions());

    expect(result.value).toBe('ok');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      attemptNumber: 1,
      succeeded: true,
      errorCode: null,
      errorMessage: null,
      retryAfterMs: null,
    });
  });

  it('succeeds on the second attempt after a retryable error', async () => {
    let calls = 0;
    const result = await runWithRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw new OpenAIServerError();
      }
      return 'ok';
    }, baseOptions());

    expect(result.value).toBe('ok');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.succeeded).toBe(false);
    expect(result.attempts[0]?.errorCode).toBe('openai_server_error');
    expect(result.attempts[1]?.succeeded).toBe(true);
  });

  it('succeeds on the third attempt', async () => {
    let calls = 0;
    const result = await runWithRetry(async () => {
      calls += 1;
      if (calls < 3) {
        throw new OpenAIServerError();
      }
      return 'ok';
    }, baseOptions());

    expect(result.value).toBe('ok');
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[2]?.succeeded).toBe(true);
  });

  it('throws after the third attempt on a persistent retryable error', async () => {
    await expect(
      runWithRetry(async () => {
        throw new OpenAIServerError();
      }, baseOptions()),
    ).rejects.toBeInstanceOf(OpenAIServerError);
  });

  it('aborts immediately on a non-retryable error', async () => {
    let calls = 0;
    await expect(
      runWithRetry(async () => {
        calls += 1;
        throw new ProfileExtractionError('openai_authentication', 'bad api key', {});
      }, baseOptions()),
    ).rejects.toMatchObject({ code: 'openai_authentication' });
    expect(calls).toBe(1);
  });

  it('only allows one corrective retry for OpenAIInvalidOutputError', async () => {
    let calls = 0;
    await expect(
      runWithRetry(async () => {
        calls += 1;
        throw new OpenAIInvalidOutputError();
      }, baseOptions()),
    ).rejects.toBeInstanceOf(OpenAIInvalidOutputError);
    expect(calls).toBe(2);
  });

  it('honors retryAfterMs exactly once', async () => {
    const sleepCalls: number[] = [];
    let calls = 0;
    await expect(
      runWithRetry(
        async () => {
          calls += 1;
          if (calls === 1) {
            throw new OpenAIRateLimitError(2_500);
          }
          throw new OpenAIServerError();
        },
        baseOptions({
          sleep: async (ms) => {
            sleepCalls.push(ms);
          },
        }),
      ),
    ).rejects.toBeInstanceOf(OpenAIServerError);

    expect(sleepCalls[0]).toBe(2_500);
    expect(sleepCalls).toHaveLength(2);
  });

  it('full jitter: delay is bounded by min(maxDelay, base * 2^(attempt-1))', async () => {
    const sleepCalls: number[] = [];
    await expect(
      runWithRetry(
        async () => {
          throw new OpenAIServerError();
        },
        baseOptions({
          sleep: async (ms) => {
            sleepCalls.push(ms);
          },
        }),
      ),
    ).rejects.toBeInstanceOf(OpenAIServerError);

    // First retry: attempt 1 just failed, ceiling = 500 * 2^0 = 500
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(0);
    expect(sleepCalls[0]).toBeLessThanOrEqual(500);
    // Second retry: attempt 2 just failed, ceiling = 500 * 2^1 = 1000
    expect(sleepCalls[1]).toBeGreaterThanOrEqual(0);
    expect(sleepCalls[1]).toBeLessThanOrEqual(1000);
  });

  it('defaults maxAttempts to 3', async () => {
    let calls = 0;
    await expect(
      runWithRetry(
        async () => {
          calls += 1;
          throw new OpenAIServerError();
        },
        {
          baseDelayMs: 500,
          maxDelayMs: 8_000,
          jitter: 'none',
          sleep: async () => undefined,
          now: () => 0,
          // maxAttempts intentionally omitted
        } as RetryOptions,
      ),
    ).rejects.toBeInstanceOf(OpenAIServerError);
    expect(calls).toBe(3);
  });

  it('defaults baseDelayMs to 500', async () => {
    const sleepCalls: number[] = [];
    await expect(
      runWithRetry(
        async () => {
          throw new OpenAIServerError();
        },
        {
          maxAttempts: 3,
          maxDelayMs: 8_000,
          jitter: 'none',
          sleep: async (ms: number) => {
            sleepCalls.push(ms);
          },
          now: () => 0,
          // baseDelayMs intentionally omitted
        } as RetryOptions,
      ),
    ).rejects.toBeInstanceOf(OpenAIServerError);
    expect(sleepCalls[0]).toBe(500);
    expect(sleepCalls[1]).toBe(1000);
  });

  it('defaults maxDelayMs to 8_000', async () => {
    const sleepCalls: number[] = [];
    await expect(
      runWithRetry(
        async () => {
          throw new OpenAIServerError();
        },
        {
          maxAttempts: 3,
          baseDelayMs: 500,
          jitter: 'none',
          sleep: async (ms: number) => {
            sleepCalls.push(ms);
          },
          now: () => 0,
          // maxDelayMs intentionally omitted
        } as RetryOptions,
      ),
    ).rejects.toBeInstanceOf(OpenAIServerError);
    // 500 * 2^0 = 500, 500 * 2^1 = 1000 — both within the default 8000 ceiling,
    // so the values are passed through unchanged.
    expect(sleepCalls[0]).toBe(500);
    expect(sleepCalls[1]).toBe(1000);
  });

  it('jitter=none produces base * 2^(attempt-1) deterministically', async () => {
    const sleepCalls: number[] = [];
    await expect(
      runWithRetry(
        async () => {
          throw new OpenAIServerError();
        },
        baseOptions({
          jitter: 'none',
          sleep: async (ms) => {
            sleepCalls.push(ms);
          },
        }),
      ),
    ).rejects.toBeInstanceOf(OpenAIServerError);

    expect(sleepCalls).toEqual([500, 1000]);
  });

  it('clamps server-provided retryAfterMs to maxDelayMs', async () => {
    const sleepCalls: number[] = [];
    let calls = 0;
    await expect(
      runWithRetry(
        async () => {
          calls += 1;
          if (calls === 1) {
            throw new OpenAIRateLimitError(60_000);
          }
          throw new OpenAIServerError();
        },
        baseOptions({
          maxDelayMs: 1_000,
          sleep: async (ms) => {
            sleepCalls.push(ms);
          },
        }),
      ),
    ).rejects.toBeInstanceOf(OpenAIServerError);

    // 60_000 server hint was clamped to maxDelayMs (1_000).
    expect(sleepCalls[0]).toBe(1_000);
    // The next retry uses the jittered exponential backoff (≤ 1_000).
    expect(sleepCalls[1]).toBeLessThanOrEqual(1_000);
    expect(sleepCalls[1]).toBeGreaterThanOrEqual(0);
  });

  it('attaches the attempts array to the thrown ProfileExtractionError on final failure', async () => {
    let caught: unknown;
    try {
      await runWithRetry(
        async () => {
          throw new OpenAIServerError();
        },
        baseOptions({ sleep: async () => undefined }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OpenAIServerError);
    const recorded = (
      caught as OpenAIServerError & {
        attempts?: readonly AttemptRecord[];
      }
    ).attempts;
    expect(recorded).toBeDefined();
    expect(recorded).toHaveLength(3);
    expect(recorded?.[0]?.attemptNumber).toBe(1);
    expect(recorded?.[0]?.succeeded).toBe(false);
    expect(recorded?.[0]?.errorCode).toBe('openai_server_error');
    expect(recorded?.[2]?.attemptNumber).toBe(3);
  });

  it('does not attach the attempts array to non-ProfileExtractionError values', async () => {
    let caught: unknown;
    try {
      await runWithRetry(
        async () => {
          throw new Error('boom');
        },
        baseOptions({ sleep: async () => undefined }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { attempts?: unknown }).attempts).toBeUndefined();
  });

  it('uses the now() seed to produce deterministic jittered delays', async () => {
    const sleepCallsA: number[] = [];
    const sleepCallsB: number[] = [];
    const baseOptionsNoSleep = baseOptions({
      sleep: async (ms: number) => {
        sleepCallsA.push(ms);
      },
    });
    const baseOptionsNoSleep2 = baseOptions({
      sleep: async (ms: number) => {
        sleepCallsB.push(ms);
      },
    });

    await expect(
      runWithRetry(async () => {
        throw new OpenAIServerError();
      }, baseOptionsNoSleep),
    ).rejects.toBeInstanceOf(OpenAIServerError);

    await expect(
      runWithRetry(async () => {
        throw new OpenAIServerError();
      }, baseOptionsNoSleep2),
    ).rejects.toBeInstanceOf(OpenAIServerError);

    // Same `now` source (default `() => 0` in the test baseOptions) and
    // same jitter seed → identical delays across runs.
    expect(sleepCallsA).toEqual(sleepCallsB);
    expect(sleepCallsA[0]).toBeGreaterThanOrEqual(0);
    expect(sleepCallsA[0]).toBeLessThanOrEqual(500);
  });
});
