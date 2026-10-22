// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { SidecarBanner } from '@/components/shared/ui/sidecar-banner';
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

  it('renders when a high-confidence URL is measured unreachable', () => {
    // After issue #202 the hook always measures; a pinned URL
    // (env override / Tauri IPC) with a dead sidecar must surface the
    // banner, not rely on StatusPill alone.
    render(
      <SidecarBanner
        state={makeState({
          status: 'unreachable',
          isFallback: false,
          url: 'http://127.0.0.1:54321',
        })}
      />,
    );
    expect(screen.getByTestId('sidecar-banner')).toBeTruthy();
    expect(screen.getByTestId('sidecar-banner-retry')).toBeTruthy();
  });

  it('renders the proxy port for the fallback empty URL', () => {
    // Plain browser dev resolves to { url: '' }; the copy must say
    // port 14231, not "port unknown".
    render(<SidecarBanner state={makeState({ url: '', isFallback: true })} />);
    const banner = screen.getByTestId('sidecar-banner');
    expect(banner.textContent ?? '').toContain('14231');
    expect(banner.textContent ?? '').not.toContain('unknown');
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
