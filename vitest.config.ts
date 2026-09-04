import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**'],
    coverage: {
      provider: 'v8',
      // Per-file coverage floors for the three critical module trees. Each file
      // is judged on its own so one weak file cannot hide behind a healthy
      // aggregate. Values are set at (or just below) the baseline measured when
      // the gate was introduced; raise them as coverage grows.
      thresholds: {
        perFile: true,
        'src/scoring/**/*.ts': {
          lines: 13,
          functions: 33,
          branches: 0,
          statements: 13,
        },
        'src/persistence/repositories/**/*.ts': {
          lines: 78,
          functions: 77,
          branches: 60,
          statements: 75,
        },
        'src/pipeline/**/*.ts': {
          lines: 33,
          functions: 33,
          branches: 40,
          statements: 33,
        },
      },
    },
  },
});
