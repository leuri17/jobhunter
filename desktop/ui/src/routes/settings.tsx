import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Route as rootRoute } from './__root';

// Settings (`/settings`). Surfaces:
//   - the resolved operational config (search config form + filter toggles
//     are deferred; v1 shows the raw JSON for transparency)
//   - a disabled OpenAI key field (key is read from the `OPENAI_API_KEY`
//     env var in v1; OS-keychain storage lands in a follow-up per spec §5.2)
//   - the resolved filesystem paths returned by `/api/paths`
//   - a stub "Re-run setup wizard" CTA (wizard flow is not yet wired in v1)
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

function SettingsPage() {
  const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
  const paths = useQuery({ queryKey: ['paths'], queryFn: api.paths });
  const [openaiKey] = useState('');

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold">Settings</h1>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">
          Search configuration
        </h2>
        {config.data === undefined ? (
          <p>loading…</p>
        ) : (
          <pre className="rounded border border-border bg-card p-4 text-xs overflow-auto">
            {JSON.stringify(config.data.config, null, 2)}
          </pre>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">
          OpenAI key
        </h2>
        <p className="text-sm text-zinc-400 mb-2">
          In v1 the key is read from the <code>OPENAI_API_KEY</code> environment
          variable. OS-keychain storage lands in a follow-up.
        </p>
        <input
          type="password"
          value={openaiKey}
          placeholder="(not editable in v1)"
          disabled
          className="rounded border border-border bg-card px-2 py-1 text-sm w-96"
        />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">
          Resolved paths
        </h2>
        {paths.data === undefined ? (
          <p>loading…</p>
        ) : (
          <ul className="text-sm font-mono space-y-1">
            {Object.entries(paths.data.paths).map(([k, v]) => (
              <li key={k}>
                <span className="text-zinc-400">{k}:</span> {v}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button variant="outline">Re-run setup wizard</Button>
    </div>
  );
}
