import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_OPERATIONAL_CONFIG,
  type FileSystem,
  type OperationalConfig,
} from '@jobhunter/core/config';
import type { PlatformPaths } from '@jobhunter/core/platform';

import {
  buildServer,
  createSidecarRootLogger,
  createSidecarRootLoggerFromConfig,
  resolveLogConfig,
  type ResolvedLogConfig,
} from '../src/server.js';

const silentEnv = (): NodeJS.ProcessEnv => ({ LOG_LEVEL: 'silent' });

const minimalPaths = (configPath: string): PlatformPaths => {
  const directory = path.dirname(configPath);
  return {
    config: { directory, file: () => configPath },
    data: { directory, file: () => '' },
    logs: { directory, file: () => '' },
    diagnostics: { directory, file: () => '' },
    cache: { directory, file: () => '' },
    profileSources: { directory, file: () => '' },
  };
};

/**
 * In-memory FileSystem fake so tests can drive loadConfig with deterministic
 * content without writing temp files. Persistence methods are no-ops since
 * loadConfig doesn't exercise them.
 */
const memoryFileSystem = (configContent: string): FileSystem => {
  const files = new Map<string, string>(configContent === '' ? [] : [['mem://config.json', configContent]]);
  return {
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`memoryFileSystem: no file at ${p}`);
      return v;
    },
    async writeFile(p, contents) {
      files.set(p, contents);
    },
    async rename() {
      // no-op
    },
    async mkdir() {
      // no-op
    },
    async pathExists(p) {
      return files.has(p);
    },
    async removeFile(p) {
      files.delete(p);
    },
  };
};

describe('resolveLogConfig', () => {
  it('uses env LOG_LEVEL when config is null', () => {
    const env: NodeJS.ProcessEnv = { LOG_LEVEL: 'debug' };
    const out: ResolvedLogConfig = resolveLogConfig(env, null);
    expect(out.level).toBe('debug');
    expect(out.prettyTerminal).toBe(false);
    expect(out.filePath).toBeUndefined();
  });

  it('defaults to info when neither config nor env is set', () => {
    const out = resolveLogConfig({} as NodeJS.ProcessEnv, null);
    expect(out.level).toBe('info');
    expect(out.prettyTerminal).toBe(false);
  });

  it('lets config.logging.level override the env', () => {
    const env: NodeJS.ProcessEnv = { LOG_LEVEL: 'warn' };
    const config = {
      config: {
        ...DEFAULT_OPERATIONAL_CONFIG,
        logging: { level: 'trace' as const, prettyTerminal: true, filePath: '/var/log/x.log' },
      },
      schemaVersion: 1 as const,
      hash: 'h',
      path: '/x',
    };
    const out = resolveLogConfig(env, config);
    expect(out.level).toBe('trace');
    expect(out.prettyTerminal).toBe(true);
    expect(out.filePath).toBe('/var/log/x.log');
  });

  it('lets config.logging.level win over env LOG_LEVEL when both are set', () => {
    const env: NodeJS.ProcessEnv = { LOG_LEVEL: 'error' };
    const config = {
      config: {
        ...DEFAULT_OPERATIONAL_CONFIG,
        logging: { level: 'info' as const, prettyTerminal: false },
      },
      schemaVersion: 1 as const,
      hash: 'h',
      path: '/x',
    };
    const out = resolveLogConfig(env, config);
    expect(out.level).toBe('info');
    expect(out.prettyTerminal).toBe(false);
  });
});

describe('createSidecarRootLoggerFromConfig', () => {
  it('returns a usable logger for the null-config path', () => {
    const logger = createSidecarRootLoggerFromConfig({ LOG_LEVEL: 'silent' }, null);
    expect(() => logger.info({ event: 'smoke' }, 'hi')).not.toThrow();
  });

  it('accepts config with filePath without throwing on construction', () => {
    const config = {
      config: {
        ...DEFAULT_OPERATIONAL_CONFIG,
        logging: {
          level: 'info' as const,
          prettyTerminal: false,
          filePath: '/tmp/jobhunter-test-does-not-exist/sidecar.log',
        },
      },
      schemaVersion: 1 as const,
      hash: 'h',
      path: '/x',
    };
    const logger = createSidecarRootLoggerFromConfig(silentEnv(), config);
    expect(typeof logger.info).toBe('function');
  });
});

describe('createSidecarRootLogger (env-only)', () => {
  it('builds a logger from LOG_LEVEL', () => {
    const logger = createSidecarRootLogger({ LOG_LEVEL: 'silent' });
    expect(() => logger.info({ event: 'smoke' }, 'hi')).not.toThrow();
  });
});

describe('buildServer with config plumbing', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'jobhunter-server-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeConfig = (configPath: string, content: OperationalConfig | string): void => {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    writeFileSync(configPath, text);
  };

  it('still works when no paths are provided (legacy env-only behavior)', async () => {
    const server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    try {
      expect(typeof server.inject).toBe('function');
      expect(typeof server.close).toBe('function');
    } finally {
      await server.close();
    }
  });

  it('falls back to env-only when loadConfig rejects (malformed JSON)', async () => {
    const configPath = path.join(tmpDir, 'config.json');
    writeConfig(configPath, '{ this is not json');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      paths: minimalPaths(configPath),
      processEnv: silentEnv(),
    });
    try {
      expect(typeof server.inject).toBe('function');
    } finally {
      await server.close();
    }
  });

  it('falls back to env-only when loadConfig rejects (validation failure)', async () => {
    const configPath = path.join(tmpDir, 'config.json');
    writeConfig(configPath, JSON.stringify({ bogusKey: true }));
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      paths: minimalPaths(configPath),
      processEnv: silentEnv(),
    });
    try {
      expect(typeof server.inject).toBe('function');
    } finally {
      await server.close();
    }
  });

  it('honors config.logging.level over env LOG_LEVEL', async () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config: OperationalConfig = {
      ...DEFAULT_OPERATIONAL_CONFIG,
      logging: { level: 'trace', prettyTerminal: false },
    };
    writeConfig(configPath, config);
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      paths: minimalPaths(configPath),
      processEnv: { LOG_LEVEL: 'silent' },
    });
    try {
      expect((server.log as unknown as { level: string }).level).toBe('trace');
    } finally {
      await server.close();
    }
  });
});

describe('memoryFileSystem fake (sanity)', () => {
  it('round-trips valid config through loadConfig-shaped flow', async () => {
    const fs = memoryFileSystem(JSON.stringify(DEFAULT_OPERATIONAL_CONFIG));
    expect(await fs.pathExists('mem://config.json')).toBe(true);
    const read = await fs.readFile('mem://config.json');
    expect(JSON.parse(read).logging.level).toBe('info');
  });
});