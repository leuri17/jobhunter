// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CertificationsSection } from './certifications-section';
import { EducationSection } from './education-section';
import { useProfileForm } from './profile-form-validator';
import { makeProfile } from './test-fixtures';
import type { ProfessionalProfile } from '@/lib/types';

afterEach(cleanup);

function EducationHarness({ onChange }: { onChange: (profile: ProfessionalProfile) => void }) {
  const form = useProfileForm({ defaultValues: makeProfile(), onSubmit: () => {} });
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(profile) => {
        onChange(profile as ProfessionalProfile);
        return <EducationSection form={form} />;
      }}
    </form.Subscribe>
  );
}

function CertificationsHarness({ onChange }: { onChange: (profile: ProfessionalProfile) => void }) {
  const form = useProfileForm({ defaultValues: makeProfile(), onSubmit: () => {} });
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(profile) => {
        onChange(profile as ProfessionalProfile);
        return <CertificationsSection form={form} />;
      }}
    </form.Subscribe>
  );
}

describe('EducationSection', () => {
  it('adds an education entry and renders its fields', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<EducationHarness onChange={(p) => (latest = p)} />);
    fireEvent.click(screen.getByText('Add education'));
    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(latest!.education.length).toBe(1);
    });
    expect(screen.getByLabelText('Institution')).toBeDefined();
  });
});

describe('CertificationsSection', () => {
  it('adds a certification entry', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<CertificationsHarness onChange={(p) => (latest = p)} />);
    fireEvent.click(screen.getByText('Add certification'));
    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(latest!.certifications.length).toBe(1);
    });
    expect(screen.getByLabelText('Credential URL')).toBeDefined();
  });
});
