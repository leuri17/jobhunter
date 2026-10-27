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
      migrateApiKey: vi.fn(),
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

// Vitest runs the sidecar-less standalone path, so the default mock
// mirrors what it would report: file store, no bridge configured.
const UNCONFIGURED: ApiKeyResponse = {
  schemaVersion: 1,
  configured: false,
  source: 'none',
  masked: '',
  backend: 'file',
  backendReason: 'bridge_not_configured',
  legacyFilePresent: false,
};

const CONFIGURED: ApiKeyResponse = {
  schemaVersion: 1,
  configured: true,
  source: 'stored',
  masked: 'sk-…old1',
  backend: 'keychain',
  legacyFilePresent: false,
};

const NO_KEYCHAIN: ApiKeyResponse = {
  schemaVersion: 1,
  configured: false,
  source: 'none',
  masked: '',
  backend: 'file',
  backendReason: 'keychain_unavailable',
  legacyFilePresent: false,
};

const LEGACY_ON_KEYCHAIN: ApiKeyResponse = {
  schemaVersion: 1,
  configured: false,
  source: 'none',
  masked: '',
  backend: 'keychain',
  legacyFilePresent: true,
};

const SAVED_TO_FILE: PutApiKeyResponse = {
  schemaVersion: 1,
  status: 'validated',
  configured: true,
  source: 'stored',
  masked: 'sk-…abcd',
  backend: 'file',
  backendReason: 'keychain_unavailable',
};

const REJECTED_WITH_KEY_COPY =
  'OpenAI rejected this key. Nothing was saved — the previously configured key is still active.';
const REJECTED_WITHOUT_KEY_COPY = 'OpenAI rejected this key. Nothing was saved.';
const UNREACHABLE_COPY =
  "Couldn't reach OpenAI to validate the key. Nothing was saved — try again.";
const KEYCHAIN_LINE_COPY = 'Stored in your OS keychain.';
const NO_KEYCHAIN_NOTICE_COPY =
  'No OS keychain is available on this machine, so a saved key is written to a local secrets file. The file is protected by its permissions, not by OS encryption.';
const STANDALONE_NOTE_COPY =
  'Running without the desktop shell, so keys are stored in a local file instead of the OS keychain.';
const KEYCHAIN_GONE_COPY =
  'The OS keychain is not available right now, so nothing was saved. Try again in a moment.';
const MIGRATE_FAILED_COPY = 'The old secrets file was left unchanged. You can try again.';
const LEGACY_SHADOWED_MESSAGE =
  'The keychain already holds an API key, so it stays the active source; the secrets file was not changed.';

function rejectedByOpenAI(): ApiError {
  return new ApiError(401, 'openai_authentication', 'OpenAI authentication failed.');
}

// The backend status line renders only once the status query has
// settled, so it doubles as the readiness marker before any submit.
const BACKEND_LINE_COPIES = [KEYCHAIN_LINE_COPY, NO_KEYCHAIN_NOTICE_COPY, STANDALONE_NOTE_COPY];

async function typeAndSave(key: string): Promise<void> {
  await waitFor(() => {
    expect(BACKEND_LINE_COPIES.some((copy) => screen.queryByText(copy) !== null)).toBe(true);
  });
  fireEvent.change(screen.getByLabelText('Key'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
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
    await typeAndSave('sk-typed');

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
      backend: 'keychain',
    });

    renderSection();
    await typeAndSave('sk-typed');

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
    await typeAndSave('sk-typed');

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
    await typeAndSave('sk-typed');
    await screen.findByRole('alertdialog');

    expect(screen.queryByTestId('api-error-dialog-action')).toBeNull();
  });

  it('keeps the typed key when the rejection dialog is dismissed', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    await typeAndSave('sk-typed');
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
  });

  it('drops the prior-key claim when nothing was configured before the rejection', async () => {
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    await typeAndSave('sk-typed');

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
    await typeAndSave('sk-typed');

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(UNREACHABLE_COPY)).toBeTruthy();
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('keeps the rejection reason inside the dialog trace disclosure', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);
    vi.mocked(api.setApiKey).mockRejectedValue(rejectedByOpenAI());

    renderSection();
    await typeAndSave('sk-typed');
    await screen.findByRole('alertdialog');

    expect(screen.queryByTestId('api-error-dialog-trace')).toBeNull();
    fireEvent.click(screen.getByTestId('api-error-dialog-trace-toggle'));
    expect(screen.getByTestId('api-error-dialog-trace').textContent).toContain(
      'openai_authentication',
    );
  });
});

describe('<ApiKeySection /> backend status line', () => {
  it('states the OS keychain as the storage location on the keychain backend', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);

    renderSection();

    expect(await screen.findByText(KEYCHAIN_LINE_COPY)).toBeTruthy();
    expect(screen.queryByText(NO_KEYCHAIN_NOTICE_COPY)).toBeNull();
  });

  it('notices that a saved key will live in a local file when no keychain is available', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(NO_KEYCHAIN);

    renderSection();

    expect(await screen.findByText(NO_KEYCHAIN_NOTICE_COPY)).toBeTruthy();
    expect(screen.queryByText(KEYCHAIN_LINE_COPY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move to keychain' })).toBeNull();
  });

  it('quietly notes file storage when running without the desktop shell', async () => {
    renderSection();

    expect(await screen.findByText(STANDALONE_NOTE_COPY)).toBeTruthy();
    expect(screen.queryByText(NO_KEYCHAIN_NOTICE_COPY)).toBeNull();
  });
});

describe('<ApiKeySection /> plaintext-file consent', () => {
  it('asks before saving to a plaintext file and sends the fallback flag only on confirm', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(NO_KEYCHAIN);
    vi.mocked(api.setApiKey).mockResolvedValue(SAVED_TO_FILE);

    renderSection();
    await typeAndSave('sk-typed');

    expect(await screen.findByTestId('plaintext-consent-dialog')).toBeTruthy();
    expect(api.setApiKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }));

    await waitFor(() => expect(api.setApiKey).toHaveBeenCalledWith('sk-typed', true));
    await waitFor(() =>
      expect(toast.add).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'API key saved', type: 'success' }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('plaintext-consent-dialog')).toBeNull());
  });

  it('aborts the save without a request when the consent dialog is cancelled', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(NO_KEYCHAIN);

    renderSection();
    await typeAndSave('sk-typed');
    await screen.findByTestId('plaintext-consent-dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('plaintext-consent-dialog')).toBeNull());
    expect(api.setApiKey).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('sk-typed');
  });

  it('surfaces a keychain that broke after load through the save dialog', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(CONFIGURED);
    vi.mocked(api.setApiKey).mockRejectedValue(
      new ApiError(503, 'secrets_backend_unavailable', 'The OS keychain is unavailable.'),
    );

    renderSection();
    await typeAndSave('sk-typed');

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText("Couldn't save the API key")).toBeTruthy();
    expect(screen.getByText(KEYCHAIN_GONE_COPY)).toBeTruthy();
    expect(screen.queryByTestId('plaintext-consent-dialog')).toBeNull();
  });
});

describe('<ApiKeySection /> legacy file migration', () => {
  it('offers migration only when a legacy file exists on the keychain backend', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(LEGACY_ON_KEYCHAIN);

    renderSection();

    expect(await screen.findByRole('button', { name: 'Move to keychain' })).toBeTruthy();
  });

  it('hides the migration affordance when the backend is not the keychain', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue({ ...NO_KEYCHAIN, legacyFilePresent: true });

    renderSection();

    await screen.findByText(NO_KEYCHAIN_NOTICE_COPY);
    expect(screen.queryByRole('button', { name: 'Move to keychain' })).toBeNull();
  });

  it('moves the legacy key into the keychain and refreshes the status', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(LEGACY_ON_KEYCHAIN);
    vi.mocked(api.migrateApiKey).mockResolvedValue({
      schemaVersion: 1,
      migrated: true,
      source: 'stored',
      backend: 'keychain',
      masked: 'sk-…legacy',
    });

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to keychain' }));

    await waitFor(() =>
      expect(toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Key moved to the OS keychain',
          type: 'success',
        }),
      ),
    );
    await waitFor(() => expect(api.getApiKeyStatus).toHaveBeenCalledTimes(2));
  });

  it('reports 200 outcomes where nothing was moved as a toast', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(LEGACY_ON_KEYCHAIN);
    vi.mocked(api.migrateApiKey).mockResolvedValue({
      schemaVersion: 1,
      migrated: false,
      reason: 'nothing_to_migrate',
    });

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to keychain' }));

    await waitFor(() =>
      expect(toast.add).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'The key was not moved', type: 'warning' }),
      ),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the 409 message in the dialog when the keychain already holds a key', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(LEGACY_ON_KEYCHAIN);
    vi.mocked(api.migrateApiKey).mockRejectedValue(
      new ApiError(409, 'legacy_shadowed', LEGACY_SHADOWED_MESSAGE),
    );

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to keychain' }));

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText("Couldn't move the key to the OS keychain")).toBeTruthy();
    expect(screen.getByText(LEGACY_SHADOWED_MESSAGE)).toBeTruthy();
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('routes other migration failures through the dialog with retry copy', async () => {
    vi.mocked(api.getApiKeyStatus).mockResolvedValue(LEGACY_ON_KEYCHAIN);
    vi.mocked(api.migrateApiKey).mockRejectedValue(
      new ApiError(
        503,
        'secrets_backend_unavailable',
        'The OS keychain is unavailable; the secrets file was left untouched.',
      ),
    );

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to keychain' }));

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText("Couldn't move the key to the OS keychain")).toBeTruthy();
    expect(screen.getByText(MIGRATE_FAILED_COPY)).toBeTruthy();
  });
});
