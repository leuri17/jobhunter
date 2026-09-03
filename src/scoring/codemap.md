# src/scoring/

## Responsibility

Rubric-driven job scoring subsystem. Computes weighted overall scores from OpenAI structured-output evaluations, gates on eligibility, ranks results deterministically, and persists score artifacts with versioned fingerprints for cache reuse.

## Design

- **`ScoringService`** (`service.ts`) orchestrates the per-job flow: eligibility check → prompt build → input-size guard → fingerprint lookup → OpenAI call → formula → atomic persist. Exposes `scoreOne` and `scoreBatch` (worker-pool with `ScoringServiceConfig.concurrency`).
- **`prompt.ts`** builds versioned system + user messages from profile, effective derived values, normalized job, and the rubric. `SCORING_PROMPT_VERSION` is part of the fingerprint.
- **`schema.ts`** is the Zod source of truth for the OpenAI structured output: `ScoringStructuredOutputSchema` (strict), `SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION`, and the precomputed `SCORING_STRUCTURED_OUTPUT_JSON_SCHEMA` projection sent via `SCORING_RESPONSE_SCHEMA_NAME`.
- **`rubric.ts`** freezes the 7-category weighted rubric (`RUBRIC`, `RUBRIC_VERSION = 1`); weights sum to 1.0 and are asserted in tests. `getRubricWeight` / `getRubricDescription` are the only accessors.
- **`score-formula.ts`** is deterministic and pure: `computeOverallScore` (weighted sum, full IEEE-754 precision) and `formatDisplayScore` (one-decimal string). OpenAI does **not** compute the overall score.
- **`eligibility.ts`** is a pure gate: `isJobEligibleForScoring` requires `extractionStatus === 'complete'`, `filterResult.outcome === 'accepted'`, and matching `activeFilterFingerprint`.
- **`fingerprint.ts`** derives `computeScoreFingerprint` (SHA-256 of canonical JSON with sorted keys) over job content, profile, derived values, prompt/rubric/scorer versions, model, and reasoning effort. `SCORER_IMPLEMENTATION_VERSION = 1` invalidates cached scores on implementation changes.
- **`rank.ts`** provides `rankResults`: deterministic order `overallScore` desc (full precision), tie-broken by `sourceJobId` asc; pure, no I/O.
- **`plan.ts`** builds the `ScoringPlan` consumed by the confirmation UI via `buildScoringPlan`.
- **`errors.ts`** defines the typed `ScoringError` family (exit code `ExitCode.OpenAIFailure`): `ScoringInputTooLargeError`, `ScoringInvalidStructuredOutputError`, `ScoringPersistenceError`, `ScoringFingerprintMismatchError`, `ScoringHardStopError`.
- **`log.ts`** exposes the `ScoringLogger` interface plus `noopScoringLogger` and `pinoScoringLogger` adapters; only `service.ts` imports it.
- **`state.ts`** is the typed vocabulary (`LINKEDIN_SCORING_SCHEMA_VERSION`, `ScoringKind`, `ScoringOutcome`, `ScoringBatchOutcome`, `ScoringPlan`); `types.ts` defines the 7 `SCORING_CATEGORIES`.
- **`index.ts`** is the public barrel; consumers import from here.

## Flow

`ScoringService.scoreOne(input)` (`service.ts`):

1. **Eligibility** — `isJobEligibleForScoring(...)` returns `kind: 'skipped'` with `errorCode: 'scoring_ineligible'` when the gate fails.
2. **Prompt + payload** — `buildScoringPrompt(...)` assembles `systemMessage` + `userMessage` from `RUBRIC`, profile, derived values, and normalized job.
3. **Size guard** — payload > `MAX_INPUT_BYTES` (200_000) → `kind: 'failed'`, `errorCode: 'scoring_input_too_large'`.
4. **Fingerprint + cache reuse** — `computeScoreFingerprint(...)` then `repositories.scoreResults.findActiveByJob`; active match → `kind: 'reused'`.
5. **OpenAI call** — `runWithRetry` (3 attempts, exponential backoff) invokes `openaiClient.extract` with `SCORING_RESPONSE_SCHEMA_NAME`; JSON parse + `ScoringStructuredOutputSchema.safeParse` retry on validation failure via `ScoringInvalidStructuredOutputError`.
6. **Score formula** — `computeOverallScore(categoryScoreNumbers)` then `formatDisplayScore(...)` (JobHunter-side, not OpenAI).
7. **Atomic persist** inside `repositories.transact`: mark prior `scoreResults` row inactive, insert new active row (categoryScores, overall, highlights, seniority, recommendation), insert `openaiRequestMetadata` with token usage and attempt count.
8. **Failure mapping** — abort → `kind: 'cancelled'`; `openai_authentication` increments a counter, `ScoringHardStopError` aborts the batch after `CONSECUTIVE_AUTH_FAILURE_LIMIT = 3` consecutive failures and remaining jobs are marked `kind: 'skipped'` with `errorCode: 'hard_stop'`.

Downstream: `computeRank` (rank.ts) orders `scoreBatch` outcomes deterministically before persistence; `buildScoringPlan` aggregates per-job eligibility + kind for the confirmation UI.

## Integration

- **Consumers**: `src/pipeline/orchestrator.ts` (drives `scoreBatch` per search execution), `src/reevaluation/` (re-scores cached jobs against current rubric/prompt/scorer versions), `src/persistence/repositories/score-results.ts` (`findActiveByJob` for fingerprint reuse), `src/persistence/schema.ts` (`scoreResults`, `openaiRequestMetadata` tables), `src/profile/openai/` (`OpenAIClient.extract`, `runWithRetry`, structured-output response-schemas registry).
- **Versioning surface**: `SCORING_PROMPT_VERSION`, `RUBRIC_VERSION`, `SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION`, `SCORER_IMPLEMENTATION_VERSION`, `LINKEDIN_SCORING_SCHEMA_VERSION` — any bump invalidates cached scores through the fingerprint.
