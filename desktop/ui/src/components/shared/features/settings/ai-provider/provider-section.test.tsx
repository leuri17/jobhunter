// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { AI_PROVIDER_CHOICES, DEFAULT_OPERATIONAL_CONFIG } from '@jobhunter/core/config/schemas';

import { ProviderSection } from '@/components/shared/features/settings/ai-provider/provider-section';
import type { SectionForm } from '@/components/shared/features/settings/ai-provider/types';
import { api } from '@/lib/api';
import type { ApiKeyResponse } from '@/lib/types';

vi.mock('@/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ApiError: actual.ApiError,
    api: {
      getApiKeyStatus: vi.fn(),
      setApiKey: vi.fn(),
      clearApiKey: vi.fn(),
      migrateApiKey: vi.fn(),
    },
  };
});

interface FormHandle {
  readonly state: { readonly values: typeof DEFAULT_OPERATIONAL_CONFIG };
}

let latestForm: FormHandle | null = null;

function Harness() {
  const form = useForm({ defaultValues: DEFAULT_OPERATIONAL_CONFIG });
  latestForm = form as unknown as FormHandle;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ProviderSection form={form as unknown as SectionForm} />
    </QueryClientProvider>
  );
}

function renderSection() {
  latestForm = null;
  return render(<Harness />);
}

function selectProvider(label: string) {
  fireEvent.click(screen.getByRole('combobox'));
  const option = screen.getByRole('option', { name: label });
  fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
  fireEvent.click(option);
}

function keyStatus(provider: 'openrouter' | 'groq'): ApiKeyResponse {
  return {
    schemaVersion: 1,
    configured: false,
    source: 'none',
    provider,
    masked: '',
    backend: 'file',
    backendReason: 'bridge_not_configured',
    legacyFilePresent: false,
  };
}

beforeEach(() => {
  vi.mocked(api.getApiKeyStatus).mockImplementation(async (provider) =>
    keyStatus(provider === 'groq' ? 'groq' : 'openrouter'),
  );
});

afterEach(() => {
  cleanup();
  latestForm = null;
  vi.clearAllMocks();
});

describe('ProviderSection', () => {
  it('shows the selected provider', () => {
    renderSection();
    expect(screen.getByRole('combobox').textContent).toContain('OpenRouter');
  });

  it('lists every catalog provider in the select', () => {
    renderSection();
    fireEvent.click(screen.getByRole('combobox'));
    for (const choice of AI_PROVIDER_CHOICES) {
      expect(screen.getByRole('option', { name: choice.label })).toBeDefined();
    }
  });

  it('reveals the base URL field only for custom providers', () => {
    renderSection();
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
    selectProvider('Custom…');
    expect(screen.getByLabelText(/base url/i)).toBeDefined();
    selectProvider('OpenAI');
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
  });

  it('keeps the custom URL while custom is selected and clears it when switching away', async () => {
    renderSection();
    selectProvider('Custom…');
    const input = screen.getByLabelText(/base url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://compat-proxy.example/v1' } });
    expect(input.value).toBe('https://compat-proxy.example/v1');
    selectProvider('Groq');
    await waitFor(() => {
      expect(latestForm!.state.values.aiProvider.baseUrl).toBeUndefined();
    });
    expect(latestForm!.state.values.aiProvider.provider).toBe('groq');
  });

  it('rejects a non-URL custom base URL with a validation error', () => {
    renderSection();
    selectProvider('Custom…');
    const input = screen.getByLabelText(/base url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not-a-url' } });
    fireEvent.blur(input);
    expect(input.closest('[data-invalid]')?.getAttribute('data-invalid')).toBe('true');
  });
});

describe('ProviderSection hosts the API key (#359)', () => {
  it('shows the key block under the provider select and asks for the selected provider', async () => {
    renderSection();

    expect(screen.getByLabelText('Key')).toBeTruthy();
    await waitFor(() => expect(api.getApiKeyStatus).toHaveBeenCalledWith('openrouter'));
  });

  it('requests the key for the provider chosen in the select', async () => {
    renderSection();

    selectProvider('Groq');

    await waitFor(() => expect(api.getApiKeyStatus).toHaveBeenCalledWith('groq'));
  });

  it('switching provider does not write a key', async () => {
    renderSection();

    selectProvider('Groq');
    await waitFor(() => expect(api.getApiKeyStatus).toHaveBeenCalledWith('groq'));

    expect(api.setApiKey).not.toHaveBeenCalled();
    expect(latestForm!.state.values.aiProvider.provider).toBe('groq');
  });

  it('does not offer to save a custom key until the endpoint URL is typed', async () => {
    renderSection();
    selectProvider('Custom…');
    await screen.findByText(/Running without the desktop shell/);

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'sk-test-1' } });
    expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText(/base url/i), {
      target: { value: 'https://compat-proxy.example/v1' },
    });
    expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
