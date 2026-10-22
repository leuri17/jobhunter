# Environment variables

The codebase reads eight environment variables. Six are real (build-time or runtime); two are test-only. This file is the canonical map.

| Variable | When read | Default | Required? | Description |
| --- | --- | --- | --- | --- |
| `OPENAI_API_KEY` | sidecar boot | — | no | Fallback OpenAI key used for profile extraction and job scoring. **Prefer entering the key in Settings → AI Provider**, which stores it on this machine and takes precedence over this variable. See [OpenAI API key precedence](#openai-api-key-precedence). |
| `OPENAI_MODEL` | sidecar boot | `gpt-5` | no | The model used for both profile extraction and job scoring. |
| `LOG_LEVEL` | sidecar boot | `info` | no | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent`. Overridden by `config.logging.level` when the operational config file sets it. |
| `JOBHUNTER_SIDECAR_PORT` | sidecar boot | `0` (OS-assigned) | no | The port the sidecar binds to. Only set explicitly for non-Tauri / non-supervised runs. |
| `VITE_SIDECAR_PORT` | webview build | empty (Vite dev proxy) | no | Override the URL the webview uses to reach the sidecar in dev. Read via `import.meta.env` — changing it requires a frontend rebuild. |
| `LINKEDIN_LIVE` | `pnpm test:live` | unset | no | Set to `1` to enable real-Chromium LinkedIn live tests. |
| `PLAYWRIGHT_SMOKE` | `pnpm test:e2e` | unset | no | Set to `1` to enable the two `*.smoke.test.ts` files in `tests/live/linkedin/`. |
| `CI` | Playwright webServer | unset | no | Auto-set by GitHub Actions. Controls whether Playwright reuses an existing dev server. |

## OpenAI API key precedence

There are two ways to supply the OpenAI key, and the one you set in the app wins.

1. **Settings → AI Provider** — entered in the app and stored on this machine in `secrets.json` under the platform config directory (mode `0600`, not encrypted). **This is the recommended route.**
2. **`OPENAI_API_KEY`** — the environment variable. Used only when nothing is stored.

A normal user never needs to touch this variable. Settings is the supported path; the env var exists so CI, headless runs, and existing developer setups keep working.

### Why the env var seems to do nothing

The stored key takes precedence, so once you save one in Settings, any `OPENAI_API_KEY` in your environment is ignored — including one in a stale shell profile. Settings shows an inline notice when the key currently in use came from the environment, so you can see which source is active.

### Storage and security

- The key is stored in a file (`secrets.json`), **not** in the OS keychain and **not** in `config.json`. It is written at mode `0600` with the parent directory at `0700`.
- The key is **never returned over the API**. `GET /api/secrets/api-key` reports only whether a key is configured, which source won, and a masked form (`sk-***…234`). The app never needs to read the real value back.
- The stored key is not part of the operational config, so it does not affect the config hash and cannot appear in the settings diff.
- If the stored key cannot be read (for example the file is corrupt), the app falls back to `OPENAI_API_KEY` rather than failing.

> Replacing the plaintext `secrets.json` with the OS keychain is tracked in #211. Until that lands, the key is protected by file permissions rather than OS-level encryption.

## How to set them

### Development (`.env` at the repo root)

The sidecar and the Vitest suite read `process.env` directly. The webview reads `import.meta.env` at build time, but for dev Vite exposes those variables to the browser at runtime too.

```
cp .env.example .env
$EDITOR .env   # only needed if you want to set OPENAI_API_KEY here
```

`.env` is gitignored; never commit it.

**You do not need a `.env` file to run the app.** Enter your OpenAI key in Settings → AI Provider instead; it is stored on your machine and takes precedence over `OPENAI_API_KEY`. A `.env` is only a convenience for development and CI.

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
