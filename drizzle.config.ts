import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/persistence/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  verbose: true,
  strict: true,
});
