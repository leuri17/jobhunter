import {
  OPENAI_RETRYABLE_ERROR_CODES,
  OpenAITransientError,
  ProfileExtractionError,
  type RetryAttemptSummary,
} from './errors.js';

/**
 * Configuration for `runWithRetry`.
 *
 * All four retry-shaping fields are optional; the function applies
 * standard defaults (`maxAttempts: 3`, `baseDelayMs: 500`,
 * `maxDelayMs: 8_000`, `jitter: 'full'`) so the CLI can wire up the
 * retry policy from a configuration object without duplicating the
 * defaults. Tests typically pass every field explicitly so the
 * behaviour is obvious.
 *
 * `sleep` and `now` are injectable so tests can exercise the retry
 * timing without sleeping the test process and assert the exact
 * delays without flakes. The retry policy uses `now()` as a seed for
 * a deterministic linear-congruential PRNG when `jitter: 'full' |
 * 'equal'` is active, so a test that fixes `now` and supplies a
 * custom `sleep` will see the same jittered delays across runs.
 * Production code passes `Date.now` (the default) so the seed varies
 * and the resulting backoff is non-deterministic.
 *
 * `jitter` defaults to `'full'` per SPEC §25.3:
 * `delay = random(0, min(maxDelay, base * 2^(attempt-1)))`.
 * `'equal'` is half-jitter (`delay = ceiling / 2 + random(0, ceiling / 2)`).
 * `'none'` disables jitter entirely (`delay = ceiling`).
 *
 * Server-provided `retryAfterMs` (e.g. from a `Retry-After` header) is
 * honored once and clamped to `[0, maxDelayMs]` so a hostile or
 * misconfigured header cannot stall the CLI indefinitely.
 */
export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly jitter?: 'full' | 'equal' | 'none';
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;
const DEFAULT_JITTER: 'full' | 'equal' | 'none' = 'full';

/**
 * Snapshot of a single attempt. The caller can use the array returned
 * from `runWithRetry` to surface attempt counts, error codes, and any
 * server-provided `retryAfterMs` in persistence rows or logs.
 *
 * `AttemptRecord` is the same shape as `RetryAttemptSummary` (defined
 * in `errors.ts`); the alias is re-exported here so the retry policy
 * owns the canonical name without forcing `errors.ts` to import
 * from `retry.ts` (which would create a circular dependency).
 */
export type AttemptRecord = RetryAttemptSummary;

/**
 * Runs `operation` with the SPEC §25.3 retry policy.
 *
 * Behavior:
 * - At most `maxAttempts` total attempts.
 * - Retryable failures (codes in `OPENAI_RETRYABLE_ERROR_CODES`) trigger
 *   a retry until the budget runs out.
 * - `OpenAIInvalidOutputError` is special: it is only retryable once
 *   (the "corrective retry"). A second invalid output aborts.
 * - Non-retryable failures abort immediately.
 * - Backoff is exponential with full jitter (default). Server-provided
 *   `retryAfterMs` (e.g. from a `Retry-After` header) overrides the
 *   computed delay once, is clamped to `[0, maxDelayMs]`, and is then
 *   forgotten for the next retry.
 * - On final failure, the `attempts` array is attached to the thrown
 *   `ProfileExtractionError` (when the error is a `ProfileExtractionError`)
 *   so callers can read `caught.attempts?.length` to record the attempt
 *   count in persistence rows.
 */
export async function runWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<{ readonly value: T; readonly attempts: readonly AttemptRecord[] }> {
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitter = options.jitter ?? DEFAULT_JITTER;
  const now = options.now ?? defaultNow;
  const rng = createSeededRandomInt(now);

  const attempts: AttemptRecord[] = [];
  let invalidOutputRetries = 0;
  let lastError: unknown;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      const value = await operation();
      attempts.push({
        attemptNumber,
        succeeded: true,
        errorCode: null,
        errorMessage: null,
        retryAfterMs: null,
      });
      return { value, attempts };
    } catch (error) {
      lastError = error;

      const errorCode = error instanceof ProfileExtractionError ? error.code : null;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const retryAfterMs = error instanceof OpenAITransientError ? error.retryAfterMs : null;
      const isRetryable = errorCode !== null && OPENAI_RETRYABLE_ERROR_CODES.has(errorCode);
      const isInvalidOutput = errorCode === 'openai_invalid_output';

      const willRetry =
        isRetryable &&
        attemptNumber < maxAttempts &&
        !shouldAbortInvalidOutput(isInvalidOutput, invalidOutputRetries);

      if (isInvalidOutput && willRetry) {
        invalidOutputRetries += 1;
      }

      attempts.push({
        attemptNumber,
        succeeded: false,
        errorCode,
        errorMessage,
        retryAfterMs,
      });

      if (!willRetry) {
        throw annotateAttempts(error, attempts);
      }

      const delay = computeDelay({
        baseDelay,
        maxDelay,
        jitter,
        retryAfterMs,
        attemptNumber,
        rng,
      });

      await sleep(delay);
    }
  }

  throw annotateAttempts(lastError, attempts);
}

function shouldAbortInvalidOutput(isInvalidOutput: boolean, invalidOutputRetries: number): boolean {
  return isInvalidOutput && invalidOutputRetries >= 1;
}

/**
 * Attach the attempt log to a `ProfileExtractionError` so the caller can
 * read `caught.attempts?.length` after the retry loop gave up. Other
 * errors are re-thrown unchanged (they are not retry-policy shaped).
 */
function annotateAttempts(error: unknown, attempts: readonly AttemptRecord[]): unknown {
  if (error instanceof ProfileExtractionError) {
    (error as { attempts?: readonly AttemptRecord[] }).attempts = attempts;
  }
  return error;
}

interface ComputeDelayInputs {
  readonly baseDelay: number;
  readonly maxDelay: number;
  readonly jitter: 'full' | 'equal' | 'none';
  readonly retryAfterMs: number | null;
  readonly attemptNumber: number;
  readonly rng: (min: number, max: number) => number;
}

function computeDelay(inputs: ComputeDelayInputs): number {
  if (inputs.retryAfterMs !== null) {
    // Clamp to [0, maxDelay] so a hostile or misconfigured Retry-After
    // header cannot stall the CLI indefinitely.
    return Math.max(0, Math.min(inputs.retryAfterMs, inputs.maxDelay));
  }

  const ceiling = Math.min(
    inputs.maxDelay,
    inputs.baseDelay * Math.pow(2, inputs.attemptNumber - 1),
  );
  if (inputs.jitter === 'none') {
    return ceiling;
  }
  if (inputs.jitter === 'equal') {
    const half = Math.floor(ceiling / 2);
    return half + inputs.rng(0, half);
  }
  return inputs.rng(0, ceiling);
}

/**
 * Build a deterministic-in-the-test-path PRNG seeded by `now()`. In
 * production, `now()` is `Date.now()`, so the seed varies and the
 * numbers are effectively random. In tests, `now` is fixed so the
 * same jittered delays appear across runs.
 *
 * The PRNG is a linear-congruential generator. It is intentionally
 * simple — we only need varied delays, not cryptographic randomness.
 */
function createSeededRandomInt(now: () => number): (min: number, max: number) => number {
  let state = (Math.floor(now()) ^ 0x9e3779b9) >>> 0;
  return (min, max) => {
    if (max < min) return min;
    state = (state * 1103515245 + 12345) >>> 0;
    const range = max - min + 1;
    return min + (state % range);
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultNow(): number {
  return Date.now();
}
