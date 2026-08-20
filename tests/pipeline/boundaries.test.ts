import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'vitest';

const PIPELINE_DIR = resolve(import.meta.dirname, '..', '..', 'src', 'pipeline');

const BANNED = [
  /^import\s.*from\s['"]playwright['"]/m,
  /^import\s.*from\s['"]drizzle-orm['"]/m,
  /^import\s.*from\s['"]openai['"]/m,
  /^import\s.*from\s['"]commander['"]/m,
  /^import\s.*from\s['"]pino['"]/m,
];

const ALLOWED_INQUIRER = ['prompts-inquirer.ts'];

describe('src/pipeline boundaries', () => {
  const files = readdirSync(PIPELINE_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    it(`${file} does not import banned packages directly`, () => {
      const path = join(PIPELINE_DIR, file);
      const content = readFileSync(path, 'utf8');
      if (file === 'version.ts') return; // walks up to read package.json
      if (file === 'orchestrator.ts') return; // checked separately in Task 16
      for (const pattern of BANNED) {
        if (pattern.test(content)) {
          throw new Error(`${file} imports a banned package: ${pattern}`);
        }
      }
    });

    it(`${file} does not import @inquirer/prompts except in the carve-out file`, () => {
      if (ALLOWED_INQUIRER.includes(file)) return;
      const path = join(PIPELINE_DIR, file);
      const content = readFileSync(path, 'utf8');
      if (/from\s+['"]@inquirer\/prompts['"]/.test(content)) {
        throw new Error(`${file} imports @inquirer/prompts; only ${ALLOWED_INQUIRER.join(',')} may.`);
      }
    });
  }
});