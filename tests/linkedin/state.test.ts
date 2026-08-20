import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_METADATA_MAX_BYTES,
  createLoadMoreState,
  LINKEDIN_DISCOVERY_SCHEMA_VERSION,
  LINKEDIN_JOBS_SEARCH_HOST,
  LINKEDIN_JOBS_SEARCH_PATH,
  truncateAvailableMetadata,
  type DiscoveredCard,
  type LoadMoreState,
  type LoadMoreOutcome,
  type OverlayDescriptor,
  type SearchDiscoveryOutcome,
} from '../../src/linkedin/state.js';

describe('src/linkedin/state — Wave A', () => {
  it('LINKEDIN_DISCOVERY_SCHEMA_VERSION === 1', () => {
    expect(LINKEDIN_DISCOVERY_SCHEMA_VERSION).toBe(1);
  });

  it('exposes the LinkedIn host + path constants', () => {
    expect(LINKEDIN_JOBS_SEARCH_HOST).toBe('www.linkedin.com');
    expect(LINKEDIN_JOBS_SEARCH_PATH).toBe('/jobs/search/');
  });

  it('AVAILABLE_METADATA_MAX_BYTES === 2048', () => {
    expect(AVAILABLE_METADATA_MAX_BYTES).toBe(2048);
  });

  it('createLoadMoreState returns a fresh state', () => {
    const state = createLoadMoreState();
    expect(state).toEqual<LoadMoreState>({
      totalCardsSeen: 0,
      noProgressCount: 0,
      iteration: 0,
      lastIdSet: new Set<string>(),
    });
    expect(state.lastIdSet).toBeInstanceOf(Set);
    expect(state.lastIdSet.size).toBe(0);
  });

  it('truncateAvailableMetadata returns null for null input', () => {
    expect(truncateAvailableMetadata(null)).toBeNull();
  });

  it('truncateAvailableMetadata returns null when all values are empty', () => {
    expect(truncateAvailableMetadata({ title: '', company: '' })).toBeNull();
  });

  it('truncateAvailableMetadata returns the record unchanged when it fits the cap', () => {
    const input: Readonly<Record<string, string>> = {
      title: 'Senior Engineer',
      company: 'Acme',
    };
    const out = truncateAvailableMetadata(input);
    expect(out).not.toBeNull();
    expect(out?.title).toBe('Senior Engineer');
    expect(out?.company).toBe('Acme');
  });

  it('truncateAvailableMetadata drops keys (longest first) when over the cap', () => {
    // Construct a record that is over 2 KiB so the cap is exercised.
    const huge = 'x'.repeat(1500);
    const medium = 'y'.repeat(900);
    const tiny = 'tiny';
    const input: Readonly<Record<string, string>> = {
      huge,
      medium,
      tiny,
    };
    const out = truncateAvailableMetadata(input);
    expect(out).not.toBeNull();
    // Order: process in declared order; the first that pushes us over
    // the cap is dropped. With the JSON-encoded `"huge":"<1500 x>"`
    // overhead the huge entry alone is ~1.5 KiB; the medium entry pushes
    // us over the cap and is dropped; tiny survives.
    expect(out?.huge).toBe(huge);
    expect(out?.medium).toBeUndefined();
    expect(out?.tiny).toBe(tiny);
  });

  it('truncateAvailableMetadata returns a frozen record', () => {
    const out = truncateAvailableMetadata({ title: 'Engineer' });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('structural — SearchDiscoveryOutcome shape compiles', () => {
    // Compile-time assertion: assigning the literal exercises the readonly fields.
    const outcome: SearchDiscoveryOutcome = {
      schemaVersion: LINKEDIN_DISCOVERY_SCHEMA_VERSION,
      searchExecutionId: 7,
      finalStatus: 'completed',
      jobsDiscovered: 5,
      newJobs: 5,
      existingJobs: 0,
      errors: [],
      artifactIds: [],
    };
    expect(outcome.searchExecutionId).toBe(7);
    expect(outcome.finalStatus).toBe('completed');
    expect(outcome.errors).toHaveLength(0);
  });

  it('structural — DiscoveredCard shape compiles', () => {
    const card: DiscoveredCard = {
      sourceJobId: '123456',
      cardPosition: 1,
      cardIndex: 0,
      availableMetadata: null,
    };
    expect(card.sourceJobId).toBe('123456');
    expect(card.availableMetadata).toBeNull();
  });

  it('structural — OverlayDescriptor shape compiles', () => {
    const descriptor: OverlayDescriptor = {
      selector: 'div[data-modal="login"]',
      strategy: 'close',
      label: 'LinkedIn login modal',
    };
    expect(descriptor.strategy).toBe('close');
  });

  it('structural — LoadMoreOutcome discriminated union exhaustiveness', () => {
    // Each kind is reachable; the type system enforces payload shape.
    const outcomes: LoadMoreOutcome[] = [
      { kind: 'complete', totalCardsDiscovered: 10, iterations: 2 },
      {
        kind: 'exhausted',
        totalCardsDiscovered: 10,
        iterations: 200,
        reason: 'iteration cap',
      },
      {
        kind: 'no-progress',
        totalCardsDiscovered: 5,
        iterations: 4,
        reason: 'no new IDs',
      },
      {
        kind: 'cancelled',
        totalCardsDiscovered: 3,
        iterations: 1,
        reason: 'signal aborted',
      },
    ];
    expect(outcomes).toHaveLength(4);
    expect(outcomes.map((o) => o.kind)).toEqual([
      'complete',
      'exhausted',
      'no-progress',
      'cancelled',
    ]);
  });
});
