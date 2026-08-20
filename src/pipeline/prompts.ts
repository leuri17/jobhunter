import type { ScoringPlan } from '../scoring/state.js';

/**
 * UI seam for the pipeline orchestrator (TASK-015).
 */
export interface PipelinePrompts {
  askScoringConfirmation(input: { plan: ScoringPlan }): Promise<boolean>;
}

/**
 * Scripted adapter for tests. Returns the next scripted response.
 * Throws when exhausted to surface the test's miss.
 */
export class ScriptedPipelinePrompts implements PipelinePrompts {
  private readonly responses: boolean[];
  private index = 0;

  constructor(responses: readonly boolean[]) {
    this.responses = [...responses];
  }

  async askScoringConfirmation(_input: { plan: ScoringPlan }): Promise<boolean> {
    const value = this.responses[this.index];
    if (value === undefined) {
      throw new Error(`ScriptedPipelinePrompts: exhausted responses at index ${this.index}`);
    }
    this.index += 1;
    return value;
  }
}

/**
 * Failing adapter for tests. Each call rejects with the supplied error.
 */
export class FailingPipelinePrompts implements PipelinePrompts {
  constructor(private readonly error: Error = new Error('prompt failed')) {}

  async askScoringConfirmation(_input: { plan: ScoringPlan }): Promise<boolean> {
    throw this.error;
  }
}