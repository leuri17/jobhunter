import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

describe('CLI foundation', () => {
  it('exposes help metadata without product commands', () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(help).toContain('Usage: jobhunter');
    expect(help).toContain('Local job discovery pipeline');
    expect(program.commands).toHaveLength(0);
  });

  it('does not create runtime files while constructing help', () => {
    const temporaryHome = mkdtempSync(join(tmpdir(), 'jobhunter-foundation-'));
    const before = readdirSync(temporaryHome);
    const previousEnvironment = {
      HOME: process.env.HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    };

    process.env.HOME = temporaryHome;
    process.env.XDG_CONFIG_HOME = join(temporaryHome, 'config');
    process.env.XDG_DATA_HOME = join(temporaryHome, 'data');
    process.env.XDG_STATE_HOME = join(temporaryHome, 'state');
    process.env.XDG_CACHE_HOME = join(temporaryHome, 'cache');

    try {
      createProgram().helpInformation();
      expect(readdirSync(temporaryHome)).toEqual(before);
    } finally {
      if (previousEnvironment.HOME === undefined) delete process.env.HOME;
      else process.env.HOME = previousEnvironment.HOME;
      if (previousEnvironment.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousEnvironment.XDG_CONFIG_HOME;
      if (previousEnvironment.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousEnvironment.XDG_DATA_HOME;
      if (previousEnvironment.XDG_STATE_HOME === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousEnvironment.XDG_STATE_HOME;
      if (previousEnvironment.XDG_CACHE_HOME === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousEnvironment.XDG_CACHE_HOME;
      rmSync(temporaryHome, { recursive: true, force: true });
    }
  });
});
