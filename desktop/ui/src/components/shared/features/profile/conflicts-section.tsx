import { CircleCheck } from 'lucide-react';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SectionDivider } from '@/components/shared/features/settings/search-config/section';
import type { ProfileConflictRow, ProfileWarningRow } from '@/lib/types';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export interface ConflictsSectionProps {
  conflicts: readonly ProfileConflictRow[];
  warnings: readonly ProfileWarningRow[];
}

export function ConflictsSection({ conflicts, warnings }: ConflictsSectionProps) {
  const empty = conflicts.length === 0 && warnings.length === 0;
  return (
    <>
      <CardHeader>
        <CardTitle>Conflicts &amp; warnings</CardTitle>
        <CardDescription>
          Disagreements between sources on the draft version. Resolution tools arrive in a later
          release.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {empty ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-emerald-500" />
            No conflicts or warnings on this version.
          </div>
        ) : (
          <>
            {conflicts.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-medium">Conflicts ({conflicts.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Field path</TableHead>
                      <TableHead>Values in conflict</TableHead>
                      <TableHead>Resolution</TableHead>
                      <TableHead>Explanation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conflicts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.conflictType}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.affectedField}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-mono">{formatValue(c.valueSourceA)}</span>
                          {' vs '}
                          <span className="font-mono">{formatValue(c.valueSourceB)}</span>
                        </TableCell>
                        <TableCell>
                          {c.resolutionStatus === 'unresolved' ? (
                            <Badge variant="outline" className="text-[10px]">
                              Unresolved
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400"
                            >
                              {c.resolutionStatus === 'cleared' ? 'Cleared' : 'Resolved'}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.explanation ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}
            {conflicts.length > 0 && warnings.length > 0 && <SectionDivider />}
            {warnings.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-medium">Warnings ({warnings.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Field path</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warnings.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.warningType}</TableCell>
                        <TableCell>
                          {w.severity === 'blocking_conflict' ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Blocking
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400"
                            >
                              Warning
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {w.fieldPath ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{w.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}
          </>
        )}
      </CardContent>
    </>
  );
}
