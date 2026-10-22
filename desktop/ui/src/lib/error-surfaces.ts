import type { ApiError } from './api';

/**
 * Severity → surface decision rule for showing errors to the user
 * (issue #200). One error, one expected place — pick the surface by
 * what the user must do about it, not by which component failed:
 *
 * | Severity                          | Surface       | Example                          |
 * |-----------------------------------|---------------|----------------------------------|
 * | Recoverable, no action needed     | toast         | Save succeeded; stream hiccup    |
 * | User must do something            | dialog        | `openai_unavailable` → set key   |
 * | Route-level crash                 | ErrorBoundary | Unhandled render throw           |
 * | Ambient, ongoing                  | banner        | Sidecar offline                  |
 *
 * - **Toast** wins the common case; a modal per error would be noise.
 *   If the app recovers on its own (or the user need not decide
 *   anything), fire `toast.add({ type: 'error', ... })` and move on.
 * - **Dialog** is earned when the user must make a decision or take a
 *   documented action. That includes failures of actions the user
 *   explicitly initiated (save settings, run pipeline, cancel run):
 *   the action did not happen, so they must retry, fix, or abandon —
 *   an auto-dismissing toast would let them believe it succeeded.
 *   Render failures through `<ApiErrorDialog />`.
 * - **ErrorBoundary** (`components/shared/ui/error-boundary.tsx`) is
 *   wired at the root layout and needs no per-call-site work.
 * - **Banner** covers ambient, ongoing conditions the user should
 *   keep seeing while they last (e.g. the sidecar-offline
 *   `<SidecarBanner />`; its wiring is tracked separately). Inline
 *   red boxes are not a surface — route them to one of the four.
 *
 * This module is guidance data, not a framework: call sites still
 * make the direct `toast.add(...)` / `<ApiErrorDialog />` call. Two
 * registries, one lookup rule: code guidance wins (it is the more
 * specific diagnosis), the failed action's guidance is the fallback
 * for errors whose code has none. Add to `CODE_GUIDANCE` when an
 * error code comes with a documented action, and to
 * `ACTION_GUIDANCE` when a user action does.
 */

export type ErrorSurface = 'toast' | 'dialog' | 'error-boundary' | 'banner';

export type ErrorSeverity = 'transient' | 'action-required' | 'route-crash' | 'ambient';

/** Canonical severity → surface mapping. Keep in sync with the table above. */
export const SURFACE_BY_SEVERITY: Readonly<Record<ErrorSeverity, ErrorSurface>> = {
  transient: 'toast',
  'action-required': 'dialog',
  'route-crash': 'error-boundary',
  ambient: 'banner',
};

/** Plain-language remediation shown inside an `<ApiErrorDialog />`. */
export interface ActionGuidance {
  /** What the user should do, in their words. */
  readonly message: string;
  /** Label for the button that performs the action. */
  readonly actionLabel: string;
}

/**
 * Registry of sidecar error codes with a documented user action.
 * Failures carrying one of these codes are dialog-tier regardless of
 * where they occur: the user must act before retrying makes sense.
 * Codes and their guidance live in one place so they cannot drift.
 */
const CODE_GUIDANCE = {
  openai_unavailable: {
    message: 'Add your OpenAI API key in Settings, under AI Provider.',
    actionLabel: 'Open settings',
  },
} as const satisfies Record<string, ActionGuidance>;

export type ActionRequiredErrorCode = keyof typeof CODE_GUIDANCE;

/** Codes with a documented user action — the registry's keys. */
export const ACTION_REQUIRED_ERROR_CODES: readonly ActionRequiredErrorCode[] = Object.keys(
  CODE_GUIDANCE,
) as ActionRequiredErrorCode[];

/** Whether the error carries one of the documented action-required codes. */
export function isActionRequiredError(error: ApiError): boolean {
  return typeof CODE_GUIDANCE[error.code as ActionRequiredErrorCode] !== 'undefined';
}

/**
 * Guidance copy for an error, or `null` when the code has no
 * documented user action (the dialog then shows its generic help).
 */
export function actionGuidanceFor(error: ApiError): ActionGuidance | null {
  return CODE_GUIDANCE[error.code as ActionRequiredErrorCode] ?? null;
}

/**
 * Guidance for failures of a specific user action. Any error can fail
 * these, so they are keyed by the action rather than by an error
 * code, and the route passes them explicitly. A code with documented
 * guidance still wins — a save that fails because the key is missing
 * should tell the user to add the key, not to retry.
 */
export const ACTION_GUIDANCE = {
  settingsSave: {
    message: 'Nothing was saved. Your edits are still in the form.',
    actionLabel: 'Retry saving',
  },
} as const satisfies Record<string, ActionGuidance>;

/**
 * Technical trace for a failed request (status, code, message), one
 * per line, formatted for pasting straight into a bug report. The
 * dialog keeps this behind its "More info" disclosure; plain-language
 * copy is the default view.
 */
export function formatErrorTrace(error: ApiError): string {
  return `status: ${error.status}\ncode: ${error.code}\nmessage: ${error.message}`;
}
