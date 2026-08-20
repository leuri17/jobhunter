import { describe, expect, it } from 'vitest';
import { getApplicationVersion } from '../../src/pipeline/version.js';

describe('getApplicationVersion', () => {
  it('resolves the jobhunter package.json', () => {
    const version = getApplicationVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    // The current package.json is 0.1.0.
    expect(version).toBe('0.1.0');
  });
});
