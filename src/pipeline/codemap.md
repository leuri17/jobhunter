# src/pipeline/

## Responsibility

End-to-end pipeline orchestration: discover LinkedIn jobs for a generated
search matrix, extract per-job details, apply the active filter, score
accepted jobs with OpenAI, and persist the run lifecycle. Owns the
pipeline-run state machine, configuration snapshotting, and the seams
the desktop sidecar plugs into (logger, prompts).

## Design

- `PipelineOrchestrator` (orchestrator.ts) coordinates all phases via
  `run(input: PipelineRunInput)`, returning
  `PipelineRunResult { summary, scoringPlan, topN }`.
- State vocabulary is pure TS in `state.ts`: `PipelineRunStatus`
  (`running | cancelling | completed | completed_with_errors | failed |
  cancelled`), `RunSummary` (21-field persisted shape), `TopNRow`,
  `PIPELINE_SCHEMA_VERSION = 1`.
- Typed error hierarchy in `errors.ts` — `PipelineLifecycleError` →
  `PipelinePrerequisiteError` → `PipelineOpenAIKeyMissingError` —
  carrying exit codes (Fatal / MissingRequired); per-job / per-search
  failures stay as `RunSummary` counters.
- Seams: `PipelineLogger` (log.ts) with `noopPipelineLogger` /
  `pinoPipelineLogger`; `PipelinePrompts` (prompts.ts) with
  `ScriptedPipelinePrompts` / `FailingPipelinePrompts` test adapters.
- `normalize.ts` produces a sorted-keys JSON snapshot of
  `OperationalConfig` + SHA-256 hash (`pipelineRuns.configHash`);
  `format.ts` renders `RunSummary` / `TopNRow[]` / `ScoringPlan` as
  text; `version.ts` resolves the package version.

## Flow

1. `PipelineOrchestrator.run()` → `validatePrerequisites()` (OpenAI
   key, active approved profile, active filter config).
2. `generateSearchMatrix()` yields search entries;
   `repositories.pipelineRuns.createRunWithSearches()` opens the run
   in `running` status with `configSnapshotJson` + `configHash`.
3. `browserSession.launch()`, then per search (`runOneSearch`):
   `discoveryService.discover` → open search page →
   `extractionService.extractBatch` (aggregate `complete | partial |
   failed | skipped`) → `filterApplyService.apply` over each
   `complete` job, pushing accepted jobs onto `perJobs`.
4. `buildScoringPlan()` from accepted perJobs; `prompts.askScoringConfirmation`
   when new OpenAI requests exist and `confirmScoring` is false.
5. `runScoring()` → `scoringService.scoreBatch({ jobs, signal })`;
   `ScoringHardStopError` downgrades status to `completed_with_errors`.
6. Derive final status, `pipelineRuns.finalizeRunStats()`, then
   `computeTopN(runId, runTopN)` via `scoreResults.topByRun()`.

`browserSession.close()` and `diagnosticManager.close()` run in a
`finally`; the supplied `cancelSignal` short-circuits the search loop
to `cancelled` with `cancellationReason = 'user_cancelled'`.

## Integration

- `src/search/index.ts` — `generateSearchMatrix`.
- `src/linkedin/` — `discovery-service`, `extraction/service`,
  `browser-session`, `LinkedInScraperError`.
- `src/filter/service.ts` — `FilterApplyService.apply`; `src/filter/`
  configs — `filterConfigurations.findActive()` supplies scoring
  fingerprint.
- `src/scoring/` — `ScoringService.buildScoringPlan` / `scoreBatch`,
  `ScoringPlan`, `ScoringHardStopError`.
- `src/persistence/repositories/pipeline-runs.ts` — run lifecycle
  (`createRunWithSearches`, `findSearchById`, `finalizeRunStats`);
  plus `repositories.jobs`, `repositories.scoreResults`.
- `src/profile/` — `profileVersions.findActiveApproved()` gates scoring.
- `src/config/schema.ts` — `OperationalConfig` snapshot source.
- `src/diagnostics/manager.ts` — closed at end of run.
- `src/logging/logger.ts` — `pinoPipelineLogger` adapter target.
