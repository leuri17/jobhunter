import { describe, expect, it } from 'vitest';
import { validatePickedPaths, SOURCE_EXTENSIONS, isTauriWebview } from './profile-upload';

describe('validatePickedPaths', () => {
  it('accepts picks within the remaining slots', () => {
    const result = validatePickedPaths(['/tmp/a.pdf', '/tmp/b.md'], 2);
    expect(result.accepted).toEqual(['/tmp/a.pdf', '/tmp/b.md']);
    expect(result.rejected).toEqual([]);
    expect(result.overCapacity).toBe(false);
  });

  it('rejects disallowed extensions with per-file reasons', () => {
    const result = validatePickedPaths(['/tmp/a.docx', '/tmp/ok.pdf'], 1);
    expect(result.rejected).toEqual([{ path: '/tmp/a.docx', reason: 'type' }]);
    expect(result.accepted).toEqual(['/tmp/ok.pdf']);
    expect(result.overCapacity).toBe(false);
  });

  it('rejects the whole pick when it exceeds the remaining slots', () => {
    const result = validatePickedPaths(['/tmp/1.pdf', '/tmp/2.md'], 1);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.overCapacity).toBe(true);
  });

  it('filters invalid paths out before the capacity check', () => {
    const result = validatePickedPaths(['/tmp/1.docx', '/tmp/2.pdf'], 1);
    expect(result.accepted).toEqual(['/tmp/2.pdf']);
    expect(result.rejected).toEqual([{ path: '/tmp/1.docx', reason: 'type' }]);
    expect(result.overCapacity).toBe(false);
  });

  it('returns empty for an empty pick', () => {
    expect(validatePickedPaths([], 2)).toEqual({ accepted: [], rejected: [], overCapacity: false });
  });

  it('is case-insensitive on extensions', () => {
    const result = validatePickedPaths(['/tmp/Resume.PDF'], 2);
    expect(result.accepted).toEqual(['/tmp/Resume.PDF']);
  });
});

describe('SOURCE_EXTENSIONS', () => {
  it('lists exactly the accepted document extensions', () => {
    expect([...SOURCE_EXTENSIONS]).toEqual(['pdf', 'md', 'markdown', 'txt']);
  });
});

describe('isTauriWebview', () => {
  it('returns false when the Tauri internal global is absent', () => {
    expect(isTauriWebview()).toBe(false);
  });
});
