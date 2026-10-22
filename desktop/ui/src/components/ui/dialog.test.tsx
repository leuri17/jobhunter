// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

afterEach(() => {
  cleanup();
});

function ControlledDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete run</DialogTitle>
          <DialogDescription>This removes the run record from the database.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('<Dialog />', () => {
  it('does not render content until the trigger is pressed', () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uncontrolled</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Uncontrolled')).toBeTruthy();
  });

  it('renders an accessible dialog with title and description when open', () => {
    render(<ControlledDialog open onOpenChange={() => {}} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Delete run')).toBeTruthy();
    expect(screen.getByText(/removes the run record/i)).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    render(<ControlledDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls onOpenChange(false) when the header close button is clicked', () => {
    const onOpenChange = vi.fn();
    render(<ControlledDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('calls onOpenChange(false) when the footer close action is clicked', () => {
    const onOpenChange = vi.fn();
    render(<ControlledDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('calls onOpenChange(false) on Escape', () => {
    const onOpenChange = vi.fn();
    render(<ControlledDialog open onOpenChange={onOpenChange} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('calls onOpenChange(false) when the backdrop is clicked', () => {
    const onOpenChange = vi.fn();
    const { container } = render(<ControlledDialog open onOpenChange={onOpenChange} />);

    const overlay = container.ownerDocument.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
