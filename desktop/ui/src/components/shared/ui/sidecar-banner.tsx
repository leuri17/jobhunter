import { Button } from '@/components/ui/button';
import type { SidecarReachability } from '@/lib/sidecar-reachability';

export interface SidecarBannerProps {
  readonly state: SidecarReachability;
}

/**
 * Ambient banner for a measured sidecar outage (issue #202 / the
 * `banner` tier in `@/lib/error-surfaces`). Renders above the
 * sidebar/content shell so every route sees it, regardless of how
 * the URL was resolved.
 */
export function SidecarBanner({ state }: SidecarBannerProps) {
  if (state.status !== 'unreachable') {
    return null;
  }
  const port =
    state.url === null || state.url === ''
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
