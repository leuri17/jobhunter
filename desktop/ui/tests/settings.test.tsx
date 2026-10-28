// @vitest-environment happy-dom
//
// The route component is imported from the code-split chunk that the
// TanStack router plugin generates (`?tsr-split=component`): the module's
// `Route.options.component` is only a lazy wrapper, and that wrapper does
// not settle under vitest's module runner. The test lives outside
// `src/routes/` so the router plugin does not scan it as a route file.
// @ts-expect-error virtual module served by the tanstack router plugin
import { component as SettingsRoute } from '../src/routes/settings?tsr-split=component';
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ConfigResponse } from '@/lib/types';
import { DEFAULT_OPERATIONAL_CONFIG } from '@jobhunter/core/config/schemas';
import type { OperationalConfig } from '@jobhunter/core/config/schemas';

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  api: {
    getConfig: vi.fn(),
    patchConfig: vi.fn(),
    getApiKeyStatus: vi.fn(),
    listOpenAiModels: vi.fn(),
  },
}));

function makeConfig(runTopN: number): OperationalConfig {
  const next = JSON.parse(JSON.stringify(DEFAULT_OPERATIONAL_CONFIG)) as OperationalConfig;
  next.output.runTopN = runTopN;
  return next;
}

let serverConfig: OperationalConfig;

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData<ConfigResponse>(['config'], { schemaVersion: 1, config: serverConfig });
  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <SettingsRoute />
      </Suspense>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  serverConfig = makeConfig(20);
  vi.mocked(api.getConfig).mockImplementation(async () => ({
    schemaVersion: 1,
    config: serverConfig,
  }));
  vi.mocked(api.patchConfig).mockImplementation(async () => {
    serverConfig = makeConfig(30);
    return { schemaVersion: 1, config: serverConfig };
  });
  vi.mocked(api.getApiKeyStatus).mockResolvedValue({
    schemaVersion: 1,
    configured: false,
    source: 'none',
    masked: '',
    backend: 'keychain',
    legacyFilePresent: false,
  });
  vi.mocked(api.listOpenAiModels).mockResolvedValue({
    schemaVersion: 1,
    configured: false,
    models: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('settings route form re-baseline', () => {
  it('clears isDirty and repaints from the refetched config after a successful save', async () => {
    renderSettings();

    expect(await screen.findByText('No changes')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Output' }));
    const runTopN = await screen.findByLabelText('Run top N');
    fireEvent.change(runTopN, { target: { value: '25' } });

    await waitFor(() => {
      expect(screen.queryByText('No changes')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(screen.getByText('No changes')).toBeTruthy();
    });
    expect((screen.getByLabelText('Run top N') as HTMLInputElement).value).toBe('30');
    expect(api.patchConfig).toHaveBeenCalledTimes(1);
    expect(api.patchConfig).toHaveBeenCalledWith(
      expect.objectContaining({ output: expect.objectContaining({ runTopN: 25 }) }),
    );
  });
});
