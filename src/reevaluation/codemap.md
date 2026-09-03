# src/reevaluation/

## Responsibility

Reevaluates previously scored jobs against updated profile, filter, or
scoring-rubric state. Decides which jobs are *stale* (their fingerprint
no longer matches a current active filter / score row) and drives a
targeted re-filter + re-score pass, leaving unchanged jobs untouched.
Delta detection + selective recomputation — no bulk re-pipeline.

## Design

Plan-driven execution. The service classifies every complete job into
`filter-stale` / `score-stale` / `already-current` via fingerprint
comparison, then runs only the work the classification requires. Output
is a structured `ReevaluationPlan` envelope rendered by formatters and
the Zod `REEVALUATION_JSON_SCHEMA` (versioned by
`REEVALUATION_SCHEMA_VERSION`). Two fingerprints drive delta detection:
`computeFilterFingerprintForJob` (config + profile + job hash) and
`computeScoreFingerprintForJob` (profile version + prompt/rubric/model
+ job hash). Pure layer (`state`, `errors`, `plan`, `format`,
`json-schemas`, `log`) is I/O-free; only `service.ts` and
`fingerprint.ts` import from `src/filter/`, `src/scoring/`,
`src/pipeline/`, and `src/persistence/`. Typed errors:
`ReevaluationError` → `ExitCode.Fatal`,
`ReevaluationValidationError` → `ExitCode.InvalidUsage`,
`PipelinePrerequisiteError` for missing profile/filter/`OPENAI_API_KEY`.

## Flow

`ReevaluationService.execute(input: ReevaluationExecuteInput)` is the
single orchestrator:

1. **Prerequisites** — resolve active filter config, active approved
   profile (when scope requires), and `OPENAI_API_KEY` (when not
   dry-run); throw `PipelinePrerequisiteError` on miss.
2. **Selection** — for each complete job, compute current
   filter/score fingerprints and probe
   `filterResults.findActiveByJob` / `scoreResults.findActiveByJob`;
   partition into `filtersToReevaluate`, `jobsToScore`, or
   `skipped` (with `ReevaluationSkipReason`).
3. **Plan** — call `ScoringService.buildScoringPlan` for the score
   batch and `buildReevaluationPlan` (pure aggregator) to assemble the
   envelope with `totals`.
4. **Confirmation** — when `confirmScoring` and the plan produces new
   OpenAI requests, prompt via `PipelinePrompts.askScoringConfirmation`.
5. **Filter reruns** — `FilterApplyService.apply` per entry; on fresh
   row, `scoreResults.invalidateActiveByJob` flips dependent scores.
6. **Score reruns** — per `jobsToScore` entry, call
   `ScoringService.scoreOne` via the `runOneScore` helper (per-job
   try/catch isolates failures).
7. **Return** — `ReevaluationOutcome` wrapping the (possibly adjusted)
   `ReevaluationPlan`.

`ReevaluationLogger` emits structured events (`reevaluationStart`,
`reevaluationSelection`, `reevaluationFilterRerun`,
`reevaluationFilterInvalidatedScores`,
`reevaluationScoreReuse`/`Complete`/`Fail`, `reevaluationDecline`,
`reevaluationComplete`).

## Integration

- **Host integration** — the sidecar's reevaluation HTTP route parses scope flags
  and `jobId` from the request, then calls `ReevaluationService.execute`. Tests
  invoke the same orchestrator directly.
- **Consumes**:
  - `src/filter/service.js` — `FilterApplyService.apply`;
    `src/filter/{fingerprint,schema,version,content-hash}.js` for the
    canonical filter-fingerprint formula.
  - `src/scoring/service.js` — `ScoringService.scoreOne` and
    `ScoringService.buildScoringPlan`;
    `src/scoring/{fingerprint,prompt,rubric}.js` for the score
    fingerprint and version pins.
  - `src/pipeline/prompts.js` (confirmation), `src/pipeline/errors.js`
    (prerequisite errors), `src/pipeline/format.js` (scoring-plan
    renderer via `formatScoringPlanForReevaluation` — the single
    allowed `src/pipeline/` import from the pure layer).
  - `src/profile/hashing.js` + `src/profile/schema.js`.
- **Persists via** `Repositories` from
  `src/persistence/repositories/index.js`:
  `filterResults.findActiveByJob` (cache probe) plus writes through
  `FilterApplyService.apply`; `scoreResults.findActiveByJob` (probe)
  + `scoreResults.invalidateActiveByJob` (flip on filter rerun) +
  writes through `ScoringService.scoreOne`; `jobs.listComplete` for
  the selection universe; `filterConfigurations.findActive` and
  `profileVersions.findActiveApproved` for active state.
- **Logging boundary**: Pino adapter at
  `src/logging/reevaluation-logger.ts` implements
  `ReevaluationLogger`; pure layer uses `noopReevaluationLogger`.
