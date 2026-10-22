import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api';
import { actionGuidanceFor } from '@/lib/error-surfaces';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ApiErrorDialogProps {
  /** The failed request's error; `null` keeps the dialog closed. */
  readonly error: ApiError | null;
  readonly title: string;
  /** Called when the dialog is dismissed (Close button, X, Escape, backdrop). */
  readonly onDismiss: () => void;
  /**
   * Performs the documented action for action-required error codes
   * (see `lib/error-surfaces.ts`). Only rendered when the error maps
   * to guidance; safe to pass unconditionally from call sites.
   */
  readonly onAction?: (() => void) | undefined;
  /** Context copy rendered above the error detail, e.g. "Nothing was saved." */
  readonly children?: ReactNode;
}

/**
 * Dialog surface for a failed `ApiError` the user must act on (issue
 * #200's action-required tier). Shows the problem plainly, the
 * raw status/code/message for diagnosis, and — for codes with a
 * documented action — the guidance copy and the button that performs
 * it. Use for failures of user-initiated actions; transient errors
 * go through the toast instead.
 */
export function ApiErrorDialog({
  error,
  title,
  onDismiss,
  onAction,
  children,
}: ApiErrorDialogProps) {
  const guidance = error !== null ? actionGuidanceFor(error) : null;

  return (
    <Dialog
      open={error !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent data-testid="api-error-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 px-4">
          {children}
          {error !== null && (
            <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
              {error.status} {error.code} — {error.message}
            </pre>
          )}
          {guidance !== null && <p className="text-sm">{guidance.message}</p>}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          {guidance !== null && onAction !== undefined && (
            <Button data-testid="api-error-dialog-action" onClick={onAction}>
              {guidance.actionLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
