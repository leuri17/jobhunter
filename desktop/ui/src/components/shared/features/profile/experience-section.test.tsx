// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useProfileForm } from './profile-form-validator';
import { ExperienceSection } from './experience-section';
import { ProjectsSection } from './projects-section';
import { makeProfile } from './test-fixtures';
import type { ProfessionalProfile, WorkExperience } from '@/lib/types';

afterEach(cleanup);

interface HarnessProps {
  profile: ProfessionalProfile;
  section: 'experience' | 'projects';
  onChange: (profile: ProfessionalProfile) => void;
}

function Harness({ profile, section, onChange }: HarnessProps) {
  const form = useProfileForm({ defaultValues: profile, onSubmit: () => {} });
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(values) => {
        onChange(values as ProfessionalProfile);
        return section === 'experience' ? (
          <ExperienceSection form={form} />
        ) : (
          <ProjectsSection form={form} />
        );
      }}
    </form.Subscribe>
  );
}

function acmeExperience(): WorkExperience {
  return {
    id: 'exp-acme-1',
    company: 'Acme',
    title: 'Engineer',
    location: null,
    startDate: '2021-03',
    endDate: '2023-01',
    isCurrent: false,
    summary: null,
    responsibilities: [],
    achievements: [],
    technologies: [],
    domains: [],
    sourceReferences: [],
  };
}

describe('ExperienceSection', () => {
  it('adds an expanded empty experience entry with a generated id', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<Harness profile={makeProfile()} section="experience" onChange={(p) => (latest = p)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add experience' }));
    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(latest!.experience.length).toBe(1);
      expect(latest!.experience[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
    });
    expect(screen.getByLabelText('Company')).toBeDefined();
  });

  it('checking current role disables end date', async () => {
    const profile = { ...makeProfile(), experience: [acmeExperience()] };
    render(<Harness profile={profile} section="experience" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Acme$/i }));
    const endDate = screen.getByLabelText('End date') as HTMLInputElement;
    expect(endDate.disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => {
      expect((screen.getByLabelText('End date') as HTMLInputElement).disabled).toBe(true);
    });
  });
});

describe('ProjectsSection', () => {
  it('adds a project entry', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<Harness profile={makeProfile()} section="projects" onChange={(p) => (latest = p)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(latest!.projects.length).toBe(1);
    });
  });
});

describe('ExperienceSection date fields', () => {
  it('clearing a date field returns it to null instead of an invalid empty string', async () => {
    const profile = makeProfile();
    profile.experience = [acmeExperience()];
    let latest: ProfessionalProfile | null = null;
    render(<Harness profile={profile} section="experience" onChange={(p) => (latest = p)} />);
    fireEvent.click(screen.getByRole('button', { name: /^Acme$/i }));
    const start = await screen.findByPlaceholderText('2021-03');
    fireEvent.change(start, { target: { value: '' } });
    await waitFor(() => {
      expect(latest!.experience[0]!.startDate).toBeNull();
    });
  });
});
