// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VersionStatusBadge } from './version-status-badge';

afterEach(cleanup);

describe('VersionStatusBadge', () => {
  it('renders all four statuses with distinct labels', () => {
    for (const [status, label] of [
      ['draft', 'Draft'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected'],
      ['superseded', 'Superseded'],
    ] as const) {
      render(<VersionStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeDefined();
      cleanup();
    }
  });
});
