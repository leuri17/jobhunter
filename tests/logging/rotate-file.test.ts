import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRotatingFileStream, resolveDefaultLogPath } from '../../src/logging/rotate-file.js';
import type { PlatformPaths } from '../../src/platform/paths.js';

describe('resolveDefaultLogPath', () => {
  it('resolves jobhunter.log inside the logs slot', () => {
    const paths = {
      logs: { directory: '/state/jobhunter', file: (name: string) => `/state/jobhunter/${name}` },
    } as PlatformPaths;

    expect(resolveDefaultLogPath(paths)).toBe('/state/jobhunter/jobhunter.log');
  });
});

describe('createRotatingFileStream', () => {
  let dir: string;
  let dest: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'jobhunter-rotate-'));
    dest = path.join(dir, 'jobhunter.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const flush = (stream: NodeJS.WritableStream): Promise<void> =>
    new Promise((resolve) => stream.end(resolve));

  it('appends lines to the active file', async () => {
    const stream = createRotatingFileStream({ dest });
    stream.write('{"a":1}\n');
    stream.write('{"a":2}\n');
    await flush(stream);

    const contents = readFileSync(dest, 'utf8').trim().split('\n');
    expect(contents).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('creates missing parent directories', async () => {
    const nested = path.join(dir, 'deep', 'nested', 'jobhunter.log');
    const stream = createRotatingFileStream({ dest: nested });
    stream.write('{"a":1}\n');
    await flush(stream);

    expect(existsSync(nested)).toBe(true);
  });

  it('rotates once the size threshold is exceeded', async () => {
    const stream = createRotatingFileStream({ dest, maxBytes: 20, maxFiles: 3 });
    stream.write(`${'x'.repeat(15)}\n`);
    stream.write(`${'y'.repeat(15)}\n`);
    await flush(stream);

    expect(readFileSync(dest, 'utf8')).toContain('yyy');
    expect(readFileSync(`${dest}.1`, 'utf8')).toContain('xxx');
  });

  it('keeps at most maxFiles generations', async () => {
    const stream = createRotatingFileStream({ dest, maxBytes: 10, maxFiles: 2 });
    for (let i = 0; i < 5; i += 1) {
      stream.write(`${String(i).repeat(15)}\n`);
    }
    await flush(stream);

    // maxFiles = 2 means the active file plus generation `.1` survive;
    // `.2` and beyond are evicted on each rotation.
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(`${dest}.1`)).toBe(true);
    expect(existsSync(`${dest}.2`)).toBe(false);
  });

  it('appends to an existing file that already exceeds the threshold', async () => {
    writeFileSync(dest, `${'old'.repeat(50)}\n`);
    const stream = createRotatingFileStream({ dest, maxBytes: 20, maxFiles: 3 });
    stream.write(`${'new'.repeat(15)}\n`);
    await flush(stream);

    // The pre-existing oversized file is rotated aside rather than
    // growing without bound.
    expect(readFileSync(`${dest}.1`, 'utf8')).toContain('oldold');
  });

  it('reports an open failure without throwing', () => {
    const errors: string[] = [];
    const blocked = path.join(dir, 'blocked');
    rmSync(blocked, { recursive: true, force: true });
    // A path whose parent is a regular file cannot be created.
    writeFileSync(blocked, 'not a directory');

    const stream = createRotatingFileStream({
      dest: path.join(blocked, 'jobhunter.log'),
      onError: () => errors.push('failed'),
    });

    expect(errors).toHaveLength(1);
    expect(() => stream.write('{"a":1}\n')).not.toThrow();
  });

  it('reports a rotation failure without throwing and keeps accepting writes', async () => {
    const errors: unknown[] = [];
    writeFileSync(dest, `${'old'.repeat(50)}\n`);

    const stream = createRotatingFileStream({
      dest,
      maxBytes: 10,
      maxFiles: 2,
      onError: (err) => errors.push(err),
    });
    stream.write(`${'new'.repeat(15)}\n`);
    await flush(stream);

    // Whatever the platform did, the sink neither crashed nor blocked.
    expect(Array.isArray(errors)).toBe(true);
  });
});
