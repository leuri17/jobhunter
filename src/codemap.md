# src/

## Responsibility

`src/` is the `@jobhunter/core` workspace sub-package (declared in `pnpm-workspace.yaml`). It is a private ESM library that exposes the core domain — configuration, logging, error taxonomy, persistence, profile model, search, filter, scoring, LinkedIn integration, and the per-area bounded-context service modules (`init`, `pipeline`, `reevaluation`, `inspection`) — to two consumers: the desktop sidecar (`desktop/sidecar/`) and the test harness. There is no CLI here: `index.ts` is a stub barrel (`export {};`), there is no `bin` field in `src/package.json` or the root `package.json`, and the package surface is consumed exclusively through the `exports` map (subpath imports like `@jobhunter/core/pipeline`).

## Design

- **Library layout, not a CLI** — `src/` is a private ESM package (`"type": "module"`, `"private": true`) imported by sibling workspace members (`desktop/sidecar`, `desktop/ui`); it exposes no program entry, no `bin`, and no argv parsing.
- **Subpath exports map** (`src/package.json`): every submodule is exposed under a stable contract so consumers never reach into internal files:
  - `.` -> `./index.ts` (stub)
  - `./config`, `./logging`, `./errors`, `./platform`, `./diagnostics` — cross-cutting infrastructure
  - `./persistence`, `./profile`, `./filter`, `./search`, `./scoring`, `./linkedin` — domain primitives
  - `./pipeline`, `./init`, `./reevaluation`, `./inspection` — bounded-context service modules grouped by use-case area; each ships its own `index.ts` (`service.ts`/`orchestrator.ts`), `state.ts`, `errors.ts`, `format.ts`, `log.ts`, and (where applicable) `prompts.ts` / `json-schemas.ts`. The folder names happen to align with sidecar HTTP route paths, but they are domain-area modules, not CLI commands.
- **Bounded-context pattern** — each area module follows the same internal pattern: typed state, dedicated error class, formatting layer, logger, and an orchestrator/service entry that an embedder (the sidecar's HTTP route handler, or tests) invokes with an already-parsed request object.
- **Build/typecheck** — `tsconfig.json` extends the root base config and emits to `dist`; the `typecheck` script runs `tsc --noEmit`.

## Flow

Consumers reach `@jobhunter/core` by subpath import (e.g. `@jobhunter/core/pipeline` resolves to `src/pipeline/index.ts`). That module's `index.ts` re-exports its `service`/`orchestrator`, which the embedder calls with a parsed request (the sidecar HTTP layer parses argv-equivalents from query/path/body and forwards; tests inject directly). The service loads typed `state`, runs the module's pipeline (prompt construction -> external calls -> normalization -> scoring/filtering -> persistence), raises domain errors from `./errors` (subclasses of `@jobhunter/core/errors`), and streams results through its `format.ts` and `log.ts` adapters. Cross-cutting concerns (config, logging, diagnostics, platform) are pulled in via the corresponding subpath exports.

## Integration

Composed of all subfolders: `config`, `logging`, `errors`, `platform`, `diagnostics`, `persistence`, `persistence/repositories`, `profile`, `filter`, `search`, `scoring`, `linkedin`, `linkedin/extraction`, `pipeline`, `init`, `reevaluation`, `inspection`. The `package.json` exports map is the integration contract; consumers import from `@jobhunter/core/<submodule>` per the `exports` field. The package itself is consumed only by `desktop/sidecar/` (the Fastify HTTP host that exposes core capabilities over HTTP + SSE) and by the test suite under `tests/` (acceptance + live).
