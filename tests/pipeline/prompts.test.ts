import { describe, expect, it } from 'vitest';
import { ScriptedPipelinePrompts, FailingPipelinePrompts } from '../../src/pipeline/prompts.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from '../../src/scoring/state.js';

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

describe('PipelinePrompts', () => {
  it('ScriptedPipelinePrompts returns responses in order', async () => {
    const prompts = new ScriptedPipelinePrompts([true, false]);
    expect(await prompts.askScoringConfirmation({ plan })).toBe(true);
    expect(await prompts.askScoringConfirmation({ plan })).toBe(false);
  });

  it('ScriptedPipelinePrompts throws when exhausted', async () => {
    const prompts = new ScriptedPipelinePrompts([true]);
    await prompts.askScoringConfirmation({ plan });
    await expect(prompts.askScoringConfirmation({ plan })).rejects.toThrow(/exhausted/);
  });

  it('FailingPipelinePrompts rejects', async () => {
    const prompts = new FailingPipelinePrompts(new Error('declined'));
    await expect(prompts.askScoringConfirmation({ plan })).rejects.toThrow('declined');
  });
});
