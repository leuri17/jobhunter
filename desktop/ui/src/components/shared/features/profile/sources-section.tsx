import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Trash } from 'lucide-react';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { SOURCE_EXTENSIONS, isTauriWebview, validatePickedPaths } from '@/lib/profile-upload';
import type { ProfileSourceRow } from '@/lib/types';

const EXTRACTOR_LABELS: Record<ProfileSourceRow['sourceType'], string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  plain_text: 'Plain text',
};

function filenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function SourceRow({
  row,
  primary,
  disabled,
}: {
  row: ProfileSourceRow;
  primary: boolean;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.deleteSource(row.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-sources'] });
      toast.add({ title: `Removed ${row.originalFilename}`, type: 'success' });
    },
    onError: (error) => {
      toast.add({
        title: `Could not remove ${row.originalFilename}: ${error.message}`,
        type: 'error',
      });
    },
  });

  return (
    <>
      <div className="flex items-center justify-between rounded-md border bg-card/50 px-3.5 py-2.5 transition-colors hover:border-muted-foreground/30">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{row.originalFilename}</span>
            {primary ? (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400"
              >
                Primary
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Supplement
              </Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            sha256:{row.sha256.slice(0, 8)}…{row.sha256.slice(-4)} ·{' '}
            {Math.max(1, Math.round(row.fileSize / 1024))} KB · {EXTRACTOR_LABELS[row.sourceType]}{' '}
            extractor · {row.textExtractionStatus}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${row.originalFilename}`}
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          <Trash />
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove source file?</AlertDialogTitle>
            <AlertDialogDescription>
              “{row.originalFilename}” will be deleted from your library. Already extracted profile
              data stays; run extraction again to rebuild without it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
              Remove file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SourcesSection({ disabled }: { disabled?: boolean }) {
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ['profile-sources'], queryFn: api.listSources });

  const importSources = useMutation({
    mutationFn: (paths: string[]) => api.importSources(paths),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ['profile-sources'] });
      const duplicates = response.counts.reused;
      toast.add({
        title:
          duplicates > 0
            ? `Imported ${response.counts.total - duplicates} file(s); ${duplicates} duplicate(s) skipped`
            : `Imported ${response.counts.total} file(s)`,
        type: 'success',
      });
    },
    onError: (error) => {
      toast.add({ title: `Import failed: ${error.message}`, type: 'error' });
    },
  });

  const onAdd = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: 'Documents', extensions: [...SOURCE_EXTENSIONS] }],
    });
    const paths = Array.isArray(picked) ? picked : picked === null ? [] : [picked];
    if (paths.length === 0) return;
    const { accepted, rejected, skippedByCount } = validatePickedPaths(paths);
    for (const r of rejected) {
      toast.add({
        title: `Skipped ${filenameOf(r.path)} — only PDF, Markdown, and TXT files are supported.`,
        type: 'warning',
      });
    }
    if (skippedByCount.length > 0) {
      toast.add({
        title: `Only 2 files can be imported at a time — ${skippedByCount.length} skipped. Add the rest afterwards.`,
        type: 'warning',
      });
    }
    if (accepted.length > 0) {
      await importSources.mutateAsync(accepted);
    }
  };

  const rows = sources.data?.sources ?? [];
  const busy = disabled === true || importSources.isPending;

  return (
    <>
      <CardHeader>
        <CardTitle>Source documents &amp; extractors</CardTitle>
        <CardDescription>
          Uploaded resumes used for profile synthesis. Duplicates are detected by SHA-256 hash.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No source documents. Add a resume to start.
          </p>
        ) : (
          rows.map((row, i) => (
            <SourceRow key={row.id} row={row} primary={i === 0} disabled={busy} />
          ))
        )}
        {isTauriWebview() ? (
          <Button
            variant="outline"
            className="w-full justify-between"
            disabled={busy}
            onClick={onAdd}
          >
            <span>Add a source file (PDF, Markdown, TXT)…</span>
            <ChevronDown className="size-4" />
          </Button>
        ) : (
          <Button variant="outline" className="w-full justify-between" disabled>
            <span>File upload is available in the desktop app</span>
            <ChevronDown className="size-4" />
          </Button>
        )}
      </CardContent>
    </>
  );
}
