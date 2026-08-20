import { confirm } from '@inquirer/prompts';
import type { PipelinePrompts } from './prompts.js';
import type { ScoringPlan } from '../scoring/state.js';

/**
 * Default @inquirer/prompts adapter for PipelinePrompts.
 * The orchestrator never imports @inquirer/prompts directly;
 * this file is the ONLY module under src/pipeline/ allowed to do so.
 */
export class InquirerPipelinePrompts implements PipelinePrompts {
  async askScoringConfirmation(input: { plan: ScoringPlan }): Promise<boolean> {
    const message =
      `Run will send ${input.plan.newOpenAIRequests} new OpenAI scoring request(s) ` +
      `for ${input.plan.jobsAccepted} eligible job(s). Proceed?`;
    return confirm({ message, default: false });
  }
}