import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/diagnostics/redactor.js';

describe('Redactor.redactString', () => {
  const r = new Redactor();

  it('redacts apiKey=value style secrets', () => {
    expect(r.redactString('apiKey=sk-abcdef123')).toBe('[REDACTED:apiKey]');
  });

  it('redacts Bearer tokens', () => {
    expect(r.redactString('Authorization: Bearer eyJabc.def.ghi')).toBe(
      'Authorization: Bearer [REDACTED:token]',
    );
  });

  it('redacts query-string secrets', () => {
    expect(r.redactString('https://x.test/?api_key=ABC&q=1')).toBe(
      'https://x.test/?api_key=[REDACTED]&q=1',
    );
  });

  it('leaves safe strings alone', () => {
    expect(r.redactString('navigate to /jobs/search')).toBe('navigate to /jobs/search');
  });

  it('applies extraPatterns after built-ins', () => {
    const custom = new Redactor({
      extraPatterns: [{ name: 'session', match: /sess-[0-9]+/g, replace: '[REDACTED:session]' }],
    });
    expect(custom.redactString('cookie=sess-12345 other')).toBe('cookie=[REDACTED:session] other');
  });
});

describe('Redactor.redactValue', () => {
  const r = new Redactor();

  it('redacts sensitive keys in objects', () => {
    const input = { url: 'https://x.test', apiKey: 'sk-abcdef', meta: { token: 't-1', keep: 7 } };
    expect(r.redactValue(input)).toEqual({
      url: 'https://x.test',
      apiKey: '[REDACTED]',
      meta: { token: '[REDACTED]', keep: 7 },
    });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const input = [{ password: 'pw' }, { safe: 'ok' }];
    expect(r.redactValue(input)).toEqual([{ password: '[REDACTED]' }, { safe: 'ok' }]);
  });

  it('does not mutate the input', () => {
    const input = { apiKey: 'sk-abcdef' };
    const copy = { ...input };
    r.redactValue(input);
    expect(input).toEqual(copy);
  });

  it('handles circular references without throwing', () => {
    const obj: Record<string, unknown> = { apiKey: 'sk-abc' };
    obj.self = obj;
    expect(() => r.redactValue(obj)).not.toThrow();
  });
});
