/**
 * Default `FilterPrompts` adapter for the Inquirer CLI.
 *
 * This module is the ONLY file under `src/filter/` that imports
 * `@inquirer/prompts`. Every other module talks to the configurator
 * through the `FilterPrompts` interface defined in `./prompts.ts`.
 *
 * The adapter:
 *
 *   - askExcludedCompanies           → @inquirer/input (comma-separated)
 *   - askTitleExcludedKeywords        → @inquirer/input (newline-separated)
 *   - askTitleRequiredAnyKeywords     → @inquirer/input (newline-separated)
 *   - askDescriptionExcludedKeywords → @inquirer/input (newline-separated)
 *   - askDescriptionRequiredAnyKeywords → @inquirer/input (newline-separated)
 *   - askMaximumSeniority             → @inquirer/select over
 *                                       SENIORITY_LEVELS + 'none'
 *   - askAcceptedLanguages            → @inquirer/checkbox over `seeds`
 *                                       plus an "Other…" free-text input
 *   - askRejectUnsupportedLanguages   → @inquirer/confirm
 *   - showPreview                     → prints a human-readable preview
 *                                       to stderr and returns
 *   - askConfirmation                 → @inquirer/confirm
 *
 * The "Other…" input for `askAcceptedLanguages` is a follow-up
 * `@inquirer/input`; users can type one language per line and an empty
 * line ends the prompt. New languages are merged into the `added`
 * array; `chosen` is whatever subset of the seeds the user left
 * checked.
 *
 * Domain-boundary note (AGENTS.md §5, §9): this module is the carve-out
 * in `tests/filter/boundaries.test.ts` that allows
 * `@inquirer/prompts` under `src/filter/`. Every other file under
 * `src/filter/` is checked by the tree-walk scan.
 */

import { checkbox, confirm, input, select } from '@inquirer/prompts';

import { SENIORITY_LEVELS, type SeniorityLevel } from '../profile/schema.js';
import { type FilterConfigurationPreview, type FilterPrompts } from './prompts.js';

const NONE_SENTINEL = 'none' as const;

function splitAndTrim(raw: string): readonly string[] {
  return raw
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function splitLines(raw: string): readonly string[] {
  return raw
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function formatList(label: string, values: readonly string[]): string {
  if (values.length === 0) return `${label}: (none)`;
  return `${label}: ${values.join(', ')}`;
}

function formatPreview(preview: FilterConfigurationPreview): string {
  const lines = [
    'Filter configuration preview:',
    formatList('  Excluded companies', preview.excludedCompanies),
    formatList('  Title excluded keywords', preview.titleExcludedKeywords),
    formatList('  Title required-any keywords', preview.titleRequiredAnyKeywords),
    formatList('  Description excluded keywords', preview.descriptionExcludedKeywords),
    formatList('  Description required-any keywords', preview.descriptionRequiredAnyKeywords),
    `  Maximum seniority: ${preview.maximumSeniority ?? '(no cap)'}`,
    formatList('  Accepted languages', preview.acceptedLanguages),
    `  Reject unsupported languages: ${preview.rejectUnsupportedLanguages ? 'yes' : 'no'}`,
  ];
  return lines.join('\n');
}

export class InquirerFilterPrompts implements FilterPrompts {
  async askExcludedCompanies(existing: readonly string[]): Promise<readonly string[]> {
    const defaultText = existing.join(', ');
    const raw = await input({
      message: 'Excluded companies (comma-separated; empty to keep current):',
      default: defaultText,
    });
    return splitAndTrim(raw);
  }

  async askTitleExcludedKeywords(existing: readonly string[]): Promise<readonly string[]> {
    const defaultText = existing.join('\n');
    const raw = await input({
      message: 'Title excluded keywords (one per line; empty to keep current):',
      default: defaultText,
    });
    return splitLines(raw);
  }

  async askTitleRequiredAnyKeywords(existing: readonly string[]): Promise<readonly string[]> {
    const defaultText = existing.join('\n');
    const raw = await input({
      message: 'Title required-any keywords (one per line; empty list means "any title is fine"):',
      default: defaultText,
    });
    return splitLines(raw);
  }

  async askDescriptionExcludedKeywords(existing: readonly string[]): Promise<readonly string[]> {
    const defaultText = existing.join('\n');
    const raw = await input({
      message: 'Description excluded keywords (one per line; empty to keep current):',
      default: defaultText,
    });
    return splitLines(raw);
  }

  async askDescriptionRequiredAnyKeywords(existing: readonly string[]): Promise<readonly string[]> {
    const defaultText = existing.join('\n');
    const raw = await input({
      message:
        'Description required-any keywords (one per line; empty list means "any description is fine"):',
      default: defaultText,
    });
    return splitLines(raw);
  }

  async askMaximumSeniority(existing: SeniorityLevel | null): Promise<SeniorityLevel | null> {
    const choices: { name: string; value: SeniorityLevel | typeof NONE_SENTINEL }[] = [
      ...SENIORITY_LEVELS.map((level) => ({ name: level, value: level })),
      { name: '(no cap)', value: NONE_SENTINEL },
    ];
    const def = existing ?? NONE_SENTINEL;
    const picked = await select<SeniorityLevel | typeof NONE_SENTINEL>({
      message: 'Maximum seniority (jobs above this rank will be rejected):',
      choices,
      default: def,
    });
    return picked === NONE_SENTINEL ? null : picked;
  }

  async askAcceptedLanguages(
    seeds: readonly string[],
  ): Promise<{ readonly chosen: readonly string[]; readonly added: readonly string[] }> {
    const initialSet = new Set<string>(seeds);
    const chosen = await checkbox<string>({
      message: 'Accepted languages (toggle the languages the candidate supports):',
      choices: seeds.map((value) => ({ name: value, value, checked: true })),
    });
    const added: string[] = [];
    while (true) {
      const raw = await input({
        message: 'Add another language (one per line; empty line to finish):',
      });
      const trimmed = raw.trim();
      if (trimmed.length === 0) break;
      added.push(trimmed);
    }
    // Defensive: if the user unchecked every seed AND added nothing,
    // treat the seeds as the chosen set so the configuration is never
    // empty (an empty accepted list disables the rule).
    if (chosen.length === 0 && added.length === 0) {
      return { chosen: seeds, added: [] };
    }
    // Reference `initialSet` to keep the closure compiler-friendly and
    // document the seed semantics.
    void initialSet;
    return { chosen, added };
  }

  async askRejectUnsupportedLanguages(existing: boolean): Promise<boolean> {
    return confirm({
      message: 'Reject jobs that explicitly require a non-accepted language?',
      default: existing,
    });
  }

  async showPreview(preview: FilterConfigurationPreview): Promise<void> {
    console.error(formatPreview(preview));
  }

  async askConfirmation(_preview: FilterConfigurationPreview): Promise<boolean> {
    return confirm({
      message: 'Write this filter configuration to disk?',
      default: true,
    });
  }
}

/** Default Inquirer adapter (no constructor args required). */
export const defaultInquirerFilterPrompts: FilterPrompts = new InquirerFilterPrompts();

/** Re-export the seniority levels for tests / CLI hooks. */
export { SENIORITY_LEVELS as InquirerFilterSeniorityLevels };
export type { SeniorityLevel };
