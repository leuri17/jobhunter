// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusCard } from './status-card';
import { makeProfile } from './test-fixtures';

afterEach(cleanup);

describe('StatusCard', () => {
  it('renders live identity, experience, and fingerprint columns', () => {
    const profile = makeProfile();
    profile.basics.fullName = 'Alex Vance';
    profile.basics.email = 'alex@example.com';
    profile.basics.phone = '+49 30 123456';
    profile.basics.totalYearsOfExperience = 9.4;
    profile.basics.currentLocation = 'Berlin';
    render(<StatusCard profile={profile} badges={null} sourcesReady={0} />);
    expect(screen.getByText('Alex Vance')).toBeDefined();
    expect(screen.getByText('alex@example.com · +49 30 123456')).toBeDefined();
    expect(screen.getByText('9.4 years')).toBeDefined();
    expect(screen.getByText('Berlin')).toBeDefined();
  });

  it('shows em dashes for missing identity data', () => {
    render(<StatusCard profile={makeProfile()} badges={null} sourcesReady={0} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the first-run empty state with an add-source CTA when no profile exists', () => {
    const onAddSource = vi.fn();
    render(<StatusCard profile={null} badges={null} sourcesReady={0} onAddSource={onAddSource} />);
    expect(screen.getByText('No profile yet')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Add source file' }));
    expect(onAddSource).toHaveBeenCalledOnce();
  });

  it('shows the sources-ready variant when sources exist but no version does', () => {
    render(<StatusCard profile={null} badges={null} sourcesReady={2} />);
    expect(screen.getByText(/2 sources ready/i)).toBeDefined();
  });
});
