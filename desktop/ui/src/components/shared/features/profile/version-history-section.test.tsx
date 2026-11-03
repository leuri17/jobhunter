// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VersionHistorySection } from './version-history-section';
import { api, ApiError } from '@/lib/api';
import type { ProfileListEntry } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ApiError: actual.ApiError,
    api: {
      approveProfile: vi.fn(),
      rejectProfile: vi.fn(),
    },
  };
});

const entry = (over: Partial<ProfileListEntry>): ProfileListEntry => ({
  profileVersionId: 1,
  profileId: 'prf_one',
  status: 'draft',
  active: false,
  contentHash: 'h',
  sourceIds: [],
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  approvedAt: null,
  ...over,
});

function renderSection(
  profiles: ProfileListEntry[],
  blockingConflictCount: number,
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VersionHistorySection profiles={profiles} blockingConflictCount={blockingConflictCount} />
    </QueryClientProvider>,
  );
}

describe('VersionHistorySection', () => {
  beforeEach(() => {
    vi.mocked(api.approveProfile).mockResolvedValue({ schemaVersion: 1 } as never);
    vi.mocked(api.rejectProfile).mockResolvedValue({ schemaVersion: 1 } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('marks the active approved row and lists statuses', () => {
    renderSection(
      [
        entry({ profileVersionId: 7, profileId: 'prf_active', status: 'approved', active: true }),
        entry({ profileVersionId: 3 }),
      ],
      0,
    );
    expect(screen.getByText('ver_7')).toBeDefined();
    expect(screen.getByText('ver_3')).toBeDefined();
    expect(screen.getByText('Active', { selector: 'span' })).toBeDefined();
  });

  it('disables approve while blocking conflicts exist', () => {
    renderSection([entry({})], 1);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('confirms before approving a draft', async () => {
    renderSection([entry({ profileVersionId: 5, profileId: 'prf_five' })], 0);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText('Approve version ver_5?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Approve & publish' }));
    await waitFor(() => expect(api.approveProfile).toHaveBeenCalledWith('profile_5'));
  });

  it('confirms before rejecting a draft', async () => {
    renderSection([entry({ profileVersionId: 5, profileId: 'prf_five' })], 0);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByText(/reject draft ver_5/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reject draft' }));
    await waitFor(() => expect(api.rejectProfile).toHaveBeenCalledWith('profile_5'));
  });

  it('shows the empty state', () => {
    renderSection([], 0);
    expect(screen.getByText(/no versions yet/i)).toBeDefined();
  });
});

describe('VersionHistorySection error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api.approveProfile).mockResolvedValue({ schemaVersion: 1 } as never);
    vi.mocked(api.rejectProfile).mockResolvedValue({ schemaVersion: 1 } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a dialog when approval fails, not just a toast', async () => {
    vi.mocked(api.approveProfile).mockRejectedValue(
      new ApiError(409, 'invalid_profile_state', 'Profile is approved, not draft'),
    );
    renderSection([entry({ profileVersionId: 9, profileId: 'prf_nine' })], 0);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve & publish' }));
    await waitFor(() => expect(screen.getByText('Approval failed')).toBeDefined());
  });
});
