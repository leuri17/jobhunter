// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import { ApiError } from '@/lib/api';

afterEach(() => {
  cleanup();
});

function openaiUnavailable(): ApiError {
  return new ApiError(503, 'openai_unavailable', 'No OpenAI API key is configured');
}

describe('<ApiErrorDialog />', () => {
  it('renders nothing while the error is null', () => {
    render(
      <ApiErrorDialog error={null} title="Couldn't start the pipeline" onDismiss={() => {}} />,
    );
    expect(screen.queryByTestId('api-error-dialog')).toBeNull();
  });

  it('shows the title and the status/code/message detail for the failed request', () => {
    render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't start the pipeline"
        onDismiss={() => {}}
      >
        <p>The run didn't start.</p>
      </ApiErrorDialog>,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText("Couldn't start the pipeline")).toBeTruthy();
    expect(screen.getByText(/The run didn't start\./)).toBeTruthy();
    expect(
      screen.getByText(/503 openai_unavailable — No OpenAI API key is configured/),
    ).toBeTruthy();
  });

  it('shows the guidance copy for an action-required code', () => {
    render(
      <ApiErrorDialog
        error={openaiUnavailable()}
        title="Couldn't start the pipeline"
        onDismiss={() => {}}
      />,
    );

    expect(
      screen.getByText('Add your OpenAI API key in Settings, under AI Provider.'),
    ).toBeTruthy();
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

    // The footer Close and the header X both carry the accessible name
    // "Close"; either dismissal path must clear the error.
    const [closeButton] = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButton!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
