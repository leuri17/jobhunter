import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? elapsed : 0;
}

export interface ProfileFooterProps {
  isDirty: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  invalid: boolean;
  blockingCount: number;
  warningCount: number;
  extracting: boolean;
  apiKeyConfigured: boolean;
  mode: 'dirty' | 'draft' | 'idle';
  onSave: () => void;
  onDiscard: () => void;
  onRunExtraction: () => void;
  onApprove: () => void;
  onGoToConflicts: () => void;
}

export function ProfileFooter(props: ProfileFooterProps) {
  const {
    isDirty,
    canSubmit,
    isSubmitting,
    invalid,
    blockingCount,
    warningCount,
    extracting,
    apiKeyConfigured,
    mode,
    onSave,
    onDiscard,
    onRunExtraction,
    onApprove,
    onGoToConflicts,
  } = props;
  const [confirmExtraction, setConfirmExtraction] = useState(false);
  const extractingSeconds = useElapsedSeconds(extracting);

  return (
    <div className="sticky bottom-0 flex items-center justify-between gap-3 bg-background/95 p-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {extracting ? (
          <>
            <Spinner className="size-4" />
            <span>Running extraction — {extractingSeconds}s elapsed…</span>
          </>
        ) : blockingCount > 0 ? (
          <>
            <TriangleAlert className="size-4 text-destructive" />
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-destructive"
              onClick={onGoToConflicts}
            >
              {blockingCount} blocking {blockingCount === 1 ? 'conflict' : 'conflicts'} must be
              resolved before approving
            </Button>
          </>
        ) : invalid ? (
          <span className="text-destructive">Some fields need attention before saving</span>
        ) : isDirty ? (
          <span>Unsaved changes — saving creates a new draft version</span>
        ) : (
          <>
            <CircleCheck className="size-4 text-emerald-500" />
            <span>Profile reconciled. {warningCount} warnings.</span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {isDirty && (
          <Button variant="ghost" onClick={onDiscard}>
            Discard changes
          </Button>
        )}
        {apiKeyConfigured ? (
          <>
            <Button
              variant="outline"
              disabled={extracting}
              onClick={() => setConfirmExtraction(true)}
            >
              {extracting ? (
                <>
                  <Spinner className="size-4" /> Extracting…
                </>
              ) : (
                'Run extraction'
              )}
            </Button>
            <AlertDialog open={confirmExtraction} onOpenChange={setConfirmExtraction}>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Run extraction?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your source documents will be sent to your AI provider using your API key. This
                    consumes tokens and typically takes one to a few minutes.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setConfirmExtraction(false);
                      onRunExtraction();
                    }}
                  >
                    Run extraction
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Link
            to="/settings"
            className="text-primary underline-offset-4 hover:underline"
            aria-label="Add your AI provider API key in Settings"
          >
            Add your AI provider API key in Settings
          </Link>
        )}
        {mode === 'dirty' ? (
          <Button onClick={onSave} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save draft'}
          </Button>
        ) : (
          <Button onClick={onApprove} disabled={mode === 'idle' || blockingCount > 0}>
            Approve &amp; publish
          </Button>
        )}
      </div>
    </div>
  );
}
