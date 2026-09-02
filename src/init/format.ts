/**
 * Human-readable renderer for `SetupSummary` ( Minor h).
 *
 * Output is deterministic (same input → same output) and
 * newline-terminated per the desktop sidecar's `<line>\n` writing
 * convention.
 *
 * Format:
 *   ```
 *   paths: complete
 *   directories: complete
 *   ...
 *   filters: complete
 *   ready: yes
 *   next: none
 *
 *   ```
 *
 *   (blank trailing line because every line is `\n`-terminated and the
 *   final `\n` produces an empty trailing line when joined)
 *
 * For a partially-ready summary, `ready: no` replaces `ready: yes`
 * and `next: <stepId>` replaces `next: none`. When `openAiKeyMissing`
 * is `true`, no extra line is emitted — the operator can read the
 * `extract: incomplete` line and the explicit handoff message lives
 * outside the summary (in the orchestrator's CLI-level print step).
 *
 * Failed steps append `[errorCode=<code>]` after the status literal:
 *   ```
 *   approvedProfile: failed [errorCode=blocking_conflicts_unresolved]
 *   ```
 */
import type { InitStepReport, SetupSummary } from './state.js';

export function formatInitSummary(summary: SetupSummary): string {
  const lines: string[] = [];
  for (const step of summary.steps) {
    lines.push(formatStepLine(step));
  }
  lines.push(`ready: ${summary.ready ? 'yes' : 'no'}`);
  lines.push(`next: ${summary.nextStep ?? 'none'}`);
  // Trailing newline so the CLI's `process.stdout.write(${result}\n)`
  // emits a single trailing newline and the shell sees a complete line.
  return `${lines.join('\n')}\n`;
}

function formatStepLine(step: InitStepReport): string {
  const base = `${step.id}: ${step.status}`;
  if (step.errorCode !== null) {
    return `${base} [errorCode=${step.errorCode}]`;
  }
  return base;
}
