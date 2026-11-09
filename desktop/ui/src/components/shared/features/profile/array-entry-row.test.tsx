// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArrayEntryRow } from './array-entry-row';

afterEach(cleanup);

describe('ArrayEntryRow', () => {
  it('shows title and meta, hides content until toggled, removes via trash', () => {
    const onRemove = vi.fn();
    render(
      <ArrayEntryRow
        title="Senior Engineer · Canonical"
        meta="2021-03 — Present · Berlin"
        onRemove={onRemove}
        removeLabel="Remove experience"
      >
        <input aria-label="Company" />
      </ArrayEntryRow>,
    );
    expect(screen.getByText('2021-03 — Present · Berlin')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /senior engineer/i }));
    expect(screen.getByRole('textbox')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove experience' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('opens by default when defaultOpen', () => {
    render(
      <ArrayEntryRow title="New entry" onRemove={() => {}} removeLabel="Remove" defaultOpen>
        <input aria-label="Name" />
      </ArrayEntryRow>,
    );
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('renders the error dot and badges', () => {
    render(
      <ArrayEntryRow
        title="Broken entry"
        hasError
        badges={<span data-testid="badge">Draft</span>}
        onRemove={() => {}}
        removeLabel="Remove"
      >
        <input aria-label="Name" />
      </ArrayEntryRow>,
    );
    expect(screen.getByTestId('badge')).toBeDefined();
    expect(document.querySelector('.bg-destructive')).not.toBeNull();
  });
});
