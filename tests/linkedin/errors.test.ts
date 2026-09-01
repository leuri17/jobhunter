import { describe, expect, it } from 'vitest';

import { ExitCode } from '../../src/errors/application-error.js';

import {
  BrowserCapacityExceededError,
  BrowserLaunchError,
  LinkedInAccessBlockedError,
  LinkedInExpectedPageError,
  LinkedInScraperError,
  LoadMoreLoopExhaustedError,
  NavigationTimeoutError,
  OverlayUndismissableError,
} from '../../src/linkedin/errors.js';

describe('src/linkedin/errors — ', () => {
  it('LinkedInScraperError extends ApplicationError', () => {
    const err = new LinkedInScraperError('test_code', 'test message', ExitCode.Fatal);
    expect(err).toBeInstanceOf(LinkedInScraperError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('test_code');
    expect(err.message).toBe('test message');
    expect(err.exitCode).toBe(ExitCode.Fatal);
  });

  it('LinkedInAccessBlockedError uses ExitCode.LinkedInBlocked (exact spelling)', () => {
    const err = new LinkedInAccessBlockedError();
    expect(err).toBeInstanceOf(LinkedInScraperError);
    expect(err.code).toBe('linkedin_access_blocked');
    expect(err.exitCode).toBe(ExitCode.LinkedInBlocked);
    // Regression guard: the constant is `LinkedInBlocked`, NOT `LinkedInBlock`.
    expect(ExitCode.LinkedInBlocked).toBe(4);
  });

  it('LinkedInExpectedPageError uses ExitCode.Fatal', () => {
    const err = new LinkedInExpectedPageError();
    expect(err.code).toBe('linkedin_expected_page_missing');
    expect(err.exitCode).toBe(ExitCode.Fatal);
  });

  it('NavigationTimeoutError uses ExitCode.Fatal', () => {
    const err = new NavigationTimeoutError();
    expect(err.code).toBe('navigation_timeout');
    expect(err.exitCode).toBe(ExitCode.Fatal);
  });

  it('OverlayUndismissableError uses ExitCode.Fatal', () => {
    const err = new OverlayUndismissableError();
    expect(err.code).toBe('overlay_undismissable');
    expect(err.exitCode).toBe(ExitCode.Fatal);
  });

  it('LoadMoreLoopExhaustedError uses ExitCode.Fatal (soft warning)', () => {
    const err = new LoadMoreLoopExhaustedError();
    expect(err.code).toBe('load_more_loop_exhausted');
    expect(err.exitCode).toBe(ExitCode.Fatal);
    expect(err.exitCode).toBe(1);
  });

  it('BrowserLaunchError uses ExitCode.Fatal', () => {
    const err = new BrowserLaunchError();
    expect(err.code).toBe('browser_launch_failed');
    expect(err.exitCode).toBe(ExitCode.Fatal);
  });

  it('BrowserCapacityExceededError uses ExitCode.Fatal', () => {
    const err = new BrowserCapacityExceededError();
    expect(err.code).toBe('browser_capacity_exceeded');
    expect(err.exitCode).toBe(ExitCode.Fatal);
  });

  it('metadata is forwarded to the base ApplicationError', () => {
    const err = new LinkedInExpectedPageError({ url: 'https://www.linkedin.com/jobs/search/' });
    expect(err.metadata).toEqual({ url: 'https://www.linkedin.com/jobs/search/' });
  });

  it('cause is forwarded when supplied', () => {
    const cause = new Error('upstream timeout');
    const err = new NavigationTimeoutError({ attempt: 1 }, cause);
    expect(err.cause).toBe(cause);
    expect(err.metadata).toEqual({ attempt: 1 });
  });

  it('toJSON returns the documented shape with cause populated', () => {
    const cause = new Error('playwright timeout');
    const err = new OverlayUndismissableError({ selector: 'div[data-modal="login"]' }, cause);
    const json = err.toJSON();
    expect(json.name).toBe('OverlayUndismissableError');
    expect(json.code).toBe('overlay_undismissable');
    expect(json.exitCode).toBe(ExitCode.Fatal);
    expect(json.message).toContain('overlay');
    expect(json.metadata).toEqual({ selector: 'div[data-modal="login"]' });
    expect(json.cause).toEqual({ name: 'Error', message: 'playwright timeout' });
  });

  it('toJSON omits cause when not supplied', () => {
    const err = new BrowserLaunchError();
    const json = err.toJSON();
    expect(json.cause).toBeUndefined();
  });

  it('error message is lowercase except the leading letter (project convention)', () => {
    const errors = [
      new LinkedInAccessBlockedError(),
      new LinkedInExpectedPageError(),
      new NavigationTimeoutError(),
      new OverlayUndismissableError(),
      new LoadMoreLoopExhaustedError(),
      new BrowserLaunchError(),
      new BrowserCapacityExceededError(),
    ];
    for (const err of errors) {
      // First char uppercase; the rest of the message is lowercase (no internal capitals).
      expect(err.message.charAt(0)).toBe(err.message.charAt(0).toUpperCase());
      const tail = err.message.slice(1);
      // Tail must not contain uppercase ASCII letters.
      expect(tail).not.toMatch(/[A-Z]/);
    }
  });
});
