/**
 * Init-specific prompts. The orchestrator composes the existing
 * `SearchPrompts`, `FilterPrompts`, and `ProfileApprovalPrompts` for
 * every other user interaction — those are NOT part of this seam.
 */
export interface InitPrompts {
  /** Confirm resume from the first incomplete prerequisite. */
  askResume(input: { readonly nextStepLabel: string }): Promise<boolean>;
  /**
   * Collect 1 or 2 CV source file paths (PDF / Markdown / plain text).
   * The orchestrator calls this BEFORE invoking `ProfileImportService`
   * (Finding 1). The adapter returns 1 or 2 absolute paths; zero or
   * three+ paths is a contract violation that the orchestrator surfaces
   * as a `SetupSummary` step-level `failed` with `errorCode:
   * 'invalid_source_paths'`. The default inquirer adapter asks for the
   * first path (required), then offers an `@inquirer/confirm` for the
   * second (optional).
   */
  askSourcePaths(input: { readonly existing: readonly string[] }): Promise<readonly string[]>;
  /**
   * Confirm whether the user wants to edit the current draft through
   * `jobhunter profile edit` before init offers to approve it. The
   * orchestrator NEVER calls `ProfileEditingService.startEdit` directly
   * (Decision 6).
   */
  askEditHandoff(input: {
    readonly draftProfileVersionId: number;
    readonly warnings: readonly string[];
  }): Promise<'edit_then_return' | 'approve_now' | 'reject' | 'exit_init'>;
  /**
   * Print the final setup summary (the CLI handler owns the actual
   * stdout write) and ask whether to exit cleanly. The orchestrator
   * treats `false` as a SOFT exit — it returns the typed `SetupSummary`
   * to the caller; the CLI prints it; exit 0. `confirmSummary: false`
   * is NOT cancellation (Finding 5). Cancellation is signalled
   * exclusively via `UserCancellation` subclasses thrown by the
   * prerequisite services or `SearchCancelledError`.
   */
  confirmSummary(input: {
    readonly ready: boolean;
    readonly nextStep: string | null;
  }): Promise<boolean>;
}

export function createFailingInitPrompts(reason: string): InitPrompts {
  return {
    askResume: async () => {
      throw new Error(reason);
    },
    askSourcePaths: async () => {
      throw new Error(reason);
    },
    askEditHandoff: async () => {
      throw new Error(reason);
    },
    confirmSummary: async () => {
      throw new Error(reason);
    },
  };
}

export class ScriptedInitPrompts implements InitPrompts {
  public readonly calls: Array<{ readonly method: keyof InitPrompts; readonly input: unknown }> =
    [];
  private readonly script: {
    readonly resume?: boolean;
    readonly sourcePaths?: readonly string[];
    readonly editHandoff?: 'edit_then_return' | 'approve_now' | 'reject' | 'exit_init';
    readonly confirmSummary?: boolean;
  };
  constructor(script: ScriptedInitPrompts['script'] = {}) {
    this.script = script;
  }
  async askResume(input: { readonly nextStepLabel: string }): Promise<boolean> {
    this.calls.push({ method: 'askResume', input });
    return this.script.resume ?? true;
  }
  async askSourcePaths(input: {
    readonly existing: readonly string[];
  }): Promise<readonly string[]> {
    this.calls.push({ method: 'askSourcePaths', input });
    if (this.script.sourcePaths !== undefined) return this.script.sourcePaths;
    return input.existing.length > 0 ? input.existing : ['/tmp/cv.pdf'];
  }
  async askEditHandoff(input: {
    readonly draftProfileVersionId: number;
    readonly warnings: readonly string[];
  }): Promise<'edit_then_return' | 'approve_now' | 'reject' | 'exit_init'> {
    this.calls.push({ method: 'askEditHandoff', input });
    return this.script.editHandoff ?? 'approve_now';
  }
  async confirmSummary(input: {
    readonly ready: boolean;
    readonly nextStep: string | null;
  }): Promise<boolean> {
    this.calls.push({ method: 'confirmSummary', input });
    return this.script.confirmSummary ?? true;
  }
}
