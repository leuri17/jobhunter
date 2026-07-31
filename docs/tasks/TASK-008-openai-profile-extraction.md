# TASK-008 — OpenAI Profile Extraction and Structured Validation

**Status:** Planned; not approved for implementation
**Order:** 008
**Dependencies:** TASK-002, TASK-004, TASK-007

## Scope

Implement the profile-extraction OpenAI operation as a separately testable application service:

- Define the canonical professional-profile Zod schema and versioned structured-output schema.
- Build the extraction request from normalized stored source text with distinct source IDs and no unsupported facts.
- Keep profile extraction configuration independent from job scoring configuration.
- Validate every structured response with Zod and deterministically post-process normalized names, aliases, dates, enums, references, durations, deduplication, warnings, conflicts, and content hash.
- Calculate an extraction fingerprint from source hashes, schema/prompt/model/configuration versions, and extractor implementation version.
- Reuse a matching valid draft when appropriate; create a new draft for changed fingerprints without overwriting history.
- Persist OpenAI request metadata without raw prompts/responses by default.
- Implement up to three total attempts with the specified retry categories, corrective invalid-output retry limit, exponential jitter, and server retry delay handling.
- Preserve imported sources and the current approved profile when extraction fails.

Interactive review and approval are out of scope for this task.

## Dependencies and handoffs

- Uses validated configuration and OpenAI credential lookup from TASK-002.
- Uses profile/source/request repositories from TASK-004.
- Consumes normalized source text from TASK-007.
- Produces versioned draft profiles and extraction metadata for TASK-009 and TASK-011.

## Referenced specification sections

- `SPEC.md` §12.1–12.2 canonical profile schema and normalized names
- `SPEC.md` §14.1–14.5 profile extraction flow, behavior, post-processing, metadata, and fingerprint
- `SPEC.md` §15 multiple-source merging and conflicts
- `SPEC.md` §25.1–25.5 model, structured output, retry, request persistence, and concurrency
- `SPEC.md` §40 Reliability requirements
- `SPEC.md` §41.2 OpenAI structured-response integration expectations
- `SPEC.md` §44 open decisions 2 and 8

## Expected tests

- Validate complete, sparse, malformed, enum-invalid, date-invalid, and reference-invalid model outputs.
- Verify missing scalars become `null`, missing collections become empty arrays, and unsupported invented facts are rejected or warned according to the schema.
- Verify normalized aliases and equivalent skill/language deduplication are deterministic.
- Verify two-source complementary facts merge while conflicting claims remain explicit and unresolved.
- Verify matching fingerprints reuse valid drafts and changed fingerprints create new versions.
- Verify retryable/non-retryable failures, corrective invalid-output retry, rate-limit delays, and attempt metadata.
- Verify no request is made when local extraction marked a required source unusable.
- Verify raw prompt and raw response persistence is disabled by default.

## Verification requirements

- Run OpenAI operation tests exclusively with fakes; no live API call in normal verification.
- Run profile schema/post-processing unit tests and repository integration tests.
- Inspect request payload tests to confirm only allowed source/profile data is included.
- Run typecheck, build, and focused tests.

## Completion criteria

- A valid normalized source set can produce a persisted draft profile through a fake OpenAI client.
- Every structured result is validated and fingerprinted before persistence.
- Retry and failure behavior preserves source/history state and leaves the active approved profile unchanged.
