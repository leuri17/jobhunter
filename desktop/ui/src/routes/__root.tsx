import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { StatusPill } from '@/components/status-pill';
import { SidecarBanner } from '@/components/sidecar-banner';
import { useSidecarReachability } from '@/lib/sidecar-reachability';

// Root layout: persistent sidebar + content area. StatusPill surfaces
// periodic /api/health from the queryClient; SidecarBanner is a blocking
// overlay that fires when the sidecar URL resolver falls back to a port
// nothing is bound to (issue #31 / audit B4-B-L4.6).
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const reachability = useSidecarReachability();
  return (
    <div className="flex h-screen flex-col">
      <SidecarBanner state={reachability} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 border-r border-border bg-card p-4 flex flex-col">
          <h1 className="text-xl font-bold mb-4">JobHunter</h1>
          <nav className="flex flex-col gap-2 text-sm">
            <Link to="/" className="hover:underline" activeProps={{ className: 'font-semibold' }}>
              Dashboard
            </Link>
            <Link
              to="/jobs"
              className="hover:underline"
              activeProps={{ className: 'font-semibold' }}
            >
              Jobs
            </Link>
            <Link
              to="/pipeline"
              className="hover:underline"
              activeProps={{ className: 'font-semibold' }}
            >
              Pipeline
            </Link>
            <Link
              to="/runs"
              className="hover:underline"
              activeProps={{ className: 'font-semibold' }}
            >
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
    </div>
  );
}
