# desktop/ui/src/

## Responsibility
UI source root for the Tauri webview (React 19 + Vite). Owns the client bootstrap (`main.tsx`), the TanStack Router route-tree composition (`router.tsx`), and the global Tailwind v4 stylesheet/theme (`styles.css`). The entry HTML lives one level up at `desktop/ui/index.html`, which mounts `#root` and loads `main.tsx` as a module.

## Design
- `main.tsx` mounts a `createRoot` render under `StrictMode`, wrapping `RouterProvider` in `QueryClientProvider` so every route shares the singleton `queryClient` from `lib/query-client.ts`.
- `router.tsx` uses **code-based route composition**: each file in `routes/` exports a `Route`, and the tree is wired here via `rootRoute.addChildren([...])`. This deliberately sidesteps the TanStack Router Vite codegen plugin while retaining a file-based `routes/` layout for future codegen adoption. A `declare module` block registers the router type for typed navigation.
- `styles.css` imports `tailwindcss` and defines the dark-first design tokens in an `@theme` block (oklch color scale, `--radius`) consumed by components via Tailwind utilities.
- Subfolders: `lib/` (sidecar API client, SSE hook, types, utils), `routes/` (one module per screen: index/jobs/pipeline/runs/profile/settings plus `__root` layout), `components/` (shared presentational pieces + `components/ui/` primitives). Absolute imports resolve through the `@/*` alias.

## Flow
`index.html` -> `main.tsx` -> `queryClient` + `router` -> `routes/__root.tsx` renders the persistent sidebar shell and `<Outlet />` -> the matched route component fetches through React Query into `lib/api.ts` (HTTP) or subscribes via `lib/sse.ts` (`EventSource`) against the local sidecar. Global styles are side-effect imported by `main.tsx` before first paint.

## Integration
Bundled by `desktop/ui/vite.config.ts` into the asset dir loaded by the Tauri shell; all backend traffic goes to `desktop/sidecar/` over the resolved sidecar base URL. Domain types come from the `@jobhunter/core` workspace package via `lib/types.ts`.

Sub-maps: [lib/](/desktop/ui/src/lib/codemap.md)
