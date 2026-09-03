# desktop/

## Responsibility

Desktop application workspace: a Tauri shell that bundles a Node.js HTTP sidecar and a web-based UI, packaging the headless `src/` core as a native desktop application for the `@jobhunter` system.

## Design

Three-component layout following the Tauri sidecar pattern:

- **Rust shell (`tauri/`)** — Tauri 2 host process. Manages window lifecycle, spawns and supervises the sidecar via `tokio::process`, enforces single-instance behavior, and exposes native notifications.
- **Node.js sidecar (`sidecar/`)** — Fastify 5 HTTP server wrapping `@jobhunter/core`. Compiled with `tsc`, executed under `tsx` in dev. Uses `@fastify/cors` and `@fastify/multipart` to expose core capabilities over a local HTTP boundary.
- **Web UI (`ui/`)** — React 19 SPA built with Vite 8 and Tailwind 4. Uses TanStack Router for routing, TanStack React Query for server state, react-hook-form + zod for forms/validation, and Radix primitives for accessible UI. Communicates with the Tauri host via `@tauri-apps/api` IPC.

Build target is `custom-protocol` so production bundles serve UI assets through Tauri's asset protocol rather than HTTP.

## Flow

UI ↔ Sidecar over HTTP (request/response and Server-Sent Events for streaming). UI ↔ Tauri shell over Tauri's IPC bridge (`@tauri-apps/api` invoke/event channels). Tauri shell ↔ Sidecar as parent-child process: shell spawns the Node.js entrypoint (`sidecar/src/server.ts`) on app startup and tears it down on exit. The sidecar itself holds no UI state — it is a thin HTTP adapter delegating to `@jobhunter/core`.

## Integration

- `desktop/sidecar/` — Fastify HTTP wrapper exposing `src/` core — [View Map](desktop/sidecar/codemap.md)
- `desktop/ui/` — React frontend (Vite + TanStack) — [View Map](desktop/ui/codemap.md)
- `desktop/tauri/` — Rust shell (Tauri 2) — [View Map](desktop/tauri/codemap.md)