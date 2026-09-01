import { describe, expect, it } from 'vitest';

import { ExitCode } from '../../src/errors/application-error.js';

import {
  DedicatedPageError,
  DetailUrlBuildError,
  LinkedInExtractionError,
  PanelExtractionError,
  PanelJobIdMismatchError,
  RequiredFieldMissingError,
} from '../../src/linkedin/extraction/errors.js';
import { LinkedInScraperError } from '../../src/linkedin/errors.js';

/**
 * Tests for `src/linkedin/extraction/errors.ts`.
 *
 * Mirrors `tests/linkedin/errors.test.ts`. Each
 * subclass is asserted for:
 *   - `code` (the stable lower_snake_case identifier)
 *   - `exitCode` (always `ExitCode.Fatal = 1`)
 *   - `metadata` shape (the per-subclass payload)
 *   - `instanceof` chain (extends `LinkedInScraperError` → `ApplicationError`)
 */
describe('src/linkedin/extraction/errors — ', () => {
  it('LinkedInExtractionError extends LinkedInScraperError → ApplicationError', () => {
    const err = new LinkedInExtractionError('test_code', 'test message', { foo: 'bar' });
    expect(err).toBeInstanceOf(LinkedInExtractionError);
    expect(err).toBeInstanceOf(LinkedInScraperError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('test_code');
    expect(err.message).toBe('test message');
    expect(err.exitCode).toBe(ExitCode.Fatal);
    expect(err.metadata).toEqual({ foo: 'bar' });
  });

  it('LinkedInExtractionError supports the documented base error code (matches LinkedInScraperError pattern)', () => {
    // The base class is rarely instantiated directly — subclasses
    // pin a specific code. Confirm the base constructor accepts the
    // (code, message, metadata, cause) tuple (mirrors
    // LinkedInScraperError at `src/linkedin/errors.ts:15-25`).
    const err = new LinkedInExtractionError(
      'linkedin_extraction_failed',
      'Job-detail extraction failed.',
      {},
    );
    expect(err.code).toBe('linkedin_extraction_failed');
    expect(err.exitCode).toBe(ExitCode.Fatal);
  });

  it('PanelExtractionError uses code panel_extraction_failed + ExitCode.Fatal', () => {
    const err = new PanelExtractionError({
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      reason: 'description_not_visible',
    });
    expect(err).toBeInstanceOf(LinkedInExtractionError);
    expect(err.code).toBe('panel_extraction_failed');
    expect(err.exitCode).toBe(ExitCode.Fatal);
    expect(err.exitCode).toBe(1);
    expect(err.metadata).toEqual({
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      reason: 'description_not_visible',
    });
  });

  it('PanelJobIdMismatchError carries expectedSourceJobId + actualSourceJobId + attempts', () => {
    const err = new PanelJobIdMismatchError({
      expectedSourceJobId: '123456',
      actualSourceJobId: '999999',
      attempts: 3,
    });
    expect(err).toBeInstanceOf(LinkedInExtractionError);
    expect(err.code).toBe('panel_job_id_mismatch');
    expect(err.exitCode).toBe(ExitCode.Fatal);
    expect(err.metadata).toEqual({
      expectedSourceJobId: '123456',
      actualSourceJobId: '999999',
      attempts: 3,
    });
    // The exact field names are part of the contract — regression
    // guard against renaming `expected` → `expectedSourceJobId`.
    expect(err.metadata).toHaveProperty('expectedSourceJobId');
    expect(err.metadata).toHaveProperty('actualSourceJobId');
    expect(err.metadata).toHaveProperty('attempts');
    expect(err.metadata).not.toHaveProperty('expected');
    expect(err.metadata).not.toHaveProperty('actual');
  });

  it('DedicatedPageError uses code dedicated_page_failed + ExitCode.Fatal', () => {
    const err = new DedicatedPageError({
      url: 'https://www.linkedin.com/jobs/view/123456/',
      reason: 'navigation_timeout',
    });
    expect(err).toBeInstanceOf(LinkedInExtractionError);
    expect(err.code).toBe('dedicated_page_failed');
    expect(err.exitCode).toBe(ExitCode.Fatal);
    expect(err.metadata).toEqual({
      url: 'https://www.linkedin.com/jobs/view/123456/',
      reason: 'navigation_timeout',
    });
  });

  it('RequiredFieldMissingError carries missing: readonly RequiredField[]', () => {
    const err = new RequiredFieldMissingError({
      missing: ['title', 'company', 'location', 'description'],
    });
    expect(err).toBeInstanceOf(LinkedInExtractionError);
    expect(err.code).toBe('required_field_missing');
    expect(err.exitCode).toBe(ExitCode.Fatal);
    expect(err.metadata).toEqual({
      missing: ['title', 'company', 'location', 'description'],
    });
    // Field is a readonly array (no in-place mutation).
    const missing = err.metadata['missing'] as readonly string[];
    expect(Array.isArray(missing)).toBe(true);
    expect(missing).toHaveLength(4);
  });

  it('RequiredFieldMissingError accepts an empty missing array', () => {
    // Edge case: every field IS present but the parser still threw.
    // The error still carries the empty array for diagnostics.
    const err = new RequiredFieldMissingError({ missing: [] });
    expect(err.code).toBe('required_field_missing');
    expect(err.metadata).toEqual({ missing: [] });
  });

  it('DetailUrlBuildError carries sourceJobId in metadata', () => {
    const err = new DetailUrlBuildError({ sourceJobId: 'abc' });
    expect(err).toBeInstanceOf(LinkedInExtractionError);
    expect(err.code).toBe('detail_url_build_failed');
    expect(err.exitCode).toBe(ExitCode.Fatal);
    expect(err.metadata).toEqual({ sourceJobId: 'abc' });
  });

  it('cause is forwarded when supplied (PanelExtractionError)', () => {
    const cause = new Error('upstream playwright timeout');
    const err = new PanelExtractionError({ url: 'https://x', reason: 'timeout' }, cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is forwarded when supplied (PanelJobIdMismatchError)', () => {
    const cause = new Error('href mismatch');
    const err = new PanelJobIdMismatchError(
      { expectedSourceJobId: '123456', actualSourceJobId: '999999', attempts: 3 },
      cause,
    );
    expect(err.cause).toBe(cause);
  });

  it('toJSON returns the documented shape (PanelExtractionError)', () => {
    const err = new PanelExtractionError({
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      reason: 'description_not_visible',
    });
    const json = err.toJSON();
    expect(json.name).toBe('PanelExtractionError');
    expect(json.code).toBe('panel_extraction_failed');
    expect(json.exitCode).toBe(ExitCode.Fatal);
    expect(json.metadata).toEqual({
      url: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
      reason: 'description_not_visible',
    });
    expect(json.cause).toBeUndefined();
  });

  it('every subclass uses ExitCode.Fatal (1) — none use LinkedInBlocked', () => {
    // Per : extraction errors all exit 1. The orchestrator
    // catches LinkedInAccessBlockedError from  separately;
    // extraction never re-emits it.
    const errors: LinkedInExtractionError[] = [
      new PanelExtractionError({ url: 'x', reason: 'y' }),
      new PanelJobIdMismatchError({
        expectedSourceJobId: '1',
        actualSourceJobId: '2',
        attempts: 3,
      }),
      new DedicatedPageError({ url: 'x', reason: 'y' }),
      new RequiredFieldMissingError({ missing: ['title'] }),
      new DetailUrlBuildError({ sourceJobId: 'abc' }),
    ];
    for (const err of errors) {
      expect(err.exitCode).toBe(ExitCode.Fatal);
      expect(err.exitCode).toBe(1);
      expect(err.exitCode).not.toBe(ExitCode.LinkedInBlocked);
    }
  });

  it('error messages are lowercase except the leading letter (project convention)', () => {
    const errors: Error[] = [
      new PanelExtractionError({ url: 'x', reason: 'y' }),
      new PanelJobIdMismatchError({
        expectedSourceJobId: '1',
        actualSourceJobId: '2',
        attempts: 3,
      }),
      new DedicatedPageError({ url: 'x', reason: 'y' }),
      new RequiredFieldMissingError({ missing: [] }),
      new DetailUrlBuildError({ sourceJobId: 'x' }),
    ];
    for (const err of errors) {
      expect(err.message.charAt(0)).toBe(err.message.charAt(0).toUpperCase());
      const tail = err.message.slice(1);
      expect(tail).not.toMatch(/[A-Z]/);
    }
  });
});
