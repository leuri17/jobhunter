# TASK-014 Plan — Revision 1 (post-recon corrections)

> **Status:** Revision 1 supersedes the original plan in `docs/superpowers/plans/2026-08-20-task-014-openai-scoring-ranking.md`. The original is preserved for reference; this document lists the specific corrections.
>
> **Recon sources:** `@explorer` recon (`ses_fe0f0e778ffeoa5803m9MYayQp`) + `@oracle` architecture review (`ses_fe0f0ba96ffeP98g04UOXUbSQz`).
>
> **Date:** 2026-08-20.

This revision resolves the 3 blockers and 6 high-priority follow-ups identified in the review. The implementing agent must read the original plan first, then apply the corrections below.

---

## 0. Resolution summary

| # | Issue | Severity | Resolution |
|---|---|---|---|
| B1 | `OpenAIClient.extract` cannot serve scoring (hardcoded response schema, no per-call `maxCompletionTokens`, no `messages` array) | **BLOCKER** | New **Task 0** — extend the client surface (see §1 below) |
| B2 | Task 12 sketch silently drops 5 audit columns (`explanation`, `keyMatchesJson`, `importantGapsJson`, `importantConcernsJson`, `inferredSeniority`, `recommendationSummary`) | **BLOCKER** | Revised Task 12 sketch (see §3 below) — map `raw` to all existing columns |
| B3 | "3 consecutive auth failures" hard-stop under-defined (no counter, no test) | **BLOCKER** | Explicit counter in `scoreBatch` (see §2 Decision 19 update) |
| H1 | No 200 KB boundary test (200,000 vs 200,001 bytes) | HIGH | Add to Task 11 + Task 12 (see §4) |
| H2 | Decision 3 doesn't document the two-call pattern | HIGH | Updated Decision 3 (see §2) |
| H3 | `scoreBatch` concurrency under-specified | HIGH | Worker-pool loop specification (see §2 + §3) |
| H4 | Unnecessary `transact` → `db.transaction` nesting | HIGH | Simplified pattern (see §3) |
| H5 | No snapshot assertion for the assembled OpenAI payload (F9 §25.7) | HIGH | Add to Task 12 (see §4) |
| H6 | `ScoringFieldSet` duplicates the Zod-derived shape | HIGH | Derive via `z.infer<typeof ScoringStructuredOutputSchema>` |
| — | Reference errors throughout (see §5) | MEDIUM | Rename throughout |
| — | Line number errors (see §6) | LOW | Fix throughout |

---

## 1. New Task 0 — OpenAI client surface refactor (BLOCKER B1)

**Files:**
- Modify: `src/profile/openai/types.ts:40-47` (add `maxCompletionTokens?` to `OpenAIExtractionRequest`)
- Modify: `src/profile/openai/client.ts:56-98` (replace hardcoded `STRUCTURED_OUTPUT_SCHEMA` with a registry)
- Modify: `src/profile/openai/prompt.ts:25-94` (export the schema registry; keep `STRUCTURED_OUTPUT_SCHEMA` as the entry for profile extraction)
- Modify: `src/profile/openai/index.ts` (re-export the new surface)
- Create: `src/scoring/schema.ts` (the scoring-specific Zod schema + JSON-Schema projection; not the prompt)
- Modify: `tests/profile/openai/client.test.ts` (extend the test seam)

**Goal:** Make `OpenAIClient.extract` reusable for scoring. Three concrete changes:

1. **Add `maxCompletionTokens?: number`** to `OpenAIClient.extract` request type. Wire it into the SDK call as `max_completion_tokens: request.maxCompletionTokens ?? undefined` (or omit when undefined to use the OpenAI default).

2. **Replace the hardcoded `STRUCTURED_OUTPUT_SCHEMA`** with a registry keyed by `responseSchemaName`. The current `createDefaultOpenAIClient` hardcodes the profile extraction schema. The fix: export a `RESPONSE_SCHEMA_REGISTRY: Readonly<Record<string, JSONSchemaType>>` from `src/profile/openai/prompt.ts` (or a new `src/profile/openai/response-schemas.ts`). The registry holds both the profile extraction schema (under `'ExtractedProfile'`) and the scoring schema (under `'ScoringStructuredOutput'`, re-exported from `src/scoring/schema.ts`). The client looks up the schema by `request.responseSchemaName` and throws if the name is not in the registry.

3. **Re-export the scoring schema** from `src/scoring/schema.ts` (Zod source of truth) and its JSON-Schema projection (re-using the `applyStrictModeAdjustments` pattern from `src/profile/openai/prompt.ts`). The projection is registered under `'ScoringStructuredOutput'`.

**`scoring/schema.ts` (sketch):**

```ts
import { z } from 'zod';
import { SCORING_CATEGORIES, type ScoringCategory } from './state.js';

export const ScoringCategoryScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string(),
  evidence: z.array(z.string()),
}).strict();

export const ScoringStructuredOutputSchema = z.object({
  categoryScores: z.object(
    Object.fromEntries(SCORING_CATEGORIES.map((cat) => [cat, ScoringCategoryScoreSchema])) as Record<ScoringCategory, typeof ScoringCategoryScoreSchema>,
  ).strict(),
  keyMatches: z.array(z.string()),
  importantGaps: z.array(z.string()),
  importantConcerns: z.array(z.string()),
  inferredSeniority: z.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'unknown']),
  recommendationSummary: z.string(),
}).strict();

export type ScoringStructuredOutput = z.infer<typeof ScoringStructuredOutputSchema>;
export type ScoringFieldSet = ScoringStructuredOutput; // (H6) — single source of truth

export const SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION = 1 as const;
export type ScoringStructuredOutputSchemaVersion = typeof SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION;
```

**Registry export (from `src/profile/openai/prompt.ts` or new file):**

```ts
import { ScoringStructuredOutputSchema as ScoringSchema } from '../../scoring/schema.js';

export const RESPONSE_SCHEMA_REGISTRY: Readonly<Record<string, { schema: unknown; version: number }>> = {
  ExtractedProfile: { schema: STRUCTURED_OUTPUT_SCHEMA, version: 1 },
  ScoringStructuredOutput: { schema: ScoringSchema.toJSONSchema(), version: 1 },
};
```

**Tests:**
- `extract` with a known `responseSchemaName` returns the correct schema's JSON in the response.
- `extract` with an unknown `responseSchemaName` throws `OpenAIInvalidRequestError` (config error, not a runtime error).
- `extract` with `maxCompletionTokens: 2000` passes `max_completion_tokens: 2000` to the SDK (verify via fake SDK).
- `extract` without `maxCompletionTokens` omits `max_completion_tokens` from the SDK call (verify the SDK receives no such field).

**Verify by running:** `pnpm typecheck` exit 0; `pnpm test tests/profile/openai/client.test.ts` passes; `pnpm test tests/profile/openai` passes (no regressions).

---

## 2. Updated 26 decisions

The original 26-decision table is mostly correct. The following rows are updated:

### Decision 3 (Per-job flow) — UPDATED (H2)

> **Per-job flow.** `ScoringService.scoreOne({ run, searchExecution, job, profileVersion, effectiveDerivedValues, filterResult, signal }) → Promise<ScoringOutcome>`. Per-job sequence:
>
> **(a) check eligibility** via `isJobEligibleForScoring`;
> **(b) read existing `scoreResults` row by fingerprint** via the EXISTING `findActiveByJob(jobId, fingerprint)` (at `src/persistence/repositories/score-results.ts:141-155`).
> **(c) THREE CASES:**
>  - **No active row** → call OpenAI; on success, call `txRepos.scoreResults.activateResult({...allColumns...})` (which atomically UPDATEs the previous active row to `active: false` AND INSERTs the new row with `active: true` in a single `db.transaction`).
>  - **Active row with matching fingerprint** → return `kind: 'reused'` with the cached `overallScore` (NO OpenAI call, NO new `openaiMetadata` row).
>  - **Active row with different fingerprint** → same as "no row" case: call OpenAI + call `activateResult` (which replaces the stale active row atomically).
>
> The two-call pattern is correct because `activateResult` handles the "stale" case internally — no separate `markStale` method is needed.
>
> OpenAI call: `runWithRetry({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8_000, jitter: 'full', operation: async () => { ... } })`. The retry budget is per-job, NOT shared across the batch. Build prompt (excludes all SPEC §25.7 prohibited fields). Call OpenAI via the EXTENDED `OpenAIClient.extract()` method (Task 0; the request now accepts `maxCompletionTokens` + arbitrary `responseSchemaName`). Validate the `rawJsonText` response via INLINE `JSON.parse` + `ScoringStructuredOutputSchema.safeParse` (mirrors `src/profile/extraction-service.ts:344` — no `parseStructuredOutput` function exists). Compute `overallScore` in JobHunter via `computeOverallScore`. Format `displayScore` on read via `formatDisplayScore` (per F8 — not persisted). Persist `scoreResults` row + `openaiMetadata` row atomically inside `this.repositories.transact((txRepos) => { ... })` (the sync callback pattern from `src/persistence/repositories/index.ts:59-64`); the `activateResult` method (at `score-results.ts:92-139`) atomically UPDATEs the previous active row to `active: false` AND INSERTs the new row with `active: true` — NO stale-detection inconsistency window.

### Decision 11 (Retry policy) — UPDATED

> REUSE `runWithRetry` from `src/profile/openai/retry.ts:81-152` with EXACT defaults: `maxAttempts: 3`, `baseDelayMs: 500`, `maxDelayMs: 8_000`, `jitter: 'full'`. The `invalid structured output` retry is the "corrective retry" — at most one (per SPEC §25.3). `Retry-After` header is parsed via `parseRetryAfterMs` (at `client.ts:245-260`), clamped to `[0, maxDelayMs]`, applied once, consumed. NO new retry-policy code.
>
> **Cancellation seam:** the `runWithRetry` operation callback checks `signal.aborted` BEFORE each attempt (not just after returning). If `signal.aborted` is set mid-retry-budget, the loop throws `AbortError` and the per-job outcome is `kind: 'cancelled'`. The OpenAI SDK may complete a retry that's already in flight after `signal.aborted` is set — the orchestrator discards the result and does NOT consume the retry budget retroactively.

### Decision 12 (Structured output schema) — UPDATED (B1)

> `ScoringStructuredOutputSchema` (Zod) lives in `src/scoring/schema.ts` (per H6: `ScoringFieldSet` is derived via `z.infer<typeof ScoringStructuredOutputSchema>` — single source of truth). Shape: 7 category objects (each: `score: z.number().int().min(0).max(100)`, `explanation: z.string()`, `evidence: z.array(z.string())`) + `keyMatches: z.array(z.string())` + `importantGaps: z.array(z.string())` + `importantConcerns: z.array(z.string())` + `inferredSeniority: z.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'unknown'])` + `recommendationSummary: z.string()`. Every nested object uses `.strict()` to reject unknown keys. Bump `SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION` on any change. Reuse the manual JSON-Schema projection from `src/profile/openai/prompt.ts` to pass the schema to OpenAI via the `RESPONSE_SCHEMA_REGISTRY` (Task 0). The `OpenAIClient.extract` request sets `responseSchemaName: 'ScoringStructuredOutput'` + `structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION` + `maxCompletionTokens: 2000` (now reachable via Task 0).

### Decision 19 (Typed errors) — UPDATED (B3)

> `ScoringError` base (extends `ApplicationError`, exit `ExitCode.OpenAIFailure = 5`). Subclasses: `ScoringInputTooLargeError` (non-retryable; per §25.8), `ScoringInvalidStructuredOutputError` (retryable once per §25.3), `ScoringPersistenceError` (non-retryable; DB error), `ScoringFingerprintMismatchError` (internal; surfaces data corruption). Per-job errors are NOT thrown across the `scoreOne` boundary — surfaced via `ScoringOutcome.kind: 'failed'` and persisted to `openaiMetadata` with `success: false`.
>
> **Hard-stop mechanism (B3):** `scoreBatch` maintains a `consecutiveAuthFailures: number` counter. After EACH per-job outcome with `kind: 'failed'` AND `errorCode === 'openai_authentication'`, the counter increments. After ANY non-auth outcome (or `kind: 'complete' | 'reused' | 'skipped' | 'cancelled'`), the counter resets to 0. When the counter reaches **3**, `scoreBatch` throws `ScoringError` with a `hard_stop_consecutive_auth_failures` code (a NEW subclass). Subsequent jobs in the batch are NOT processed; partial results are returned to the caller. The orchestrator (TASK-015) catches this error and maps it to a clean exit.
>
> A new `ScoringHardStopError` subclass extends `ScoringError` and carries metadata `{ consecutiveAuthFailures: number }`. It is NOT a per-job error — it aborts the batch.

### Decision 22 (Fixture harness) — UPDATED (H1, H5)

> New `tests/scoring/fixtures/` directory with: `scoring-input-job.json` (a complete job with all 4 fields populated), `scoring-input-payload.json` (the assembled OpenAI request body, with NO prohibited fields per §25.7 — **this is the snapshot oracle for the F9 §25.7 test assertion**), `scoring-output-valid.json` (a valid structured response), `scoring-output-malformed.json` (fails Zod validation — invalid JSON syntax), `scoring-output-category-out-of-bounds.json` (score 150, violates `.max(100)`), `scoring-output-missing-field.json` (no `recommendationSummary`), `scoring-output-extra-field.json` (extra `secretNote` field, violates `.strict()`), `scoring-output-decimal-score.json` (score 87.5, violates `.int()`), `scoring-output-unknown-seniority.json` (seniority "intern", not in the enum). Reuses `loadFixture` helper from `tests/linkedin/fixtures/loadFixture.ts`.
>
> **Boundary fixture (H1):** add `scoring-input-payload-200000-bytes.json` (exactly 200,000 bytes) + `scoring-input-payload-200001-bytes.json` (200,001 bytes — one over the cap). Used by Task 12 tests #5a + #5b.

### Decision 23 (Integration test seam) — UPDATED

> New `tests/scoring/helpers/fake-scoring-pipeline.ts` — a helper that wires the `FakeOpenAIClient` (from `src/profile/openai/fake-client.ts`) into the `ScoringService` for hermetic integration tests. The fake client can be programmed to return specific responses (valid, malformed, timeout, rate-limit, etc.) per call. NO fake repositories — the integration test uses the REAL `createRepositories(connection)` over a `mkdtempSync` DB (mirrors the TASK-013 pattern at `tests/extraction/service.test.ts`).

### Decision 26 (Boundaries guard) — UPDATED

> New `tests/scoring/boundaries.test.ts` (mirror `tests/extraction/boundaries.test.ts`): enumerates `src/scoring/*.ts`, bans runtime imports of `commander`, `@inquirer/prompts`, `drizzle-orm`, `openai`, runtime `pino`. NO `DRIZZLE_ORM_ALLOW_LIST` carve-out needed — the service uses `this.repositories.transact(...)` (the sync callback pattern from `src/persistence/repositories/index.ts:59-64`) which goes through the repositories' methods and does NOT import `drizzle-orm` directly. The scoring service MAY import FROM `src/profile/openai/` (cross-module dependency is allowed). The `openai` runtime import lives in `src/profile/openai/client.ts:1-11` (TASK-008) — `src/scoring/` MUST NOT import the `openai` package directly. Ban `process.exit(...)`.

---

## 3. Revised Task 12 sketch (BLOCKER B2, H3, H4)

**File:** `src/scoring/service.ts`

```ts
import type { Repositories } from '../persistence/repositories/index.js';
import type { OpenAIClient } from '../profile/openai/client.js';
import { runWithRetry } from '../profile/openai/retry.js';
import { DiagnosticManager } from '../../diagnostics/manager.js';
import { isJobEligibleForScoring } from './eligibility.js';
import { buildScoringPrompt, SCORING_PROMPT_VERSION } from './prompt.js';
import { ScoringStructuredOutputSchema, SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION } from './schema.js';
import { computeOverallScore, formatDisplayScore } from './score-formula.js';
import { computeScoreFingerprint, SCORER_IMPLEMENTATION_VERSION } from './fingerprint.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from './state.js';
import { noopScoringLogger, type ScoringLogger } from './log.js';
import { ScoringError, ScoringInputTooLargeError, ScoringInvalidStructuredOutputError, ScoringHardStopError } from './errors.js';

const MAX_INPUT_BYTES = 200_000;
const CONSECUTIVE_AUTH_FAILURE_LIMIT = 3;

export interface ScoringServiceOptions {
  readonly repositories: Repositories;
  readonly openaiClient: OpenAIClient;
  readonly diagnosticManager: DiagnosticManager;
  readonly logger?: ScoringLogger;
  readonly config: {
    readonly model: string;
    readonly reasoningEffort: string;
    readonly concurrency: number;
  };
  readonly now?: () => Date;
}

export interface ScoreOneInput { /* unchanged */ }

export class ScoringService {
  async scoreOne(input: ScoreOneInput): Promise<ScoringOutcome> {
    const startedAt = this.now().toISOString();

    // (a) eligibility
    if (!isJobEligibleForScoring({ job: input.job, filterResult: input.filterResult })) {
      this.logger.scoringSkip({ jobId: input.job.id, reason: 'ineligible' });
      return { kind: 'skipped', /* ... */ };
    }

    // (b) build payload + fingerprint
    const payload = buildScoringPrompt({ /* ... */ });
    const fingerprint = computeScoreFingerprint({ /* ... */ });
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');

    // (c) input-too-large guard (B1: hardcoded)
    if (payloadBytes > MAX_INPUT_BYTES) {
      this.logger.scoringFail({ jobId: input.job.id, errorCode: 'scoring_input_too_large' });
      // Per-job error: return kind: 'failed' (no throw across the boundary)
      return { kind: 'failed', errorCode: 'scoring_input_too_large', errorMessage: `...`, /* ... */ };
    }

    // (d) check for existing active score by fingerprint
    const existing = await this.repositories.scoreResults.findActiveByJob(input.job.id, fingerprint);
    if (existing !== null) {
      this.logger.scoringReuse({ jobId: input.job.id, fingerprint, previousScoreTimestamp: existing.timestamp });
      return {
        kind: 'reused',
        overallScore: existing.overallScore,
        displayScore: formatDisplayScore(existing.overallScore),
        fingerprint,
        /* ... */
      };
    }

    // (e) call OpenAI via runWithRetry (signal checked between attempts)
    const raw = await runWithRetry({
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 8_000,
      jitter: 'full',
      operation: async () => {
        if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = await this.openaiClient.extract({
          promptVersion: `v${SCORING_PROMPT_VERSION}`,
          model: this.config.model,
          reasoningEffort: this.config.reasoningEffort,
          sources: [{ kind: 'cv_text', identifier: `job-${input.job.id}-scoring`, content: JSON.stringify(payload) }],
          responseSchemaName: 'ScoringStructuredOutput', // Task 0
          structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
          maxCompletionTokens: 2000, // Task 0
        });
        let parsed: unknown;
        try { parsed = JSON.parse(response.rawJsonText); } // .rawJsonText is on the RESPONSE
        catch { throw new ScoringInvalidStructuredOutputError({ attemptNumber: 0, validationError: 'invalid_json_or_refusal' }); }
        const result = ScoringStructuredOutputSchema.safeParse(parsed);
        if (!result.success) throw new ScoringInvalidStructuredOutputError({ attemptNumber: 0, validationError: result.error.message });
        return result.data;
      },
    });

    // (f) compute overall score in JobHunter
    const overallScore = computeOverallScore(raw.categoryScores);
    const displayScore = formatDisplayScore(overallScore);
    const completedAt = this.now().toISOString();

    // (g) persist atomically via SINGLE transact (H4: no nested transaction)
    // Map raw to ALL scoreResults columns (B2: no audit-field drops)
    let newScoreResultId: number;
    this.repositories.transact((txRepos) => {
      newScoreResultId = txRepos.scoreResults.activateResult({
        jobId: input.job.id,
        pipelineRunId: input.run.id,
        filterResultId: input.filterResult.id,
        fingerprint,
        timestamp: completedAt,
        promptVersion: `v${SCORING_PROMPT_VERSION}`,
        rubricVersion: RUBRIC_VERSION,
        model: this.config.model,
        reasoningEffort: this.config.reasoningEffort,
        scorerImplementationVersion: SCORER_IMPLEMENTATION_VERSION,
        categoryScoresJson: raw.categoryScores,        // 7-category object
        overallScore,                                  // full precision
        explanation: raw.recommendationSummary,        // B2: per-aggregate explanation OR a synthesized one
        keyMatchesJson: raw.keyMatches,
        importantGapsJson: raw.importantGaps,
        importantConcernsJson: raw.importantConcerns,
        inferredSeniority: raw.inferredSeniority,
        recommendationSummary: raw.recommendationSummary,
        success: true,
        errorCode: null,
        errorMessage: null,
      });
      txRepos.openaiMetadata.insert({
        relatedEntityType: 'score_result',
        relatedEntityId: newScoreResultId,
        operationType: 'job_scoring',
        inputHashesJson: { /* ... */ },
        promptVersion: `v${SCORING_PROMPT_VERSION}`,
        structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
        model: this.config.model,
        reasoningEffort: this.config.reasoningEffort,
        configJson: { /* ... */ },
        tokenUsageJson: { /* from response.tokenUsage */ },
        validatedOutputJson: raw,
        attemptCount: /* from runWithRetry result */,
        startTimestamp: startedAt,
        endTimestamp: completedAt,
        success: true,
        errorCode: null,
        errorMessage: null,
      });
    });

    return { kind: 'complete', overallScore, displayScore, fingerprint, fields: raw };
  }

  // scoreBatch uses a WORKER-POOL loop (H3) — not chunked Promise.all
  async scoreBatch(input: ScoreBatchInput): Promise<ScoringBatchOutcome> {
    const outcomes: ScoringOutcome[] = [];
    const queue = [...input.jobs];
    const workers: Promise<void>[] = [];
    let consecutiveAuthFailures = 0; // B3: hard-stop counter

    const processNext = async (): Promise<void> => {
      while (queue.length > 0) {
        if (input.signal.aborted) {
          while (queue.length > 0) {
            const job = queue.shift()!;
            outcomes.push({ kind: 'cancelled', /* ... */, jobId: job.id, sourceJobId: job.sourceJobId });
          }
          return;
        }
        const job = queue.shift()!;
        const outcome = await this.scoreOne({ /* ... */, signal: input.signal });
        outcomes.push(outcome);

        if (outcome.kind === 'failed' && outcome.errorCode === 'openai_authentication') {
          consecutiveAuthFailures += 1;
          if (consecutiveAuthFailures >= CONSECUTIVE_AUTH_FAILURE_LIMIT) {
            throw new ScoringHardStopError({ consecutiveAuthFailures });
          }
        } else {
          consecutiveAuthFailures = 0; // reset on any non-auth outcome
        }
      }
    };

    for (let i = 0; i < Math.min(this.config.concurrency, input.jobs.length); i++) {
      workers.push(processNext());
    }
    try {
      await Promise.all(workers);
    } catch (cause) {
      if (cause instanceof ScoringHardStopError) {
        // mark remaining jobs as skipped
        while (queue.length > 0) {
          const job = queue.shift()!;
          outcomes.push({ kind: 'skipped', /* ... */, jobId: job.id, sourceJobId: job.sourceJobId, errorCode: 'hard_stop' });
        }
      } else {
        throw cause;
      }
    }

    return { /* aggregate from outcomes */ };
  }
}
```

**Test additions for Task 12:**
- #5a: payload = 200,000 bytes → `kind: 'complete'`.
- #5b: payload = 200,001 bytes → `kind: 'failed'`, `errorCode: 'scoring_input_too_large'`, NO OpenAI call.
- #13: 3 consecutive `openai_authentication` outcomes → `ScoringHardStopError` thrown; remaining jobs `kind: 'skipped'`, `errorCode: 'hard_stop'`.
- #14: 2 auth failures + 1 success → counter resets; subsequent jobs proceed normally.
- #15: snapshot assertion: `expect(assembledPayload).toEqual(loadFixture('scoring-input-payload'))` (H5 — F9 §25.7 oracle).
- #16: stale-detection path: existing row with mismatched fingerprint → `activateResult` writes the new row + marks the old row `active: false` (verify via 2 rows in `scoreResults`, only 1 with `active: true`).
- #17: cancellation mid-batch: signal aborted after the first job → second job `kind: 'cancelled'`, no `openaiMetadata` row written.
- #18: `scoreBatch` concurrency: 6 jobs + `concurrency: 3` → at most 3 in-flight at any time (verify via `FakeOpenAIClient.requestTimestamps`).
- #19: all audit fields persisted: `recommendationSummary`, `inferredSeniority`, `keyMatches`, `importantGaps`, `importantConcerns` are all non-null on the persisted row.

---

## 4. High-priority follow-up fixes (H1-H6)

### H1 — 200 KB boundary test fixtures
Add to Task 11:
- `tests/scoring/fixtures/scoring-input-payload-200000-bytes.json` (exactly 200,000 bytes — succeeds).
- `tests/scoring/fixtures/scoring-input-payload-200001-bytes.json` (200,001 bytes — fails).

The fixtures are built by padding the existing `scoring-input-payload.json` with whitespace.

### H2 — Decision 3 two-call pattern
Documented in §2 above. The two-call pattern is `findActiveByJob(jobId, fingerprint)` → `null` OR `existing` (matching fingerprint) → no row OR `activateResult(input)` (atomic stale-replacement).

### H3 — `scoreBatch` worker-pool specification
Documented in §3 above. The pattern is a queue + N worker loops (NOT chunked `Promise.all`). Each worker pulls from the queue and processes serially; N workers run in parallel. Cancellation is checked at the top of each iteration. The auth-failure counter (B3) is shared across all workers via closure.

### H4 — Simplified `transact` pattern
Documented in §3 above. The `transact` callback now calls `txRepos.scoreResults.activateResult(...)` and `txRepos.openaiMetadata.insert(...)` directly — no nested `txRepos.db.transaction(...)`. This matches the existing pattern at `extraction-service.ts:509-559` (per the original plan's note).

### H5 — F9 §25.7 snapshot oracle
Add to Task 12 test:
```ts
const assembledPayload = buildScoringPrompt({ /* ... */ });
expect(assembledPayload).toEqual(loadFixture('scoring-input-payload'));
```

The fixture is the canonical "what goes to OpenAI" — if a prohibited field (DB ID, run metadata, etc.) leaks in, the snapshot fails. This is the F9 test.

### H6 — `ScoringFieldSet` derived from Zod
Replace the explicit `ScoringFieldSet` interface in `state.ts` with:
```ts
export type ScoringFieldSet = ScoringStructuredOutput; // re-exported from schema.ts
```
This requires `state.ts` to import from `schema.ts`. To avoid a circular dependency, the cleanest pattern is to put `ScoringCategory` + `ScoringFieldSet` in `schema.ts` and re-export from `state.ts`. Alternative: put `ScoringCategory` in a shared `types.ts` that both `state.ts` and `schema.ts` import. Pick the latter (shared `types.ts`).

---

## 5. Reference corrections (apply throughout)

| Original (WRONG) | Correction |
|---|---|
| `OpenAIClient` interface in `src/profile/openai/client.ts` | `src/profile/openai/types.ts:67-68` (interface) + `src/profile/openai/client.ts:56-98` (factory `createDefaultOpenAIClient`) |
| `OpenAIHttpClient` (real) | **`createDefaultOpenAIClient()` factory** at `client.ts:56-98` |
| `FakeOpenAIClient` | `src/profile/openai/fake-client.ts:33-81` (CONFIRMED) |
| `RetryPolicy` (named export) | **`RetryOptions` + `runWithRetry`** at `src/profile/openai/retry.ts:36-43, 81-152` (no `RetryPolicy` symbol) |
| `parseStructuredOutput` function | **Does NOT exist.** Use inline `JSON.parse` + `safeParse` pattern at `src/profile/extraction-service.ts:344` |
| `Retry-After` parsing | `src/profile/openai/client.ts:245-260` (`parseRetryAfterMs` + `parseRetryAfterMsFromUnknown`) (CONFIRMED) |
| Manual JSON-Schema projection in `prompt.ts` | `src/profile/openai/prompt.ts:25-94` (`STRUCTURED_OUTPUT_SCHEMA` + `applyStrictModeAdjustments`) (CONFIRMED) |
| `OpenAIExtractionRequest.rawJsonText` | **`rawJsonText` is on the RESPONSE** (`OpenAIExtractionRawResponse`, `types.ts:56-59`), not the request. The request has `promptVersion`, `model`, `reasoningEffort`, `sources`, `responseSchemaName`, `structuredOutputSchemaVersion`, `maxCompletionTokens?` (after Task 0). |
| `OpenAIExtractionError` family | **`ProfileExtractionError`** (base, `errors.ts:32-43`). Re-exported from `index.ts:17-34`. |
| `OpenAIInvalidOutputError` | `src/profile/openai/errors.ts:95-105` (CONFIRMED) |
| Runtime OpenAI importer | Only `src/profile/openai/client.ts:1-11` imports `openai` + `openai/error` (CONFIRMED) |

---

## 6. Line number corrections (apply throughout)

| Original (WRONG) | Correction |
|---|---|
| `score-results.ts:92-139` (activateResult) | **CONFIRMED** (lines 92-139) |
| `score-results.ts:148-184` (findActiveByJob) | **`score-results.ts:141-155`** |
| `findById`, `listByJob`, `listByRun`, `topByRun` | `score-results.ts:157-161, 163-166, 168-175, 177-192` (other public methods the plan should list in the appendix) |
| `openai-metadata.ts` (line numbers not specified) | 164 lines; `OpenAIRequestMetadataRepository` at line 79; `insert` at lines 82-115; `findById` at 117-125; `listByOperation` at 127-145; `listByRelatedEntity` at 147-163 |
| `openaiMetadata` field `requestConfig` | **`configJson`** (line 481 of schema.ts) |
| `openaiMetadata` field `errors` | **`errorCode` + `errorMessage`** (two separate fields, lines 488-489 of schema.ts) |
| `repositories/index.ts:50-58` (transact) | **`repositories/index.ts:59-64`** (doc comment + method) |
| `OperationalConfigSchema.openai.jobScoring.*` at `config/schema.ts:120-130` | **Schema definition at `config/schema.ts:34-40`**, defaults at 120-130 |
| `ExitCode.OpenAIFailure = 5` at `application-error.ts:1-9` | **CONFIRMED** |
| `DiagnosticScope` at `filename.ts:3-9` | **CONFIRMED** (no `openaiRequestId` yet — Task 9 adds it) |
| `hashString` at `profile/hashing.ts:5` | **CONFIRMED** (15-line file) |
| `src/linkedin/extraction/fingerprint.ts` (claimed pattern) | **DOES NOT EXIST.** The extraction pattern is `{normalize, required-fields, status, detail-url}.ts` (4 files, not 5). The TASK-014 pattern is independent: `src/scoring/{rubric, score-formula, rank, fingerprint, plan, state, errors, log}.ts` (8 files). |
| `persistence/schema.ts:387-419` (scoreResults) | **`schema.ts:424-461`** (lines 387-419 are `filterResults`) |
| `scoreResults.active` at line 451 | **CONFIRMED** |
| Partial unique index on `active = 1` at lines 457-459 | **CONFIRMED** |
| `openaiRequestMetadata` table | `schema.ts:465-497` |
| `openai` package version | **`7.4.0`** (per `package.json:33`) |

---

## 7. Updated test plan (additions in **bold**)

### Unit tests (no I/O)

| Wave | Test file | Coverage |
|---|---|---|
| A | `tests/scoring/state.test.ts` | Structural assertions on `ScoringOutcome` + `ScoringKind` (5 values) + `ScoringCategory` (7 values) + `LINKEDIN_SCORING_SCHEMA_VERSION === 1`. **`ScoringFieldSet` derived from Zod (H6).** |
| A | `tests/scoring/errors.test.ts` | Each `ScoringError` subclass's `code` + `exitCode === 5` + `metadata` shape. **`ScoringHardStopError` exit-code + metadata (B3).** |
| A | `tests/scoring/rubric.test.ts` | `RUBRIC_VERSION === 1`; all 7 categories have entries; sum of all weights = 1.0 (floating-point tolerance < 1e-9). |
| A | `tests/scoring/score-formula.test.ts` | 16+ cases of `computeOverallScore` + `formatDisplayScore` (NaN throws, Infinity throws). |
| A | `tests/scoring/rank.test.ts` | Sort order (descending by score, then ascending by `sourceJobId` for ties), 1-based ranks, empty array, float scores, stable sort. |
| A | `tests/scoring/fingerprint.test.ts` | Same input → same fingerprint, different inputs → different fingerprints, 64 lowercase hex chars, default substitution, sorted-key canonicalization. |
| A | `tests/scoring/plan.test.ts` | Empty jobs, all eligible + new, all eligible + 1 reused, 1 ineligible, 1 skipped, `scoringConcurrency` carried through. |
| A | `tests/scoring/log.test.ts` | Each method emits the expected `event` + structured fields; `noopScoringLogger().scoringStart({...})` does not throw. |
| A | `tests/scoring/schema.test.ts` (NEW) | `ScoringStructuredOutputSchema` accepts valid, rejects invalid (out-of-bounds, decimal, unknown seniority, extra fields, missing fields, malformed JSON). |
| B | `tests/diagnostics/filename.test.ts` (extended) | New `openaiRequestId` field included in `resolveScopeDirectory` + `buildSafeFilename`. |
| 0 | `tests/profile/openai/client.test.ts` (extended) | `extract` with known `responseSchemaName` returns correct schema; unknown name throws; `maxCompletionTokens` propagates; omission omits. |
| 0 | `tests/profile/openai/prompt.test.ts` (NEW or extended) | `RESPONSE_SCHEMA_REGISTRY` includes both profile + scoring schemas; `applyStrictModeAdjustments` preserves the scoring shape. |
| E | `tests/scoring/boundaries.test.ts` | All `src/scoring/*.ts` files avoid banned imports; the `openai` runtime import stays in `src/profile/openai/client.ts`. |

### Integration tests (with real DB + FakeOpenAIClient)

| Wave | Test file | Coverage |
|---|---|---|
| C | `tests/scoring/openai-mock.test.ts` | `FakeOpenAIClient` programmable responses (valid, malformed, timeout, rate-limit, auth error). |
| D | `tests/scoring/service.test.ts` | Per-job flow: reuse, new score, **stale detection (verify old row `active: false`)**, ineligible, **input too large (200,000 vs 200,001 bytes)**, OpenAI timeout, OpenAI invalid output (corrective retry), OpenAI rate limit, **OpenAI auth error (3 consecutive → hard-stop)**, `scoreBatch` with 3 jobs, **atomic transaction (rollback on failure)**, **cancellation (signal mid-batch)**, **F9 §25.7 snapshot assertion**, **concurrency enforcement (6 jobs + concurrency 3)**, **all audit fields persisted**. |

### Live tests (LINKEDIN_LIVE=1 gated, opt-in only)

| Wave | Test file | Coverage |
|---|---|---|
| E | `tests/live/linkedin.test.ts` (extended) | Score a real LinkedIn job-detail page; assert `overallScore` is a valid number; assert `displayScore` matches `overallScore.toFixed(1)`; assert all 7 categories. |

---

## 8. Updated verification commands (additions in **bold**)

```bash
# After Task 0 (OpenAI client refactor):
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test tests/profile/openai tests/scoring/state tests/scoring/errors

# After Wave A (pure helpers):
pnpm test tests/scoring/{state,errors,rubric,score-formula,rank,fingerprint,plan,log,schema}.test.ts

# After Wave B (DiagnosticScope):
pnpm test tests/diagnostics/filename.test.ts

# After Wave C (fixtures + OpenAI mock):
pnpm test tests/scoring/openai-mock.test.ts

# After Wave D (orchestrator + integration):
pnpm test tests/scoring/service.test.ts

# After Wave E (boundaries + live test + docs):
pnpm test
pnpm exec playwright --version  # expect 1.62.x
pnpm test:live:list  # expect tests/live/linkedin.test.ts

# Final task verification:
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm exec playwright --version
```

---

## 9. Critical preconditions (updated)

The implementing agent MUST stop and ask the user to confirm each item before any file in `src/scoring/` or `src/profile/openai/` is edited. Per AGENTS.md §12.

1. **Extend `OpenAIClient.extract`** to add `maxCompletionTokens?` + a `responseSchemaName`-keyed schema registry (Task 0). This is a TASK-008 surface extension; not strictly a TASK-014 change.
2. **Extend `DiagnosticScope`** to add `openaiRequestId?: number | null` (Task 9, no schema change).
3. **NO new database schema / migration** — all tables already exist.
4. **NO new top-level CLI subcommand** — TASK-015 owns `jobhunter run` orchestration; TASK-014 exposes only `ScoringService.scoreOne()` + `scoreBatch()` + `buildScoringPlan()` consumed by TASK-015.
5. **NO new `openai` dependency** — already present from TASK-008.
6. **NO new `playwright` dependency** — already present from TASK-012/013.
7. **Add `tests/scoring/boundaries.test.ts`** mirroring the `tests/extraction/boundaries.test.ts` pattern.
8. **`OperationalConfigSchema` is `.strict()`** — do NOT add new config fields. Reuse `openai.jobScoring.{model, reasoningEffort, concurrency}` (already wired). The 200 KB `scoring_input_too_large` threshold is HARDCODED, not config-driven.
9. **No raw prompts/responses persisted** — per SPEC §25.4. Only input hashes + validated structured output + token usage + errors.
10. **The `ScoringPlan` data structure** is TASK-014's deliverable to TASK-015 (the confirmation UI). TASK-014 owns the data shape; TASK-015 owns the UI.
11. **NEW:** The Task 0 refactor to `OpenAIClient.extract` must be reviewed + merged BEFORE Wave A begins (the scoring schema registry depends on it).
12. **NEW:** The 3-consecutive-auth-failure hard-stop in `scoreBatch` requires a NEW `ScoringHardStopError` subclass + test (#13).
13. **NEW:** The F9 §25.7 prohibited-fields check is enforced via snapshot assertion against `scoring-input-payload.json` (test #15).
14. **NEW:** The `transact` callback in `scoreOne` is FLAT — no nested `db.transaction` (H4).

---

## 10. Resolved open questions

| Original open question | Resolution (in this revision) |
|---|---|
| 1. `scoring_input_too_large` threshold — hardcoded 200 KB or config-driven? | **Hardcoded 200 KB** (per `OperationalConfigSchema.strict()` constraint). Constant `MAX_INPUT_BYTES` at top of `service.ts`. |
| 2. Retry-after-cancellation — accept discard or wrap in `AbortController`? | **Accept discard** (mirrors TASK-012's pattern). The `runWithRetry` operation callback checks `signal.aborted` BEFORE each attempt. |
| 3. Stale detection cascade — per-job or `markStaleByProfileVersion` helper? | **Per-job** — `activateResult` handles the stale case atomically. TASK-015 orchestrates the cascade. |
| 4. `ScoringPlan` ownership — TASK-014 or TASK-015? | **TASK-014 owns it** (the plan builder needs the eligibility logic, which lives in TASK-014). |
| 5. Live test scope — extend `tests/live/linkedin.test.ts` or create `tests/live/scoring.test.ts`? | **Extend the existing file** (keeps live tests in one place). |
| 6. OpenAI strict-mode schema support — `z.enum` or discriminated union? | **`z.enum` for `inferredSeniority`** (simpler + strict-mode compatible). |
| 7. Concurrency implementation — `p-limit` or chunked `Promise.all`? | **Worker-pool loop** (H3) — queue + N workers, no `p-limit` dependency. |
| 8. NEW: `OpenAIClient.extract` surface for scoring? | **Extend `OpenAIClient.extract`** with `maxCompletionTokens?` + `responseSchemaName`-keyed schema registry (Task 0). |
| 9. NEW: 5 audit columns in `scoreResults`? | **Map to existing separate columns** (no migration). |
| 10. NEW: Fix plan reference errors? | **Fix all in this revision** (per user direction). |

---

## 11. Per-wave commit messages (updated)

Per `GIT.md §6`, each wave produces one commit. The squash-merge to `main` is a 7th commit that summarizes the 6 wave commits.

- Task 0: `refactor(openai): parameterize extract response schema + maxCompletionTokens (TASK-014 W0)`
- Wave A: `feat(scoring): add linkedin scoring pure helpers (TASK-014 W1)`
- Wave B: `feat(diagnostics): add openaiRequestId to DiagnosticScope (TASK-014 W2)`
- Wave C: `feat(scoring): add linkedin scoring fixtures and openai mock (TASK-014 W3)`
- Wave D: `feat(scoring): add linkedin scoring service and auth-failure hard-stop (TASK-014 W4)`
- Wave E: `chore(tasks): add scoring boundaries, live test, and docs (TASK-014 W5)`
- Squash: `feat(scoring): add linkedin openai scoring, fixtures, and live test (TASK-014)`

---

## 12. Completion criteria (updated)

The task is complete when ALL of the following are true:

1. **Task 0 complete** — `OpenAIClient.extract` accepts `maxCompletionTokens?` + a `responseSchemaName`-keyed schema registry. `RESPONSE_SCHEMA_REGISTRY` includes both `ExtractedProfile` and `ScoringStructuredOutput`. Tests pass.
2. **Per-job flow** — `ScoringService.scoreOne()` correctly handles the 5 outcomes: `reused` (existing row with current fingerprint), `complete` (new score), `failed` (OpenAI error or input too large), `skipped` (ineligible or hard-stop), `cancelled` (signal aborted). All 5 outcomes have unit + integration tests.
3. **Score reuse + stale detection** — fingerprint-driven; REUSE the existing `findActiveByJob` (at `score-results.ts:141-155`) which returns the active row; on fingerprint mismatch, call the existing `activateResult` (at `score-results.ts:92-139`) which atomically UPDATEs the previous active row to `active: false` AND INSERTs the new row with `active: true` in a single `db.transaction`. Old row remains stored per SPEC §27.4. NO stale-detection inconsistency window.
4. **All 11 audit columns persisted** — `categoryScoresJson`, `overallScore`, `explanation`, `keyMatchesJson`, `importantGapsJson`, `importantConcernsJson`, `inferredSeniority`, `recommendationSummary`, plus the metadata columns. Test #19 covers this.
5. **Retry policy** — `runWithRetry` with `maxAttempts: 3`, `baseDelayMs: 500`, `maxDelayMs: 8_000`, `jitter: 'full'`, plus the existing corrective-retry budget (1) for `OpenAIInvalidOutputError`. Signal checked between attempts.
6. **Structured output** — `z.number().int().min(0).max(100)` per category + `z.enum` for `inferredSeniority` + `.strict()` on every object. `maxCompletionTokens: 2000`. Schema registered in `RESPONSE_SCHEMA_REGISTRY`.
7. **Score formula** — `computeOverallScore` returns the full-precision weighted sum (JobHunter, not OpenAI). `formatDisplayScore` returns one-decimal display value.
8. **Ranking** — `rankResults` sorts by `overallScore` descending, then `sourceJobId` ascending. No hidden factors.
9. **Score fingerprint** — SHA-256 of canonical JSON with sorted keys, lowercase hex (64 chars). Includes all SPEC §27.3 fields.
10. **Input too large** — hardcoded 200 KB byte-size pre-check; `scoring_input_too_large` surfaced; no silent truncation. **Boundary test (200,000 vs 200,001 bytes).**
11. **Per-job failure isolation** — a failure in one `scoreOne` call does NOT terminate the batch.
12. **Auth-failure hard-stop** — `scoreBatch` throws `ScoringHardStopError` after 3 consecutive `openai_authentication` outcomes; subsequent jobs `kind: 'skipped'`. Tests #13 + #14 cover this.
13. **All OpenAI resources close** — the OpenAI client is owned by `src/profile/openai/`; the scoring service does NOT call `launch`/`close` on it. The orchestrator (TASK-015) owns the run-level lifecycle.
14. **No raw prompts/responses persisted** — per SPEC §25.4. Only input hashes + validated structured output + token usage + errors.
15. **`DiagnosticScope.openaiRequestId`** — extended, tested, and used by the scoring service for per-request diagnostics.
16. **Boundaries guard extended** — `tests/scoring/boundaries.test.ts` mirrors the existing pattern. The `openai` runtime import stays in `src/profile/openai/client.ts`; `src/scoring/` does NOT import the `openai` package directly.
17. **Live test extended** — `tests/live/linkedin.test.ts` gains one new `it` that exercises the scoring flow against a real LinkedIn job-detail page. The test is `LINKEDIN_LIVE=1` gated.
18. **F9 §25.7 snapshot assertion** — the assembled OpenAI payload is compared against `scoring-input-payload.json`; prohibited fields fail the test. Test #15 covers this.
19. **All verification commands pass** — `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (all green); `pnpm exec playwright --version` 1.62.x; `pnpm test:live:list` lists `tests/live/linkedin.test.ts`.
20. **Per-wave commits** — 6 wave commits (Task 0 + Waves A-E), each with a clear Conventional Commits message. The squash-merge to `main` is a 7th commit that follows `GIT.md §6`.
