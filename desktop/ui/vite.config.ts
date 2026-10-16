/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    strictPort: true,
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
