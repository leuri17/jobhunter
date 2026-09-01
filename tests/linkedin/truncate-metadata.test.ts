import { describe, expect, it } from 'vitest';

import { Redactor } from '../../src/diagnostics/redactor.js';
import { truncateAvailableMetadata } from '../../src/linkedin/truncate-metadata.js';
import { noopLinkedInScraperLogger } from '../../src/linkedin/log.js';
import { AVAILABLE_METADATA_MAX_BYTES } from '../../src/linkedin/state.js';

describe('truncateAvailableMetadata', () => {
  it('returns null for null input', () => {
    const result = truncateAvailableMetadata({ metadata: null });
    expect(result.result).toBeNull();
    expect(result.droppedFields).toEqual([]);
  });

  it('returns null for undefined input', () => {
    const result = truncateAvailableMetadata({ metadata: undefined });
    expect(result.result).toBeNull();
    expect(result.droppedFields).toEqual([]);
  });

  it('returns the object unchanged when it fits the byte budget', () => {
    const metadata = { title: 'Senior Engineer', company: 'Acme' };
    const result = truncateAvailableMetadata({ metadata });
    expect(result.droppedFields).toEqual([]);
    expect(result.result).toEqual({ title: 'Senior Engineer', company: 'Acme' });
  });

  it('drops the longest string values first when over the byte budget', () => {
    const huge = 'x'.repeat(1500);
    const medium = 'y'.repeat(900);
    const tiny = 'tiny';
    const result = truncateAvailableMetadata({ metadata: { huge, medium, tiny } });
    expect(result.droppedFields.length).toBeGreaterThan(0);
    // The `huge` field (1500 bytes) should be dropped first.
    expect(result.droppedFields).toContain('huge');
  });

  it('redacts sensitive keys via the optional Redactor', () => {
    const redactor = new Redactor();
    const result = truncateAvailableMetadata({
      metadata: {
        title: 'Senior Engineer',
        apiKey: 'sk-abcdef-secret',
        company: 'Acme',
      },
      redactor,
    });
    expect(result.result).not.toBeNull();
    expect(result.result?.['apiKey']).toBe('[REDACTED]');
    expect(result.result?.['title']).toBe('Senior Engineer');
  });

  it('redacts secret-like values inside string fields', () => {
    const redactor = new Redactor();
    const result = truncateAvailableMetadata({
      metadata: {
        description: 'Use the API key: Bearer sk-abcdef-12345 to authenticate.',
      },
      redactor,
    });
    expect(result.result).not.toBeNull();
    expect(result.result?.['description']).toContain('[REDACTED:token]');
    expect(result.result?.['description']).not.toContain('sk-abcdef-12345');
  });

  it('logs a warning via the logger when fields are dropped', () => {
    const events: Array<{ searchId: string; errorCode: string; message: string }> = [];
    const logger = {
      ...noopLinkedInScraperLogger,
      searchFail: (input: { searchId: string; errorCode: string; message: string }) => {
        events.push(input);
      },
    };
    const metadata = { huge: 'x'.repeat(3000), tiny: 'tiny' };
    truncateAvailableMetadata({ metadata, logger: logger });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.errorCode).toBe('fields_dropped');
    expect(events[0]?.message).toContain('Dropped');
  });

  it('returns null when every field exceeds the byte budget and logs all_fields_dropped', () => {
    const events: Array<{ searchId: string; errorCode: string; message: string }> = [];
    const logger = {
      ...noopLinkedInScraperLogger,
      searchFail: (input: { searchId: string; errorCode: string; message: string }) => {
        events.push(input);
      },
    };
    const metadata = { huge: 'x'.repeat(5000) };
    const result = truncateAvailableMetadata({ metadata, logger, maxBytes: 100 });
    expect(result.result).toBeNull();
    expect(result.droppedFields).toEqual(['huge']);
    expect(events.some((e) => e.errorCode === 'all_fields_dropped')).toBe(true);
  });

  it('respects a custom maxBytes override', () => {
    const result = truncateAvailableMetadata({
      metadata: { title: 'A'.repeat(50) },
      maxBytes: 100,
    });
    expect(result.droppedFields).toEqual([]);
    expect(result.result?.['title']?.length).toBe(50);
  });

  it('uses the default 2 KiB budget when maxBytes is omitted', () => {
    const result = truncateAvailableMetadata({ metadata: { title: 'tiny' } });
    expect(result.droppedFields).toEqual([]);
    expect(AVAILABLE_METADATA_MAX_BYTES).toBe(2048);
  });

  it('stringifies non-string values (numbers, booleans, nulls dropped)', () => {
    const result = truncateAvailableMetadata({
      metadata: { count: 42, active: true, drop: null, name: 'hello' },
    });
    expect(result.result?.['count']).toBe('42');
    expect(result.result?.['active']).toBe('true');
    expect(result.result?.['drop']).toBeUndefined();
    expect(result.result?.['name']).toBe('hello');
  });

  it('returns a frozen record (immutability contract)', () => {
    const result = truncateAvailableMetadata({ metadata: { title: 'Engineer' } });
    expect(Object.isFrozen(result.result)).toBe(true);
  });
});
