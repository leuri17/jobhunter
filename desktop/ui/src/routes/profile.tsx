import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { ProfileListEntry } from '@/lib/types';
import { Route as rootRoute } from './__root';

// Profile (`/profile`). Renders a sidebar list of persisted profile
// versions (draft / approved / rejected / superseded) with a detail
// pane for the selected version. The detail pane surfaces conflicts /
// warnings / overrides extracted by the sidecar and exposes Approve
// / Reject actions. Editing is intentionally not implemented yet:
// POST `/api/profile/:id/edit` returns 501 per B4-fix (interactive
// prompts aren't available over HTTP).
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: ProfilePage,
});

function ProfilePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.listProfiles(),
  });
  const detail = useQuery({
    queryKey: ['profile', selectedId],
    queryFn: () => api.getProfile(selectedId as unknown as string),
    enabled: selectedId !== null,
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.approveProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['profile', selectedId] });
    },
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.rejectProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['profile', selectedId] });
    },
  });

  return (
    <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
      <aside>
        <h1 className="text-2xl font-bold mb-4">Profile versions</h1>
        {list.data === undefined ? (
          <p className="text-zinc-500">loading…</p>
        ) : list.data.profiles.length === 0 ? (
          <p className="text-zinc-500">No profile versions yet.</p>
        ) : (
          <ul className="space-y-1">
            {list.data.profiles.map((p: ProfileListEntry) => (
              <li key={p.profileVersionId}>
                <button
                  onClick={() => setSelectedId(p.profileId)}
                  className={`w-full text-left rounded p-2 text-sm ${
                    selectedId === p.profileId
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-card'
                  }`}
                >
                  <div className="font-mono">{p.profileId}</div>
                  <div className="text-xs text-zinc-400">
                    {p.status}
                    {p.active ? ' · active' : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="md:col-span-2">
        {detail.data === undefined ? (
          <p className="text-zinc-500">Select a version.</p>
        ) : (
          <div className="space-y-4">
            <header className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="font-mono text-sm">{detail.data.profile.id}</div>
                <div className="text-xs text-zinc-400">
                  status: {detail.data.status}
                  {detail.data.active ? ' · active' : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    approve.mutate(detail.data?.profile.id as unknown as string)
                  }
                  disabled={detail.data.status !== 'draft' || approve.isPending}
                >
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    reject.mutate(detail.data?.profile.id as unknown as string)
                  }
                  disabled={detail.data.status !== 'draft' || reject.isPending}
                >
                  Reject
                </Button>
              </div>
            </header>

            {detail.data.warnings.length > 0 && (
              <section>
                <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">
                  Warnings ({detail.data.warnings.length})
                </h2>
                <ul className="rounded border border-amber-600/40 bg-amber-950/20 p-3 text-sm space-y-1">
                  {detail.data.warnings.map((w, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-mono text-amber-300">
                        {w.warningType}
                        {w.severity === 'blocking_conflict' ? ' (blocking)' : ''}
                        {w.fieldPath !== null ? ` @ ${w.fieldPath}` : ''}:
                      </span>{' '}
                      {w.message}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detail.data.conflicts.length > 0 && (
              <section>
                <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">
                  Conflicts ({detail.data.conflicts.length})
                </h2>
                <ul className="rounded border border-red-600/40 bg-red-950/20 p-3 text-sm space-y-1">
                  {detail.data.conflicts.map((c, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-mono text-red-300">
                        {c.conflictType} @ {c.affectedField}
                        {c.resolutionStatus !== 'unresolved'
                          ? ` (${c.resolutionStatus})`
                          : ''}:
                      </span>{' '}
                      {c.explanation ?? '(no explanation)'}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm uppercase tracking-wide text-zinc-400">
                  Profile JSON
                </h2>
                <span className="text-xs text-zinc-500">
                  Editing not implemented in v1 (POST /api/profile/:id/edit → 501)
                </span>
              </div>
              <pre className="rounded border border-border bg-card p-4 text-xs overflow-auto max-h-96">
                {JSON.stringify(detail.data.profile, null, 2)}
              </pre>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
