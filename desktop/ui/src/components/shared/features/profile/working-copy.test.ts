import { describe, expect, it } from 'vitest';
import { resolveWorkingCopy } from './working-copy';
import type { ProfileListEntry } from '@/lib/types';

const entry = (over: Partial<ProfileListEntry>): ProfileListEntry => ({
  profileVersionId: 1,
  profileId: 'profile_1',
  status: 'draft',
  active: false,
  contentHash: 'h',
  sourceIds: [],
  createdAt: '',
  updatedAt: '',
  approvedAt: null,
  ...over,
});

describe('resolveWorkingCopy', () => {
  it('prefers the newest draft (list is most-recent-first)', () => {
    const wc = resolveWorkingCopy([
      entry({ profileVersionId: 5, status: 'approved', active: true }),
      entry({ profileVersionId: 9 }),
      entry({ profileVersionId: 3 }),
    ]);
    expect(wc.kind).toBe('draft');
    if (wc.kind === 'draft') expect(wc.entry.profileVersionId).toBe(9);
  });

  it('falls back to the active approved version', () => {
    const wc = resolveWorkingCopy([
      entry({ status: 'superseded' }),
      entry({ status: 'approved', active: true }),
    ]);
    expect(wc.kind).toBe('approved');
  });

  it('returns none when the list is empty or has no editable version', () => {
    expect(resolveWorkingCopy([]).kind).toBe('none');
    expect(
      resolveWorkingCopy([entry({ status: 'rejected' }), entry({ status: 'superseded' })]).kind,
    ).toBe('none');
  });
});
