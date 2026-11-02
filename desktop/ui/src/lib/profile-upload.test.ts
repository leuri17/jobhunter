import { describe, expect, it } from 'vitest';
import {
  validatePickedPaths,
  SOURCE_EXTENSIONS,
  mimeForPath,
  isTauriWebview,
} from './profile-upload';

describe('validatePickedPaths', () => {
  it('accepts allowed extensions', () => {
    const result = validatePickedPaths(['/tmp/a.pdf', '/tmp/b.md']);
    expect(result.accepted).toEqual(['/tmp/a.pdf', '/tmp/b.md']);
    expect(result.rejected).toEqual([]);
    expect(result.skippedByCount).toEqual([]);
  });

  it('rejects disallowed extensions with per-file reasons', () => {
    const result = validatePickedPaths(['/tmp/a.docx', '/tmp/noext']);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { path: '/tmp/a.docx', reason: 'type' },
      { path: '/tmp/noext', reason: 'type' },
    ]);
  });

  it('caps accepted paths at 2 and reports the rest as skippedByCount', () => {
    const result = validatePickedPaths(['/tmp/1.pdf', '/tmp/2.md', '/tmp/3.txt', '/tmp/4.md']);
    expect(result.accepted).toEqual(['/tmp/1.pdf', '/tmp/2.md']);
    expect(result.skippedByCount).toEqual(['/tmp/3.txt', '/tmp/4.md']);
  });

  it('filters invalid paths out before applying the count cap', () => {
    const result = validatePickedPaths(['/tmp/1.docx', '/tmp/2.pdf', '/tmp/3.txt']);
    expect(result.accepted).toEqual(['/tmp/2.pdf', '/tmp/3.txt']);
    expect(result.rejected).toEqual([{ path: '/tmp/1.docx', reason: 'type' }]);
    expect(result.skippedByCount).toEqual([]);
  });

  it('returns empty for an empty pick', () => {
    expect(validatePickedPaths([])).toEqual({ accepted: [], rejected: [], skippedByCount: [] });
  });

  it('is case-insensitive on extensions', () => {
    const result = validatePickedPaths(['/tmp/Resume.PDF', '/tmp/notes.MD']);
    expect(result.accepted).toEqual(['/tmp/Resume.PDF', '/tmp/notes.MD']);
  });
});

describe('mimeForPath', () => {
  it('maps extensions to sidecar MIME types', () => {
    expect(mimeForPath('/tmp/a.pdf')).toBe('application/pdf');
    expect(mimeForPath('/tmp/a.md')).toBe('text/markdown');
    expect(mimeForPath('/tmp/a.markdown')).toBe('text/markdown');
    expect(mimeForPath('/tmp/a.txt')).toBe('text/plain');
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
