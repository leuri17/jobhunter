// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import { ApiError } from '@/lib/api';
import { ACTION_GUIDANCE } from '@/lib/error-surfaces';

afterEach(() => {
  cleanup();
});

function openaiUnavailable(): ApiError {
  return new ApiError(503, 'openai_unavailable', 'No OpenAI API key is configured');
}

function mockClipboardWriteText(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function openTrace(): HTMLElement {
  const toggle = screen.getByTestId('api-error-dialog-trace-toggle');
  fireEvent.click(toggle);
  return screen.getByTestId('api-error-dialog-trace');
}

describe('<ApiErrorDialog />', () => {
  it('renders nothing while the error is null', () => {
    render(
      <ApiErrorDialog error={null} title="Couldn't start the pipeline" onDismiss={() => {}} />,
    );
    expect(screen.queryByTestId('api-error-dialog')).toBeNull();
  });

  it('shows the plain-language help and keeps the technical trace hidden by default', () => {
    render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't start the pipeline"
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText("Couldn't start the pipeline")).toBeTruthy();
    expect(
      screen.getByText('Add your OpenAI API key in Settings, under AI Provider.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('api-error-dialog-trace')).toBeNull();

    const toggle = screen.getByTestId('api-error-dialog-trace-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('falls back to generic context copy when the call site passes none', () => {
    render(
      <ApiErrorDialog
        error={new ApiError(500, 'internal_error', 'Internal server error')}
        title="Couldn't save settings"
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByText(/It didn't go through\. You can try again\./)).toBeTruthy();
  });

  it('reveals the status/code/message trace when More info is pressed', () => {
    render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't start the pipeline"
        onDismiss={() => {}}
      />,
    );

    const trace = openTrace();
    expect(trace.textContent).toBe(
      'status: 503\ncode: openai_unavailable\nmessage: No OpenAI API key is configured',
    );
    expect(screen.getByTestId('api-error-dialog-trace-toggle').getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('copies the trace to the clipboard and confirms it', async () => {
    const writeText = mockClipboardWriteText();
    render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't start the pipeline"
        onDismiss={() => {}}
      />,
    );

    openTrace();
    const copy = screen.getByTestId('api-error-dialog-copy');
    expect(copy.textContent).toBe('Copy details');

    fireEvent.click(copy);
    await waitFor(() =>
      expect(screen.getByTestId('api-error-dialog-copy').textContent).toBe('Copied'),
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      'status: 503\ncode: openai_unavailable\nmessage: No OpenAI API key is configured',
    );
  });

  it("falls back to the failed action's guidance when the code has none", () => {
    const onAction = vi.fn();
    render(
      <ApiErrorDialog
        error={new ApiError(500, 'internal_error', 'Internal server error')}
        title="Couldn't save settings"
        guidance={ACTION_GUIDANCE.settingsSave}
        onAction={onAction}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByText('Nothing was saved. Your edits are still in the form.')).toBeTruthy();
    const action = screen.getByTestId('api-error-dialog-action');
    expect(action.textContent).toBe('Retry saving');
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('lets code guidance win over the action fallback when both apply', () => {
    render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't save settings"
        guidance={ACTION_GUIDANCE.settingsSave}
        onAction={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(
      screen.getByText('Add your OpenAI API key in Settings, under AI Provider.'),
    ).toBeTruthy();
    expect(screen.getByTestId('api-error-dialog-action').textContent).toBe('Open settings');
  });

  it('renders the guidance action button only for action-required codes', () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't start the pipeline"
        onDismiss={() => {}}
        onAction={onAction}
      />,
    );

    const action = screen.getByTestId('api-error-dialog-action');
    expect(action.textContent).toBe('Open settings');
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(
      <ApiErrorDialog
        error={new ApiError(500, 'internal_error', 'Internal server error')}
        title="Couldn't start the pipeline"
        onDismiss={() => {}}
        onAction={onAction}
      />,
    );
    expect(screen.queryByTestId('api-error-dialog-action')).toBeNull();
  });

  it('invokes onDismiss when the dialog is closed', () => {
    const onDismiss = vi.fn();
    render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't start the pipeline"
        onDismiss={onDismiss}
      />,
    );

    // The footer Close is the only dismissal button; Escape and
    // backdrop land on the same onDismiss path.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
