import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function StatusPill() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 5000,
  });

  if (isError) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-red-950 px-3 py-1 text-xs text-red-200">
        <span className="size-2 rounded-full bg-red-500" />
        sidecar offline
      </span>
    );
  }
  if (data === undefined) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-400">
        <span className="size-2 animate-pulse rounded-full bg-zinc-500" />
        connecting…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-950 px-3 py-1 text-xs text-emerald-200">
      <span className="size-2 rounded-full bg-emerald-500" />
      sidecar connected
    </span>
  );
}
