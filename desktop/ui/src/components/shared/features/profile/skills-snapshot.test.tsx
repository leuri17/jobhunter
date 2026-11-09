// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillsSnapshot } from './skills-snapshot';
import type { Skill } from '@/lib/types';

afterEach(cleanup);

const skill = (over: Partial<Skill>): Skill => ({
  id: 's1',
  name: 'TypeScript',
  normalizedName: 'typescript',
  category: 'programming_language',
  proficiency: null,
  yearsOfExperience: null,
  lastUsedAt: null,
  evidence: [],
  ...over,
});

describe('SkillsSnapshot', () => {
  it('groups skills by category in schema order and shows counts', () => {
    render(
      <SkillsSnapshot
        skills={[
          skill({ name: 'TypeScript', category: 'programming_language' }),
          skill({ id: 's2', name: 'Rust', category: 'programming_language' }),
          skill({ id: 's3', name: 'React', category: 'framework' }),
        ]}
        onManage={() => {}}
      />,
    );
    expect(screen.getByText('Programming languages (2)')).toBeDefined();
    expect(screen.getByText('Frameworks (1)')).toBeDefined();
  });

  it('shows the empty state', () => {
    render(<SkillsSnapshot skills={[]} onManage={() => {}} />);
    expect(screen.getByText(/no skills yet/i)).toBeDefined();
  });

  it('links to the skills tab via onManage', () => {
    const onManage = vi.fn();
    render(<SkillsSnapshot skills={[skill({})]} onManage={onManage} />);
    fireEvent.click(screen.getByRole('button', { name: /manage skills/i }));
    expect(onManage).toHaveBeenCalledOnce();
  });
});
