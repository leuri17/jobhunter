# TASK-014 — OpenAI Scoring, Score Fingerprints, Weighted Scoring, and Ranking

**Status:** Planned; not approved for implementation
**Order:** 014
**Dependencies:** TASK-004, TASK-009, TASK-010, TASK-013

## Scope

Implement independent per-job OpenAI scoring and deterministic ranking:

- Define the versioned scoring rubric and structured-output Zod schema.
- Build each request from the active approved profile, effective derived values, complete normalized job fields, rubric, schema, and prompt versions.
- Exclude database IDs, revision history, source excerpts, paths, diagnostics, prior results, run metadata, logs, and artifacts.
- Reject or record `scoring_input_too_large` when the full payload cannot be submitted; never silently truncate, summarize, or split a job.
- Use one OpenAI request per eligible job with configurable positive concurrency, defaulting to three.
- Apply the specified retry policy and persist request metadata, validated output, attempts, usage, timestamps, and errors without raw prompts/responses by default.
- Calculate the weighted overall score in JobHunter with full precision and expose one-decimal display values.
- Rank by full-precision overall score descending, then `sourceJobId` ascending for exact ties, with no hidden factors or threshold.
- Calculate score fingerprints from job content/profile/effective values/prompt/rubric/model/configuration/scorer versions and preserve stale historical results.

Pipeline confirmation and scheduling belong to TASK-015.

## Dependencies and handoffs

- Uses score/request repositories from TASK-004.
- Consumes the active approved profile/effective derived values from TASK-009.
- Consumes current accepted complete jobs and filter fingerprints from TASK-010 and TASK-013.
- Produces scoring-plan candidates, score results, stale detection, and ranking services for TASK-015 through TASK-017.

## Referenced specification sections

- `SPEC.md` §25.1–25.8 model, structured output, retry, persistence, concurrency, granularity, input, and no-truncation behavior
- `SPEC.md` §26.1–26.5 eligibility, rubric, calculation, precision, and ranking
- `SPEC.md` §27.3–27.4 score fingerprints and stale results
- `SPEC.md` §30 scoring-plan inputs
- `SPEC.md` §41.1–41.2 score/ranking and OpenAI integration tests
- `SPEC.md` §44 open decisions 3 and 8

## Expected tests

- Validate complete and malformed scoring responses, category bounds, evidence, and required summary fields.
- Verify ineligible/partial/rejected jobs never reach OpenAI.
- Verify request payload inclusion/exclusion rules and one-job granularity.
- Verify concurrency limits, retries, non-retryable failures, and input-too-large handling.
- Verify full-precision weighted score calculation and one-decimal display formatting.
- Verify ranking tie-breaking and absence of hidden ranking factors.
- Verify fingerprint reuse, stale detection, and historical score retention.
- Verify scoring errors remain errors and do not become filter rejections.

## Verification requirements

- Run scoring tests with fake OpenAI clients only.
- Run repository integration tests for score attempts, current/stale selection, and metadata.
- Review a fixture payload to ensure no prohibited fields are sent.
- Run typecheck, build, and focused tests.

## Completion criteria

- A complete accepted job can be scored independently and ranked deterministically.
- The final weighted score is calculated by JobHunter, not OpenAI.
- Score reuse and invalidation are fingerprint-driven and historical.
