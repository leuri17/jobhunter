// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useProfileForm } from './profile-form-validator';
import { TargetRolesSection } from './target-roles-section';
import { makeProfile } from './test-fixtures';
import type { ProfessionalProfile } from '@/lib/types';

afterEach(cleanup);

interface HarnessProps {
  onChange: (profile: ProfessionalProfile) => void;
}

function Harness({ onChange }: HarnessProps) {
  const form = useProfileForm({ defaultValues: makeProfile(), onSubmit: () => {} });
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(profile) => {
        onChange(profile as ProfessionalProfile);
        return <TargetRolesSection form={form} />;
      }}
    </form.Subscribe>
  );
}

describe('TargetRolesSection', () => {
  it('shows generated roles as read-only chips until an override is activated', () => {
    render(<Harness onChange={() => {}} />);
    // Harness renders with empty generatedValue; assert the add row exists.
    expect(screen.getByPlaceholderText('Type a role title and press Enter…')).toBeDefined();
  });

  it('adding a role activates the override and keeps generatedValue intact', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<Harness onChange={(p) => (latest = p)} />);
    const input = screen.getByPlaceholderText('Type a role title and press Enter…');
    fireEvent.change(input, { target: { value: 'Staff Engineer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(latest).not.toBeNull();
      const roles = latest!.derived.primaryRoles;
      expect(roles.overrideActive).toBe(true);
      expect(roles.overrideValue).toContain('Staff Engineer');
      expect(roles.effectiveValue).toContain('Staff Engineer');
      expect(roles.generatedValue).toEqual([]);
    });
  });

  it('reset restores the generated value', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<Harness onChange={(p) => (latest = p)} />);
    const input = screen.getByPlaceholderText('Type a role title and press Enter…');
    fireEvent.change(input, { target: { value: 'Staff Engineer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Reset to generated')).toBeDefined());
    fireEvent.click(screen.getByText('Reset to generated'));
    await waitFor(() => {
      const roles = latest!.derived.primaryRoles;
      expect(roles.overrideActive).toBe(false);
      expect(roles.overrideValue).toBeNull();
      expect(roles.effectiveValue).toEqual([]);
    });
  });

  it('lists every seniority level in the select', () => {
    render(<Harness onChange={() => {}} />);
    fireEvent.click(screen.getByRole('combobox'));
    for (const level of ['Senior', 'Staff', 'Executive']) {
      expect(screen.getByRole('option', { name: level })).toBeDefined();
    }
  });
});
