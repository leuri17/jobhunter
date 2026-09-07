/**
 * Run-time `'error'` event coverage for the file destination path
 * (audit B1-M2). Lives in a sibling file because the test needs to
 * `vi.mock('node:fs')` to intercept `createWriteStream` so the
 * test can drive an asynchronous I/O error on the resulting
 * `WriteStream` — the rest of `tests/logging/logger.test.ts` uses
 * the real `node:fs` (the boot-time test relies on the real
 * `mkdirSync` throwing `EACCES` against a `chmod 0o555` parent).
 *
 * The `vi.mock` factory deliberately keeps `mkdirSync` and the rest
 * of `node:fs` intact via `importOriginal` and only stubs
 * `createWriteStream` to return the mock we control. `vi.mock` is
 * file-scoped — `logger.test.ts` and `format-error.test.ts` are
 * unaffected.
 */
import { Writable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createWriteStream: vi.fn(),
  };
});

// Import AFTER `vi.mock` so the factory's stub is in place when
// `src/logging/logger.ts` resolves `createWriteStream`.
import { createLogger } from '../../src/logging/logger.js';

interface CapturedRecord {
  [key: string]: unknown;
}

function captureSink(): { stream: Writable; records: CapturedRecord[] } {
  const records: CapturedRecord[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        records.push(JSON.parse(line) as CapturedRecord);
      }
      callback();
    },
  });
  return { stream, records };
}

describe('createLogger — file stream run-time error (audit B1-M2)', () => {
  let mockFileStream: Writable;
  let createWriteStreamMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFileStream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const fs = await import('node:fs');
    createWriteStreamMock = fs.createWriteStream as unknown as ReturnType<typeof vi.fn>;
    createWriteStreamMock.mockReset();
    createWriteStreamMock.mockReturnValue(
      mockFileStream as unknown as ReturnType<typeof fs.createWriteStream>,
    );
  });

  it('detaches the broken stream, warns on stdout, keeps logging alive', () => {
    const { stream: stdout, records } = captureSink();
    const logger = createLogger(
      { level: 'info', prettyTerminal: false, filePath: '/tmp/never-written.log' },
      { stdout },
    );

    // Sanity: the mock was the destination the factory wired in.
    expect(createWriteStreamMock).toHaveBeenCalledOnce();
    expect(createWriteStreamMock).toHaveBeenCalledWith('/tmp/never-written.log', { flags: 'a' });

    // Normal logging reaches stdout pre-error.
    logger.info({ component: 'audit', event: 'b1m2.runtime.before_error' }, 'starting');
    const before = records.filter((r) => r['event'] === 'b1m2.runtime.before_error');
    expect(before).toHaveLength(1);

    // Emit a runtime I/O error on the file stream — pre-fix this
    // would crash the process because the stream had no listener.
    // We wrap the Error with the standard Node `{ code: 'ENOSPC' }`
    // shape so `formatError` preserves the code in the warning.
    const ioError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    mockFileStream.emit('error', ioError);

    // The listener wrote a warning to stdout naming the path and
    // carrying the underlying error code, and the broken stream was
    // detached from pino's multistream.
    const warning = records.find((r) => r['event'] === 'log.file.error');
    expect(warning).toBeDefined();
    expect(warning?.['path']).toBe('/tmp/never-written.log');
    expect(warning?.['level']).toBe(40);
    expect(warning?.['code']).toBe('ENOSPC');
    expect(warning?.['message']).toContain('disk full');

    // Subsequent log lines still reach stdout — the file stream is
    // detached, not the whole logger.
    logger.info({ component: 'audit', event: 'b1m2.runtime.after_error' }, 'still alive');
    const after = records.filter((r) => r['event'] === 'b1m2.runtime.after_error');
    expect(after).toHaveLength(1);

    // Sentinel: the test runner is still alive. If the listener had
    // failed to swallow the `'error'` event, Node would have aborted
    // the process before this assertion ran.
    expect(true).toBe(true);
  });
});
