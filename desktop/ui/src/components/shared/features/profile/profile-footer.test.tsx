// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileFooter } from './profile-footer';

vi.mock('@tanstack/react-router', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} href="/settings" />,
}));

const noop = () => {};

interface FooterProps {
  isDirty?: boolean;
  canSubmit?: boolean;
  isSubmitting?: boolean;
  invalid?: boolean;
  blockingCount?: number;
  warningCount?: number;
  extracting?: boolean;
  apiKeyConfigured?: boolean;
  mode?: 'dirty' | 'draft' | 'idle';
  onSave?: () => void;
  onDiscard?: () => void;
  onRunExtraction?: () => void;
  onApprove?: () => void;
  onGoToConflicts?: () => void;
}

function renderFooter(props: FooterProps = {}) {
  const p = {
    isDirty: false,
    canSubmit: true,
    isSubmitting: false,
    invalid: false,
    blockingCount: 0,
    warningCount: 0,
    extracting: false,
    apiKeyConfigured: true,
    mode: 'draft' as const,
    onSave: noop,
    onDiscard: noop,
    onRunExtraction: noop,
    onApprove: noop,
    onGoToConflicts: noop,
    ...props,
  };
  return { props: p, ...render(<ProfileFooter {...p} />) };
}

afterEach(cleanup);

describe('ProfileFooter', () => {
  it('shows Save draft and Discard while dirty', () => {
    renderFooter({ isDirty: true, mode: 'dirty' });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDefined();
    expect(screen.getByText(/unsaved changes/i)).toBeDefined();
  });

  it('shows an enabled Approve & publish when clean with a draft and no blocking conflicts', () => {
    renderFooter({ isDirty: false, mode: 'draft' });
    const approve = screen.getByRole('button', { name: 'Approve & publish' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
  });

  it('disables approve on blocking conflicts and links to the conflicts tab', () => {
    const onGoToConflicts = vi.fn();
    renderFooter({ blockingCount: 2, onGoToConflicts });
    const approve = screen.getByRole('button', { name: 'Approve & publish' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /2 blocking conflicts/i }));
    expect(onGoToConflicts).toHaveBeenCalledOnce();
  });

  it('replaces the extraction button with a Settings link when no API key', () => {
    renderFooter({ apiKeyConfigured: false });
    expect(screen.getByRole('link', { name: /add your ai provider api key/i })).toBeDefined();
  });

  it('shows the extracting state', () => {
    renderFooter({ extracting: true });
    expect(screen.getByText(/running extraction/i)).toBeDefined();
    const run = screen.getByRole('button', { name: /extracting/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it('confirms before running extraction', () => {
    const onRunExtraction = vi.fn();
    renderFooter({ onRunExtraction });
    fireEvent.click(screen.getByRole('button', { name: 'Run extraction' }));
    expect(screen.getByText('Run extraction?')).toBeDefined();
    expect(onRunExtraction).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Run extraction' });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(onRunExtraction).toHaveBeenCalledOnce();
  });

  it('surfaces invalid form state in the context line', () => {
    renderFooter({ invalid: true });
    expect(screen.getByText(/some fields need attention/i)).toBeDefined();
  });
});
