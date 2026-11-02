// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConflictsSection } from './conflicts-section';
import type { ProfileConflictRow, ProfileWarningRow } from '@/lib/types';

afterEach(cleanup);

const conflict = (over: Partial<ProfileConflictRow> = {}): ProfileConflictRow => ({
  id: 1,
  profileVersionId: 1,
  conflictType: 'experience.company',
  affectedField: 'experience[0].company',
  valueSourceA: 'Acme GmbH',
  valueSourceB: 'Acme Inc.',
  sourceReferences: [],
  provisionalValue: null,
  explanation: 'Sources disagree on the company name.',
  resolutionStatus: 'unresolved',
  resolvedAt: null,
  resolvedValue: null,
  ...over,
});

const warning = (over: Partial<ProfileWarningRow> = {}): ProfileWarningRow => ({
  id: 2,
  profileVersionId: 1,
  severity: 'warning',
  warningType: 'employment_gap',
  fieldPath: 'experience[1].startDate',
  message: 'Employment gap between 2016 and 2018 is unexplained.',
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

describe('ConflictsSection', () => {
  it('renders conflict rows with both values and the resolution status', () => {
    render(<ConflictsSection conflicts={[conflict()]} warnings={[warning()]} />);
    expect(screen.getByText('experience.company')).toBeDefined();
    expect(screen.getByText(/Acme GmbH/)).toBeDefined();
    expect(screen.getByText(/Acme Inc\./)).toBeDefined();
    expect(screen.getByText('Unresolved')).toBeDefined();
    expect(screen.getByText('Conflicts (1)')).toBeDefined();
    expect(screen.getByText('Warnings (1)')).toBeDefined();
    expect(screen.getByText(/Employment gap between 2016 and 2018/)).toBeDefined();
  });

  it('shows the empty state when there is nothing to review', () => {
    render(<ConflictsSection conflicts={[]} warnings={[]} />);
    expect(screen.getByText(/no conflicts or warnings/i)).toBeDefined();
  });
});
