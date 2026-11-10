// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrerequisitesBanner } from './prerequisites-banner';
import { api, ApiError } from '@/lib/api';
import type { PipelinePrerequisitesResponse } from '@/lib/types';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, createDefaultFilter: vi.fn() },
  };
});

const gatesClear: PipelinePrerequisitesResponse = {
  schemaVersion: 1,
  openaiKeyConfigured: true,
  activeProfile: { id: 7, contentHash: 'a'.repeat(64) },
  activeFilter: { id: 3, contentHash: 'b'.repeat(64) },
  configHash: 'c'.repeat(64),
};

const filterMissing: PipelinePrerequisitesResponse = {
  ...gatesClear,
  activeFilter: null,
};

function renderBanner(data: PipelinePrerequisitesResponse | undefined): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PrerequisitesBanner data={data} failed={false} />
    </QueryClientProvider>,
  );
}

describe('<PrerequisitesBanner /> default-filter unblock', () => {
  beforeEach(() => {
    vi.mocked(api.createDefaultFilter).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('offers Create default filter when the filter gate is missing', async () => {
    vi.mocked(api.createDefaultFilter).mockResolvedValue({
      schemaVersion: 1,
      filter: { id: 1, contentHash: 'hash' },
      created: true,
    });

    renderBanner(filterMissing);

    fireEvent.click(screen.getByRole('button', { name: /create default filter/i }));
    await waitFor(() => {
      expect(api.createDefaultFilter).toHaveBeenCalledTimes(1);
    });
  });

  it('shows no create button when the filter gate is satisfied', () => {
    renderBanner(gatesClear);
    expect(screen.queryByRole('button', { name: /create default filter/i })).toBeNull();
  });

  it('surfaces a failed creation through the error dialog', async () => {
    vi.mocked(api.createDefaultFilter).mockRejectedValue(
      new ApiError(500, 'filter_storage_error', 'Failed to persist filter configuration'),
    );

    renderBanner(filterMissing);
    fireEvent.click(screen.getByRole('button', { name: /create default filter/i }));

    expect(await screen.findByTestId('api-error-dialog')).toBeTruthy();
    expect(screen.getByText("Couldn't create the default filter")).toBeTruthy();
  });
});
