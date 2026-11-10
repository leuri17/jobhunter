// Configured search matrix, read-only: the cross product of search
// queries × locations that a run will execute, with the geo id as a
// mono badge per row and best-effort live status during a run. Editing
// happens in Settings — the backend has no per-row controls.

import { Link } from '@tanstack/react-router';
import { CheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DATE_POSTED_CHOICES, WORKPLACE_TYPE_LABELS } from '@jobhunter/core/search';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from 'cn';
import type { OperationalConfig } from '@/lib/types';
import { searchRowKey, type RunView } from './derive-run-view';

interface SearchMatrixProps {
  readonly search: OperationalConfig['search'] | undefined;
  readonly view: RunView;
  /** Query settled with an error — say so instead of skeletoning forever. */
  readonly failed: boolean;
}

interface MatrixRow {
  readonly key: string;
  readonly query: string;
  readonly locationName: string;
  readonly geoId: string;
}

function buildRows(search: OperationalConfig['search']): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const query of search.searchQueries) {
    for (const location of search.locations) {
      rows.push({
        key: searchRowKey(query, location.name),
        query,
        locationName: location.name,
        geoId: location.geoId,
      });
    }
  }
  return rows;
}

type RowStatus = 'queued' | 'running' | 'done';

function RowStatusBadge({ status }: { readonly status: RowStatus }) {
  if (status === 'running') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-400">
        <span
          className="size-1.5 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none"
          aria-hidden="true"
        />
        Running
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CheckIcon className="size-3.5" aria-hidden="true" />
        Done
      </span>
    );
  }
  return <span className="shrink-0 text-xs text-muted-foreground/70">Queued</span>;
}

export function SearchMatrix({ search, view, failed }: SearchMatrixProps) {
  const rows = search !== undefined ? buildRows(search) : [];

  function rowStatus(row: MatrixRow): RowStatus | null {
    if (!view.runStarted) return null;
    if (view.startedSearchKeys.includes(row.key)) {
      return row.key === view.lastSearchKey && view.stages.discovery === 'active'
        ? 'running'
        : 'done';
    }
    return 'queued';
  }

  let body: ReactNode;
  if (search === undefined) {
    body = failed ? (
      <p className="text-sm text-muted-foreground">Couldn't load the search configuration.</p>
    ) : (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-6">
        <p className="text-sm font-medium">No searches configured yet.</p>
        <p className="text-sm text-muted-foreground">
          Add at least one search query and one location in Settings, then run the pipeline from
          here.
        </p>
        <Link to="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Open Settings
        </Link>
      </div>
    );
  } else {
    const freshness =
      DATE_POSTED_CHOICES.find((c) => c.value === search.datePosted)?.label ?? 'Any time';
    const workplaces = search.workplaceTypes.map((t) => WORKPLACE_TYPE_LABELS[t]).join(', ');
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Applies to every search: posted within {freshness.toLowerCase()}
          {workplaces !== '' ? ` · ${workplaces}` : ''}
        </p>
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((row) => {
            const status = rowStatus(row);
            return (
              <li
                key={row.key}
                className={cn(
                  'flex items-center justify-between gap-3 py-2.5',
                  status === 'running' && 'text-foreground',
                )}
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{row.query}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">in</span>
                  <span className="truncate text-sm text-muted-foreground">{row.locationName}</span>
                  <Badge
                    variant="secondary"
                    className="shrink-0 font-mono text-[10px] tracking-tight"
                  >
                    geo {row.geoId}
                  </Badge>
                </div>
                {status !== null && <RowStatusBadge status={status} />}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search matrix</CardTitle>
        <CardDescription>
          Every query × location pair the next run will execute, in order.
        </CardDescription>
        <CardAction>
          <Link to="/settings" className="text-sm text-primary underline-offset-4 hover:underline">
            Edit in Settings
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
