import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pingSidecar, resolveSidecar } from './sidecar-url';

const REACHABILITY_STALE_MS = 5_000;

export type ReachabilityStatus = 'pending' | 'reachable' | 'unreachable';

export interface SidecarReachability {
  /**
   * `pending` until the first query resolves; `reachable` when the resolver
   * returned a non-fallback URL, or when the resolver hit the fallback port
   * and `/api/health` answered 2xx; `unreachable` when the resolver hit the
   * fallback port and the ping failed.
   */
  readonly status: ReachabilityStatus;
  readonly url: string | null;
  readonly isFallback: boolean;
  /** Re-runs resolution + ping. Safe to call from a button onClick. */
  readonly retry: () => void;
}

interface ReachabilityData {
  readonly url: string;
  readonly isFallback: boolean;
  readonly reachable: boolean;
}

/**
 * Tracks whether the resolved sidecar URL is actually serving traffic.
 *
 * When the resolver returns the fallback port, the hook pings
 * `<url>/api/health` to confirm a server is listening. The query result is
 * cached for 5 s so we don't ping on every render. Non-fallback URLs are
 * trusted — the existing StatusPill surfaces their reachability through the
 * independent `/api/health` query.
 */
export function useSidecarReachability(): SidecarReachability {
  const query = useQuery<ReachabilityData>({
    queryKey: ['sidecar-reachability'],
    queryFn: async (): Promise<ReachabilityData> => {
      const { url, isFallback } = await resolveSidecar();
      if (!isFallback) {
        return { url, isFallback, reachable: true };
      }
      const reachable = await pingSidecar(url);
      return { url, isFallback, reachable };
    },
    staleTime: REACHABILITY_STALE_MS,
    refetchInterval: REACHABILITY_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);

  const data = query.data;
  if (query.isPending || data === undefined) {
    return { status: 'pending', url: null, isFallback: false, retry };
  }
  const status: ReachabilityStatus = data.reachable ? 'reachable' : 'unreachable';
  return { status, url: data.url, isFallback: data.isFallback, retry };
}
