import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jsonColumn } from '../../../src/persistence/repositories/codecs.js';

const schema = z.object({
  name: z.string(),
  count: z.number(),
});

describe('jsonColumn', () => {
  const codec = jsonColumn(schema);

  it('encode then decode roundtrips the value', () => {
    const encoded = codec.encode({ name: 'alpha', count: 3 });
    expect(typeof encoded).toBe('string');
    expect(codec.decode(encoded)).toEqual({ name: 'alpha', count: 3 });
  });

  it('rejects malformed JSON on decode', () => {
    expect(() => codec.decode('not-json')).toThrow();
  });

  it('rejects JSON that fails schema validation', () => {
    expect(() => codec.decode('{"name":1}')).toThrow();
  });

  it('decode returns null when the raw value is null', () => {
    expect(codec.decode(null)).toBeNull();
  });

  it('decodeRequired throws when the raw value is null', () => {
    expect(() => codec.decodeRequired(null)).toThrow();
  });
});
