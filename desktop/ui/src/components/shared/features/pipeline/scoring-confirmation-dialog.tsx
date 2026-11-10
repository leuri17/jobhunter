// The cost-gate decision dialog: the run paused after filtering and
// waits on `api.decideScoring`. Numbers are shown plainly; both
// choices record a real decision (there is no cancel — the run stays
// paused until one is made).

import { CoinsIcon } from 'lucide-react';
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

interface ScoringConfirmationDialogProps {
  readonly open: boolean;
  readonly jobsDiscovered: number;
  readonly newOpenAIRequests: number;
  readonly model: string | undefined;
  readonly deciding: boolean;
  readonly onScore: () => void;
  readonly onSkip: () => void;
  /** Escape / programmatic close — the gate stays open, the banner offers a way back. */
  readonly onDismiss: () => void;
}

export function ScoringConfirmationDialog({
  open,
  jobsDiscovered,
  newOpenAIRequests,
  model,
  deciding,
  onScore,
  onSkip,
  onDismiss,
}: ScoringConfirmationDialogProps) {
  const requestsLabel = `${newOpenAIRequests} new OpenAI ${newOpenAIRequests === 1 ? 'request' : 'requests'}`;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss();
      }}
    >
      <AlertDialogContent size="sm" data-testid="scoring-confirmation-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-primary/10 text-primary">
            <CoinsIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Score these jobs now?</AlertDialogTitle>
          <AlertDialogDescription>
            {jobsDiscovered} {jobsDiscovered === 1 ? 'job is' : 'jobs are'} ready to score ·{' '}
            {requestsLabel}.
            {model !== undefined && (
              <>
                {' '}
                Scoring runs <span className="font-mono">{model}</span>.
              </>
            )}{' '}
            Skip and the run finishes unscored.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" disabled={deciding} onClick={() => onSkip()}>
            Skip scoring
          </AlertDialogCancel>
          <AlertDialogAction disabled={deciding} onClick={() => onScore()}>
            {deciding ? 'Recording…' : 'Score now'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
