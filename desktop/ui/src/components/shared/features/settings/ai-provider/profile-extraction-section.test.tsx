// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_REASONING_EFFORT_IDS,
  DEFAULT_OPERATIONAL_CONFIG,
} from '@jobhunter/core/config/schemas';

import { ProfileExtractionSection } from '@/components/shared/features/settings/ai-provider/profile-extraction-section';
import type { SectionForm } from '@/components/shared/features/settings/ai-provider/types';
import { api } from '@/lib/api';
import type { ApiKeyResponse } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ApiError: actual.ApiError,
    api: { listAiProviderModels: vi.fn(), getApiKeyStatus: vi.fn() },
  };
});

interface FormHandle {
  readonly state: { readonly values: typeof DEFAULT_OPERATIONAL_CONFIG };
  setFieldValue(name: string, value: unknown): void;
}

let form: FormHandle | null = null;

function renderSection() {
  form = null;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Harness() {
    const instance = useForm({ defaultValues: DEFAULT_OPERATIONAL_CONFIG });
    form = instance as unknown as FormHandle;
    return <ProfileExtractionSection form={instance as unknown as SectionForm} />;
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

const UNSUPPORTED = AI_PROVIDER_IDS.filter((id) => !AI_PROVIDER_REASONING_EFFORT_IDS.includes(id));

const UNCONFIGURED_KEY: ApiKeyResponse = {
  schemaVersion: 1,
  configured: false,
  source: 'none',
  provider: 'openrouter',
  masked: '',
  backend: 'file',
  backendReason: 'bridge_not_configured',
  legacyFilePresent: false,
};

beforeEach(() => {
  vi.mocked(api.listAiProviderModels).mockResolvedValue({
    schemaVersion: 1,
    configured: false,
    models: [],
  });
  vi.mocked(api.getApiKeyStatus).mockResolvedValue(UNCONFIGURED_KEY);
});

afterEach(() => {
  cleanup();
  form = null;
  vi.clearAllMocks();
});

describe('ProfileExtractionSection follows the selected provider (#359)', () => {
  it('requests the model list for the selected provider', async () => {
    renderSection();

    await waitFor(() =>
      expect(api.listAiProviderModels).toHaveBeenCalledWith({ provider: 'openrouter' }),
    );
  });

  it('re-requests the model list when the selected provider changes', async () => {
    renderSection();
    await waitFor(() =>
      expect(api.listAiProviderModels).toHaveBeenCalledWith({ provider: 'openrouter' }),
    );

    act(() => form!.setFieldValue('aiProvider.provider', 'groq'));

    await waitFor(() =>
      expect(api.listAiProviderModels).toHaveBeenCalledWith({ provider: 'groq' }),
    );
  });

  it.each(AI_PROVIDER_REASONING_EFFORT_IDS)(
    'shows reasoning effort for %s, which supports the parameter',
    (provider) => {
      renderSection();
      act(() => form!.setFieldValue('aiProvider.provider', provider));

      expect(screen.getByLabelText('Reasoning effort')).toBeTruthy();
    },
  );

  it.each(UNSUPPORTED)('hides reasoning effort for %s, which ignores the parameter', (provider) => {
    renderSection();
    act(() => form!.setFieldValue('aiProvider.provider', provider));

    expect(screen.queryByLabelText('Reasoning effort')).toBeNull();
  });

  it('keeps the stored reasoning effort when the control is hidden', () => {
    renderSection();
    act(() => form!.setFieldValue('aiProvider.provider', 'groq'));

    expect(screen.queryByLabelText('Reasoning effort')).toBeNull();
    expect(form!.state.values.aiProvider.profileExtraction.reasoningEffort).toBe(
      DEFAULT_OPERATIONAL_CONFIG.aiProvider.profileExtraction.reasoningEffort,
    );
  });
});
