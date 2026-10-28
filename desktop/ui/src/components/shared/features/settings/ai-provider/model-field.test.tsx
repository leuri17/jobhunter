// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';

import { ModelField } from '@/components/shared/features/settings/ai-provider/model-field';
import { api, ApiError } from '@/lib/api';
import type { OpenAiModelsResponse } from '@/lib/types';
import type { AnyFieldApi } from '@/components/shared/features/settings/ai-provider/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ApiError: actual.ApiError,
    api: {
      listOpenAiModels: vi.fn(),
    },
  };
});

function ModelFieldHarness() {
  const form = useForm({ defaultValues: { model: '' } });
  return (
    <form.Field name="model">{(field: AnyFieldApi) => <ModelField field={field} />}</form.Field>
  );
}

function renderModelField(seed?: OpenAiModelsResponse) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (seed !== undefined) {
    // Seed instead of awaiting the fetch so trigger-presence assertions
    // cannot race the query resolution.
    queryClient.setQueryData(['openai', 'models'], seed);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelFieldHarness />
    </QueryClientProvider>,
  );
}

const CONFIGURED_MODELS = {
  schemaVersion: 1 as const,
  configured: true,
  models: ['gpt-5.6-mini', 'gpt-5.6-sol', 'o4-standard'],
};

beforeEach(() => {
  vi.mocked(api.listOpenAiModels).mockResolvedValue(CONFIGURED_MODELS);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ModelField', () => {
  it('offers the full model list while typing', async () => {
    renderModelField();
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-5.6' } });

    expect(await screen.findByText('gpt-5.6-mini')).toBeTruthy();
    expect(screen.getByText('gpt-5.6-sol')).toBeTruthy();
    expect(screen.getByText('o4-standard')).toBeTruthy();
  });

  it('renders the whole list when expanded with a value selected', async () => {
    renderModelField();
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
    renderModelField();
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
    renderModelField({ schemaVersion: 1, configured: false, models: [] });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps a custom id that is not in the fetched list', async () => {
    renderModelField();
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'ft:snapshot-2026' } });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('ft:snapshot-2026');
    });
    expect(screen.queryByText('gpt-5.6-mini')).toBeNull();
  });

  it('behaves as a plain text field when no key is configured', async () => {
    vi.mocked(api.listOpenAiModels).mockResolvedValue({
      schemaVersion: 1,
      configured: false,
      models: [],
    });
    renderModelField();
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-anything' } });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('gpt-anything');
    });
    expect(screen.queryByText('gpt-5.6-mini')).toBeNull();
  });

  it('behaves as a plain text field when the models query fails', async () => {
    vi.mocked(api.listOpenAiModels).mockRejectedValue(
      new ApiError(503, 'openai_network', 'OpenAI is unreachable.'),
    );
    renderModelField();
    const input = screen.getByLabelText('Model');
    fireEvent.change(input, { target: { value: 'gpt-anything' } });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('gpt-anything');
    });
    expect(screen.queryByText('gpt-5.6-mini')).toBeNull();
  });
});
