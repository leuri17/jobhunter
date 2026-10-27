import {
  FileSecretsStore,
  KeychainSecretsStore,
  SocketKeychainTransport,
  parseBridgeEnv,
  type SecretsStore,
} from '@jobhunter/core/config';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';

export type SecretsBackend = 'keychain' | 'file';

export type SecretsBackendReason = 'bridge_not_configured' | 'keychain_unavailable';

export interface ResolvedSecretsBackend {
  readonly store: SecretsStore;
  readonly backend: SecretsBackend;
  /**
   * Present only when the backend fell back to the file store. A stable
   * machine token (`bridge_not_configured`, `keychain_unavailable`) — the
   * human-readable detail is logged at boot, not embedded here, so route
   * responses stay matchable for the UI.
   */
  readonly reason?: SecretsBackendReason;
}

function fileBackend(reason: SecretsBackendReason): ResolvedSecretsBackend {
  return {
    store: new FileSecretsStore({ paths: resolvePlatformPaths(createDefaultPlatformAdapter()) }),
    backend: 'file',
    reason,
  };
}

/**
 * Resolve which secrets backend this sidecar run uses.
 *
 * With no bridge env (standalone dev/test runs) the file store is the
 * backend by design. With bridge env present, a `KeychainSecretsStore` is
 * probed once: a successful probe (including an empty keychain) commits to
 * `keychain`; any `SecretStoreError` falls back to the file store with
 * reason `keychain_unavailable` — the sidecar stays usable and the boot
 * record carries why.
 */
export function resolveSecretsBackend(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ResolvedSecretsBackend> {
  const bridgeEnv = parseBridgeEnv(env);
  if (bridgeEnv === null) return Promise.resolve(fileBackend('bridge_not_configured'));

  const store = new KeychainSecretsStore({
    transport: new SocketKeychainTransport({ port: bridgeEnv.port, token: bridgeEnv.token }),
  });
  return store.read().then(
    () => ({ store, backend: 'keychain' }) satisfies ResolvedSecretsBackend,
    (err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `sidecar: keychain probe failed, falling back to the file store: ${detail}\n`,
      );
      return fileBackend('keychain_unavailable');
    },
  );
}

let memoized: Promise<ResolvedSecretsBackend> | null = null;

/**
 * The process-wide secrets backend resolution. The first call wins and the
 * promise is shared, so every route and service observes one backend per
 * launch; tests reset it with {@link resetSecretsBackendForTest}.
 */
export function getSecretsBackend(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ResolvedSecretsBackend> {
  memoized ??= resolveSecretsBackend(env);
  return memoized;
}

/** Test-only: drop the memoized resolution so the next call re-probes. */
export function resetSecretsBackendForTest(): void {
  memoized = null;
}
