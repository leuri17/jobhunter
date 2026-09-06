import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

// ApiError is a known 4xx/5xx — retrying is unlikely to change the
// outcome, so give up immediately. Non-ApiError failures (network,
// parse, transport — the sidecar isn't listening yet) get one retry
// with exponential backoff so the first-load race after `tauri dev`
// cold start recovers within ~1s.
export const shouldRetryQuery = (failureCount: number, error: unknown): boolean =>
  error instanceof ApiError ? false : failureCount < 2;

export const queryRetryDelay = (attempt: number): number =>
  Math.min(1000 * 2 ** attempt, 5000);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,
    },
  },
});
