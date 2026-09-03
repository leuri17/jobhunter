# desktop/ui/

## Responsibility
Frontend UI sub-package (`@jobhunter/ui`, private, ESM) of the desktop workspace. Owns the
web bundle rendered inside the Tauri window: it is the HTTP client and SSE consumer for the
Node.js sidecar, renders pipeline output (runs, jobs, profile, config), and reaches the
native shell through `@tauri-apps/api` IPC for notifications and sidecar port discovery.

## Design
Thin manifest + `tsconfig.json`; all architecture lives under `src/`. React 19 SPA with
`@tanstack/react-router` for routing and `@tanstack/react-query` for server state;
`react-hook-form` + `@hookform/resolvers` + `zod` for forms/validation; `radix-ui` +
`class-variance-authority` + `clsx` + `tailwind-merge` + `lucide-react` for the component
layer. Domain types are not redeclared — they are re-exported from the workspace dependency
`@jobhunter/core` (`workspace:*`) via `src/lib/types.ts`, so response payloads stay in sync
with the sidecar. `tsconfig.json` extends `../../tsconfig.base.json`, is `noEmit` with
`moduleResolution: "Bundler"`, `jsx: "react-jsx"`, `types: ["vite/client", "node"]`, and the
`@/*` -> `./src/*` path alias; `include` is limited to `src`.

## Flow
`vite` (dev) or `tsc -b && vite build` (`build`) produces the static bundle; Tauri serves it
over the `custom-protocol` asset scheme in production and via the Vite dev server locally.
At runtime pages call `src/lib/api.ts` -> `sidecarBaseUrl()` -> `fetch` against
`desktop/sidecar/` routes (`/api/health`, `/api/config`, `/api/profile/*`, `/api/jobs/*`,
`/api/runs/*`, `/api/pipeline/*`), with non-2xx responses normalized into `ApiError`.
Streaming pipeline progress arrives through `src/lib/sse.ts` (`EventSource` on
`/api/pipeline/:runId/events`); terminal events invoke the Tauri command
`notify_pipeline_complete`. Verification scripts: `typecheck` (`tsc -b --noEmit`), `test`
(`vitest run` on happy-dom), `test:e2e` (`playwright test`), `preview` (`vite preview`).

## Integration
Sub-maps:
- [src/](desktop/ui/src/codemap.md) — entry (`main.tsx`), `router.tsx`, routes, components
- [src/lib/](desktop/ui/src/lib/codemap.md) — API client, SSE hook, query client, types

Consumed by the Tauri shell ([desktop/tauri/](desktop/tauri/codemap.md)) as its bundled
webview asset; talks HTTP/SSE to [desktop/sidecar/](desktop/sidecar/codemap.md) and shares
types with `@jobhunter/core`.
