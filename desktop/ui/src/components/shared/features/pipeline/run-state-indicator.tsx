// Live run-state pill for the pipeline header: text + colored dot,
// never color alone. `animate-pulse` on the running dot is the only
// motion; reduced-motion users get a static dot.

import type { PipelineEvents } from '@/lib/sse';
import { cn } from 'cn';

interface StateMeta {
  readonly label: string;
  readonly pill: string;
  readonly dot: string;
}

const STATE_META: Readonly<Record<PipelineEvents['status'], StateMeta>> = {
  idle: {
    label: 'Idle',
    pill: 'border-border bg-muted/50 text-muted-foreground',
    dot: 'bg-zinc-500',
  },
  running: {
    label: 'Running',
    pill: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    dot: 'bg-emerald-400 animate-pulse motion-reduce:animate-none',
  },
  done: {
    label: 'Completed',
    pill: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    dot: 'bg-emerald-400',
  },
  cancelled: {
    label: 'Cancelled',
    pill: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    dot: 'bg-amber-400',
  },
  failed: {
    label: 'Failed',
    pill: 'border-destructive/30 bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
  },
  error: {
    label: 'Connection lost',
    pill: 'border-destructive/30 bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
  },
};

export function RunStateIndicator({ status }: { readonly status: PipelineEvents['status'] }) {
  const meta = STATE_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        meta.pill,
      )}
    >
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
