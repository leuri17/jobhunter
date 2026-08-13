import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { hashFileContents, hashString } from '../../src/profile/hashing.js';

const KNOWN_EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const KNOWN_HELLO_DIGEST = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

describe('hashString', () => {
  it('returns the SHA-256 digest of the empty string', () => {
    expect(hashString('')).toBe(KNOWN_EMPTY_DIGEST);
  });

  it('returns the SHA-256 digest of "hello"', () => {
    expect(hashString('hello')).toBe(KNOWN_HELLO_DIGEST);
  });

  it('is deterministic across many invocations', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const first = hashString(text);
    const second = hashString(text);
    expect(first).toBe(second);
  });
});

describe('hashFileContents', () => {
  it('hashes a file stream', async () => {
    const path = join(tmpdir(), `jobhunter-hash-${Date.now()}-${Math.random()}.txt`);
    writeFileSync(path, 'hello');
    const stream = createReadStream(path, { highWaterMark: 1 });
    const digest = await hashFileContents(stream);
    expect(digest).toBe(KNOWN_HELLO_DIGEST);
  });

  it('hashes an empty stream to the empty digest', async () => {
    const empty = (async function* () {
      // intentionally yields nothing
    })();
    const digest = await hashFileContents(empty);
    expect(digest).toBe(KNOWN_EMPTY_DIGEST);
  });

  it('hashes multi-byte content with UTF-8 boundaries', async () => {
    const text = 'café résumé naïve';
    const input = (async function* () {
      yield new Uint8Array(Buffer.from(text, 'utf8'));
    })();
    const digest = await hashFileContents(input);
    expect(digest).toBe(hashString(text));
  });

  it('produces a 64-character lowercase hex digest', async () => {
    const input = (async function* () {
      yield new Uint8Array(Buffer.from('anything', 'utf8'));
    })();
    const digest = await hashFileContents(input);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
