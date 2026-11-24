// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { DEFAULT_OPERATIONAL_CONFIG } from '@jobhunter/core/config/schemas';

import {
  ModelField,
  modelsQueryKey,
} from '@/components/shared/features/settings/ai-provider/model-field';
import { api, ApiError } from '@/lib/api';
import type { AiProviderModelsResponse, ApiKeyResponse } from '@/lib/types';
import type { AnyFieldApi } from '@/components/shared/features/settings/ai-provider/types';
import type { AiProviderId } from '@jobhunter/core/config';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ApiError: actual.ApiError,
    api: {
      listAiProviderModels: vi.fn(),
      getApiKeyStatus: vi.fn(),
    },
  };
});

interface HarnessProps {
  readonly provider?: AiProviderId;
  readonly baseUrl?: string;
}

function ModelFieldHarness({ provider = 'openrouter', baseUrl }: HarnessProps) {
  const form = useForm({
    defaultValues: {
      ...DEFAULT_OPERATIONAL_CONFIG,
      aiProvider: { ...DEFAULT_OPERATIONAL_CONFIG.aiProvider, provider },
    },
  });
  return (
    <form.Field name="aiProvider.profileExtraction.model">
      {(field: AnyFieldApi) => <ModelField field={field} provider={provider} baseUrl={baseUrl} />}
    </form.Field>
  );
}

function renderModelField(seed: AiProviderModelsResponse | undefined, props: HarnessProps = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (seed !== undefined) {
    // Seed instead of awaiting the fetch so trigger-presence assertions
    // cannot race the query resolution.
    queryClient.setQueryData(modelsQueryKey(props.provider ?? 'openrouter', props.baseUrl), seed);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelFieldHarness {...props} />
    </QueryClientProvider>,
  );
}

const CONFIGURED_MODELS = {
  schemaVersion: 1 as const,
  configured: true,
  models: ['gpt-5.6-mini', 'gpt-5.6-sol', 'o4-standard'],
};

const NO_MODELS: AiProviderModelsResponse = { schemaVersion: 1, configured: false, models: [] };

function keyStatus(provider: AiProviderId | undefined, configured: boolean): ApiKeyResponse {
  return {
    schemaVersion: 1,
    configured,
    source: configured ? 'stored' : 'none',
    provider: provider ?? 'openrouter',
    masked: configured ? 'sk-…abcd' : '',
    backend: 'file',
    backendReason: 'bridge_not_configured',
    legacyFilePresent: false,
  };
}

beforeEach(() => {
  vi.mocked(api.listAiProviderModels).mockResolvedValue(CONFIGURED_MODELS);
  vi.mocked(api.getApiKeyStatus).mockImplementation(async (provider) => keyStatus(provider, false));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ModelField', () => {
  it('offers the full model list while typing', async () => {
    renderModelField(undefined);
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-5.6' } });

    expect(await screen.findByText('gpt-5.6-mini')).toBeTruthy();
    expect(screen.getByText('gpt-5.6-sol')).toBeTruthy();
    expect(screen.getByText('o4-standard')).toBeTruthy();
  });

  it('opens the list as soon as the field is focused (#359)', async () => {
    renderModelField(CONFIGURED_MODELS);
    const input = screen.getByLabelText('Model');

    fireEvent.focus(input);

    expect(await screen.findByText('o4-standard')).toBeTruthy();
  });

  it('renders the whole list when expanded with a value selected', async () => {
    renderModelField(undefined);
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-5.6' } });

    fireEvent.click(await screen.findByText('gpt-5.6-sol'));
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('gpt-5.6-sol');
    });
    expect(screen.queryByText('o4-standard')).toBeNull();

    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('o4-standard')).toBeTruthy();
    expect(screen.getByText('gpt-5.6-mini')).toBeTruthy();
    expect(screen.getByText('gpt-5.6-sol')).toBeTruthy();
  });

  it('writes a selected suggestion into the field', async () => {
    renderModelField(undefined);
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-5.6' } });

    fireEvent.click(await screen.findByText('gpt-5.6-sol'));

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('gpt-5.6-sol');
    });
  });

  it('shows the dropdown trigger when models are available', () => {
    renderModelField(CONFIGURED_MODELS);

    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('hides the dropdown trigger when no models can ever be suggested', () => {
    renderModelField(NO_MODELS);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps a custom id that is not in the fetched list', async () => {
    renderModelField(undefined);
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'ft:snapshot-2026' } });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('ft:snapshot-2026');
    });
    expect(screen.queryByText('gpt-5.6-mini')).toBeNull();
  });

  it('behaves as a plain text field when the provider lists no models', async () => {
    vi.mocked(api.listAiProviderModels).mockResolvedValue(NO_MODELS);
    renderModelField(undefined);
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-anything' } });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('gpt-anything');
    });
    expect(screen.queryByText('gpt-5.6-mini')).toBeNull();
  });

  it('behaves as a plain text field when the models query fails', async () => {
    vi.mocked(api.listAiProviderModels).mockRejectedValue(
      new ApiError(503, 'ai_provider_network', 'AiProvider is unreachable.'),
    );
    renderModelField(undefined);
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-anything' } });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('gpt-anything');
    });
    expect(screen.queryByText('gpt-5.6-mini')).toBeNull();
  });
});

describe('ModelField follows the selected provider (#359)', () => {
  it('requests the list for the selected provider', async () => {
    renderModelField(undefined, { provider: 'groq' });

    await waitFor(() =>
      expect(api.listAiProviderModels).toHaveBeenCalledWith({ provider: 'groq' }),
    );
  });

  it('passes the custom base URL for a custom provider', async () => {
    renderModelField(undefined, { provider: 'custom', baseUrl: 'https://compat-proxy.example/v1' });

    await waitFor(() =>
      expect(api.listAiProviderModels).toHaveBeenCalledWith({
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
      }),
    );
  });

  it('does not request a list for a custom provider without a base URL', async () => {
    renderModelField(undefined, { provider: 'custom', baseUrl: '' });

    await waitFor(() => expect(api.getApiKeyStatus).toHaveBeenCalled());
    expect(api.listAiProviderModels).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says a key is needed when a provider has no key and no public model list', async () => {
    vi.mocked(api.listAiProviderModels).mockResolvedValue(NO_MODELS);
    renderModelField(undefined, { provider: 'groq' });

    expect(await screen.findByText('Add a Groq key to list its models.')).toBeTruthy();
  });

  it('does not ask for a key when the provider already has one', async () => {
    vi.mocked(api.listAiProviderModels).mockResolvedValue(NO_MODELS);
    vi.mocked(api.getApiKeyStatus).mockImplementation(async (provider) =>
      keyStatus(provider, true),
    );
    renderModelField(undefined, { provider: 'groq' });

    await waitFor(() => expect(api.getApiKeyStatus).toHaveBeenCalledWith('groq'));
    await waitFor(() => expect(api.listAiProviderModels).toHaveBeenCalled());
    expect(screen.queryByText(/key to list its models/)).toBeNull();
  });

  it('does not ask for a key for a provider whose model list is public', async () => {
    vi.mocked(api.listAiProviderModels).mockResolvedValue(NO_MODELS);
    renderModelField(undefined, { provider: 'openrouter' });

    await waitFor(() => expect(api.listAiProviderModels).toHaveBeenCalled());
    expect(screen.queryByText(/key to list its models/)).toBeNull();
  });
});
