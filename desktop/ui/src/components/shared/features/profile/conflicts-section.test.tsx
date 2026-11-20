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

  it('wraps long unbroken text in table cells instead of overflowing (#297)', () => {
    const longValueA = 'a'.repeat(200);
    const longExplanation = 'e'.repeat(200);
    const longFieldPath = 'f'.repeat(200);
    const longMessage = 'm'.repeat(200);
    const longConflict = conflict({
      valueSourceA: longValueA,
      affectedField: longFieldPath,
      explanation: longExplanation,
    });
    const longWarning = warning({ fieldPath: longFieldPath, message: longMessage });
    render(<ConflictsSection conflicts={[longConflict]} warnings={[longWarning]} />);

    expect(screen.getByText(longValueA).closest('td')?.className).toContain('whitespace-normal');
    expect(screen.getByText(longValueA).closest('td')?.className).toContain('break-words');
    expect(screen.getByText(longExplanation).closest('td')?.className).toContain('break-words');
    expect(screen.getByText(longMessage).closest('td')?.className).toContain('break-words');
    // Both mono field-path cells (conflicts + warnings tables) wrap too.
    const fieldPathNodes = screen.getAllByText(longFieldPath);
    expect(fieldPathNodes).toHaveLength(2);
    expect(fieldPathNodes[0]?.closest('td')?.className).toContain('break-words');
    expect(fieldPathNodes[1]?.closest('td')?.className).toContain('break-words');
  });
});
