import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  select as inquirerSelect,
} from '@inquirer/prompts';
import type { InitPrompts } from './prompts.js';

/**
 * The default `InitPrompts` adapter backed by `@inquirer/prompts`. This
 * is the ONLY module under `src/init/` that imports `@inquirer/prompts`;
 * the boundaries test (`tests/init/boundaries.test.ts`) enforces this.
 */
export const defaultInquirerInitPrompts: InitPrompts = {
  async askResume(input) {
    return inquirerConfirm({
      message: `Resume initialization from "${input.nextStepLabel}"?`,
      default: true,
    });
  },
  async askSourcePaths(_input) {
    const first = await inquirerInput({
      message: 'Path to the first CV source file (PDF / Markdown / plain text):',
      validate: (value: string) =>
        typeof value === 'string' && value.trim().length > 0 ? true : 'Path is required.',
    });
    const second = await inquirerConfirm({
      message: 'Add a second CV source file?',
      default: false,
    });
    if (!second) return [first.trim()];
    const secondPath = await inquirerInput({
      message: 'Path to the second CV source file:',
      validate: (value: string) =>
        typeof value === 'string' && value.trim().length > 0 ? true : 'Path is required.',
    });
    return [first.trim(), secondPath.trim()];
  },
  async askEditHandoff(input) {
    type Handoff = 'edit_then_return' | 'approve_now' | 'reject' | 'exit_init';
    return inquirerSelect<Handoff>({
      message: `Draft profile_${input.draftProfileVersionId} is unapproved. What would you like to do?`,
      choices: [
        {
          name: 'Edit it via "jobhunter profile edit", then re-run init',
          value: 'edit_then_return',
        },
        { name: 'Approve it now (with remaining warnings if any)', value: 'approve_now' },
        { name: 'Reject it (prior approved profile stays active)', value: 'reject' },
        { name: 'Exit init and address it later', value: 'exit_init' },
      ],
      default: 'approve_now',
    });
  },
  async confirmSummary(input) {
    return inquirerConfirm({
      message: input.ready
        ? 'Initialization is complete. Print summary and exit?'
        : `Initialization is partial (next: ${input.nextStep ?? 'done'}). Print summary and exit?`,
      default: true,
    });
  },
};
