import { describe, expect, it } from 'vitest';

import { ApplicationError, ExitCode } from '../../src/errors/application-error.js';
import { formatError, type SerialisedError } from '../../src/logging/format-error.js';

describe('formatError', () => {
  describe('Error subclasses', () => {
    it('extracts name + message from a plain Error', () => {
      const out = formatError(new Error('boom'));
      expect(out.name).toBe('Error');
      expect(out.message).toBe('boom');
    });

    it('preserves the constructor name on Error subclasses', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const out = formatError(new CustomError('nope'));
      expect(out.name).toBe('CustomError');
      expect(out.message).toBe('nope');
    });

    it('preserves `code` from the duck-typed `code` field', () => {
      const out = formatError(
        Object.assign(new Error('unauth'), { code: 'openai_authentication' }),
      );
      expect(out.code).toBe('openai_authentication');
    });

    it('stringifies a numeric `code`', () => {
      const out = formatError(Object.assign(new Error('bad request'), { code: 400 }));
      expect(out.code).toBe('400');
    });

    it('omits `stack` by default (PII-safe default)', () => {
      const err = new Error('boom');
      expect(err.stack).toBeDefined();
      const out = formatError(err);
      expect(out.stack).toBeUndefined();
    });

    it('includes `stack` when `includeStack: true`', () => {
      const err = new Error('boom');
      const out = formatError(err, { includeStack: true });
      expect(out.stack).toBe(err.stack);
    });

    it('recurses a 3-deep cause chain with all levels visible', () => {
      const a = new Error('level a');
      const b = new Error('level b', { cause: a });
      const c = new Error('level c', { cause: b });
      const out = formatError(c);

      expect(out.message).toBe('level c');
      expect(out.cause?.message).toBe('level b');
      expect(out.cause?.cause?.message).toBe('level a');
      expect(out.cause?.cause?.cause).toBeUndefined();
    });

    it('walks a 6-deep chain up to `maxDepth: 5` then truncates the 6th link', () => {
      const link = (depth: number): Error => {
        if (depth === 0) return new Error(`leaf`);
        return new Error(`level ${depth}`, { cause: link(depth - 1) });
      };
      // 6 links: leaf -> 1 -> 2 -> 3 -> 4 -> 5 (top).
      // maxDepth: 5 means the recursion walks depths 0..5 (6 calls);
      // depth 6 would be the 7th level — which doesn't exist here —
      // so the 6th link (leaf, depth 5) IS still a real Error. The
      // truncation fires when depth >= maxDepth at recursion time,
      // which happens at depth 5: leaf.cause is the sentinel.
      const top = link(5);
      const out = formatError(top, { maxDepth: 5 });

      expect(out.message).toBe('level 5');
      const level4 = out.cause;
      expect(level4?.message).toBe('level 4');
      const level3 = level4?.cause;
      expect(level3?.message).toBe('level 3');
      const level2 = level3?.cause;
      expect(level2?.message).toBe('level 2');
      const level1 = level2?.cause;
      expect(level1?.message).toBe('level 1');
      const leaf = level1?.cause;
      expect(leaf?.message).toBe('leaf');
      // The truncation kicks in at the leaf's cause, which doesn't exist.
      expect(leaf?.cause).toBeUndefined();
      // ...but if the caller adds one more link, the truncation fires there.
      const longer = link(6);
      const outLonger = formatError(longer, { maxDepth: 5 });
      const truncated = outLonger.cause?.cause?.cause?.cause?.cause?.cause;
      expect(truncated?.name).toBe('<truncated>');
      expect(truncated?.message).toContain('truncated at depth 5');
    });

    it('honors a tighter `maxDepth` budget', () => {
      const a = new Error('a');
      const b = new Error('b', { cause: a });
      const c = new Error('c', { cause: b });
      const out = formatError(c, { maxDepth: 1 });
      // depth 0 = c; cause allowed at depth 1 = b; depth 1's cause is truncated.
      expect(out.message).toBe('c');
      expect(out.cause?.message).toBe('b');
      expect(out.cause?.cause?.name).toBe('<truncated>');
    });
  });

  describe('non-Error inputs', () => {
    it('wraps `null` with name "NonError"', () => {
      expect(formatError(null)).toEqual({ name: 'NonError', message: 'null' });
    });

    it('wraps `undefined` with name "NonError"', () => {
      expect(formatError(undefined)).toEqual({ name: 'NonError', message: 'undefined' });
    });

    it('wraps a bare string with name "NonError"', () => {
      expect(formatError('just a string')).toEqual({ name: 'NonError', message: 'just a string' });
    });

    it('wraps a number with name "NonError"', () => {
      expect(formatError(42)).toEqual({ name: 'NonError', message: '42' });
    });

    it('wraps a boolean with name "NonError"', () => {
      expect(formatError(false)).toEqual({ name: 'NonError', message: 'false' });
    });

    it('duck-types a plain object with `.message` and `.code`', () => {
      const out = formatError({ message: 'oops', code: 'custom_code' });
      expect(out.message).toBe('oops');
      expect(out.code).toBe('custom_code');
      expect(out.name).toBe('Error');
    });

    it('falls back to `String(value)` when the object has no `.message`', () => {
      const out = formatError({ foo: 'bar' });
      expect(out.name).toBe('Error');
      expect(out.message).toBe('[object Object]');
    });

    it('defaults `name` to "Error" when the object has an empty `name`', () => {
      const out = formatError({ name: '', message: 'x' });
      expect(out.name).toBe('Error');
    });

    it('recurses the cause chain on a plain object with `.cause`', () => {
      const out = formatError({
        name: 'Wrapper',
        message: 'outer',
        cause: { name: 'Inner', message: 'inner' },
      });
      expect(out.cause).toEqual({ name: 'Inner', message: 'inner' });
    });

    it('treats a null `cause` as the chain terminator', () => {
      const out = formatError({ name: 'Outer', message: 'outer', cause: null });
      expect(out.cause).toBeUndefined();
    });
  });

  describe('ApplicationError integration', () => {
    it('round-trips an ApplicationError with metadata + code', () => {
      const err = new ApplicationError('custom_code', 'failure', ExitCode.Fatal, {
        foo: 'bar',
        nested: { a: 1 },
      });
      const out = formatError(err);
      expect(out.name).toBe('ApplicationError');
      expect(out.code).toBe('custom_code');
      expect(out.message).toBe('failure');
      expect(out.metadata).toEqual({ foo: 'bar', nested: { a: 1 } });
    });

    it('preserves a chain of ApplicationErrors', () => {
      const root = new ApplicationError('root_code', 'root', ExitCode.Fatal);
      const middle = new ApplicationError('middle_code', 'middle', ExitCode.Fatal, {}, root);
      const top = new ApplicationError('top_code', 'top', ExitCode.Fatal, {}, middle);
      const out = formatError(top);

      expect(out.code).toBe('top_code');
      expect(out.cause?.code).toBe('middle_code');
      expect(out.cause?.cause?.code).toBe('root_code');
      expect(out.cause?.cause?.cause).toBeUndefined();
    });

    it('round-trips an Error (cause) wrapped by an ApplicationError', () => {
      const root = new Error('underlying network blip');
      const wrapped = new ApplicationError(
        'request_failed',
        'request failed',
        ExitCode.OpenAIFailure,
        { endpoint: '/v1/chat' },
        root,
      );
      const out = formatError(wrapped);
      expect(out.code).toBe('request_failed');
      expect(out.metadata).toEqual({ endpoint: '/v1/chat' });
      expect(out.cause?.name).toBe('Error');
      expect(out.cause?.message).toBe('underlying network blip');
    });

    it('forwards the empty default `metadata` record as `{}`', () => {
      // ApplicationError always exposes `metadata`, defaulting to `{}`.
      // formatError preserves it verbatim so downstream consumers can
      // distinguish "no metadata record" from "empty metadata".
      const out = formatError(new ApplicationError('x', 'y', ExitCode.Fatal));
      expect(out.metadata).toEqual({});
    });
  });

  describe('return type', () => {
    it('returns a plain JSON-serialisable object', () => {
      const err = new ApplicationError('c', 'm', ExitCode.Fatal, { k: 1 }, new Error('inner'));
      const out: SerialisedError = formatError(err);
      // Round-trip through JSON without loss (excluding `undefined`).
      const round = JSON.parse(JSON.stringify(out)) as SerialisedError;
      expect(round.name).toBe('ApplicationError');
      expect(round.code).toBe('c');
      expect(round.cause?.name).toBe('Error');
      expect(round.cause?.message).toBe('inner');
    });
  });
});
