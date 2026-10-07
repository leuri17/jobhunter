// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrorBoundary, RetryPanel } from '@/components/error-boundary';

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
});
