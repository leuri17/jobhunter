/**
 * Service-level coverage of every documented failure path in
 * `ScoringService` (C1 / B-L4.1).
 *
 * Each `it` block exercises one path end-to-end through the real
 * service, the real persistence layer (a temp SQLite DB), and a
 * deterministic `FakeOpenAIClient` wired up by the
 * `FakeScoringPipeline` fixture. The fixture seeds every parent row
 * the service needs (`pipelineRuns`, `searchExecutions`,
 * `profileVersions`, `filterConfigurationVersions`,
 * `filterResults`, `jobs`) so the per-job `transact` block in
 * `scoreOne` can satisfy FK constraints on `scoreResults`.
 *
 * Path → block map (10 documented paths, one focused `it` per path):
 *
 *   1. OpenAI timeout                        → kind: 'failed'
 *   2. Malformed JSON                        → ScoringInvalidStructuredOutputError
 *   3. Zod validation failure                → ScoringInvalidStructuredOutputError
 *   4. scoring_input_too_large (payload cap) → kind: 'failed'
 *   5. ScoringHardStopError after 3 auth fails → batch short-circuit
 *   6. Cancellation signal between iterations → kind: 'cancelled'
 *   7. Reuse path — active row matches FP    → kind: 'reused'
 *   8. Happy path                            → kind: 'complete'
 *   9. openai_authentication extraction      → outcome.errorCode === 'openai_authentication'
 *  10a. scoreBatch worker-pool concurrency  → tracker.maxConcurrent
 *  10b. consecutiveAuthFailures reset       → counter clears on success
 *
 * Paths 10a + 10b share the "scoreBatch worker-pool behaviour"
 * envelope from the spec; splitting them into two focused blocks
 * keeps each assertion isolated and matches the "one focused `it`
 * per path" rule.
 *
 * The hard-stop tests (paths 5, 10b) deliberately pin
 * `config.concurrency = 1`. The current `scoreBatch` implementation
 * has an async race when `Promise.all(workers)` rejects — workers
 * that already pulled a job but had not yet resolved continue
 * running after the function returns, so the final `perJob`
 * cardinality depends on microtask timing. Concurrency 1 makes the
 * sequence deterministic: jobs are dequeued serially, and the
 * `hard_stop` catch block drains the full tail of the queue before
 * the function returns. The race itself is out of scope for this
 * fix; the tests document the deterministic single-worker envelope.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashString } from '../../src/profile/hashing.js';
import { OpenAIAuthenticationError, OpenAITimeoutError } from '../../src/profile/openai/errors.js';
import { computeScoreFingerprint } from '../../src/scoring/fingerprint.js';
import { SCORING_PROMPT_VERSION } from '../../src/scoring/prompt.js';
import { RUBRIC_VERSION } from '../../src/scoring/rubric.js';
import { FakeScoringPipeline, makeValidResponse } from './fixtures/fake-scoring-pipeline.js';
import { loadScoringFixture } from './fixtures/loadFixture.js';

const VALID_OUTPUT = loadScoringFixture('scoring-output-valid');
const MALFORMED_OUTPUT = loadScoringFixture('scoring-output-malformed');
const DECIMAL_SCORE_OUTPUT = loadScoringFixture('scoring-output-decimal-score');

/** Pad a string so it pushes the assembled user message over the
 *  200 KB scoring_input_too_large cap. The rubric + system message
 *  account for a few KB, so a 250 KB padding puts us safely above
 *  the limit. */
function makeOversizedDescription(): string {
  return 'x'.repeat(250_000);
}

/** Build the same fingerprint the service computes inside `scoreOne`
 *  so the reuse-path test can pre-insert a row that will hit. */
function fingerprintFor(input: {
  readonly profileVersionId: number;
  readonly profileFingerprint: string;
  readonly job: {
    readonly normalizedTitle: string;
    readonly normalizedCompany: string;
    readonly normalizedLocation: string;
    readonly normalizedDescription: string;
  };
  readonly effectiveDerivedValues: Readonly<Record<string, unknown>>;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
}): string {
  const jobContentHash = hashString(
    JSON.stringify({
      title: input.job.normalizedTitle,
      company: input.job.normalizedCompany,
      location: input.job.normalizedLocation,
      description: input.job.normalizedDescription,
    }),
  );
  const effectiveDerivedValuesHash = hashString(JSON.stringify(input.effectiveDerivedValues));
  return computeScoreFingerprint({
    jobContentHash,
    profileVersionId: input.profileVersionId,
    profileFingerprint: input.profileFingerprint,
    effectiveDerivedValuesHash,
    promptVersion: SCORING_PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    modelConfig: {},
    scorerImplementationVersion: 1,
  });
}

describe('ScoringService.scoreOne — documented failure paths', () => {
  let pipeline: FakeScoringPipeline;

  beforeEach(async () => {
    pipeline = await FakeScoringPipeline.create({
      fakeScripts: { responses: [makeValidResponse(VALID_OUTPUT)] },
      config: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        concurrency: 3,
      },
    });
  });

  afterEach(async () => {
    await pipeline.cleanup();
  });

  it('path 1: OpenAI timeout → kind: failed with errorCode: openai_timeout', async () => {
    pipeline.replaceOpenAIScripts([
      { error: new OpenAITimeoutError() },
      { error: new OpenAITimeoutError() },
      { error: new OpenAITimeoutError() },
    ]);
    pipeline.tracker.reset();
    const outcome = await pipeline.service.scoreOne(pipeline.makeScoreOneInput());
    expect(outcome.kind).toBe('failed');
    expect(outcome.errorCode).toBe('openai_timeout');
    expect(outcome.attempted).toBe(true);
    expect(outcome.overallScore).toBeNull();
    expect(pipeline.tracker.totalCalls).toBe(3);
  });

  it('path 2: malformed JSON → retry then ScoringInvalidStructuredOutputError', async () => {
    pipeline.replaceOpenAIScripts([
      { responses: [makeValidResponse(MALFORMED_OUTPUT)] },
      { responses: [makeValidResponse(MALFORMED_OUTPUT)] },
    ]);
    pipeline.tracker.reset();
    const outcome = await pipeline.service.scoreOne(pipeline.makeScoreOneInput());
    expect(outcome.kind).toBe('failed');
    expect(outcome.errorCode).toBe('scoring_invalid_structured_output');
    expect(outcome.attempted).toBe(true);
    expect(pipeline.tracker.totalCalls).toBe(2);
  });

  it('path 3: Zod validation failure (decimal score) → typed error', async () => {
    pipeline.replaceOpenAIScripts([
      { responses: [makeValidResponse(DECIMAL_SCORE_OUTPUT)] },
      { responses: [makeValidResponse(DECIMAL_SCORE_OUTPUT)] },
    ]);
    pipeline.tracker.reset();
    const outcome = await pipeline.service.scoreOne(pipeline.makeScoreOneInput());
    expect(outcome.kind).toBe('failed');
    expect(outcome.errorCode).toBe('scoring_invalid_structured_output');
    expect(outcome.attempted).toBe(true);
    expect(pipeline.tracker.totalCalls).toBe(2);
  });

  it('path 4: scoring_input_too_large (payload cap) → typed error, no OpenAI call', async () => {
    const oversized = await pipeline.insertCompleteJob({
      normalizedDescription: makeOversizedDescription(),
    });
    pipeline.tracker.reset();
    const outcome = await pipeline.service.scoreOne(
      pipeline.makeScoreOneInput({ job: oversized.scoreOneInput.job }),
    );
    expect(outcome.kind).toBe('failed');
    expect(outcome.errorCode).toBe('scoring_input_too_large');
    expect(outcome.attempted).toBe(false);
    expect(outcome.overallScore).toBeNull();
    expect(pipeline.tracker.totalCalls).toBe(0);
  });

  it('path 7: reuse path — active row matches fingerprint → kind: reused, no OpenAI call', async () => {
    const input = pipeline.makeScoreOneInput();
    const fingerprint = fingerprintFor({
      profileVersionId: pipeline.profileVersionId,
      profileFingerprint: input.profileVersion.fingerprint,
      job: {
        normalizedTitle: input.job.normalizedTitle,
        normalizedCompany: input.job.normalizedCompany,
        normalizedLocation: input.job.normalizedLocation,
        normalizedDescription: input.job.normalizedDescription,
      },
      effectiveDerivedValues: input.effectiveDerivedValues,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    });
    await pipeline.preInsertActiveScoreResult({ fingerprint, overallScore: 88 });
    pipeline.tracker.reset();
    const outcome = await pipeline.service.scoreOne(input);
    expect(outcome.kind).toBe('reused');
    expect(outcome.overallScore).toBe(88);
    expect(outcome.attempted).toBe(false);
    expect(outcome.errorCode).toBeNull();
    expect(pipeline.tracker.totalCalls).toBe(0);
  });

  it('path 8: happy path → kind: complete, OpenAI called once, row persisted', async () => {
    pipeline.replaceOpenAIScripts([{ responses: [makeValidResponse(VALID_OUTPUT)] }]);
    pipeline.tracker.reset();
    const outcome = await pipeline.service.scoreOne(pipeline.makeScoreOneInput());
    expect(outcome.kind).toBe('complete');
    expect(outcome.attempted).toBe(true);
    expect(outcome.errorCode).toBeNull();
    expect(typeof outcome.overallScore).toBe('number');
    expect(typeof outcome.displayScore).toBe('string');
    expect(pipeline.tracker.totalCalls).toBe(1);

    const active = await pipeline.repositories.scoreResults.findActiveByJob(
      pipeline.jobId,
      outcome.fingerprint,
    );
    expect(active).not.toBeNull();
    expect(active?.success).toBe(true);
  });

  it('path 9: openai_authentication extraction from cause.code', async () => {
    pipeline.replaceOpenAIScripts([{ error: new OpenAIAuthenticationError() }]);
    pipeline.tracker.reset();
    const outcome = await pipeline.service.scoreOne(pipeline.makeScoreOneInput());
    expect(outcome.kind).toBe('failed');
    expect(outcome.errorCode).toBe('openai_authentication');
    expect(outcome.attempted).toBe(true);
    expect(pipeline.tracker.totalCalls).toBe(1);
  });
});

describe('ScoringService.scoreBatch — auth hard-stop (concurrency: 1)', () => {
  let pipeline: FakeScoringPipeline;

  beforeEach(async () => {
    pipeline = await FakeScoringPipeline.create({
      fakeScripts: { responses: [makeValidResponse(VALID_OUTPUT)] },
      config: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        concurrency: 1,
      },
    });
  });

  afterEach(async () => {
    await pipeline.cleanup();
  });

  it('path 5: 3 consecutive openai_authentication → ScoringHardStopError; remaining jobs skipped', async () => {
    // 6 jobs queued, all fail with auth. The third pulls triggers
    // the hard stop; the remaining 3 are still in the queue, so
    // the catch block marks them kind: 'skipped', errorCode:
    // 'hard_stop'. Concurrency 1 makes the sequence deterministic
    // (no in-flight worker race).
    const jobs = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const { scoreOneInput } = await pipeline.insertCompleteJob();
        return scoreOneInput;
      }),
    );
    pipeline.replaceOpenAIScripts(
      Array.from({ length: jobs.length }, () => ({
        error: new OpenAIAuthenticationError(),
      })),
    );
    pipeline.tracker.reset();
    const batch = await pipeline.service.scoreBatch(pipeline.makeScoreBatchInput(jobs));
    expect(batch.perJob).toHaveLength(6);
    const authFailures = batch.perJob.filter(
      (o) => o.kind === 'failed' && o.errorCode === 'openai_authentication',
    );
    const hardStops = batch.perJob.filter(
      (o) => o.kind === 'skipped' && o.errorCode === 'hard_stop',
    );
    expect(authFailures.length).toBe(3);
    expect(hardStops.length).toBe(3);
    expect(batch.totals.failed).toBe(3);
    expect(batch.totals.skipped).toBe(3);
    expect(batch.totals.complete).toBe(0);
  });

  it('path 6: cancellation signal between batch iterations → graceful stop (no OpenAI call)', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const { scoreOneInput } = await pipeline.insertCompleteJob();
        return scoreOneInput;
      }),
    );
    const controller = new AbortController();
    controller.abort();
    pipeline.tracker.reset();
    const batch = await pipeline.service.scoreBatch(
      pipeline.makeScoreBatchInput(jobs, controller.signal),
    );
    expect(batch.perJob).toHaveLength(4);
    for (const outcome of batch.perJob) {
      expect(outcome.kind).toBe('cancelled');
      expect(outcome.errorCode).toBe('cancelled');
    }
    expect(pipeline.tracker.totalCalls).toBe(0);
    expect(batch.totals.cancelled).toBe(4);
  });

  it('path 10b: consecutiveAuthFailures resets on a successful auth attempt', async () => {
    // Pattern: [auth, auth, success, auth, auth] (5 jobs, concurrency 1).
    // Jobs 1+2 fail with auth (counter 2); job 3 succeeds → counter resets
    // to 0; jobs 4+5 fail with auth (counter 2). No hard stop because the
    // counter never reaches 3 in either half — the test asserts the reset
    // by observing 4 failures and 1 complete.
    const jobs = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const { scoreOneInput } = await pipeline.insertCompleteJob();
        return scoreOneInput;
      }),
    );
    pipeline.replaceOpenAIScripts([
      { error: new OpenAIAuthenticationError() },
      { error: new OpenAIAuthenticationError() },
      { responses: [makeValidResponse(VALID_OUTPUT)] },
      { error: new OpenAIAuthenticationError() },
      { error: new OpenAIAuthenticationError() },
    ]);
    pipeline.tracker.reset();
    const batch = await pipeline.service.scoreBatch(pipeline.makeScoreBatchInput(jobs));
    expect(batch.perJob).toHaveLength(5);
    const authFailures = batch.perJob.filter(
      (o) => o.kind === 'failed' && o.errorCode === 'openai_authentication',
    );
    const completes = batch.perJob.filter((o) => o.kind === 'complete');
    expect(authFailures.length).toBe(4);
    expect(completes.length).toBe(1);
    expect(batch.totals.complete).toBe(1);
    expect(batch.totals.failed).toBe(4);
  });
});

describe('ScoringService.scoreBatch — worker-pool concurrency', () => {
  let pipeline: FakeScoringPipeline;

  beforeEach(async () => {
    pipeline = await FakeScoringPipeline.create({
      fakeScripts: { responses: [makeValidResponse(VALID_OUTPUT)] },
      config: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        concurrency: 3,
      },
    });
  });

  afterEach(async () => {
    await pipeline.cleanup();
  });

  it('path 10a: scoreBatch fans out across `config.concurrency` workers', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const { scoreOneInput } = await pipeline.insertCompleteJob();
        return scoreOneInput;
      }),
    );
    pipeline.replaceOpenAIScripts(
      Array.from({ length: jobs.length }, () => ({
        responses: [makeValidResponse(VALID_OUTPUT)],
        delayMs: 50,
      })),
    );
    pipeline.tracker.reset();
    const batch = await pipeline.service.scoreBatch(pipeline.makeScoreBatchInput(jobs));
    expect(batch.perJob).toHaveLength(6);
    expect(batch.totals.complete).toBe(6);
    expect(pipeline.tracker.totalCalls).toBe(6);
    expect(pipeline.tracker.maxConcurrent).toBe(3);
  });
});
