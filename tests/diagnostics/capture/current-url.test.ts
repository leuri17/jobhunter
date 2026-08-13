import { describe, expect, it } from 'vitest';
import { CurrentUrlCapture } from '../../../src/diagnostics/capture/current-url.js';

describe('CurrentUrlCapture', () => {
  it('serializes the provided URL', async () => {
    const cap = new CurrentUrlCapture();
    const result = await cap.capture({
      scope: { pipelineRunId: 7 },
      timestamp: '2026-08-13T10:00:00.000Z',
      currentUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
    });
    expect(result.artifactType).toBe('current_url');
    expect(result.extension).toBe('txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.contents.toString()).toContain('linkedin.com/jobs/search');
  });

  it('returns an empty artifact when no URL is provided', async () => {
    const cap = new CurrentUrlCapture();
    const result = await cap.capture({
      scope: {},
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(result.contents.toString()).toBe('no url captured');
  });
});
