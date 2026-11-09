// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SourcesSection } from './sources-section';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { ProfileSourceRow } from '@/lib/types';
import * as profileUpload from '@/lib/profile-upload';

vi.mock('@/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ApiError: actual.ApiError,
    api: {
      listSources: vi.fn(),
      deleteSource: vi.fn(),
      importSources: vi.fn(),
    },
  };
});

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('@/lib/profile-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/profile-upload')>();
  return {
    ...actual,
    isTauriWebview: vi.fn(),
  };
});

const sourceRow = (over: Partial<ProfileSourceRow> = {}): ProfileSourceRow => ({
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
  ...over,
});

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SourcesSection />
    </QueryClientProvider>,
  );
}

describe('SourcesSection', () => {
  beforeEach(() => {
    vi.mocked(profileUpload.isTauriWebview).mockReturnValue(true);
    vi.mocked(api.listSources).mockResolvedValue({
      schemaVersion: 1,
      sources: [sourceRow()],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('guards the pick: rejects wrong types, imports what fits', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValue(['/a/cv.pdf', '/b/notes.docx']);
    vi.mocked(api.importSources).mockResolvedValue({
      schemaVersion: 1,
      status: 'completed',
      counts: { total: 1, extracted: 1, failed: 0, reused: 0 },
      sources: [],
      failedSourcePaths: [],
    });
    renderSection();
    await screen.findByText('resume.pdf');
    fireEvent.click(screen.getByRole('button', { name: /add a source file/i }));
    await waitFor(() => expect(api.importSources).toHaveBeenCalledWith(['/a/cv.pdf']));
    const titles = vi.mocked(toast.add).mock.calls.map((c) => String(c[0]?.title));
    expect(titles.some((t) => t.includes('notes.docx'))).toBe(true);
  });

  it('rejects the whole pick when it exceeds the remaining slots', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValue(['/a/cv.pdf', '/c/one.md']);
    renderSection();
    await screen.findByText('resume.pdf');
    fireEvent.click(screen.getByRole('button', { name: /add a source file/i }));
    await waitFor(() =>
      expect(
        vi.mocked(toast.add).mock.calls.some((c) => String(c[0]?.title).includes('Only 1 more')),
      ).toBe(true),
    );
    expect(api.importSources).not.toHaveBeenCalled();
  });

  it('disables the add row at the source cap', async () => {
    vi.mocked(api.listSources).mockResolvedValue({
      schemaVersion: 1,
      sources: [
        sourceRow(),
        sourceRow({ id: 2, originalFilename: 'two.md', sourceType: 'markdown' }),
      ],
    });
    renderSection();
    const capped = await screen.findByRole('button', { name: /source limit reached \(2 of 2\)/i });
    expect((capped as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Remove a source file to add another.')).toBeDefined();
  });

  it('is a silent no-op when the dialog is cancelled', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValue(null);
    renderSection();
    await screen.findByText('resume.pdf');
    fireEvent.click(screen.getByRole('button', { name: /add a source file/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(api.importSources).not.toHaveBeenCalled();
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('renders a disabled add row in non-Tauri dev mode', async () => {
    vi.mocked(profileUpload.isTauriWebview).mockReturnValue(false);
    renderSection();
    const disabled = await screen.findByRole('button', {
      name: /available in the desktop app/i,
    });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for confirmation before deleting a source', async () => {
    vi.mocked(api.deleteSource).mockResolvedValue({ schemaVersion: 1, removed: true });
    renderSection();
    await screen.findByText('resume.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Remove resume.pdf' }));
    expect(screen.getByText('Remove source file?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    await waitFor(() => expect(api.deleteSource).toHaveBeenCalledWith(1));
  });

  it('marks the first source Primary and the rest Supplement', async () => {
    vi.mocked(api.listSources).mockResolvedValue({
      schemaVersion: 1,
      sources: [
        sourceRow(),
        sourceRow({ id: 2, originalFilename: 'supplement.md', sourceType: 'markdown' }),
      ],
    });
    renderSection();
    await screen.findByText('resume.pdf');
    expect(screen.getByText('Primary')).toBeDefined();
    expect(screen.getByText('Supplement')).toBeDefined();
  });
});

describe('SourcesSection error surfacing', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a dialog when import fails, not just a toast', async () => {
    vi.mocked(profileUpload.isTauriWebview).mockReturnValue(true);
    vi.mocked(api.listSources).mockResolvedValue({ schemaVersion: 1, sources: [] });
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValue(['/a/cv.pdf']);
    vi.mocked(api.importSources).mockRejectedValue(
      new ApiError(500, 'source_import_failed', 'Source file does not exist'),
    );
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /add a source file/i }));
    await waitFor(() => expect(screen.getByText('Import failed')).toBeDefined());
    const titles = vi.mocked(toast.add).mock.calls.map((c) => String(c[0]?.title));
    expect(titles.some((t) => t.includes('Import failed'))).toBe(false);
  });

  it('shows a dialog when removal fails', async () => {
    vi.mocked(api.listSources).mockResolvedValue({
      schemaVersion: 1,
      sources: [sourceRow()],
    });
    vi.mocked(api.deleteSource).mockRejectedValue(new ApiError(500, 'internal_error', 'boom'));
    renderSection();
    await screen.findByText('resume.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Remove resume.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    await waitFor(() => expect(screen.getByText('Remove failed')).toBeDefined());
  });
});
