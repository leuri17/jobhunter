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
 * make the direct `toast.add(...)` / `<ApiErrorDialog />` call. When
 * you add an error code with a documented user action, register it in
 * `ACTION_REQUIRED_ERROR_CODES` and give it guidance copy below.
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

/**
 * Sidecar error codes that have a documented user action. Failures
 * carrying one of these codes are dialog-tier regardless of where
 * they occur: the user must act before retrying makes sense.
 */
export const ACTION_REQUIRED_ERROR_CODES = ['openai_unavailable'] as const;

export type ActionRequiredErrorCode = (typeof ACTION_REQUIRED_ERROR_CODES)[number];

/** Plain-language remediation shown inside an `<ApiErrorDialog />`. */
export interface ActionGuidance {
  /** What the user should do, in their words. */
  readonly message: string;
  /** Label for the button that performs the action. */
  readonly actionLabel: string;
}

const ACTION_GUIDANCE: Readonly<Record<ActionRequiredErrorCode, ActionGuidance>> = {
  openai_unavailable: {
    message: 'Add your OpenAI API key in Settings, under AI Provider.',
    actionLabel: 'Open settings',
  },
};

/** Whether the error carries one of the documented action-required codes. */
export function isActionRequiredError(error: ApiError): boolean {
  return (ACTION_REQUIRED_ERROR_CODES as readonly string[]).includes(error.code);
}

/**
 * Guidance copy for an error, or `null` when the code has no
 * documented user action (the dialog then shows detail only).
 */
export function actionGuidanceFor(error: ApiError): ActionGuidance | null {
  return isActionRequiredError(error)
    ? ACTION_GUIDANCE[error.code as ActionRequiredErrorCode]
    : null;
}
