import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Route as rootRoute } from './__root';

// Runs (`/runs`). Renders a table of past pipeline runs (id / status /
// start time / jobs scored) with a click-to-open side drawer showing the
// full `RunShowPayload` JSON for the selected run. Data is fetched
// through TanStack Query against the typed sidecar API client.
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs',
  component: RunsPage,
});

function RunsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ['runs', 'all'], queryFn: () => api.listRuns(50) });
  const detail = useQuery({
    queryKey: ['run', selected],
    queryFn: () => api.getRun(selected as unknown as string),
    enabled: selected !== null,
  });

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">Runs</h1>
      {runs.data === undefined ? (
        <p className="text-zinc-500">loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="py-2">ID</th>
              <th>Status</th>
              <th>Started</th>
              <th>Jobs scored</th>
            </tr>
          </thead>
          <tbody>
            {runs.data.runs.map((r) => (
              <tr
                key={r.id}
                className="border-t border-border cursor-pointer hover:bg-card/50"
                onClick={() => setSelected(r.id)}
              >
                <td className="py-2 font-mono">{r.id}</td>
                <td>{r.status}</td>
                <td>{r.startTimestamp}</td>
                <td>{r.jobsScored}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected !== null && (
        <div className="fixed inset-y-0 right-0 w-1/2 bg-zinc-900 border-l border-border p-6 overflow-auto">
          <button className="mb-4 text-sm" onClick={() => setSelected(null)}>
            close
          </button>
          <pre className="text-xs">{JSON.stringify(detail.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
