// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChipListEditor } from './chip-list-editor';

afterEach(cleanup);

describe('ChipListEditor', () => {
  it('adds on Enter and ignores empty input', () => {
    const onChange = vi.fn();
    render(
      <ChipListEditor
        values={['React']}
        onChange={onChange}
        addPlaceholder="Add a technology…"
        removeLabel={(v) => `Remove ${v}`}
      />,
    );
    const input = screen.getByPlaceholderText('Add a technology…');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Rust' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['React', 'Rust']);
  });

  it('ignores duplicates', () => {
    const onChange = vi.fn();
    render(
      <ChipListEditor
        values={['React']}
        onChange={onChange}
        addPlaceholder="Add…"
        removeLabel={(v) => `Remove ${v}`}
      />,
    );
    const input = screen.getByPlaceholderText('Add…');
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a chip via its button', () => {
    const onChange = vi.fn();
    render(
      <ChipListEditor
        values={['React', 'Rust']}
        onChange={onChange}
        addPlaceholder="Add…"
        removeLabel={(v) => `Remove ${v}`}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove React' }));
    expect(onChange).toHaveBeenCalledWith(['Rust']);
  });
});
