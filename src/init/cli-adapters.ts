/**
 * CLI-only prompt adapters for the init orchestrator.
 *
 * These adapters isolate the inquirer-based prompts from the
 * orchestrator. They are imported ONLY by `src/cli.ts` and the test
 * file — they are NOT used inside `src/init/init-service.ts` (the
 * orchestrator consumes the structural interfaces, not the adapters).
 */
import { confirm as inquirerConfirm } from '@inquirer/prompts';
import { defaultInquirerFilterPrompts } from '../filter/prompts-inquirer.js';
import type { FilterPrompts } from '../filter/prompts.js';
import type { ProfileApprovalPrompts } from '../profile/approval-service.js';
import type { ProfileRejectionPrompts } from '../profile/rejection-service.js';
import { defaultInquirerPrompts } from '../search/prompts.js';
import type { SearchPrompts } from '../search/prompts.js';

export function configureFiltersPromptAdapter(): FilterPrompts {
  return defaultInquirerFilterPrompts;
}

export function configureSearchPromptAdapter(): SearchPrompts {
  return defaultInquirerPrompts;
}

export function profileApprovalPromptAdapter(): ProfileApprovalPrompts {
  return {
    confirmApprovalWithWarnings: async (input) => {
      process.stderr.write(
        `Approving profile ${input.profileVersionId} with ${input.remainingWarnings.length} warning(s):\n`,
      );
      for (const warning of input.remainingWarnings) {
        process.stderr.write(`  - ${warning}\n`);
      }
      return inquirerConfirm({
        message: 'Proceed with approval?',
        default: false,
      });
    },
  };
}

export function profileRejectionPromptAdapter(): ProfileRejectionPrompts {
  return {
    confirmRejection: async (input) => {
      return inquirerConfirm({
        message: `Reject profile ${input.profileVersionId}? (prior approved profile stays active)`,
        default: false,
      });
    },
  };
}
