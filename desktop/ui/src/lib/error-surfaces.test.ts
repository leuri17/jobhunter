import { describe, it, expect } from 'vitest';
import { ApiError } from './api';
import {
  ACTION_GUIDANCE,
  ACTION_REQUIRED_ERROR_CODES,
  SURFACE_BY_SEVERITY,
  actionGuidanceFor,
  formatErrorTrace,
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

  it('returns guidance for no_active_profile pointing at the Profile page', () => {
    const guidance = actionGuidanceFor(
      new ApiError(409, 'no_active_profile', 'No active approved profile.'),
    );
    expect(guidance?.message).toContain('Profile page');
    expect(guidance?.actionLabel).toBe('Open Profile');
  });

  it('returns guidance for openai_api_key_missing pointing at Settings', () => {
    const guidance = actionGuidanceFor(
      new ApiError(409, 'openai_api_key_missing', 'An OpenAI API key is required.'),
    );
    expect(guidance?.message).toContain('Settings');
    expect(guidance?.actionLabel).toBe('Open settings');
  });

  it('explains no_active_filter pointing at the default-filter button', () => {
    const guidance = actionGuidanceFor(
      new ApiError(409, 'no_active_filter', 'No active filter configuration.'),
    );
    expect(guidance?.message).toContain('default filter');
  });

  it('returns null for codes without a documented action', () => {
    expect(
      actionGuidanceFor(new ApiError(500, 'internal_error', 'Internal server error')),
    ).toBeNull();
  });
});

describe('formatErrorTrace', () => {
  it('puts status, code, and message on separate lines', () => {
    expect(
      formatErrorTrace(new ApiError(503, 'openai_unavailable', 'No OpenAI API key is configured')),
    ).toBe('status: 503\ncode: openai_unavailable\nmessage: No OpenAI API key is configured');
  });
});

describe('ACTION_GUIDANCE profile keys', () => {
  it('defines guidance for profile saves', () => {
    expect(ACTION_GUIDANCE.profileSave.message).toContain('draft');
    expect(ACTION_GUIDANCE.profileSave.actionLabel.length).toBeGreaterThan(0);
  });

  it('defines guidance for extraction failures pointing at Settings', () => {
    expect(ACTION_GUIDANCE.profileExtraction.message).toContain('Settings');
    expect(ACTION_GUIDANCE.profileExtraction.actionLabel.length).toBeGreaterThan(0);
  });
});
