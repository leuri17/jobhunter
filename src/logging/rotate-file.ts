import {
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  type WriteStream,
} from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';

import type { PlatformPaths } from '../platform/paths.js';

export const DEFAULT_LOG_FILENAME = 'jobhunter.log';
export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_LOG_MAX_FILES = 5;

export interface RotateFileOptions {
  readonly dest: string;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  /**
   * Sink for rotation diagnostics. Defaults to `process.stderr` so a
   * failure to write the log never recurses into the log itself.
   */
  readonly onError?: (err: unknown, dest: string) => void;
}

export function resolveDefaultLogPath(paths: PlatformPaths): string {
  return paths.logs.file(DEFAULT_LOG_FILENAME);
}

/**
 * Append-mode log destination that rolls over at `maxBytes` and retains
 * at most `maxFiles` generations (`jobhunter.log`, `jobhunter.1.log`, …).
 *
 * The instance registered with pino never changes: rotation swaps the
 * underlying file handle in place. That keeps the stream safe to
 * register once at boot, and keeps a write already in flight on the old
 * handle from landing in the new file.
 *
 * Every filesystem failure degrades to `onError` plus dropped bytes
 * rather than an emitted `'error'`, because an unhandled `'error'` on a
 * pino destination stream would take the sidecar down.
 */
export function createRotatingFileStream(options: RotateFileOptions): Writable {
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_LOG_MAX_FILES;
  const onError =
    options.onError ??
    ((err: unknown, dest: string) => {
      process.stderr.write(
        `${JSON.stringify({
          level: 40,
          component: 'jobhunter',
          event: 'log.file.error',
          dest,
          message: err instanceof Error ? err.message : String(err),
        })}\n`,
      );
    });

  let handle: WriteStream | null = null;
  let size = 0;

  const generationPath = (index: number): string =>
    index === 0 ? options.dest : `${options.dest}.${index}`;

  const currentSize = (): number => {
    try {
      return statSync(options.dest).size;
    } catch {
      return 0;
    }
  };

  const shiftGenerations = (): void => {
    try {
      rmSync(generationPath(maxFiles - 1), { force: true });
      for (let index = maxFiles - 2; index >= 0; index -= 1) {
        const from = generationPath(index);
        const to = generationPath(index + 1);
        try {
          renameSync(from, to);
        } catch {
          // A missing or locked generation is not fatal; the slot is
          // simply reused by the next rotation.
        }
      }
    } catch (err) {
      onError(err, options.dest);
    }
  };

  const open = (): void => {
    try {
      mkdirSync(dirname(options.dest), { recursive: true });
      handle = createWriteStream(options.dest, { flags: 'a' });
      handle.on('error', (err: unknown) => onError(err, options.dest));
      size = currentSize();
    } catch (err) {
      handle = null;
      size = 0;
      onError(err, options.dest);
    }
  };

  const rotate = (): void => {
    handle?.end();
    handle = null;
    shiftGenerations();
    open();
  };

  open();

  return new Writable({
    write(chunk, _encoding, callback) {
      if (handle === null) {
        open();
      }
      if (handle === null) {
        callback();
        return;
      }
      const length = chunk.length;
      if (size > 0 && size + length > maxBytes) {
        rotate();
        if (handle === null) {
          callback();
          return;
        }
      }
      size += length;
      handle.write(chunk, (err) => {
        if (err !== undefined && err !== null) onError(err, options.dest);
        callback();
      });
    },
    final(callback) {
      handle?.end();
      handle = null;
      callback();
    },
  });
}
