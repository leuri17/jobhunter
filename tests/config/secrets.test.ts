import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileSecretsStore, maskSecret, resolveSecretsPath } from '../../src/config/secrets.js';
import { resolveApiKeySource, resolveOpenAiApiKey } from '../../src/config/api-key.js';
import type { PlatformPaths } from '../../src/platform/paths.js';

function pathsFor(root: string): PlatformPaths {
  const slot = () => ({ directory: root, file: (f: string) => path.join(root, f) });
  return {
    config: slot('config'),
    data: slot('data'),
    logs: slot('logs'),
    diagnostics: slot('diagnostics'),
    profileSources: slot('profile-sources'),
  } as PlatformPaths;
}

describe('FileSecretsStore', () => {
  let root: string;
  let store: FileSecretsStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'jobhunter-secrets-'));
    store = new FileSecretsStore({ paths: pathsFor(root) });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty secrets when nothing is stored', async () => {
    expect(await store.read()).toEqual({});
  });

  it('round-trips a stored key', async () => {
    await store.write({ openaiApiKey: 'sk-test-123' });
    expect(await store.read()).toEqual({ openaiApiKey: 'sk-test-123' });
  });

  it('writes the file with owner-only permissions', async () => {
    await store.write({ openaiApiKey: 'sk-test-123' });
    const mode = statSync(resolveSecretsPath(pathsFor(root))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('overwrites rather than appends on a second write', async () => {
    await store.write({ openaiApiKey: 'first' });
    await store.write({ openaiApiKey: 'second' });
    expect(await store.read()).toEqual({ openaiApiKey: 'second' });
  });

  it('clear removes the stored key', async () => {
    await store.write({ openaiApiKey: 'sk-test-123' });
    await store.clear();
    expect(await store.read()).toEqual({});
  });

  it('throws a typed error when the file is not valid JSON', async () => {
    await store.write({ openaiApiKey: 'sk-test-123' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolveSecretsPath(pathsFor(root)), 'not json');
    await expect(store.read()).rejects.toMatchObject({ code: 'secrets_parse_failed' });
  });

  it('ignores an empty string value as unset', async () => {
    await store.write({ openaiApiKey: 'sk-test-123' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolveSecretsPath(pathsFor(root)), JSON.stringify({ openaiApiKey: '' }));
    expect(await store.read()).toEqual({});
  });
});

describe('maskSecret', () => {
  it('returns empty for unset', () => {
    expect(maskSecret(undefined)).toBe('');
    expect(maskSecret('')).toBe('');
  });

  it('never returns the full value', () => {
    const masked = maskSecret('sk-proj-abcdefghijklmnop1234');
    expect(masked).not.toContain('abcdefghijklmnop');
    expect(masked.startsWith('sk-')).toBe(true);
    expect(masked.endsWith('234')).toBe(true);
  });

  it('fully masks short values', () => {
    expect(maskSecret('abcd')).toBe('****');
  });
});

describe('resolveOpenAiApiKey precedence', () => {
  let root: string;
  let store: FileSecretsStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'jobhunter-key-'));
    store = new FileSecretsStore({ paths: pathsFor(root) });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prefers the stored key over the environment', async () => {
    await store.write({ openaiApiKey: 'sk-stored' });
    const resolved = await resolveOpenAiApiKey({ store, env: { OPENAI_API_KEY: 'sk-env' } });
    expect(resolved).toBe('sk-stored');
  });

  it('falls back to the environment when nothing is stored', async () => {
    const resolved = await resolveOpenAiApiKey({ store, env: { OPENAI_API_KEY: 'sk-env' } });
    expect(resolved).toBe('sk-env');
  });

  it('returns null when neither source has a key', async () => {
    expect(await resolveOpenAiApiKey({ store, env: {} })).toBeNull();
  });

  it('ignores an empty environment variable', async () => {
    expect(await resolveOpenAiApiKey({ store, env: { OPENAI_API_KEY: '' } })).toBeNull();
  });

  it('falls back to the environment when the store read fails', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolveSecretsPath(pathsFor(root)), 'corrupt');
    const resolved = await resolveOpenAiApiKey({ store, env: { OPENAI_API_KEY: 'sk-env' } });
    expect(resolved).toBe('sk-env');
  });

  it('reports the winning source', async () => {
    expect(await resolveApiKeySource({ store, env: { OPENAI_API_KEY: 'sk-env' } })).toBe(
      'environment',
    );
    expect(await resolveApiKeySource({ store, env: {} })).toBe('none');
    await store.write({ openaiApiKey: 'sk-stored' });
    expect(await resolveApiKeySource({ store, env: { OPENAI_API_KEY: 'sk-env' } })).toBe('stored');
    expect(await resolveApiKeySource({ store, env: {} })).toBe('stored');
  });
});
