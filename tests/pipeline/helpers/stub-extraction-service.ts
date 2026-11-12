import type {
  ExtractBatchInput,
  ExtractionBatchOutcome,
} from '../../../../src/linkedin/extraction/index.js';

/**
 * Extraction stub for pipeline-level tests: marks every discovered job
 * complete with fixed fields, so the filter and scoring stages run on
 * real extraction-shaped data without the FakePage DOM stubs.
 */
export class StubExtractionService {
  async extractBatch(input: ExtractBatchInput): Promise<ExtractionBatchOutcome> {
    const perJob = input.jobs.map((job) => ({
      schemaVersion: 1 as const,
      jobId: job.id,
      sourceJobId: job.sourceJobId,
      kind: 'complete' as const,
      fields: {
        title: 'Extracted Title',
        company: 'Extracted Co',
        location: 'Berlin',
        description: 'Extracted description.',
      },
      attemptedMethods: ['search_detail_panel'] as const,
      errorCode: null,
      errorMessage: null,
      artifactIds: [],
    }));
    return {
      schemaVersion: 1,
      runId: input.run.id,
      searchExecutionId: input.searchExecution.id,
      perJob,
      totals: {
        complete: perJob.length,
        partial: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
      },
    };
  }
}
