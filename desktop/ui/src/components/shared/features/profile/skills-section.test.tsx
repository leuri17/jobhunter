// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useProfileForm } from './profile-form-validator';
import { SkillsSection } from './skills-section';
import { LanguagesSection } from './languages-section';
import { makeProfile } from './test-fixtures';
import type { ProfessionalProfile, Skill } from '@/lib/types';

afterEach(cleanup);

function makeSkill(name: string, category: Skill['category']): Skill {
  return {
    id: crypto.randomUUID(),
    name,
    normalizedName: name.toLowerCase(),
    category,
    proficiency: null,
    yearsOfExperience: null,
    lastUsedAt: null,
    evidence: [],
  };
}

interface HarnessProps {
  profile: ProfessionalProfile;
  onChange: (profile: ProfessionalProfile) => void;
}

function Harness({ profile, onChange }: HarnessProps) {
  const form = useProfileForm({ defaultValues: profile, onSubmit: () => {} });
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(values) => {
        onChange(values as ProfessionalProfile);
        return (
          <>
            <SkillsSection form={form} />
            <LanguagesSection form={form} />
          </>
        );
      }}
    </form.Subscribe>
  );
}

describe('SkillsSection', () => {
  it('filters skills by name client-side and updates the count', async () => {
    const profile = makeProfile();
    profile.skills = [
      makeSkill('React', 'framework'),
      makeSkill('PostgreSQL', 'database'),
      makeSkill('Rust', 'programming_language'),
    ];
    render(<Harness profile={profile} onChange={() => {}} />);
    expect(screen.getByText('3 skills')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('Filter skills…'), {
      target: { value: 'react' },
    });
    await waitFor(() => {
      expect(screen.getByText('1 skill')).toBeDefined();
    });
    expect(screen.queryByText('PostgreSQL')).toBeNull();
  });

  it('new skill entries default to category other', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<Harness profile={makeProfile()} onChange={(p) => (latest = p)} />);
    fireEvent.click(screen.getByText('Add skill'));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
      expect(latest?.skills[0]?.category).toBe('other');
    });
  });
});

describe('LanguagesSection', () => {
  it('adds a language entry', async () => {
    let latest: ProfessionalProfile | null = null;
    render(<Harness profile={makeProfile()} onChange={(p) => (latest = p)} />);
    fireEvent.click(screen.getByText('Add language'));
    await waitFor(() => {
      expect(latest?.languages.length).toBe(1);
    });
  });
});
