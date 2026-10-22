import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '@/lib/api';
import type { ActionGuidance } from '@/lib/error-surfaces';
import { actionGuidanceFor, formatErrorTrace } from '@/lib/error-surfaces';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CheckIcon, ChevronRightIcon, CopyIcon, TriangleAlertIcon } from 'lucide-react';
import { cn } from 'cn';
import { Separator } from '@/components/ui/separator';
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item';

const DEFAULT_HELP = "It didn't go through. You can try again.";
const COPY_RESET_MS = 2000;

/**
 * Technical trace for the failed request, behind a closed-by-default
 * disclosure at the bottom of the dialog. Owns its own open/copy state
 * so both reset whenever the dialog moves to a new error.
 */
function ErrorTraceDisclosure({ error }: { readonly error: ApiError }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimeoutRef.current), []);

  async function copyTrace(): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatErrorTrace(error));
      setCopied(true);
      window.clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      // clipboard writes can fail (unfocused window, permissions);
      // leave the label as-is so the user can retry
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Item
        variant="outline"
        size="xs"
        className={cn('cursor-pointer text-muted-foreground', open && 'rounded-b-none')}
        render={<CollapsibleTrigger data-testid="api-error-dialog-trace-toggle" />}
      >
        <ItemContent>
          <ItemTitle>More info</ItemTitle>
        </ItemContent>
        <ItemActions>
          <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </ItemActions>
      </Item>

      <CollapsibleContent>
        <pre
          data-testid="api-error-dialog-trace"
          className="max-h-40 overflow-auto bg-background/50 p-2 text-xs whitespace-pre-wrap text-muted-foreground"
        >
          {formatErrorTrace(error)}
        </pre>
        <div className="flex flex-col max-h-40 overflow-auto rounded-b-lg bg-background/50 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
          <Separator className="mb-2" />

          <Button
            variant="outline"
            size="sm"
            aria-live="polite"
            onClick={() => void copyTrace()}
            data-testid="api-error-dialog-copy"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy details'}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ApiErrorDialogProps {
  /** The failed request's error; `null` keeps the dialog closed. */
  readonly error: ApiError | null;
  readonly title: string;
  /** Called when the dialog is dismissed (footer Close, Escape, backdrop). */
  readonly onDismiss: () => void;
  /**
   * Performs the guidance's action. Only rendered when guidance is in
   * play — from the error's code or an explicit override — so it is
   * safe to pass unconditionally from call sites.
   */
  readonly onAction?: (() => void) | undefined;
  /**
   * Fallback guidance for a failed user action (see `ACTION_GUIDANCE`
   * in `lib/error-surfaces.ts`). Any error can fail an action like a
   * save, so the route names the action's guidance and it applies
   * whenever the error's code has no guidance of its own.
   */
  readonly guidance?: ActionGuidance | undefined;
}

export function ApiErrorDialog({
  error,
  title,
  onDismiss,
  onAction,
  guidance,
}: ApiErrorDialogProps) {
  const resolved = error !== null ? (actionGuidanceFor(error) ?? guidance ?? null) : null;
  const help = resolved !== null ? resolved.message : DEFAULT_HELP;

  return (
    <AlertDialog
      open={error !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <AlertDialogContent size="sm" data-testid="api-error-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/20 text-destructive">
            <TriangleAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{help}</AlertDialogDescription>
        </AlertDialogHeader>

        <Separator />

        {error !== null && <ErrorTraceDisclosure error={error} />}

        <AlertDialogFooter>
          <AlertDialogCancel variant="outline">Close</AlertDialogCancel>
          {resolved !== null && onAction !== undefined && (
            <AlertDialogAction data-testid="api-error-dialog-action" onClick={onAction}>
              {resolved.actionLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
