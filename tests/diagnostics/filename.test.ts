import { describe, expect, it } from 'vitest';
import {
  buildSafeFilename,
  resolveScopeDirectory,
  sanitizeFilenameComponent,
} from '../../src/diagnostics/filename.js';

describe('sanitizeFilenameComponent', () => {
  it('keeps lowercase alphanumerics and dashes', () => {
    expect(sanitizeFilenameComponent('frontend-developer 42')).toBe('frontend-developer-42');
  });

  it('collapses unsafe characters to dashes', () => {
    expect(sanitizeFilenameComponent('../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeFilenameComponent('?api_key=ABC&x=1')).toBe('api-key-abc-x-1');
  });

  it('replaces empty/whitespace input with "unknown"', () => {
    expect(sanitizeFilenameComponent('')).toBe('unknown');
    expect(sanitizeFilenameComponent('   ')).toBe('unknown');
  });

  it('truncates to 40 characters with trailing dash', () => {
    const long = 'a'.repeat(80);
    const result = sanitizeFilenameComponent(long);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith('-')).toBe(true);
  });
});

describe('resolveScopeDirectory', () => {
  it('returns run-<id> when only runId is set', () => {
    expect(resolveScopeDirectory({ pipelineRunId: 7 })).toBe('run-7');
  });

  it('nests in run/search/job order', () => {
    expect(resolveScopeDirectory({ pipelineRunId: 7, searchExecutionId: 42, jobId: 99 })).toBe(
      'run-7/search-42/job-99',
    );
  });

  it('falls back to "unscoped" when no ids are present', () => {
    expect(resolveScopeDirectory({})).toBe('unscoped');
  });

  it('skips zero/negative ids', () => {
    expect(resolveScopeDirectory({ pipelineRunId: 0, jobId: -1 })).toBe('unscoped');
  });

  it('emits ai-provider-<id> segment when aiProviderRequestId is set', () => {
    expect(resolveScopeDirectory({ aiProviderRequestId: 42 })).toBe('ai-provider-42');
  });

  it('nests ai-provider-<id> after the other segments', () => {
    expect(
      resolveScopeDirectory({
        pipelineRunId: 7,
        searchExecutionId: 42,
        jobId: 99,
        aiProviderRequestId: 123,
      }),
    ).toBe('run-7/search-42/job-99/ai-provider-123');
  });

  it('skips aiProviderRequestId when zero, negative, or null', () => {
    expect(resolveScopeDirectory({ aiProviderRequestId: 0 })).toBe('unscoped');
    expect(resolveScopeDirectory({ aiProviderRequestId: -1 })).toBe('unscoped');
    expect(resolveScopeDirectory({ aiProviderRequestId: null })).toBe('unscoped');
  });
});

describe('buildSafeFilename', () => {
  it('produces a basename with sanitized type and timestamp', () => {
    const { basename, relativePath } = buildSafeFilename({
      artifactType: 'screenshot',
      scope: { pipelineRunId: 7 },
      extension: 'png',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(basename).toBe('screenshot-run-7-2026-08-13T10-00-00-000Z.png');
    expect(relativePath).toBe('run-7/screenshot-run-7-2026-08-13T10-00-00-000Z.png');
  });

  it('appends suffix and omits absent ids', () => {
    const { basename } = buildSafeFilename({
      artifactType: 'stack_trace',
      scope: { pipelineRunId: 7, jobId: 99 },
      extension: 'txt',
      timestamp: '2026-08-13T10:00:00.000Z',
      suffix: '-attempt-2',
    });
    expect(basename).toBe('stack-trace-run-7-job-99-2026-08-13T10-00-00-000Z-attempt-2.txt');
  });

  it('includes ai-provider-<id> in the basename and the relative path', () => {
    const { basename, relativePath } = buildSafeFilename({
      artifactType: 'ai_provider_error',
      scope: { pipelineRunId: 7, jobId: 99, aiProviderRequestId: 123 },
      extension: 'json',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(basename).toBe(
      'ai-provider-error-run-7-job-99-ai-provider-123-2026-08-13T10-00-00-000Z.json',
    );
    expect(relativePath).toBe(
      'run-7/job-99/ai-provider-123/ai-provider-error-run-7-job-99-ai-provider-123-2026-08-13T10-00-00-000Z.json',
    );
  });

  it('omits the ai-provider segment when aiProviderRequestId is absent', () => {
    const { basename } = buildSafeFilename({
      artifactType: 'screenshot',
      scope: { pipelineRunId: 7 },
      extension: 'png',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(basename).not.toContain('ai-provider-');
  });
});
