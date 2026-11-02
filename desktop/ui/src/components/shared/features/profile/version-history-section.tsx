import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import type { ProfileListEntry } from '@/lib/types';
import { VersionStatusBadge } from './version-status-badge';

const INVALIDATE = [['profiles'], ['profile'], ['jobs'], ['runs']] as const;

export interface VersionHistorySectionProps {
  profiles: readonly ProfileListEntry[];
  blockingConflictCount: number;
}

export function VersionHistorySection({
  profiles,
  blockingConflictCount,
}: VersionHistorySectionProps) {
  const queryClient = useQueryClient();
  const [pendingApprove, setPendingApprove] = useState<ProfileListEntry | null>(null);
  const [pendingReject, setPendingReject] = useState<ProfileListEntry | null>(null);

  const invalidateAll = () => {
    for (const key of INVALIDATE) {
      void queryClient.invalidateQueries({ queryKey: [...key] });
    }
  };

  const approve = useMutation({
    mutationFn: (id: string) => api.approveProfile(id),
    onSuccess: () => {
      invalidateAll();
      toast.add({ title: 'Version approved — profile is live', type: 'success' });
    },
    onError: (error) => {
      toast.add({ title: `Approval failed: ${error.message}`, type: 'error' });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.rejectProfile(id),
    onSuccess: () => {
      invalidateAll();
      toast.add({ title: 'Draft rejected — kept in history', type: 'success' });
    },
    onError: (error) => {
      toast.add({ title: `Rejection failed: ${error.message}`, type: 'error' });
    },
  });

  return (
    <>
      <CardHeader>
        <CardTitle>Version history</CardTitle>
        <CardDescription>
          Every profile version, newest first. Approving a draft atomically swaps the active
          profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No versions yet. Run extraction to create the first draft.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Created / Updated</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.profileVersionId} className={p.active ? 'bg-emerald-500/5' : ''}>
                  <TableCell className="font-mono text-xs">ver_{p.profileVersionId}</TableCell>
                  <TableCell>
                    <VersionStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell>
                    {p.active && (
                      <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                        Active
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleString()} ·{' '}
                    {new Date(p.updatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">{p.sourceIds.length}</TableCell>
                  <TableCell className="text-right">
                    {p.status === 'draft' && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={blockingConflictCount > 0 || approve.isPending}
                          onClick={() => setPendingApprove(p)}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reject.isPending}
                          onClick={() => setPendingReject(p)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog
        open={pendingApprove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingApprove(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve version ver_{pendingApprove?.profileVersionId}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current active profile used for job scoring. The previous active
              version becomes superseded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingApprove !== null) approve.mutate(pendingApprove.profileId);
                setPendingApprove(null);
              }}
            >
              Approve &amp; publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingReject !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReject(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Reject draft ver_{pendingReject?.profileVersionId}?</AlertDialogTitle>
            <AlertDialogDescription>It will be kept in history as rejected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingReject !== null) reject.mutate(pendingReject.profileId);
                setPendingReject(null);
              }}
            >
              Reject draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
