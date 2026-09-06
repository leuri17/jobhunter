# Environment variables

The codebase reads eight environment variables. Six are real (build-time or runtime); two are test-only. This file is the canonical map.

| Variable | When read | Default | Required? | Description |
| --- | --- | --- | --- | --- |
| `OPENAI_API_KEY` | sidecar boot | — | yes (for non-trivial use) | The OpenAI key used by the sidecar for profile extraction and job scoring. |
| `OPENAI_MODEL` | sidecar boot | `gpt-5` | no | The model used for both profile extraction and job scoring. |
| `LOG_LEVEL` | sidecar boot | `info` | no | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent`. Overridden by `config.logging.level` when the operational config file sets it. |
| `JOBHUNTER_SIDECAR_PORT` | sidecar boot | `0` (OS-assigned) | no | The port the sidecar binds to. Only set explicitly for non-Tauri / non-supervised runs. |
| `VITE_SIDECAR_PORT` | webview build | empty (Vite dev proxy) | no | Override the URL the webview uses to reach the sidecar in dev. Read via `import.meta.env` — changing it requires a frontend rebuild. |
| `LINKEDIN_LIVE` | `pnpm test:live` | unset | no | Set to `1` to enable real-Chromium LinkedIn live tests. |
| `PLAYWRIGHT_SMOKE` | `pnpm test:e2e` | unset | no | Set to `1` to enable the two `*.smoke.test.ts` files in `tests/live/linkedin/`. |
| `CI` | Playwright webServer | unset | no | Auto-set by GitHub Actions. Controls whether Playwright reuses an existing dev server. |

## How to set them

### Development (`.env` at the repo root)

The sidecar and the Vitest suite read `process.env` directly. The webview reads `import.meta.env` at build time, but for dev Vite exposes those variables to the browser at runtime too.

```
cp .env.example .env
$EDITOR .env   # fill in OPENAI_API_KEY at minimum
```

`.env` is gitignored; never commit it.

### Production

The Tauri shell supervises the sidecar child process. The sidecar reads `process.env` at boot. Either set the variables in the OS environment before launching the desktop app, or wire them through your packaging layer (e.g. the macOS app bundle's `Info.plist` or a systemd unit file on Linux).

`VITE_SIDECAR_PORT` does **not** apply to production Tauri builds. The webview reaches the sidecar via Tauri's `invoke('sidecar_port')` IPC; the `VITE_*` variable is only consulted when running the Vite dev server outside the Tauri shell.

### CI

- The Tauri build CI workflow does not need these variables unless it runs the full vitest suite (it currently doesn't).
- The vitest GitHub Actions job sets `CI=1` automatically.
- LinkedIn live tests and Playwright smoke tests are opt-in and run on ad-hoc machines with `LINKEDIN_LIVE=1` / `PLAYWRIGHT_SMOKE=1` exported in the shell.

## Build-time vs runtime

The split is the most common confusion when a new contributor first runs the project. Concretely:

- **Build-time** (`VITE_*`): read once when Vite builds the frontend bundle. The bundle ships the resolved value. Changing the variable requires a rebuild. The webview in the Tauri shell does **not** consult these at runtime; the Tauri shell provides the sidecar URL via `invoke('sidecar_port')`.
- **Runtime**: read every time the sidecar process starts. The desktop app inherits the environment from the Tauri shell, which inherits from the user's shell. Toggling the variable without restarting the desktop app has no effect.

## Adding a new env var

1. Add the variable to `.env.example` with the table row above.
2. Reference it from the sidecar via `process.env['NAME']` or from the webview via `import.meta.env['NAME']`.
3. If the var is build-time, document that a frontend rebuild is required to pick up the change.
4. The CI grep guard in `tests/env-vars.test.ts` (issue #48 acceptance criteria) fails the build if a `process.env[...]` or `import.meta.env[...]` reference is added without a matching `.env.example` entry.
