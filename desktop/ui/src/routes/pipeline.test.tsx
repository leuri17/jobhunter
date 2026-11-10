// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PipelinePage } from './pipeline';
import { ApiError, api } from '@/lib/api';
import type { PipelineEvents } from '@/lib/sse';
import { usePipelineEvents } from '@/lib/sse';
import { DEFAULT_OPERATIONAL_CONFIG } from '@jobhunter/core/config/schemas';
import type { ActivePipelineRunResponse, PipelinePrerequisitesResponse } from '@/lib/types';

const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  // The page renders outside a router instance here, so Link gets a
  // context-free anchor stub; useNavigate is spied for action routes.
  const stubLink = ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children?: ReactNode;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  );
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    Link: stubLink,
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      runPipeline: vi.fn(),
      cancelPipeline: vi.fn(),
      getPipelinePrerequisites: vi.fn(),
      getConfig: vi.fn(),
      getActivePipelineRun: vi.fn(),
      decideScoring: vi.fn(),
    },
  };
});

vi.mock('@/lib/sse', () => ({
  usePipelineEvents: vi.fn(),
}));

const prerequisitesFixture: PipelinePrerequisitesResponse = {
  schemaVersion: 1,
  openaiKeyConfigured: true,
  activeProfile: { id: 7, contentHash: 'a'.repeat(64) },
  activeFilter: { id: 3, contentHash: 'b'.repeat(64) },
  configHash: 'c'.repeat(64),
};

const configFixture = {
  schemaVersion: 1 as const,
  config: {
    ...DEFAULT_OPERATIONAL_CONFIG,
    search: {
      ...DEFAULT_OPERATIONAL_CONFIG.search,
      searchQueries: ['Frontend developer'],
      locations: [{ name: 'Amsterdam Area', geoId: '90010383' }],
    },
  },
};

const noActiveRunFixture: ActivePipelineRunResponse = {
  schemaVersion: 1,
  runId: null,
  status: null,
};

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
  progress: [],
  pendingConfirmation: null,
};

describe('<PipelinePage /> run-failure surfacing', () => {
  beforeEach(() => {
    vi.mocked(usePipelineEvents).mockReturnValue(baseEvents);
    vi.mocked(api.getPipelinePrerequisites).mockResolvedValue(prerequisitesFixture);
    vi.mocked(api.getConfig).mockResolvedValue(configFixture);
    vi.mocked(api.getActivePipelineRun).mockResolvedValue(noActiveRunFixture);
  });

  afterEach(() => {
    cleanup();
    navigateSpy.mockClear();
    vi.mocked(api.runPipeline).mockReset();
    vi.mocked(api.getPipelinePrerequisites).mockReset();
    vi.mocked(api.getConfig).mockReset();
    vi.mocked(api.getActivePipelineRun).mockReset();
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

describe('<PipelinePage /> idle history pointer', () => {
  beforeEach(() => {
    vi.mocked(usePipelineEvents).mockReturnValue(baseEvents);
    vi.mocked(api.getPipelinePrerequisites).mockResolvedValue(prerequisitesFixture);
    vi.mocked(api.getConfig).mockResolvedValue(configFixture);
    vi.mocked(api.getActivePipelineRun).mockResolvedValue(noActiveRunFixture);
  });

  afterEach(() => {
    cleanup();
    vi.mocked(api.getPipelinePrerequisites).mockReset();
    vi.mocked(api.getConfig).mockReset();
    vi.mocked(api.getActivePipelineRun).mockReset();
  });

  it('links to the Runs page when idle (no run adopted or active)', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: 'Runs' });
    expect(link.getAttribute('href')).toBe('/runs');
  });

  it('hides the Runs pointer while a run is live', async () => {
    vi.mocked(usePipelineEvents).mockReturnValue({ ...baseEvents, status: 'running' });

    renderPage();

    await screen.findByRole('button', { name: /cancel/i });
    expect(screen.queryByRole('link', { name: 'Runs' })).toBeNull();
  });
});
