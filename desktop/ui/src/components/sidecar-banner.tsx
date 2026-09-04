import { Button } from '@/components/ui/button';
import type { SidecarReachability } from '@/lib/sidecar-reachability';

export interface SidecarBannerProps {
  readonly state: SidecarReachability;
}

/**
 * Blocking banner that surfaces when the sidecar URL resolver fell back to
 * the last-resort default port AND a `/api/health` ping fails. Renders above
 * the sidebar/content shell so every route sees it.
 */
export function SidecarBanner({ state }: SidecarBannerProps) {
  if (!state.isFallback || state.status === 'reachable' || state.status === 'pending') {
    return null;
  }
  const port =
    state.url === null
      ? 14231
      : (() => {
          try {
            return new URL(state.url).port || 'unknown';
          } catch {
            return 'unknown';
          }
        })();
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="sidecar-banner"
      className="flex items-center justify-between gap-4 border-b border-red-900 bg-red-950 px-6 py-3 text-sm text-red-100"
    >
      <div className="flex-1">
        <strong className="font-semibold">Couldn't reach the sidecar.</strong>
        <span className="ml-2 text-red-200">
          No server is listening on port {port}. Is the JobHunter desktop app running?
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => state.retry()}
        data-testid="sidecar-banner-retry"
      >
        Retry
      </Button>
    </div>
  );
}
