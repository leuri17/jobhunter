// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiKeySection } from '@/components/shared/features/settings/api-key/api-key-section';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { ApiKeyResponse, PutApiKeyResponse } from '@/lib/types';

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
    },
  };
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiKeySection />
    </QueryClientProvider>,
  );
}

function typeAndSave(key: string): void {
  fireEvent.change(screen.getByLabelText('Key'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
}

const UNCONFIGURED: ApiKeyResponse = {
  schemaVersion: 1,
  configured: false,
  source: 'none',
  masked: '',
};

const CONFIGURED: ApiKeyResponse = {
  schemaVersion: 1,
  configured: true,
  source: 'stored',
  masked: 'sk-…old1',
};

const REJECTED_WITH_KEY_COPY =
  'OpenAI rejected this key. Nothing was saved — the previously configured key is still active.';
const REJECTED_WITHOUT_KEY_COPY = 'OpenAI rejected this key. Nothing was saved.';
const UNREACHABLE_COPY =
  "Couldn't reach OpenAI to validate the key. Nothing was saved — try again.";

function rejectedByOpenAI(): ApiError {
  return new ApiError(401, 'openai_authentication', 'OpenAI authentication failed.');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getApiKeyStatus).mockResolvedValue(UNCONFIGURED);
});

afterEach(() => {
  cleanup();
});

describe('<ApiKeySection />', () => {
  it('relabels the save button to "Validating key…" and disables the field while the probe runs', async () => {
    const validation = deferred<PutApiKeyResponse>();
    vi.mocked(api.setApiKey).mockReturnValue(validation.promise);

    renderSection();
    typeAndSave('sk-typed');

    const button = await screen.findByRole('button', { name: 'Validating key…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Key') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps the success toast and clears the input when the key validates', async () => {
    vi.mocked(api.setApiKey).mockResolvedValue({
      schemaVersion: 1,
      status: 'validated',
      configured: true,
      source: 'stored',
      masked: 'sk-…abcd',
    });

    renderSection();
    typeAndSave('sk-typed');

    await waitFor(() =>
      expect(toast.add).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'API key saved', type: 'success' }),
      ),
    );
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the rejection dialog with prior-key copy and keeps the typed key in the input', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    typeAndSave('sk-typed');

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText("Couldn't save the API key")).toBeTruthy();
    expect(screen.getByText(REJECTED_WITH_KEY_COPY)).toBeTruthy();
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('offers only Close on the rejection dialog', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    typeAndSave('sk-typed');
    await screen.findByRole('alertdialog');

    expect(screen.queryByTestId('api-error-dialog-action')).toBeNull();
  });

  it('keeps the typed key when the rejection dialog is dismissed', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    typeAndSave('sk-typed');
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
  });

  it('drops the prior-key claim when nothing was configured before the rejection', async () => {
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    typeAndSave('sk-typed');

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(REJECTED_WITHOUT_KEY_COPY)).toBeTruthy();
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('shows the retry copy when OpenAI cannot be reached to validate', async () => {
    vi.mocked(api.setApiKey).mockRejectedValue(
      new ApiError(503, 'openai_network_error', 'OpenAI network failure.'),
    );

    renderSection();
    typeAndSave('sk-typed');

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(UNREACHABLE_COPY)).toBeTruthy();
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('keeps the rejection reason inside the dialog trace disclosure', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    typeAndSave('sk-typed');
    await screen.findByRole('alertdialog');

    expect(screen.queryByTestId('api-error-dialog-trace')).toBeNull();
    fireEvent.click(screen.getByTestId('api-error-dialog-trace-toggle'));
    expect(screen.getByTestId('api-error-dialog-trace').textContent).toContain(
      'openai_authentication',
    );
  });
});
