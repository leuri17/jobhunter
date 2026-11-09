import type { ReactNode } from 'react';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ProfessionalProfile } from '@/lib/types';

export interface StatusCardProps {
  profile: ProfessionalProfile | null;
  badges: ReactNode;
  sourcesReady: number;
  onAddSource?: () => void;
}

function Column({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
      {sub !== undefined && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function StatusCard({ profile, badges, sourcesReady, onAddSource }: StatusCardProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Active version &amp; status</CardTitle>
        <CardDescription>
          The approved profile used by pipeline scoring, plus the draft you&apos;re editing.
        </CardDescription>
        {badges}
      </CardHeader>
      <CardContent>
        {profile === null ? (
          sourcesReady > 0 ? (
            <div className="rounded-lg border bg-card/50 p-3.5 text-sm text-amber-400">
              No profile version yet — {sourcesReady} {sourcesReady === 1 ? 'source' : 'sources'}{' '}
              ready. Run extraction to build the first draft.
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm font-medium">No profile yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a CV as a source, then run extraction to build your first version.
              </p>
              {onAddSource !== undefined && (
                <Button className="mt-4" onClick={onAddSource}>
                  Add source file
                </Button>
              )}
            </div>
          )
        ) : (
          <div className="grid grid-cols-3 divide-x divide-border rounded-lg border bg-card/50 p-3.5">
            <Column
              label="Candidate"
              value={profile.basics.fullName ?? '—'}
              sub={[profile.basics.email, profile.basics.phone].filter(Boolean).join(' · ') || '—'}
            />
            <Column
              label="Verified experience"
              value={
                profile.basics.totalYearsOfExperience === null
                  ? '—'
                  : `${profile.basics.totalYearsOfExperience} years`
              }
              sub={profile.basics.currentLocation ?? '—'}
            />
            <Column
              label="Fingerprint"
              value={
                <span className="font-mono text-xs">
                  sha256:{profile.contentHash.slice(0, 6)}…{profile.contentHash.slice(-4)}
                </span>
              }
              sub={`Updated ${new Date(profile.updatedAt).toLocaleString()}`}
            />
          </div>
        )}
      </CardContent>
    </>
  );
}
