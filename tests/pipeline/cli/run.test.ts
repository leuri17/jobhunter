import { describe, expect, it } from 'vitest';

import { createProgram } from '../../../src/cli.js';

describe('CLI run subcommand', () => {
  it('registers the run subcommand', () => {
    const program = createProgram();
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run).toBeDefined();
    expect(run?.description()).toContain('Run the full discovery');
  });

  it('run subcommand has --yes and --json flags', () => {
    const program = createProgram();
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run?.options.find((o) => o.long === '--yes')).toBeDefined();
    expect(run?.options.find((o) => o.long === '--json')).toBeDefined();
  });
});
