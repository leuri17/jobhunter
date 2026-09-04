/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SIDECAR_PROXY_TARGET = 'http://localhost:14231';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Browser dev: forward `/api/*` to the sidecar so the UI hits its own
    // origin (localhost:5173) and Vite proxies to the sidecar at the configured
    // target. The sidecar's CORS allowlist (registered in PR #87 / commit
    // bceb942) includes `http://localhost:<any-port>` so the proxied response
    // carries the correct `Access-Control-Allow-Origin` header back to the browser.
    // The sidecar must be started with `JOBHUNTER_SIDECAR_PORT=14231` to match
    // this target. SSE/EventSource requests are plain HTTP, so they proxy
    // without any WebSocket-specific config.
    proxy: {
      '/api': {
        target: SIDECAR_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: { '@': '/src' },
  },
  test: {
    // Playwright specs live under tests/e2e/; exclude them from vitest
    // so `pnpm test` (component/unit) doesn't try to run them.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
