# src/inspection/

## Responsibility

Read-only inspection subsystem: renders persisted jobs and pipeline runs in tabular or multi-line form for the desktop sidecar's HTTP routes (and tests). Owns the typed row/payload vocabulary (`JobListRow`, `JobShowPayload`, `RunListRow`, `RunShowPayload`), the per-state column projection (`HEADERS_BY_STATE` / `PRIORITY_BY_STATE`), terminal-width adaptive truncation, and the Zod schemas that lock the JSON wire contract to `INSPECTION_SCHEMA_VERSION`.

## Design

Two-layer split — a pure layer (no I/O) and a service layer:

- **Pure layer** — `state.ts` (discriminated unions + `ColumnSpec`), `errors.ts` (`InspectionError` hierarchy mapping to `ExitCode.Fatal` / `ExitCode.InvalidUsage`), `columns.ts` (`selectColumns` drops lowest-priority columns until the per-state minWidth budget fits; ID is priority 0, never dropped), `truncate.ts` (`truncateWithEllipsis` uses U+2026), `format.ts` (table + multi-line renderers, right-aligned for ID/Score/Card), `json-schemas.ts` (Zod `.strict()` discriminated union mirrors the row shapes).
- **Service layer** — `JobsListService`, `JobsShowService`, `RunsListService`, `RunsShowService` in `services/`. They query repositories, sort via `sortJobListRows`, and assemble the `JobListResult` envelope.

Priority convention: `0` essential (ID), `1` secondary (Score), `2+` droppable; `NEVER_TRUNCATE_HEADERS = {ID, Score, Error ID}`. Drop is non-reordering — columns are removed tail-first after priority sort, then restored to documented order. `formatJobShow` / `formatRunShow` never truncate stored values; only the run-show diagnostic-reference path uses a width budget.

## Flow

`JobsListService.list(state, refinements)` / `RunsListService.list()` / `JobsShowService.show()` / `RunsShowService.show()` → query `src/persistence/repositories/` → project repository rows into typed `JobListRow` variants / `JobShowPayload` / `RunListRow` / `RunShowPayload` → optional `sortJobListRows` → consumer routes through either:

- **Human path** — `formatJobListTable(state, rows, terminalWidth)` calls `selectColumns(state, width)` → `renderCell` applies `truncateWithEllipsis` per `ColumnSpec` → joined header + rows. `formatJobShow` / `formatRunShow` print full stored values.
- **JSON path** — payload wrapped with `schemaVersion: 1` envelope, validated against `JobListJsonSchema` / `JobShowJsonSchema` / `RunListJsonSchema` / `RunShowJsonSchema` / `PathsJsonSchema`.

Empty inputs return `(no jobs)` / `(no runs)` placeholders rather than crashing. `selectColumns` throws `InspectionValidationError('terminal_width_too_small')` when the ID column itself cannot fit.

## Integration

Entry points: sidecar HTTP routes for list/show of jobs and runs plus `/api/paths` (`PathsJsonSchema`). Re-exported through `index.ts` for both the sidecar HTTP layer and the test harness. Services in `src/inspection/services/` are the sole consumers of `src/persistence/repositories/` for job and pipeline-run rows; the pure layer never imports persistence. Errors propagate as `InspectionValidationError` (exit code 2) for malformed identifiers or invalid input, and `InspectionNotFoundError` / `InspectionResourceNotFoundError` (exit codes 2 / 1) for missing rows or dangling foreign keys; the sidecar maps them to HTTP status responses.