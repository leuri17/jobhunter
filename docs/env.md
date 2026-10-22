# Environment variables

The codebase reads eight environment variables. Six are real (build-time or runtime); two are test-only. This file is the canonical map.

| Variable | When read | Default | Required? | Description |
| --- | --- | --- | --- | --- |
| `OPENAI_API_KEY` | sidecar boot | — | yes (for non-trivial use) | The OpenAI key used by the sidecar for profile extraction and job scoring. |
| `OPENAI_MODEL` | sidecar boot | `gpt-5` | no | The model used for both profile extraction and job scoring. |
| `LOG_LEVEL` | sidecar boot | `info` | no | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent`. **Only used when no `config.json` exists.** `config.logging.level` always wins once the operational config is present — see [Log level precedence](#log-level-precedence). |
| `JOBHUNTER_SIDECAR_PORT` | sidecar boot | `0` (OS-assigned) | no | The port the sidecar binds to. Only set explicitly for non-Tauri / non-supervised runs. |
| `VITE_SIDECAR_PORT` | webview build | empty (Vite dev proxy) | no | Override the URL the webview uses to reach the sidecar in dev. Read via `import.meta.env` — changing it requires a frontend rebuild. |
| `LINKEDIN_LIVE` | `pnpm test:live` | unset | no | Set to `1` to enable real-Chromium LinkedIn live tests. |
| `PLAYWRIGHT_SMOKE` | `pnpm test:e2e` | unset | no | Set to `1` to enable the two `*.smoke.test.ts` files in `tests/live/linkedin/`. |
| `CI` | Playwright webServer | unset | no | Auto-set by GitHub Actions. Controls whether Playwright reuses an existing dev server. |

## Log level precedence

There are two sources for the sidecar's log level, and `config.json` always wins.

1. **`config.logging.level`** — the value in the operational config, edited in Settings → Advanced → Logging. This is the source of truth whenever a `config.json` exists.
2. **`LOG_LEVEL`** — the environment variable. Used **only when no `config.json` exists**, which in practice means only a first run before the app has ever been configured.

This ordering is deliberate. The Settings value is a choice the user made in the app, and it should not be silently overridden by a stale `LOG_LEVEL` left in a shell profile. The cost is that `LOG_LEVEL` looks functional but does nothing on a configured install.

### Why your `LOG_LEVEL` seems to do nothing

`DEFAULT_OPERATIONAL_CONFIG.logging.level` is `info`, and it is always written into a new `config.json`. So from the first run onward, a config-supplied level exists, the `LOG_LEVEL` fallback is unreachable, and the variable is ignored — even if it is set to something else.

The sidecar reports the effective resolution on every boot:

```
{"event":"log.level.resolved","level":"info","levelSource":"config"}
{"event":"log.level.env_shadowed","level":"info","levelSource":"config","shadowedEnvLevel":"debug"}
```

- `log.level.resolved` (info) — always emitted, naming the level in effect and which source won (`config`, `environment`, or `default`).
- `log.level.env_shadowed` (warn) — emitted only when `LOG_LEVEL` is set **and** differs from the config value, naming both.

### How to change the level

Set it in Settings → Advanced → Logging and restart the app. If you want `LOG_LEVEL` to be authoritative instead, remove `logging.level` from `config.json` — but note the app rewrites it on the next settings save, so the env var will be shadowed again. There is no supported configuration in which `LOG_LEVEL` overrides the in-app setting.

> The `log.level.env_shadowed` warning is emitted at `warn` level, which means it is suppressed if you have configured the log level to `error` or `fatal`. That is the requested behaviour, but it also means this particular diagnosis is invisible at those levels.

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
