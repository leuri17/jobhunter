import { connect } from 'node:net';

import type { Secrets, SecretsStore } from './secrets.js';
import { SecretStoreError } from '../errors/application-error.js';

/**
 * Environment variable carrying the port of the Tauri shell's secrets
 * bridge (issue #211).
 */
export const BRIDGE_PORT_ENV_VAR = 'JOBHUNTER_SECRETS_BRIDGE_PORT';

/**
 * Environment variable carrying the per-launch auth token of the Tauri
 * shell's secrets bridge.
 */
export const BRIDGE_TOKEN_ENV_VAR = 'JOBHUNTER_SECRETS_BRIDGE_TOKEN';

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * One wire request to the shell's keychain bridge, matching the bridge's
 * line protocol. `auth` is stamped onto the outgoing line by
 * {@link SocketKeychainTransport}, which owns the token; the value carried
 * here is never sent.
 */
export type BridgeRequest =
  | { readonly auth: string; readonly op: 'get' }
  | { readonly auth: string; readonly op: 'set'; readonly value: string }
  | { readonly auth: string; readonly op: 'delete' };

/** Wire error envelope returned by the bridge on `ok: false`. */
export type BridgeError =
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * One wire response from the shell's keychain bridge. `value` is the stored
 * key on a get hit, `null` on a get miss, and absent for set/delete acks.
 */
export type BridgeResponse =
  | { readonly ok: true; readonly value?: string | null }
  | { readonly ok: false; readonly error: BridgeError };

/**
 * Transport seam for talking to the keychain bridge. Fakes in tests stand
 * in for the socket so store logic can be exercised without a bridge.
 */
export interface KeychainTransport {
  request(request: BridgeRequest): Promise<BridgeResponse>;
}

export interface SocketKeychainTransportOptions {
  readonly port: number;
  readonly token: string;
  /** Connect/response deadline for a single request. Defaults to 5 s. */
  readonly timeoutMs?: number;
}

/**
 * {@link KeychainTransport} over a loopback TCP connection to the Tauri
 * shell's bridge: one `\n`-terminated JSON line each way per request, then
 * the socket is destroyed.
 *
 * Any transport-level failure — connection refused, timeout, EOF before a
 * response line, a non-JSON or malformed response, a response over 64 KiB —
 * is normalized to `{ ok: false, error: { kind: 'unavailable', reason:
 * 'bridge_unreachable: <detail>' } }` so callers never see a raw socket
 * error. The 5 s deadline exists so a hung shell cannot stall a request
 * forever.
 */
export class SocketKeychainTransport implements KeychainTransport {
  private readonly port: number;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: SocketKeychainTransportOptions) {
    this.port = options.port;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request(request: BridgeRequest): Promise<BridgeResponse> {
    try {
      return await this.exchange(request);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return {
        ok: false,
        error: { kind: 'unavailable', reason: `bridge_unreachable: ${detail}` },
      };
    }
  }

  private exchange(request: BridgeRequest): Promise<BridgeResponse> {
    return new Promise<BridgeResponse>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: this.port });
      let settled = false;
      let received = '';
      let receivedBytes = 0;

      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        settle();
      };

      const timer = setTimeout(
        () => finish(() => reject(new Error(`no bridge response within ${this.timeoutMs}ms`))),
        this.timeoutMs,
      );

      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ ...request, auth: this.token })}\n`);
      });

      socket.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        received += chunk.toString('utf8');
        const newline = received.indexOf('\n');
        if (newline === -1) {
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            finish(() => reject(new Error('bridge response exceeded 64 KiB')));
          }
          return;
        }
        const line = received.slice(0, newline);
        const response = parseBridgeResponse(line);
        if (response === null) {
          finish(() => reject(new Error('bridge response was not a valid response line')));
          return;
        }
        finish(() => resolve(response));
      });

      socket.on('error', (err: Error) => finish(() => reject(err)));
      socket.on('close', () => finish(() => reject(new Error('bridge closed without a response'))));
    });
  }
}

/**
 * Parse one bridge response line, or `null` when the line is not valid
 * JSON or does not carry the contract's fields.
 */
function parseBridgeResponse(line: string): BridgeResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate['ok'] === true) {
    const value = candidate['value'];
    if (value !== undefined && value !== null && typeof value !== 'string') return null;
    return value === undefined ? { ok: true } : { ok: true, value: value as string | null };
  }
  if (candidate['ok'] !== false) return null;
  const error = candidate['error'];
  if (typeof error !== 'object' || error === null) return null;
  const errorFields = error as Record<string, unknown>;
  if (errorFields['kind'] === 'unavailable' && typeof errorFields['reason'] === 'string') {
    return { ok: false, error: { kind: 'unavailable', reason: errorFields['reason'] } };
  }
  if (errorFields['kind'] === 'failed' && typeof errorFields['message'] === 'string') {
    return { ok: false, error: { kind: 'failed', message: errorFields['message'] } };
  }
  return null;
}

export interface BridgeEnv {
  readonly port: number;
  readonly token: string;
}

/**
 * Read the bridge endpoint from an environment. Both variables must be
 * present and valid (port 1–65535, non-empty token); anything else means
 * the sidecar was not launched by the shell and yields `null`.
 */
export function parseBridgeEnv(
  env: Readonly<Record<string, string | undefined>>,
): BridgeEnv | null {
  const portRaw = env[BRIDGE_PORT_ENV_VAR];
  const token = env[BRIDGE_TOKEN_ENV_VAR];
  if (portRaw === undefined || token === undefined || token.length === 0) return null;
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, token };
}

export interface KeychainSecretsStoreOptions {
  readonly transport: KeychainTransport;
}

/**
 * {@link SecretsStore} backed by the OS keychain through the Tauri shell's
 * loopback bridge (issue #211). `read` maps a get miss to empty secrets;
 * `write` with no key and `clear` both issue an idempotent delete; bridge
 * errors surface as `SecretStoreError` with code
 * `secrets_backend_unavailable` (keychain missing/locked) or
 * `secrets_backend_failed`.
 */
export class KeychainSecretsStore implements SecretsStore {
  private readonly transport: KeychainTransport;

  constructor(options: KeychainSecretsStoreOptions) {
    this.transport = options.transport;
  }

  async read(): Promise<Secrets> {
    const response = await this.transport.request({ auth: '', op: 'get' });
    if (response.ok) {
      if (typeof response.value === 'string') return { openaiApiKey: response.value };
      if (response.value === null || response.value === undefined) return {};
      throw toStoreError({ error: { kind: 'failed', message: 'unexpected bridge response' } });
    }
    throw toStoreError(response);
  }

  async write(secrets: Secrets): Promise<void> {
    await this.send(
      secrets.openaiApiKey === undefined
        ? { auth: '', op: 'delete' }
        : { auth: '', op: 'set', value: secrets.openaiApiKey },
    );
  }

  async clear(): Promise<void> {
    await this.send({ auth: '', op: 'delete' });
  }

  private async send(request: BridgeRequest): Promise<void> {
    const response = await this.transport.request(request);
    if (!response.ok) throw toStoreError(response);
  }
}

function toStoreError(response: { readonly error: BridgeError }): SecretStoreError {
  const { error } = response;
  if (error.kind === 'unavailable') {
    return new SecretStoreError(
      'secrets_backend_unavailable',
      `The OS keychain is unavailable (${error.reason}).`,
      {},
    );
  }
  return new SecretStoreError(
    'secrets_backend_failed',
    `The OS keychain request failed (${error.message}).`,
    {},
  );
}
