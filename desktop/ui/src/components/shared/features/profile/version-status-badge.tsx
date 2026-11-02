import { Badge } from '@/components/ui/badge';
import type { ProfileStatus } from '@/lib/types';

const CONFIG: Record<ProfileStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
  approved: {
    label: 'Approved',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  },
  rejected: { label: 'Rejected', className: '' },
  superseded: { label: 'Superseded', className: 'text-muted-foreground' },
};

export function VersionStatusBadge({ status }: { status: ProfileStatus }) {
  const config = CONFIG[status];
  if (status === 'rejected') {
    return <Badge variant="destructive">{config.label}</Badge>;
  }
  return (
    <Badge variant="outline" className={`font-mono text-[11px] ${config.className}`}>
      {config.label}
    </Badge>
  );
}
