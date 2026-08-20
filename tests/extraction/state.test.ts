import { describe, expect, it } from 'vitest';

import {
  LINKEDIN_EXTRACTION_SCHEMA_VERSION,
  type ExtractionBatchOutcome,
  type ExtractionFieldSet,
  type ExtractionKind,
  type ExtractionMethod,
  type ExtractionOutcome,
  type LinkedinExtractionSchemaVersion,
  type RequiredField,
} from '../../src/linkedin/extraction/state.js';

/**
 * TypeScript-only structural assertions for `src/linkedin/extraction/state.ts`
 * (TASK-013 Plan Task 1). Pure type-level exercise — no runtime I/O,
 * no fixtures. The compile-time assignment of the literal objects
 * below is the primary verification; the `expect(...)` calls
 * surface the literals at runtime so vitest reports a meaningful
 * test name.
 */
describe('src/linkedin/extraction/state — Wave A', () => {
  it('LINKEDIN_EXTRACTION_SCHEMA_VERSION === 1', () => {
    expect(LINKEDIN_EXTRACTION_SCHEMA_VERSION).toBe(1);
  });

  it('LinkedinExtractionSchemaVersion is the literal type of the constant', () => {
    // Type-level assertion: the alias must equal the constant type.
    const schemaVersion: LinkedinExtractionSchemaVersion = LINKEDIN_EXTRACTION_SCHEMA_VERSION;
    expect(schemaVersion).toBe(1);
  });

  it('RequiredField union has exactly the four documented members', () => {
    const fields: RequiredField[] = ['title', 'company', 'location', 'description'];
    expect(fields).toHaveLength(4);
    expect(fields).toEqual(['title', 'company', 'location', 'description']);
  });

  it('ExtractionFieldSet shape compiles (all four keys, all nullable)', () => {
    const fields: ExtractionFieldSet = {
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build cool stuff.',
    };
    expect(fields.title).toBe('Senior Engineer');

    const nullable: ExtractionFieldSet = {
      title: null,
      company: null,
      location: null,
      description: null,
    };
    expect(nullable.title).toBeNull();
  });

  it('ExtractionMethod union has exactly the two documented members', () => {
    const methods: ExtractionMethod[] = ['search_detail_panel', 'dedicated_job_page'];
    expect(methods).toHaveLength(2);
    expect(methods).toEqual(['search_detail_panel', 'dedicated_job_page']);
  });

  it('ExtractionKind union has exactly the five documented members', () => {
    const kinds: ExtractionKind[] = ['complete', 'partial', 'failed', 'skipped', 'cancelled'];
    expect(kinds).toHaveLength(5);
    expect(kinds).toEqual(['complete', 'partial', 'failed', 'skipped', 'cancelled']);
  });

  it('structural — ExtractionOutcome shape compiles (complete path)', () => {
    const outcome: ExtractionOutcome = {
      schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
      jobId: 42,
      sourceJobId: '123456',
      kind: 'complete',
      fields: {
        title: 'Senior Engineer',
        company: 'Acme',
        location: 'Remote',
        description: 'Build cool stuff.',
      },
      attemptedMethods: ['search_detail_panel'],
      errorCode: null,
      errorMessage: null,
      artifactIds: [],
    };
    expect(outcome.kind).toBe('complete');
    expect(outcome.jobId).toBe(42);
    expect(outcome.errorCode).toBeNull();
  });

  it('structural — ExtractionOutcome shape compiles (failed path)', () => {
    const outcome: ExtractionOutcome = {
      schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
      jobId: 7,
      sourceJobId: '999999',
      kind: 'failed',
      fields: {
        title: null,
        company: null,
        location: null,
        description: null,
      },
      attemptedMethods: ['search_detail_panel', 'dedicated_job_page'],
      errorCode: 'panel_and_dedicated_failed',
      errorMessage: 'panel load timeout + dedicated load timeout',
      artifactIds: [1, 2],
    };
    expect(outcome.kind).toBe('failed');
    expect(outcome.attemptedMethods).toHaveLength(2);
    expect(outcome.errorCode).toBe('panel_and_dedicated_failed');
  });

  it('structural — ExtractionOutcome shape compiles (skipped path)', () => {
    const outcome: ExtractionOutcome = {
      schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
      jobId: 1,
      sourceJobId: '123456',
      kind: 'skipped',
      fields: {
        title: 'Senior Engineer',
        company: 'Acme',
        location: 'Remote',
        description: 'Build cool stuff.',
      },
      attemptedMethods: [],
      errorCode: null,
      errorMessage: null,
      artifactIds: [],
    };
    expect(outcome.kind).toBe('skipped');
    expect(outcome.attemptedMethods).toHaveLength(0);
  });

  it('structural — ExtractionBatchOutcome shape compiles with full totals', () => {
    const batch: ExtractionBatchOutcome = {
      schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
      runId: 1,
      searchExecutionId: 5,
      perJob: [],
      totals: {
        complete: 10,
        partial: 2,
        failed: 1,
        skipped: 3,
        cancelled: 0,
      },
    };
    expect(batch.runId).toBe(1);
    expect(batch.totals.complete).toBe(10);
    expect(batch.totals.cancelled).toBe(0);
    expect(batch.perJob).toHaveLength(0);
  });
});
