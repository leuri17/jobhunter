# src/profile/review/

## Responsibility

Pure, side-effect-free helpers that power the human review step of the
profile pipeline. The folder aggregates a `ProfessionalProfile` with its
surrounding state (warnings, conflicts, overrides) into a human-readable
summary, detects discrepancies between profile versions, and applies
manual resolutions or derived-value overrides. All functions are pure
domain code: no IO, no persistence, no terminal or prompt dependencies.

## Design

- `review-summary.ts` — renderer. Exports `renderReviewSummary(inputs: ReviewSummaryInputs)`,
  which formats a profile plus its `ProfileWarningRow[]`, `ProfileConflictRow[]`,
  and `DerivedOverrideRow[]` into a deterministic text block. Empty sections
  render as `(none)`; blocking conflicts are split from non-blocking warnings
  by `resolutionStatus === 'unresolved'` and `severity === 'blocking_conflict'`.
- `conflict-resolution.ts` — discrepancy handler. Exports `resolveConflictOnProfile(profile, conflict, entityId, choice)`
  which produces a NEW `ProfessionalProfile` with one field on one entity
  updated. Original `valueSourceA` / `valueSourceB` claims on the
  `ProfileConflictRow` are never mutated. `ConflictResolutionChoice` is a
  discriminated union over `select_source_a`, `select_source_b`, `manual`,
  and `clear`. Entity kinds are derived from the `conflictType` prefix
  (`work_experience`, `language`, `education`, `certification`, `project`);
  unknown prefixes throw `InvalidProfileStateError('unknown_conflict_type')`.
- `override-application.ts` — derived-field override applier. Exports
  `applyOverrides(profile, overrides)` which recomputes `effectiveValue`
  for each of the four derived entries (`likelySeniority`, `primaryRoles`,
  `primaryDomains`, `strongestSkills`) based on the persisted
  `overrideActive` / `overrideValue` pair. `DerivedFieldKey` is the
  exported union of those four field names.
- `index.ts` — barrel re-exporting the public surface
  (`renderReviewSummary`, `resolveConflictOnProfile`, `applyOverrides`,
  `ConflictResolutionChoice`, `ConflictEntityKind`, `DerivedFieldKey`,
  `ReviewSummaryInputs`).

## Flow

1. `reviewVersions(versions)` (caller) compares two profile versions and
   surfaces any field-level differences as `ProfileConflictRow`s.
2. `renderReviewSummary({ profile, warnings, conflicts, overrides })`
   prints the full profile alongside the blocking conflicts and warnings
   so a reviewer can inspect the state.
3. The reviewer picks a `ConflictResolutionChoice` per conflict and
   `resolveConflictOnProfile(profile, conflict, entityId, choice)` is
   called to produce a new, resolved profile.
4. `applyOverrides(profile, overrides)` is then invoked to reconcile the
   four derived entries on the resolved profile with the persisted
   `DerivedOverrideRow`s, yielding the final review-ready profile.

## Integration

- Consumed by `src/profile/review-service.ts`, which orchestrates the
  end-to-end review workflow (diff → present → resolve → persist).
- Imports row types and the `InvalidProfileStateError` from
  `src/persistence/repositories/profile-versions.ts` and the schema types
  from `src/profile/schema.js` / `src/profile/errors.js`.
- Persists conflict resolutions and derived overrides back through
  `src/persistence/repositories/profile-versions.ts`; this folder never
  touches the repository directly.
- Public consumers must import through the `index.ts` barrel; reaching
  into the individual files is intentionally disallowed by project
  convention.
