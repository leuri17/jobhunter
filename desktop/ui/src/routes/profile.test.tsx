// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import type {
  GetProfileResponse,
  ListProfilesResponse,
  ProfileListEntry,
  ProfileSourceRow,
} from '@/lib/types';
import { makeProfile } from '@/components/shared/features/profile/test-fixtures';
import { ProfilePage } from './profile';

vi.mock('@/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props} href="/settings" />
    ),
  };
});

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  api: {
    listProfiles: vi.fn(),
    getProfile: vi.fn(),
    listSources: vi.fn(),
    getApiKeyStatus: vi.fn(),
    extractProfile: vi.fn(),
    approveProfile: vi.fn(),
    editProfile: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { toast } from '@/components/ui/toast';

vi.mock('@/lib/profile-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/profile-upload')>();
  return {
    ...actual,
    isTauriWebview: vi.fn(),
  };
});

import { isTauriWebview } from '@/lib/profile-upload';

const draftEntry: ProfileListEntry = {
  profileVersionId: 5,
  profileId: 'profile_ab12cd34ef56',
  status: 'draft',
  active: false,
  contentHash: 'h',
  sourceIds: [],
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  approvedAt: null,
};

function detailResponse(): GetProfileResponse {
  return {
    schemaVersion: 1,
    profile: makeProfile(),
    status: 'draft',
    active: false,
    contentHash: 'h',
    extractionFingerprint: 'fp',
    warnings: [],
    conflicts: [],
    overrides: [],
    revisions: [],
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

const rejectedEntry: ProfileListEntry = {
  profileVersionId: 7,
  profileId: 'profile_ab12cd34ef56',
  status: 'rejected',
  active: false,
  contentHash: 'h',
  sourceIds: [1],
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T11:00:00.000Z',
  approvedAt: null,
};

describe('ProfilePage extraction failure', () => {
  beforeEach(() => {
    vi.mocked(api.listProfiles).mockResolvedValue({
      schemaVersion: 1,
      profiles: [draftEntry],
    } as ListProfilesResponse);
    vi.mocked(api.getProfile).mockResolvedValue(detailResponse());
    vi.mocked(api.listSources).mockResolvedValue({ schemaVersion: 1, sources: [] });
    vi.mocked(api.getApiKeyStatus).mockResolvedValue({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      masked: 'sk-…test',
      legacyFilePresent: false,
      backend: 'file',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('reports extraction failures as extraction failures, with an extraction retry', async () => {
    vi.mocked(api.extractProfile).mockRejectedValue(
      new ApiError(503, 'openai_unavailable', 'No OpenAI API key is configured'),
    );
    renderPage();
    await screen.findByRole('tab', { name: /overview/i });

    fireEvent.click(screen.getByRole('button', { name: 'Run extraction' }));
    const buttons = screen.getAllByRole('button', { name: 'Run extraction' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getAllByText('Extraction failed').length).toBeGreaterThan(0));
    expect(screen.queryByText("Couldn't save profile")).toBeNull();
    expect(api.extractProfile).toHaveBeenCalledOnce();
  });

  it('surfaces a 200 response with kind failed as an extraction failure, not success', async () => {
    vi.mocked(api.extractProfile).mockResolvedValue({
      schemaVersion: 1,
      status: {
        kind: 'failed',
        errorCode: 'profile_extraction_source_unusable',
        message: 'No usable profile sources.',
        attempts: 0,
      },
    } as never);
    renderPage();
    await screen.findByRole('tab', { name: /overview/i });

    fireEvent.click(screen.getByRole('button', { name: 'Run extraction' }));
    const buttons = screen.getAllByRole('button', { name: 'Run extraction' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getAllByText('Extraction failed').length).toBeGreaterThan(0));
    const titles = vi.mocked(toast.add).mock.calls.map((c) => String(c[0]?.title));
    expect(titles.some((t) => t.includes('Extraction complete'))).toBe(false);
  });
});

const firstRunSourceRow: ProfileSourceRow = {
  id: 1,
  sourceType: 'pdf',
  originalFilename: 'resume.pdf',
  originalAbsolutePath: '/home/user/resume.pdf',
  storedPath: '/data/resume.pdf',
  mimeType: 'application/pdf',
  fileSize: 145408,
  sha256: '7b91d34abcdefea14'.padEnd(64, '0'),
  importTimestamp: '2026-11-01T10:00:00.000Z',
  extractedTextHash: null,
  textExtractionStatus: 'success',
  textExtractionMessage: null,
  warnings: [],
};

describe('ProfilePage first run', () => {
  beforeEach(() => {
    vi.mocked(isTauriWebview).mockReturnValue(true);
    vi.mocked(api.listProfiles).mockResolvedValue({ schemaVersion: 1, profiles: [] });
    vi.mocked(api.getApiKeyStatus).mockResolvedValue({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      masked: 'sk-…test',
      legacyFilePresent: false,
      backend: 'file',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('collapses to the getting-started card when no sources exist', async () => {
    vi.mocked(api.listSources).mockResolvedValue({ schemaVersion: 1, sources: [] });
    renderPage();
    await screen.findByText('Get started');
    expect(screen.queryByRole('tab', { name: /overview/i })).toBeNull();
    expect(screen.getByRole('button', { name: /add a source file/i })).toBeDefined();
    expect(screen.getByText(/Add up to two CV or resume files/i)).toBeDefined();
  });

  it('shows the full first-run shell once a source exists', async () => {
    vi.mocked(api.listSources).mockResolvedValue({
      schemaVersion: 1,
      sources: [firstRunSourceRow],
    });
    renderPage();
    await screen.findByRole('tab', { name: /overview/i });
    expect(screen.getByText(/1 source ready/i)).toBeDefined();
    expect(screen.queryByText('Get started')).toBeNull();
  });

  it('lists rejected versions in the history tab after rejecting the only version', async () => {
    vi.mocked(api.listProfiles).mockResolvedValue({
      schemaVersion: 1,
      profiles: [rejectedEntry],
    });
    vi.mocked(api.listSources).mockResolvedValue({
      schemaVersion: 1,
      sources: [firstRunSourceRow],
    });
    renderPage();
    const historyTab = await screen.findByRole('tab', { name: /version history/i });
    fireEvent.click(historyTab);
    await waitFor(() => {
      expect(screen.getByText('ver_7')).toBeDefined();
    });
    expect(screen.getByText('Rejected')).toBeDefined();
    expect(screen.queryByText(/No versions yet/i)).toBeNull();
  });

  it('surfaces a 200 kind failed extraction on the first-run shell as a failure', async () => {
    vi.mocked(api.listSources).mockResolvedValue({
      schemaVersion: 1,
      sources: [firstRunSourceRow],
    });
    vi.mocked(api.extractProfile).mockResolvedValue({
      schemaVersion: 1,
      status: {
        kind: 'failed',
        errorCode: 'profile_extraction_source_unusable',
        message: 'No usable profile sources.',
        attempts: 0,
      },
    } as never);
    renderPage();
    await screen.findByRole('tab', { name: /overview/i });

    fireEvent.click(screen.getByRole('button', { name: 'Run extraction' }));
    const buttons = screen.getAllByRole('button', { name: 'Run extraction' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getAllByText('Extraction failed').length).toBeGreaterThan(0));
    const titles = vi.mocked(toast.add).mock.calls.map((c) => String(c[0]?.title));
    expect(titles.some((t) => t.includes('Extraction complete'))).toBe(false);
  });
});
