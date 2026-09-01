import { describe, expect, it } from 'vitest';

import { formatInitSummary } from '../../src/init/format.js';
import { INIT_STEPS, type InitStepReport, type SetupSummary } from '../../src/init/state.js';

/**
 *  Minor h — `formatInitSummary` test. Asserts the deterministic
 * human-readable renderer covers every documented `SetupSummary` shape:
 *
 *   1. `ready: true`
 *   2. `ready: false` + `openAiKeyMissing: true`
 *   3. `ready: false` + edit handoff (`nextStep: 'approvedProfile'`,
 *      reason `edit_handoff`)
 *   4. `ready: false` + blocking conflict (`nextStep: 'approvedProfile'`,
 *      step `failed` with `errorCode: 'blocking_conflicts_unresolved'`)
 *   5. `ready: false` + invalid config (`nextStep: 'config'`, step
 *      `failed` with `errorCode: 'config_invalid'`)
 *
 * The output must be deterministic (same input → same output) and
 * newline-terminated per the CLI's `<line>\n` writing convention.
 */

/**
 * Helper: build a `SetupSummary` literal where every step has the
 * supplied `status` (and `errorCode` is `null` unless `stepErrorCodes`
 * supplies a per-step override). The result has `steps` ordered by
 * `INIT_STEPS` and the supplied `nextStep` derived from the first
 * non-complete step.
 */
function buildSummary(args: {
  readonly statuses: Readonly<Partial<Record<string, InitStepReport['status']>>>;
  readonly reasons?: Readonly<Partial<Record<string, string | null>>>;
  readonly stepErrorCodes?: Readonly<Partial<Record<string, string | null>>>;
  readonly stepArtifactIds?: Readonly<Partial<Record<string, string | null>>>;
  readonly ready?: boolean;
  readonly nextStep?: SetupSummary['nextStep'];
  readonly openAiKeyMissing?: boolean;
}): SetupSummary {
  const steps: InitStepReport[] = INIT_STEPS.map((id) => ({
    id,
    status: args.statuses[id] ?? 'complete',
    errorCode: args.stepErrorCodes?.[id] ?? null,
    reason: args.reasons?.[id] ?? null,
    artifactId: args.stepArtifactIds?.[id] ?? null,
  }));
  return {
    schemaVersion: 1,
    ready: args.ready ?? false,
    steps,
    nextStep: args.nextStep ?? null,
    openAiKeyMissing: args.openAiKeyMissing ?? false,
  };
}

describe('formatInitSummary', () => {
  it('renders a fully-ready summary deterministically', () => {
    const summary = buildSummary({
      statuses: {
        paths: 'complete',
        directories: 'complete',
        migrations: 'complete',
        config: 'complete',
        openaiKey: 'complete',
        search: 'complete',
        sources: 'complete',
        extract: 'complete',
        approvedProfile: 'complete',
        filters: 'complete',
      },
      stepArtifactIds: {
        extract: 'profile_42',
        approvedProfile: 'profile_42',
      },
      ready: true,
      nextStep: null,
      openAiKeyMissing: false,
    });
    const expected = [
      'paths: complete',
      'directories: complete',
      'migrations: complete',
      'config: complete',
      'openaiKey: complete',
      'search: complete',
      'sources: complete',
      'extract: complete',
      'approvedProfile: complete',
      'filters: complete',
      'ready: yes',
      'next: none',
      '',
    ].join('\n');
    expect(formatInitSummary(summary)).toBe(expected);
  });

  it('renders an openAiKeyMissing partial summary', () => {
    const summary = buildSummary({
      statuses: {
        extract: 'incomplete',
      },
      reasons: {
        extract: 'openai_key_missing',
      },
      ready: false,
      nextStep: 'extract',
      openAiKeyMissing: true,
    });
    const output = formatInitSummary(summary);
    expect(output).toContain('extract: incomplete');
    expect(output).toContain('ready: no');
    expect(output).toContain('next: extract');
    expect(output.endsWith('\n')).toBe(true);
    // Determinism: same input → same output.
    expect(formatInitSummary(summary)).toBe(output);
  });

  it('renders an edit handoff partial summary', () => {
    const summary = buildSummary({
      statuses: {
        approvedProfile: 'not_started',
      },
      reasons: {
        approvedProfile: 'edit_handoff',
      },
      stepArtifactIds: {
        approvedProfile: 'profile_7',
      },
      ready: false,
      nextStep: 'approvedProfile',
    });
    const output = formatInitSummary(summary);
    expect(output).toContain('approvedProfile: not_started');
    expect(output).toContain('ready: no');
    expect(output).toContain('next: approvedProfile');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('renders a blocking-conflict failed step', () => {
    const summary = buildSummary({
      statuses: {
        approvedProfile: 'failed',
      },
      stepErrorCodes: {
        approvedProfile: 'blocking_conflicts_unresolved',
      },
      reasons: {
        approvedProfile: 'blocking_conflicts_unresolved',
      },
      stepArtifactIds: {
        approvedProfile: 'profile_11',
      },
      ready: false,
      nextStep: 'approvedProfile',
    });
    const output = formatInitSummary(summary);
    expect(output).toContain('approvedProfile: failed [errorCode=blocking_conflicts_unresolved]');
    expect(output).toContain('ready: no');
    expect(output).toContain('next: approvedProfile');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('renders an invalid config failed step', () => {
    const summary = buildSummary({
      statuses: {
        config: 'failed',
      },
      stepErrorCodes: {
        config: 'config_invalid',
      },
      reasons: {
        config: 'config_invalid',
      },
      ready: false,
      nextStep: 'config',
    });
    const output = formatInitSummary(summary);
    expect(output).toContain('config: failed [errorCode=config_invalid]');
    expect(output).toContain('ready: no');
    expect(output).toContain('next: config');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('uses the literal step order INIT_STEPS', () => {
    const summary = buildSummary({ statuses: {} });
    const output = formatInitSummary(summary);
    const lines = output.split('\n');
    // The first 10 lines must be the steps in INIT_STEPS order.
    const expectedIds = [
      'paths',
      'directories',
      'migrations',
      'config',
      'openaiKey',
      'search',
      'sources',
      'extract',
      'approvedProfile',
      'filters',
    ];
    for (const [index, id] of expectedIds.entries()) {
      expect(lines[index]).toBe(`${id}: complete`);
    }
  });
});
