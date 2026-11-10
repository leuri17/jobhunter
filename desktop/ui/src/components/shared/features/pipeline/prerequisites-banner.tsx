// Prerequisites banner: the three persisted gates a run needs (OpenAI
// key, approved profile, active filter) plus the config hash. Missing
// gates link to where they're fixed — except the filter, which has no
// in-app management yet (issue #301) and says so instead of linking.

import { Link } from '@tanstack/react-router';
import { CheckIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from 'cn';
import type { PipelinePrerequisitesResponse } from '@/lib/types';

interface PrerequisitesBannerProps {
  readonly data: PipelinePrerequisitesResponse | undefined;
  /** Query settled with an error — say so instead of skeletoning forever. */
  readonly failed: boolean;
}

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

export function PrerequisitesBanner({ data, failed }: PrerequisitesBannerProps) {
  if (data === undefined) {
    return (
      <section
        aria-label="Prerequisites"
        className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      >
        <span className="text-sm font-medium">Prerequisites</span>
        {failed ? (
          <p className="text-sm text-muted-foreground">
            Couldn't check prerequisites. Starting a run re-checks them.
          </p>
        ) : (
          <div className="flex flex-wrap gap-6">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
          </div>
        )}
      </section>
    );
  }

  const missing = [
    !data.openaiKeyConfigured,
    data.activeProfile === null,
    data.activeFilter === null,
  ].filter(Boolean).length;

  const allClear = missing === 0;

  return (
    <section
      aria-label="Prerequisites"
      className={cn(
        'rounded-xl p-4 ring-1',
        allClear ? 'bg-card ring-foreground/10' : 'bg-amber-500/5 ring-amber-500/40',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Prerequisites</span>
        <Badge
          variant="outline"
          className={cn(
            allClear
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-400',
          )}
        >
          {allClear ? 'All gates clear' : `${missing} missing`}
        </Badge>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
        <div className="flex items-start gap-2 text-sm">
          {data.openaiKeyConfigured ? (
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
          ) : (
            <XIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          )}
          <span className="text-muted-foreground">
            OpenAI API key:{' '}
            {data.openaiKeyConfigured ? (
              <span className="text-foreground">configured</span>
            ) : (
              <span className="text-foreground">
                missing — add one in{' '}
                <Link to="/settings" className="underline underline-offset-4 hover:text-primary">
                  Settings
                </Link>
              </span>
            )}
          </span>
        </div>

        <div className="flex items-start gap-2 text-sm">
          {data.activeProfile !== null ? (
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
          ) : (
            <XIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          )}
          <span className="text-muted-foreground">
            Active profile:{' '}
            {data.activeProfile !== null ? (
              <span
                className="font-mono text-xs text-foreground"
                title={data.activeProfile.contentHash}
              >
                {shortHash(data.activeProfile.contentHash)}
              </span>
            ) : (
              <span className="text-foreground">
                none — approve one on the{' '}
                <Link to="/profile" className="underline underline-offset-4 hover:text-primary">
                  Profile
                </Link>{' '}
                page
              </span>
            )}
          </span>
        </div>

        <div className="flex items-start gap-2 text-sm">
          {data.activeFilter !== null ? (
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
          ) : (
            <XIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          )}
          <span className="text-muted-foreground">
            Active filter:{' '}
            {data.activeFilter !== null ? (
              <span
                className="font-mono text-xs text-foreground"
                title={data.activeFilter.contentHash}
              >
                {shortHash(data.activeFilter.contentHash)}
              </span>
            ) : (
              <span className="text-foreground">
                none. Created during first-run setup; in-app filter management is tracked in issue
                #301.
              </span>
            )}
          </span>
        </div>
      </div>

      <p className="mt-3 font-mono text-xs text-muted-foreground/80" title={data.configHash}>
        config {shortHash(data.configHash)}…
      </p>
    </section>
  );
}
