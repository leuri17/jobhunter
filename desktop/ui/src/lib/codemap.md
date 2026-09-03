# desktop/ui/src/lib/

## Responsibility
Shared frontend utilities for the desktop webview: typed HTTP client targeting the Tauri sidecar, Server-Sent Events consumer for streaming pipeline output, sidecar URL resolution for dev vs production builds, React Query client configuration, shared API type definitions, and a generic class-name helper.

## Design
- `api.ts` exposes a single `api` object whose methods map 1:1 to sidecar routes; a private `request<T>()` helper centralizes fetch, JSON encoding, and error normalization into `ApiError`. `notifyPipelineComplete()` invokes a best-effort Tauri command for OS notifications.
- `sidecar-url.ts` resolves the sidecar base URL: production binaries call the Tauri IPC command `sidecar_port` to obtain the OS-assigned port; dev mode (no Tauri) falls back to `VITE_SIDECAR_PORT` env var or `DEFAULT_DEV_PORT` (14231).
- `sse.ts` exports the React hook `usePipelineEvents(runId)` which opens an `EventSource` against `/api/pipeline/:runId/events`, appends `log` events to a buffered line list, resolves on the terminal `done` event (firing `notifyPipelineComplete`), and degrades to `status: 'error'` on transport failure.
- `query-client.ts` constructs a singleton `QueryClient` with `staleTime: 5_000`, `retry: 1`, and `refetchOnWindowFocus: false`.
- `types.ts` re-exports zod-derived payload types from `@jobhunter/core/*` (`@jobhunter/core/config`, `profile`, `inspection`) and declares versioned response envelopes (`schemaVersion: 1`) that mirror `desktop/sidecar/src/routes/*` handlers.
- `utils.ts` provides `cn(...)`, a `clsx` + `tailwind-merge` wrapper for composing Tailwind class names.

## Flow
UI page/hook -> `api.<method>()` (e.g. `api.listJobs`, `api.getConfig`, `api.runPipeline`) -> `request<T>()` resolves `sidecarBaseUrl()` -> `fetch` against the sidecar -> typed JSON response (e.g. `ListJobsResponse`, `ConfigResponse`). For streaming, `usePipelineEvents(runId)` -> `sidecarBaseUrl()` -> `EventSource('/api/pipeline/:runId/events')` -> incremental `log`/`done` events -> terminal state fires `notifyPipelineComplete`. React Query caches the request layer via the shared `queryClient` singleton.

## Integration
Imported by UI page components (`desktop/ui/src/pages/*`) and feature hooks. Talks to the local HTTP routes exposed by `desktop/sidecar/` (Axum handlers). Request/response shapes are kept in lockstep with the sidecar through the shared types in `types.ts`, which source domain types from the `@jobhunter/core` workspaces.
