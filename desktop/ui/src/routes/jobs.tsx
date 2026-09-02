import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { JobListRow, JobListState } from '@/lib/types';
import { Route as rootRoute } from './__root';

// Jobs (`/jobs`). Renders a filterable job list with state chips,
// optional `minScore` filter, a side drawer for the selected job's
// detail payload, and a per-row "reeval" button that triggers
// reevaluation scoped to that job. Data is fetched through TanStack
// Query against the typed sidecar API client.
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs',
  component: JobsPage,
});

// State filter chips. Subset of `JobListState` — partial/filter-error/
// scoring-error rows are rendered as their inspection views in Phase F;
// we expose the six high-level states users care about most.
const STATE_CHIPS: readonly JobListState[] = [
  'all',
  'scored',
  'accepted',
  'rejected',
  'unscored',
  'failed',
];
type StateChip = (typeof STATE_CHIPS)[number];

// Render-time projection of the `JobListRow` discriminated union.
// The union has genuinely different shapes per variant: only `scored`
// carries `overallScore`, and `failed`/`partial` rows don't have
// title/company/location at all. We project to a flat nullable shape
// so the table renders uniformly, returning `null` for variants that
// don't fit (which we then filter out before rendering).
interface JobRow {
  readonly id: string;
  readonly internalId: number;
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly score: number | null;
}

function toRow(j: JobListRow): JobRow | null {
  switch (j.state) {
    case 'scored':
      return {
        id: j.id,
        internalId: j.internalId,
        title: j.title,
        company: j.company,
        location: j.location,
        score: j.overallScore,
      };
    case 'accepted':
    case 'rejected':
    case 'unscored':
    case 'all':
      return {
        id: j.id,
        internalId: j.internalId,
        title: j.title,
        company: j.company,
        location: j.location,
        score: null,
      };
    case 'partial':
      // Partial-extraction rows use `availableTitle` (and have no
      // company/location). Not yet supported in the table view.
      return null;
    case 'filter-errors':
    case 'scoring-errors':
      // Error-state rows lack a `location` field. Not yet supported
      // in the table view; surfaced through inspection panels in Phase F.
      return null;
    case 'failed':
      // Search-level errors have no job identity (`errorId`, not `id`).
      return null;
  }
}

function JobsPage() {
  const [state, setState] = useState<StateChip>('scored');
  const [minScore, setMinScore] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ['jobs', state, minScore],
    queryFn: () =>
      api.listJobs({
        state,
        limit: 100,
        ...(minScore !== '' ? { minScore: Number(minScore) } : {}),
      }),
  });
  const detail = useQuery({
    queryKey: ['job', selectedId],
    queryFn: () => api.getJob(selectedId as string),
    enabled: selectedId !== null,
  });
  const reeval = useMutation({
    mutationFn: (jobId: number) =>
      api.reevaluateJobs({ scope: 'job', jobId, confirmScoring: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">Jobs</h1>

      <div className="flex gap-2 flex-wrap items-center">
        {STATE_CHIPS.map((s) => (
          <button
            key={s}
            onClick={() => setState(s)}
            className={`rounded-full border border-border px-3 py-1 text-sm ${
              state === s ? 'bg-primary text-primary-foreground' : 'bg-card'
            }`}
          >
            {s}
          </button>
        ))}
        <input
          type="number"
          placeholder="min score"
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          className="ml-4 rounded border border-border bg-card px-2 py-1 text-sm"
        />
      </div>

      {jobs.data === undefined ? (
        <p className="text-zinc-500">loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="py-2">Title</th>
              <th>Company</th>
              <th>Location</th>
              <th>Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.jobs.map((j) => {
              const row = toRow(j);
              if (row === null) return null;
              return (
                <tr
                  key={row.id}
                  className="border-t border-border hover:bg-card/50 cursor-pointer"
                  onClick={() => setSelectedId(row.id)}
                >
                  <td className="py-2">{row.title ?? '(untitled)'}</td>
                  <td>{row.company ?? '(unknown)'}</td>
                  <td>{row.location ?? '(unknown)'}</td>
                  <td className="font-mono">{row.score ?? '—'}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        reeval.mutate(row.internalId);
                      }}
                    >
                      reeval
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {selectedId !== null && (
        <div className="fixed inset-y-0 right-0 w-1/2 bg-zinc-900 border-l border-border p-6 overflow-auto">
          <button
            className="mb-4 text-sm"
            onClick={() => setSelectedId(null)}
          >
            close
          </button>
          <pre className="text-xs">{JSON.stringify(detail.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}