import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { JobListRow, RunListRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Route as rootRoute } from './__root';

// Dashboard (`/`). Renders last-run status card + top-5 scored jobs,
// fetched via TanStack Query against the typed sidecar API client.
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});

// `JobListRow` is a discriminated union on `state`; the Dashboard only ever
// asks the sidecar for `state: 'scored'`, so we narrow at the boundary.
type ScoredJobRow = Extract<JobListRow, { state: 'scored' }>;

function Dashboard() {
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api.listRuns(5) });
  const jobs = useQuery({
    queryKey: ['jobs', 'scored'],
    queryFn: () => api.listJobs({ state: 'scored', limit: 5 }),
  });

  // Narrow the discriminated union to the `scored` variant for rendering.
  const scoredJobs: readonly ScoredJobRow[] =
    jobs.data?.jobs.filter((j): j is ScoredJobRow => j.state === 'scored') ?? [];
  const firstRun = runs.data?.runs[0];

  return (
    <div className="p-8 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Button asChild>
          <Link to="/pipeline">Run pipeline →</Link>
        </Button>
      </header>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">Last run</h2>
        {runs.data === undefined ? (
          <p className="text-zinc-500">loading…</p>
        ) : firstRun === undefined ? (
          <p className="text-zinc-500">No runs yet. Click "Run pipeline" to start.</p>
        ) : (
          <RunCard run={firstRun} />
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">Top scored jobs</h2>
        {jobs.data === undefined ? (
          <p className="text-zinc-500">loading…</p>
        ) : scoredJobs.length === 0 ? (
          <p className="text-zinc-500">No scored jobs yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-card">
            {scoredJobs.map((job) => (
              <li key={job.id} className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{job.title ?? '(untitled)'}</div>
                  <div className="text-sm text-zinc-400">
                    {(job.company ?? '(unknown)') + ' · ' + (job.location ?? '(unknown)')}
                  </div>
                </div>
                <div className="text-2xl font-mono">{job.overallScore}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunCard({ run }: { run: RunListRow }) {
  return (
    <div className="rounded border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-sm">{run.id}</div>
          <div className="text-sm text-zinc-400">started {run.startTimestamp}</div>
        </div>
        <span className="rounded bg-zinc-800 px-2 py-1 text-xs">{run.status}</span>
      </div>
      <div className="mt-2 text-sm">Scored <strong>{run.jobsScored}</strong> jobs</div>
    </div>
  );
}
