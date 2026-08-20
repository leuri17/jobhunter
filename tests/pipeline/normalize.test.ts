import { describe, expect, it } from 'vitest';
import {
  buildConfigSnapshot,
  deterministicJsonStringify,
  serializeTopNRow,
} from '../../src/pipeline/normalize.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';

describe('Pipeline normalize', () => {
  it('deterministicJsonStringify sorts keys', () => {
    const a = deterministicJsonStringify({ b: 1, a: 2 });
    const b = deterministicJsonStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('buildConfigSnapshot returns deterministic hash', () => {
    const a = buildConfigSnapshot(DEFAULT_OPERATIONAL_CONFIG);
    const b = buildConfigSnapshot(DEFAULT_OPERATIONAL_CONFIG);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.snapshot).toBe(DEFAULT_OPERATIONAL_CONFIG);
  });

  it('serializeTopNRow preserves all fields', () => {
    const row = {
      jobId: 1,
      sourceJobId: '42',
      score: 87.5,
      displayScore: '87.5',
      title: 'Engineer',
      company: 'Acme',
      location: 'Rotterdam',
      firstDiscovered: '2026-08-20T00:00:00.000Z',
    };
    expect(serializeTopNRow(row)).toEqual(row);
  });
});
