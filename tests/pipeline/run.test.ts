import { describe, it } from 'vitest';

import { createProgram } from '../../src/cli.js';
import { PipelineOrchestrator } from '../../src/pipeline/orchestrator.js';
import { PIPELINE_SCHEMA_VERSION } from '../../src/pipeline/state.js';
import { PipelineOpenAIKeyMissingError } from '../../src/pipeline/errors.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { fakePageWithCard } from './helpers/fake-page-with-card.js';
import { insertActiveFilter, insertApprovedProfile } from './helpers/fixtures.js';
import { buildRunHarness, type RunHarness } from '../helpers/run-harness.js';

/**
 * End-to-end smoke tests for the `jobhunter run` CLI wiring
 * The CLI's `runCommand` helper itself is
 * not exported from `src/cli.ts` (it constructs real
 * OpenAIClient / BrowserSession / DiagnosticManager implementations
 * internally), so the tests below assert the *contract* the CLI
 * relies on:
 *
 *   - `createProgram()` exposes the `run` subcommand with `--yes`
 *     + `--json` flags.
 *   - The orchestrator accepts a `cancelSignal` slot so the CLI's
 *     SIGINT-driven `AbortController` can abort the run.
 *   - `PipelineOpenAIKeyMissingError` is exported from the public
 *     barrel (the CLI throws it before constructing the orchestrator).
 *   - The orchestrator's `runCommand`-equivalent path produces a
 *     smoke-passing `PipelineRunResult` when wired through the harness
 *     with a fake page factory + pre-aborted cancel signal.
 */
describe('PipelineOrchestrator end-to-end (CLI wiring smoke)', () => {
  it('the CLI program exposes the run subcommand with --yes + --json', () => {
    const program = createProgram();
    const run = program.commands.find((c) => c.name() === 'run');
    if (run === undefined) throw new Error('run subcommand not registered');
    if (run.options.find((o) => o.long === '--yes') === undefined) {
      throw new Error('run subcommand missing --yes flag');
    }
    if (run.options.find((o) => o.long === '--json') === undefined) {
      throw new Error('run subcommand missing --json flag');
    }
  });

  it('PipelineOpenAIKeyMissingError is exported from the public barrel', () => {
    if (typeof PipelineOpenAIKeyMissingError !== 'function') {
      throw new Error('PipelineOpenAIKeyMissingError not exported');
    }
  });

  it('PipelineOrchestrator accepts a cancelSignal slot (CLI forwards SIGINT here)', () => {
    const ctrl = new AbortController();
    const opts = {
      repositories: {} as never,
      browserSession: {} as never,
      discoveryService: {} as never,
      extractionService: {} as never,
      filterApplyService: {} as never,
      scoringService: {} as never,
      diagnosticManager: {} as never,
      config: {
        rawConfig: {} as never,
        hash: 'h',
        schemaVersion: 1 as const,
      },
      prompts: {} as never,
      confirmScoring: false,
      env: {},
      applicationVersion: '0.0.0',
      cancelSignal: ctrl.signal,
    };
    const orchestrator = new PipelineOrchestrator(opts);
    if (typeof orchestrator.run !== 'function') {
      throw new Error('orchestrator.run is not a function');
    }
  });

  it('orchestrator cancelSignal slot is honored end-to-end (T8 smoke)', async () => {
    let harness: RunHarness | null = null;
    try {
      const config = {
        ...DEFAULT_OPERATIONAL_CONFIG,
        search: {
          ...DEFAULT_OPERATIONAL_CONFIG.search,
          searchQueries: ['q1'],
          locations: [{ name: 'L1', geoId: '1' }],
        },
      };
      harness = buildRunHarness({
        config,
        prompts: new ScriptedPipelinePrompts([]),
        createPage: fakePageWithCard(['4242']),
        cancelSignal: AbortSignal.abort(),
      });
      await insertApprovedProfile(harness.repositories);
      await insertActiveFilter(harness.repositories);
      const result = await harness.orchestrator.run({});
      if (result.summary.status !== 'cancelled') {
        throw new Error(`expected status 'cancelled', got ${result.summary.status}`);
      }
      if (result.summary.cancellationReason === null) {
        throw new Error('expected cancellationReason to be populated');
      }
    } finally {
      harness?.cleanup();
    }
  });

  it('pipeline schema version constant is locked at 1', () => {
    if (PIPELINE_SCHEMA_VERSION !== 1) {
      throw new Error(`expected PIPELINE_SCHEMA_VERSION === 1, got ${PIPELINE_SCHEMA_VERSION}`);
    }
  });
});
