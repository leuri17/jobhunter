import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Socket } from 'node:net';

import {
  KeychainSecretsStore,
  SocketKeychainTransport,
  parseBridgeEnv,
  type BridgeRequest,
  type BridgeResponse,
  type KeychainTransport,
} from '../../src/config/keychain-secrets.js';
import { resolveOpenAiApiKey } from '../../src/config/api-key.js';
import type { SecretsStore } from '../../src/config/secrets.js';

/**
 * In-memory transport: returns a scripted response per op and records the
 * requests so tests can assert which ops the store issued.
 */
class FakeTransport implements KeychainTransport {
  readonly requests: BridgeRequest[] = [];

  constructor(private readonly respond: (request: BridgeRequest) => BridgeResponse) {}

  async request(request: BridgeRequest): Promise<BridgeResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

const okValue = (value: string | null): BridgeResponse => ({ ok: true, value });
const okAck: BridgeResponse = { ok: true };

describe('KeychainSecretsStore', () => {
  it('read maps a get hit to the stored key', async () => {
    const transport = new FakeTransport(() => okValue('sk-keychain-1'));
    const store = new KeychainSecretsStore({ transport });

    expect(await store.read()).toEqual({ openaiApiKey: 'sk-keychain-1' });
    expect(transport.requests).toEqual([{ auth: '', op: 'get' }]);
  });

  it('read maps a get miss to empty secrets', async () => {
    const transport = new FakeTransport(() => okValue(null));
    const store = new KeychainSecretsStore({ transport });

    expect(await store.read()).toEqual({});
  });

  it('write with a key issues a set op carrying the key', async () => {
    const transport = new FakeTransport(() => okAck);
    const store = new KeychainSecretsStore({ transport });

    await store.write({ openaiApiKey: 'sk-set-me' });

    expect(transport.requests).toEqual([{ auth: '', op: 'set', value: 'sk-set-me' }]);
  });

  it('write without a key and clear both issue an idempotent delete op', async () => {
    const transport = new FakeTransport(() => okAck);
    const store = new KeychainSecretsStore({ transport });

    await store.write({});
    await store.clear();

    expect(transport.requests).toEqual([
      { auth: '', op: 'delete' },
      { auth: '', op: 'delete' },
    ]);
  });

  it('maps a bridge unavailable error to secrets_backend_unavailable', async () => {
    const transport = new FakeTransport(() => ({
      ok: false,
      error: { kind: 'unavailable', reason: 'no Secret Service' },
    }));
    const store = new KeychainSecretsStore({ transport });

    await expect(store.read()).rejects.toMatchObject({ code: 'secrets_backend_unavailable' });
  });

  it('maps a bridge failed error to secrets_backend_failed', async () => {
    const transport = new FakeTransport(() => ({
      ok: false,
      error: { kind: 'failed', message: 'keychain exploded' },
    }));
    const store = new KeychainSecretsStore({ transport });

    await expect(store.write({ openaiApiKey: 'sk-nope' })).rejects.toMatchObject({
      code: 'secrets_backend_failed',
    });
  });
});

describe('parseBridgeEnv', () => {
  it('accepts a valid port and token', () => {
    expect(
      parseBridgeEnv({
        JOBHUNTER_SECRETS_BRIDGE_PORT: '53199',
        JOBHUNTER_SECRETS_BRIDGE_TOKEN: 'tok',
      }),
    ).toEqual({ port: 53199, token: 'tok' });
  });

  it('returns null when either variable is missing or the token is empty', () => {
    expect(parseBridgeEnv({ JOBHUNTER_SECRETS_BRIDGE_TOKEN: 'tok' })).toBeNull();
    expect(parseBridgeEnv({ JOBHUNTER_SECRETS_BRIDGE_PORT: '53199' })).toBeNull();
    expect(
      parseBridgeEnv({
        JOBHUNTER_SECRETS_BRIDGE_PORT: '53199',
        JOBHUNTER_SECRETS_BRIDGE_TOKEN: '',
      }),
    ).toBeNull();
  });

  it('returns null for out-of-range or non-numeric ports', () => {
    for (const port of ['0', '65536', '-1', 'abc', '']) {
      expect(
        parseBridgeEnv({
          JOBHUNTER_SECRETS_BRIDGE_PORT: port,
          JOBHUNTER_SECRETS_BRIDGE_TOKEN: 'tok',
        }),
      ).toBeNull();
    }
  });
});

describe('SocketKeychainTransport', () => {
  interface BridgeServer {
    readonly port: number;
    close(): Promise<void>;
  }

  let bridge: BridgeServer | undefined;

  afterEach(async () => {
    await bridge?.close();
  });

  function startBridge(handler: (socket: Socket) => void): Promise<BridgeServer> {
    return new Promise((resolve) => {
      const server = createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') throw new Error('no port');
        resolve({
          port: address.port,
          close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
        });
      });
    });
  }

  const transportFor = (port: number): SocketKeychainTransport =>
    new SocketKeychainTransport({ port, token: 'wire-token' });

  it('sends the exact contract line with its own token and parses the response', async () => {
    const lines: string[] = [];
    bridge = await startBridge((socket) => {
      socket.on('data', (chunk: Buffer) => {
        lines.push(chunk.toString('utf8'));
        socket.write('{"ok":true,"value":"sk-over-the-wire"}\n');
      });
    });

    const response = await transportFor(bridge.port).request({ auth: 'ignored', op: 'get' });

    expect(response).toEqual({ ok: true, value: 'sk-over-the-wire' });
    expect(lines).toEqual(['{"auth":"wire-token","op":"get"}\n']);
  });

  it('normalizes a bridge that closes without responding to unavailable', async () => {
    bridge = await startBridge((socket) => {
      socket.on('data', () => socket.destroy());
    });

    const response = await transportFor(bridge.port).request({ auth: '', op: 'get' });

    expect(response.ok).toBe(false);
    if (!response.ok && response.error.kind === 'unavailable') {
      expect(response.error.reason).toMatch(/^bridge_unreachable: /);
    }
  });

  it('normalizes a non-JSON response to unavailable', async () => {
    bridge = await startBridge((socket) => {
      socket.on('data', () => socket.write('garbage\n'));
    });

    const response = await transportFor(bridge.port).request({ auth: '', op: 'delete' });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe('unavailable');
  });
});

describe('resolveOpenAiApiKey precedence with an unreadable store', () => {
  it('falls back to OPENAI_API_KEY when the store read throws', async () => {
    const broken: SecretsStore = {
      read: () => {
        throw new Error('store exploded');
      },
      write: async () => {},
      clear: async () => {},
    };

    expect(await resolveOpenAiApiKey({ store: broken, env: { OPENAI_API_KEY: 'sk-env' } })).toBe(
      'sk-env',
    );
  });
});
