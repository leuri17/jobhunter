// tests/acceptance/helpers/acceptance-harness.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { createProgram } from '../../../src/cli.js';
import { defaultInquirerFilterPrompts } from '../../../src/filter/prompts-inquirer.js';
import { ScriptedPipelinePrompts } from '../../../src/pipeline/prompts.js';
import { defaultInquirerInitPrompts } from '../../../src/init/prompts-inquirer.js';
import {
  configureSearchPromptAdapter,
  profileApprovalPromptAdapter,
  profileRejectionPromptAdapter,
} from '../../../src/init/cli-adapters.js';
import { FakeOpenAIClient } from '../../../src/profile/openai/fake-client.js';
import type { OpenAIClient } from '../../../src/profile/openai/types.js';
import { defaultInquirerPrompts } from '../../../src/search/prompts.js';

/**
 * TASK-018 T3 — Acceptance harness for the thin CLI adapter suite.
 *
 * The harness exists ONLY to:
 *   1. Create a hermetic `HOME` directory under `os.tmpdir()` so every
 *      CLI command resolves its XDG paths to a fresh, throwaway slot.
 *   2. Build a `Command` instance via `createProgram(...)` with fake
 *      dependencies injected (a `FakeOpenAIClient`, sensible scripted
 *      defaults for every prompt seam).
 *   3. Hand back a `cleanup` callback the test's `afterEach` invokes.
 *
 * The harness does NOT:
 *   - Stub `process.stdout.write` / `process.stderr.write` /
 *     `process.exit`. That stays in the test file (the
 *     `tests/cli/jobs-list.test.ts` pattern is battle-tested and simpler
 *     than a `captureStdStreams` helper would be).
 *   - Seed the SQLite DB. Commands that need DB rows open their own
 *     handle via `initializeDatabase()`; the test pre-seeds via
 *     `bootDatabase()` when needed.
 *   - Track env-var mutations. The test's `beforeEach` sets
 *     `process.env['HOME']` (and clears `OPENAI_API_KEY` for `run`).
 */
export interface AcceptanceHarnessOverrides {
  /** Scripted OpenAI responses (defaults to an empty `FakeOpenAIClient`). */
  readonly fakeScripts?: ConstructorParameters<typeof FakeOpenAIClient>[0];
  /** Optional scripted `SearchPrompts` for `configure search` + `init`. */
  readonly searchPrompts?: Parameters<typeof createProgram>[0] extends infer T
    ? T extends { prompts?: infer P }
      ? P
      : never
    : never;
  /** Optional scripted `FilterPrompts` for `configure filters` + `init`. */
  readonly filterPrompts?: Parameters<typeof createProgram>[0] extends infer T
    ? T extends { filterPrompts?: infer P }
      ? P
      : never
    : never;
  /** Optional scripted `InitPrompts` for `init`. */
  readonly initPrompts?: Parameters<typeof createProgram>[0] extends infer T
    ? T extends { initPrompts?: infer P }
      ? P
      : never
    : never;
  /** Optional scripted `SearchPrompts` for the init orchestrator. */
  readonly initSearchPrompts?: Parameters<typeof createProgram>[0] extends infer T
    ? T extends { initSearchPrompts?: infer P }
      ? P
      : never
    : never;
  /** Optional scripted `PipelinePrompts` for `run` + `jobs reevaluate`. */
  readonly pipelinePrompts?: ScriptedPipelinePrompts;
  /**
   * If supplied, replace the `FakeOpenAIClient` wholesale. Tests that
   * need a custom client (e.g. canned extraction responses) inject here.
   */
  readonly openaiClient?: OpenAIClient;
}

export interface AcceptanceHarness {
  /** Temp `HOME` directory created for this test; auto-removed by `cleanup()`. */
  readonly tempHome: string;
  /** Fake OpenAI client the harness wires into every `createProgram` call. */
  readonly openaiClient: OpenAIClient;
  /** The underlying `FakeOpenAIClient` so tests can introspect recorded calls. */
  readonly fakeClient: FakeOpenAIClient;
  /**
   * Build a fresh `Command` instance. Each call returns a NEW `Command`
   * so per-test `parseAsync` calls never share state.
   */
  buildProgram(overrides?: AcceptanceHarnessOverrides): Command;
  /** Close any held resources and remove the temp directory. */
  cleanup(): void;
}

export function setupAcceptanceHarness(): AcceptanceHarness {
  const tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-acceptance-'));
  const fakeClient = new FakeOpenAIClient({ responses: [] });
  const openaiClient: OpenAIClient = fakeClient;

  const buildProgram = (overrides: AcceptanceHarnessOverrides = {}): Command => {
    const fake =
      overrides.fakeScripts !== undefined
        ? new FakeOpenAIClient(overrides.fakeScripts)
        : fakeClient;
    const openai: OpenAIClient = overrides.openaiClient ?? fake;
    const pipelinePrompts = overrides.pipelinePrompts ?? new ScriptedPipelinePrompts([true]);

    // `exactOptionalPropertyTypes` means we must only set a key when the
    // override is actually supplied; an explicit `undefined` would fail
    // the type check. Build the options object conditionally.
    const options: Parameters<typeof createProgram>[0] = {
      prompts: overrides.searchPrompts ?? defaultInquirerPrompts,
      openaiClient: openai,
      filterPrompts: overrides.filterPrompts ?? defaultInquirerFilterPrompts,
      initPrompts: overrides.initPrompts ?? defaultInquirerInitPrompts,
      initSearchPrompts: overrides.initSearchPrompts ?? configureSearchPromptAdapter(),
      initApprovalPrompts: profileApprovalPromptAdapter(),
      initRejectionPrompts: profileRejectionPromptAdapter(),
      pipelinePrompts,
    };
    return createProgram(options);
  };

  return {
    tempHome,
    openaiClient,
    fakeClient,
    buildProgram,
    cleanup: () => rmSync(tempHome, { recursive: true, force: true }),
  };
}
