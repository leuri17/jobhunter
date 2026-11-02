import type { ProfileListEntry } from '@/lib/types';

export type WorkingCopy =
  | { kind: 'draft'; entry: ProfileListEntry }
  | { kind: 'approved'; entry: ProfileListEntry }
  | { kind: 'none' };

export function resolveWorkingCopy(profiles: readonly ProfileListEntry[]): WorkingCopy {
  const newestDraft = profiles.find((p) => p.status === 'draft');
  if (newestDraft !== undefined) {
    return { kind: 'draft', entry: newestDraft };
  }
  const active = profiles.find((p) => p.active && p.status === 'approved');
  if (active !== undefined) {
    return { kind: 'approved', entry: active };
  }
  return { kind: 'none' };
}
