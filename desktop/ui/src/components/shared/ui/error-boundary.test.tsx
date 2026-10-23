// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrorBoundary, RetryPanel } from '@/components/shared/ui/error-boundary';
import { ApiError } from '@/lib/api';

afterEach(() => {
  cleanup();
});

function ThrowingChild(props: { message: string }): ReactNode {
  throw new Error(props.message);
}

describe('<ErrorBoundary />', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">healthy</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok').textContent).toBe('healthy');
  });

  it('renders <RetryPanel/> fallback when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="usePipelineEvents JSON.parse failure" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/usePipelineEvents JSON\.parse failure/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('recovers and re-renders the children when the user clicks Retry', () => {
    let throwNext = true;
    function Toggle() {
      if (throwNext) throw new Error('first render fails');
      return <div data-testid="recovered">ok now</div>;
    }

    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    throwNext = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(screen.getByTestId('recovered').textContent).toBe('ok now');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('<RetryPanel />', () => {
  it('shows the error message and a Retry button', () => {
    render(<RetryPanel error={new Error('boom')} onRetry={() => undefined} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('invokes onRetry when the Retry button is clicked', () => {
    let clicks = 0;
    render(<RetryPanel error={new Error('boom')} onRetry={() => clicks++} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(clicks).toBe(1);
  });

  it('shows sidecar copy for a sidecar_unreachable ApiError', () => {
    render(
      <RetryPanel
        error={new ApiError(502, 'sidecar_unreachable', 'The JobHunter sidecar is not responding.')}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: "Couldn't reach the sidecar." })).toBeTruthy();
    expect(
      screen.getByText(
        'Is the JobHunter desktop app running? The rest of the app is still reachable from the sidebar.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('The JobHunter sidecar is not responding.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^retry$/i }).length).toBe(1);
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('renders a generic ApiError exactly like any other error', () => {
    render(
      <RetryPanel
        error={new ApiError(500, 'internal_error', 'Internal server error')}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(
      screen.getByText(
        'The current view failed to render. The rest of the app is still reachable from the sidebar.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Internal server error')).toBeTruthy();
    expect(screen.queryByText("Couldn't reach the sidecar.")).toBeNull();
    expect(screen.getAllByRole('button', { name: /^retry$/i }).length).toBe(1);
  });
});
