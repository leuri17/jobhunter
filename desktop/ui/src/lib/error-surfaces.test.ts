import { describe, it, expect } from 'vitest';
import { ApiError } from './api';
import {
  ACTION_REQUIRED_ERROR_CODES,
  SURFACE_BY_SEVERITY,
  actionGuidanceFor,
  isActionRequiredError,
} from './error-surfaces';

describe('SURFACE_BY_SEVERITY', () => {
  it('maps each severity to its sanctioned surface', () => {
    expect(SURFACE_BY_SEVERITY.transient).toBe('toast');
    expect(SURFACE_BY_SEVERITY['action-required']).toBe('dialog');
    expect(SURFACE_BY_SEVERITY['route-crash']).toBe('error-boundary');
    expect(SURFACE_BY_SEVERITY.ambient).toBe('banner');
  });
});

describe('isActionRequiredError', () => {
  it.each([...ACTION_REQUIRED_ERROR_CODES])('flags %s as action-required', (code) => {
    expect(isActionRequiredError(new ApiError(503, code, 'msg'))).toBe(true);
  });

  it.each(['internal_error', 'pipeline_run_not_found', 'unknown', 'invalid_state'])(
    'leaves %s to the circumstance judgment at the call site',
    (code) => {
      expect(isActionRequiredError(new ApiError(500, code, 'msg'))).toBe(false);
    },
  );
});

describe('actionGuidanceFor', () => {
  it('returns guidance for openai_unavailable', () => {
    const guidance = actionGuidanceFor(
      new ApiError(503, 'openai_unavailable', 'No OpenAI API key is configured'),
    );
    expect(guidance).not.toBeNull();
    expect(guidance?.message).toBe('Add your OpenAI API key in Settings, under AI Provider.');
    expect(guidance?.actionLabel).toBe('Open settings');
  });

  it('returns null for codes without a documented action', () => {
    expect(
      actionGuidanceFor(new ApiError(500, 'internal_error', 'Internal server error')),
    ).toBeNull();
  });
});
