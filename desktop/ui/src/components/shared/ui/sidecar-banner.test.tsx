// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { SidecarBanner } from '@/components/sidecar-banner';
import type { SidecarReachability } from '@/lib/sidecar-reachability';

function makeState(overrides: Partial<SidecarReachability> = {}): SidecarReachability {
  return {
    status: 'unreachable',
    url: 'http://127.0.0.1:14231',
    isFallback: true,
    retry: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('<SidecarBanner />', () => {
  it('renders when the resolver hit the fallback port and the ping failed', () => {
    render(<SidecarBanner state={makeState({ status: 'unreachable' })} />);
    const banner = screen.getByTestId('sidecar-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent ?? '').toMatch(/Couldn't reach the sidecar/i);
    expect(banner.textContent ?? '').toContain('14231');
  });

  it('does not render when the URL is reachable', () => {
    render(<SidecarBanner state={makeState({ status: 'reachable', isFallback: true })} />);
    expect(screen.queryByTestId('sidecar-banner')).toBeNull();
  });

  it('does not render when the resolver did not fall back', () => {
    // IPC/env-resolved URL — even if the sidecar is down, the StatusPill
    // surfaces it; the banner is fallback-specific.
    render(
      <SidecarBanner
        state={makeState({
          status: 'unreachable',
          isFallback: false,
          url: 'http://127.0.0.1:54321',
        })}
      />,
    );
    expect(screen.queryByTestId('sidecar-banner')).toBeNull();
  });

  it('does not render while the first ping is still pending', () => {
    render(<SidecarBanner state={makeState({ status: 'pending' })} />);
    expect(screen.queryByTestId('sidecar-banner')).toBeNull();
  });

  it('invokes retry() when the user clicks Retry', () => {
    const retry = vi.fn();
    render(<SidecarBanner state={makeState({ status: 'unreachable', retry })} />);
    fireEvent.click(screen.getByTestId('sidecar-banner-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
