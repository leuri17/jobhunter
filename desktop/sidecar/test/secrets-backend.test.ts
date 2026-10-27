import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:net';

import {
  getSecretsBackend,
  resetSecretsBackendForTest,
  resolveSecretsBackend,
} from '../src/secrets-backend.js';

describe('secrets backend resolution', () => {
  afterEach(() => {
    resetSecretsBackendForTest();
    vi.unstubAllEnvs();
  });

  it('falls back to the file store when the bridge env is absent', async () => {
    const resolved = await resolveSecretsBackend({});
    expect(resolved.backend).toBe('file');
    expect(resolved.reason).toBe('bridge_not_configured');
  });

  it('commits to the keychain when the bridge probe succeeds', async () => {
    const server = createServer((socket) => {
      socket.on('data', () => socket.write('{"ok":true,"value":null}\n'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    try {
      const resolved = await resolveSecretsBackend({
        JOBHUNTER_SECRETS_BRIDGE_PORT: String(address.port),
        JOBHUNTER_SECRETS_BRIDGE_TOKEN: 'probe-token',
      });
      expect(resolved.backend).toBe('keychain');
      expect(resolved.reason).toBeUndefined();
    } finally {
      await close(server);
    }
  });

  it('falls back to the file store when the bridge probe fails', async () => {
    const resolved = await resolveSecretsBackend({
      JOBHUNTER_SECRETS_BRIDGE_PORT: '1',
      JOBHUNTER_SECRETS_BRIDGE_TOKEN: 'tok',
    });
    expect(resolved.backend).toBe('file');
    expect(resolved.reason).toBe('keychain_unavailable');
  });

  it('memoizes the first resolution per process and reset re-probes', async () => {
    vi.stubEnv('JOBHUNTER_SECRETS_BRIDGE_PORT', '1');
    vi.stubEnv('JOBHUNTER_SECRETS_BRIDGE_TOKEN', 'tok');

    const first = getSecretsBackend();
    expect(getSecretsBackend()).toBe(first);
    expect((await first).backend).toBe('file');

    resetSecretsBackendForTest();
    const reProbed = getSecretsBackend();
    expect(reProbed).not.toBe(first);
    expect((await reProbed).backend).toBe('file');
  });
});

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
