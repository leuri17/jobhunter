import { describe, expect, it } from 'vitest';
import { StackTraceCapture } from '../../../src/diagnostics/capture/stack-trace.js';

describe('StackTraceCapture', () => {
  it('serializes Error.stack into a text artifact', async () => {
    const cap = new StackTraceCapture();
    const error = new Error('boom');
    const result = await cap.capture({
      scope: { pipelineRunId: 7 },
      timestamp: '2026-08-13T10:00:00.000Z',
      error,
    });
    expect(result.artifactType).toBe('stack_trace');
    expect(result.extension).toBe('txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.contents.toString()).toContain('boom');
    expect(result.contents.toString()).toContain('Error');
  });

  it('returns an empty artifact when no error is provided', async () => {
    const cap = new StackTraceCapture();
    const result = await cap.capture({
      scope: {},
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(result.contents.toString()).toBe('no error attached');
  });
});
