/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: { '@': '/src' },
  },
  test: {
    // Playwright specs live under tests/e2e/; exclude them from vitest
    // so `pnpm test` (component/unit) doesn't try to run them.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
