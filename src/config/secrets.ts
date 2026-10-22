import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import type { PlatformPaths } from '../platform/paths.js';
import { SecretStoreError } from '../errors/application-error.js';

export const SECRETS_FILENAME = 'secrets.json';

const OPENAI_API_KEY = 'openaiApiKey';

/**
 * Read/write access to secrets that must not live in the operational
 * config or the environment. The backend is an interface so the OS
 * keychain can replace the file store without touching callers.
 */
export interface SecretsStore {
  read(): Promise<Secrets>;
  write(secrets: Secrets): Promise<void>;
  clear(): Promise<void>;
}

export interface Secrets {
  readonly openaiApiKey?: string;
}

export interface FileSecretsStoreOptions {
  readonly paths: PlatformPaths;
  readonly onError?: (err: unknown) => never;
}

export function resolveSecretsPath(paths: PlatformPaths): string {
  return paths.config.file(SECRETS_FILENAME);
}

/**
 * File-backed store rooted at the platform config directory, written with
 * owner-only permissions. This is the interim backend: it relies on
 * filesystem permissions rather than OS-level encryption, and is the
 * seam the keychain implementation replaces (issue #207).
 */
export class FileSecretsStore implements SecretsStore {
  private readonly path: string;

  constructor(options: FileSecretsStoreOptions) {
    this.path = resolveSecretsPath(options.paths);
  }

  async read(): Promise<Secrets> {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new SecretStoreError(
        'secrets_read_failed',
        'Failed to read the secrets file.',
        {},
        cause instanceof Error ? cause : undefined,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new SecretStoreError(
        'secrets_parse_failed',
        'The secrets file is not valid JSON.',
        {},
        cause instanceof Error ? cause : undefined,
      );
    }

    if (typeof parsed !== 'object' || parsed === null) return {};
    const value = (parsed as Record<string, unknown>)[OPENAI_API_KEY];
    return typeof value === 'string' && value.length > 0 ? { openaiApiKey: value } : {};
  }

  async write(secrets: Secrets): Promise<void> {
    const payload =
      secrets.openaiApiKey === undefined ? {} : { [OPENAI_API_KEY]: secrets.openaiApiKey };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const tempPath = `${this.path}.${randomUUID()}.tmp`;

    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileSync(tempPath, text, { mode: 0o600 });
      renameSync(tempPath, this.path);
      chmodSync(this.path, 0o600);
    } catch (cause) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // Best-effort cleanup; the surface error below is the useful one.
      }
      throw new SecretStoreError(
        'secrets_write_failed',
        'Failed to write the secrets file.',
        {},
        cause instanceof Error ? cause : undefined,
      );
    }
  }

  async clear(): Promise<void> {
    try {
      rmSync(this.path, { force: true });
    } catch (cause) {
      throw new SecretStoreError(
        'secrets_clear_failed',
        'Failed to remove the secrets file.',
        {},
        cause instanceof Error ? cause : undefined,
      );
    }
  }
}

/**
 * Mask a secret for display. Returns the empty string when nothing is
 * stored, so callers can distinguish "unset" from "set" without the UI
 * ever holding the real value.
 */
export function maskSecret(value: string | undefined): string {
  if (value === undefined || value.length === 0) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(8)}${value.slice(-3)}`;
}
