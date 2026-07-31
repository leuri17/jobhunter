# TASK-010 — Global Deterministic Filters and Filter Fingerprints

**Status:** Planned; not approved for implementation
**Order:** 010
**Dependencies:** TASK-004, TASK-009

## Scope

Implement one immutable global filter configuration and deterministic evaluation:

- Define and validate versioned filter configuration with excluded companies, title/description keyword rules, maximum seniority, accepted languages, and unsupported-language behavior.
- Provide the interactive `configure filters` flow with profile-derived language initialization, explicit preview, save/discard/exit, and atomic persistence.
- Keep one active global configuration; create a new immutable version for every change.
- Implement shared Unicode/whitespace/separator/alias keyword normalization with meaningful word boundaries and no fuzzy, stemming, regex, or substring matching by default.
- Implement title-only seniority detection with highest-level selection and unknown abstention.
- Implement phrase-based language requirement detection with explicit requirement, non-rejecting reference, and abstention outcomes.
- Produce auditable filter decisions containing evaluated rules, matched fields/keywords, reasons, and severity/outcome.
- Calculate filter fingerprints from job content, configuration, effective profile values, and implementation version.
- Reuse only matching current results and mark changed-input results stale without deleting history.
- Never call OpenAI.

Scoring and pipeline orchestration are out of scope.

## Dependencies and handoffs

- Uses repositories and invalidation operations from TASK-004.
- Consumes the active approved effective profile from TASK-009.
- Produces filter configuration/evaluation/fingerprint contracts for TASK-011, TASK-014, TASK-015, and TASK-017.

## Referenced specification sections

- `SPEC.md` §17.1–17.7 global filter configuration and lifecycle
- `SPEC.md` §18 deterministic keyword matching
- `SPEC.md` §19 deterministic seniority detection
- `SPEC.md` §20 deterministic language filtering
- `SPEC.md` §24.1–24.3 filter outcomes, details, and fingerprints
- `SPEC.md` §27.1–27.2 independent stage cache behavior
- `SPEC.md` §41.1 filter, matcher, seniority, language, and fingerprint tests

## Expected tests

- Validate configuration defaults, normalization, deduplication, versioning, and profile-derived language initialization.
- Test keyword boundaries including `Java` versus `JavaScript`, phrase matching, punctuation aliases, Unicode, and separator variants.
- Test excluded/required-any rules and explicit audit reasons.
- Test seniority mappings, highest-level precedence, equality/maximum checks, and unknown abstention.
- Test language required/preferred/ambiguous classification and accepted/unsupported outcomes.
- Verify filter errors remain errors rather than rejections.
- Verify empty required-any rules do not apply and stale fingerprints preserve historical results.
- Verify no OpenAI client is invoked by the filter engine.

## Verification requirements

- Run pure domain tests with representative fixtures and adversarial boundary cases.
- Run configuration/repository integration tests for immutable versions and invalidation.
- Run prompt/service tests without a terminal.
- Review the deterministic alias and phrase dictionaries as versioned implementation decisions.
- Run typecheck and focused tests.

## Completion criteria

- A complete job can receive an auditable accepted, rejected, or error result deterministically.
- Unknown seniority and uncertain language wording abstain as specified.
- Fingerprints make filter reuse/invalidation reproducible and historical.
- The filter subsystem has no OpenAI or browser dependency.
