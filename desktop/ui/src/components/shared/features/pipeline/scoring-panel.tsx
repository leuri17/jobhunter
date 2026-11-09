// Scoring plan, read-only, plus the cost-gate toggle the next run
// starts with. The plan mirrors Settings → AI provider → Job scoring;
// the toggle persists to localStorage and is passed to
// `api.runPipeline` when the user presses Run.

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import type { ReactNode } from 'react';
import type { OperationalConfig } from '@/lib/types';

interface ScoringPanelProps {
  readonly jobScoring: OperationalConfig['openai']['jobScoring'] | undefined;
  /** Query settled with an error — say so instead of skeletoning forever. */
  readonly failed: boolean;
  readonly gateOn: boolean;
  readonly onGateChange: (on: boolean) => void;
  /** While a run is in flight the gate was already decided at start; lock it. */
  readonly gateDisabled: boolean;
}

function SpecRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function ScoringPanel({
  jobScoring,
  failed,
  gateOn,
  onGateChange,
  gateDisabled,
}: ScoringPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring plan</CardTitle>
        <CardDescription>
          How jobs get scored after filtering. Change the model in Settings, under AI provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        {jobScoring === undefined ? (
          failed ? (
            <p className="text-sm text-muted-foreground">Couldn't load the scoring plan.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          )
        ) : (
          <dl className="flex flex-col gap-3">
            <SpecRow label="Model" value={<span className="font-mono">{jobScoring.model}</span>} />
            <SpecRow label="Reasoning effort" value={jobScoring.reasoningEffort} />
            <SpecRow label="Concurrency" value={`${jobScoring.concurrency} parallel requests`} />
          </dl>
        )}

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/40 p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              Ask before scoring
              <Badge variant="secondary">Cost gate</Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Pause the run after filtering, show how many OpenAI requests it needs, and wait for
              your OK before spending credits. Applies the next time you start a run.
            </p>
          </div>
          <Switch
            checked={gateOn}
            onCheckedChange={(checked) => onGateChange(checked)}
            disabled={gateDisabled}
            aria-label="Ask before scoring"
          />
        </div>
      </CardContent>
    </Card>
  );
}
