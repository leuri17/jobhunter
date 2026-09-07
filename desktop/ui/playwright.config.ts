import { defineConfig, devices } from '@playwright/test';

const FIXTURE_SIDECAR_PORT = 14231;
const FIXTURE_SIDECAR_URL = `http://127.0.0.1:${FIXTURE_SIDECAR_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Node + Fastify fixture that stubs every `/api/*` endpoint the
      // desktop UI touches. Boot it before Vite so the UI's first
      // `/api/health` ping (used by StatusPill + SidecarBanner) succeeds.
      // Fixes audit ID B4-B-L4.14 (sidecar fixture for e2e specs).
      command: 'pnpm exec tsx tests/e2e/fixtures/sidecar.ts',
      url: `${FIXTURE_SIDECAR_URL}/api/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
    {
      // Vite dev server. `VITE_SIDECAR_PORT` is injected at boot so
      // the sidecar-url resolver returns a high-confidence URL
      // (`http://127.0.0.1:14231`) instead of the empty proxy fallback.
      // When the resolver is high-confidence, `useSidecarReachability`
      // skips the fallback ping and `SidecarBanner` stays hidden — the
      // spec at `tests/e2e/sidecar-banner.spec.ts` asserts this state.
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: { VITE_SIDECAR_PORT: String(FIXTURE_SIDECAR_PORT) },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});