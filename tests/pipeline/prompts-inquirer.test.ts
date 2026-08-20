import { describe, expect, it, vi } from 'vitest';
import * as inquirer from '@inquirer/prompts';

import { InquirerPipelinePrompts } from '../../src/pipeline/prompts-inquirer.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from '../../src/scoring/state.js';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

const plan = {
  schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
  runId: 1,
  searchExecutionId: 1,
  jobsDiscovered: 1,
  jobsAccepted: 1,
  scoresReused: 0,
  newOpenAIRequests: 1,
  skippedScoringCategories: [],
  scoringConcurrency: 3,
  perJob: [],
};

describe('InquirerPipelinePrompts', () => {
  it('formats the confirmation message', async () => {
    const confirmMock = vi.mocked(inquirer.confirm);
    confirmMock.mockResolvedValueOnce(true);

    const adapter = new InquirerPipelinePrompts();
    const result = await adapter.askScoringConfirmation({ plan });
    expect(result).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    const callArg = confirmMock.mock.calls[0]?.[0] as { message?: string; default?: boolean };
    expect(callArg.message).toContain('1 new OpenAI scoring request');
    expect(callArg.default).toBe(false);
  });

  it('returns false when the user declines', async () => {
    const confirmMock = vi.mocked(inquirer.confirm);
    confirmMock.mockResolvedValueOnce(false);

    const adapter = new InquirerPipelinePrompts();
    const result = await adapter.askScoringConfirmation({ plan });
    expect(result).toBe(false);
  });
});