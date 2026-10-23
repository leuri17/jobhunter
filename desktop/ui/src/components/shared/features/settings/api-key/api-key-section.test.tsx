// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiKeySection } from '@/components/shared/features/settings/api-key/api-key-section';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import type { ApiKeyResponse, PutApiKeyResponse } from '@/lib/types';

vi.mock('@/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    getApiKeyStatus: vi.fn(),
    setApiKey: vi.fn(),
    clearApiKey: vi.fn(),
  },
}));

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

const REJECTED_COPY =
  'OpenAI rejected this key. Nothing was saved — the previously configured key is still active.';
const UNREACHABLE_COPY =
  "Couldn't reach OpenAI to validate the key. Nothing was saved — try again.";

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
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a rejected key inline and keeps the typed key in the input', async () => {
    vi.mocked(api.setApiKey).mockResolvedValue({
      schemaVersion: 1,
      status: 'rejected',
      reason: 'openai_authentication',
      configured: true,
      source: 'stored',
      masked: 'sk-…old1',
    });

    renderSection();
    typeAndSave('sk-typed');

    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe(REJECTED_COPY);
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
    expect(screen.getByLabelText('Key').getAttribute('aria-invalid')).toBe('true');
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('keeps the rejection reason inside a closed technical disclosure', async () => {
    vi.mocked(api.setApiKey).mockResolvedValue({
      schemaVersion: 1,
      status: 'rejected',
      reason: 'openai_authentication',
      configured: true,
      source: 'stored',
      masked: 'sk-…old1',
    });

    renderSection();
    typeAndSave('sk-typed');

    const reason = await screen.findByText('openai_authentication');
    const disclosure = reason.closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(false);
  });

  it('reports an unreachable probe inline and keeps the typed key in the input', async () => {
    vi.mocked(api.setApiKey).mockResolvedValue({
      schemaVersion: 1,
      status: 'unreachable',
      reason: 'openai_network',
      configured: false,
      source: 'none',
      masked: '',
    });

    renderSection();
    typeAndSave('sk-typed');

    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe(UNREACHABLE_COPY);
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('clears the inline feedback once the user edits the key again', async () => {
    vi.mocked(api.setApiKey).mockResolvedValue({
      schemaVersion: 1,
      status: 'rejected',
      reason: 'openai_authentication',
      configured: true,
      source: 'stored',
      masked: 'sk-…old1',
    });

    renderSection();
    typeAndSave('sk-typed');
    await screen.findByRole('alert');

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'sk-other' } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Key').getAttribute('aria-invalid')).toBe('false');
  });

  it('drops the prior-key claim when nothing was configured before the rejection', async () => {
    vi.mocked(api.setApiKey).mockResolvedValue({
      schemaVersion: 1,
      status: 'rejected',
      reason: 'openai_authentication',
      configured: false,
      source: 'none',
      masked: '',
    });

    renderSection();
    typeAndSave('sk-typed');

    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe(
      'OpenAI rejected this key. Nothing was saved.',
    );
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
    expect(toast.add).not.toHaveBeenCalled();
  });
});
