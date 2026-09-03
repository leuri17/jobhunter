import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { StatusPill } from '@/components/status-pill';

// Root layout: persistent sidebar + content area.
// StatusPill is a placeholder replaced in D5 (SSE hook + shared components).
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-screen">
      <aside className="w-56 border-r border-border bg-card p-4 flex flex-col">
        <h1 className="text-xl font-bold mb-4">JobHunter</h1>
        <nav className="flex flex-col gap-2 text-sm">
          <Link to="/" className="hover:underline" activeProps={{ className: 'font-semibold' }}>
            Dashboard
          </Link>
          <Link to="/jobs" className="hover:underline" activeProps={{ className: 'font-semibold' }}>
            Jobs
          </Link>
          <Link
            to="/pipeline"
            className="hover:underline"
            activeProps={{ className: 'font-semibold' }}
          >
            Pipeline
          </Link>
          <Link to="/runs" className="hover:underline" activeProps={{ className: 'font-semibold' }}>
            Runs
          </Link>
          <Link
            to="/profile"
            className="hover:underline"
            activeProps={{ className: 'font-semibold' }}
          >
            Profile
          </Link>
          <Link
            to="/settings"
            className="hover:underline"
            activeProps={{ className: 'font-semibold' }}
          >
            Settings
          </Link>
        </nav>
        <div className="mt-auto pt-4">
          <StatusPill />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
