import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pingSidecar, resolveSidecar } from './sidecar-url';

const REACHABILITY_STALE_MS = 5_000;

export type ReachabilityStatus = 'pending' | 'reachable' | 'unreachable';

export interface SidecarReachability {
  /**
   * `pending` until the first query resolves; `reachable` when the ping to
   * `<url>/api/health` answered 2xx (measured for all resolver branches);
   * `unreachable` on a non-2xx response, network error, or timeout.
   * `isFallback` records how the URL was resolved and does not imply trust.
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
 * The hook pings `<url>/api/health` for every resolver branch — fallback
 * and non-fallback alike — so `status` is always measured. The query
 * result is cached for 5 s so we don't ping on every render.
 */
export function useSidecarReachability(): SidecarReachability {
  const query = useQuery<ReachabilityData>({
    queryKey: ['sidecar-reachability'],
    queryFn: async (): Promise<ReachabilityData> => {
      const { url, isFallback } = await resolveSidecar();
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
