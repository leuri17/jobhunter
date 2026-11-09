// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PipelinePage } from './pipeline';
import { ApiError, api } from '@/lib/api';
import type { PipelineEvents } from '@/lib/sse';
import { usePipelineEvents } from '@/lib/sse';

const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, runPipeline: vi.fn(), cancelPipeline: vi.fn() },
  };
});

vi.mock('@/lib/sse', () => ({
  usePipelineEvents: vi.fn(),
}));

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PipelinePage />
    </QueryClientProvider>,
  );
}

const baseEvents: PipelineEvents = {
  status: 'idle',
  lines: [],
  result: null,
  error: null,
  runError: null,
};

describe('<PipelinePage /> run-failure surfacing', () => {
  beforeEach(() => {
    vi.mocked(usePipelineEvents).mockReturnValue(baseEvents);
  });

  afterEach(() => {
    cleanup();
    navigateSpy.mockClear();
    vi.mocked(api.runPipeline).mockReset();
  });

  it('shows the run-failure dialog with Profile guidance when a run fails with no_active_profile', async () => {
    vi.mocked(usePipelineEvents).mockReturnValue({
      ...baseEvents,
      status: 'failed',
      runError: {
        code: 'no_active_profile',
        message:
          'No active approved profile. Approve a profile on the Profile page before starting a run.',
      },
    });

    renderPage();

    const dialog = await screen.findByTestId('api-error-dialog');
    expect(screen.getByText('The run failed')).toBeTruthy();
    expect(dialog.textContent).toContain('Profile page');

    fireEvent.click(screen.getByRole('button', { name: 'Open Profile' }));
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/profile' });
  });

  it('renders no run-failure dialog when the run error is absent', () => {
    vi.mocked(usePipelineEvents).mockReturnValue({ ...baseEvents, status: 'idle' });

    renderPage();

    expect(screen.queryByTestId('api-error-dialog')).toBeNull();
  });

  it('routes a no_active_profile start failure to the Profile page', async () => {
    vi.mocked(api.runPipeline).mockRejectedValue(
      new ApiError(409, 'no_active_profile', 'No active approved profile.'),
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));

    const dialog = await screen.findByTestId('api-error-dialog');
    expect(screen.getByText("Couldn't start the pipeline")).toBeTruthy();
    expect(dialog.textContent).toContain('Profile page');

    fireEvent.click(screen.getByRole('button', { name: 'Open Profile' }));
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/profile' });
  });
});
