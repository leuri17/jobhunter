import { describe, expect, it } from 'vitest';

import { PathError } from '../../src/errors/application-error.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';

function adapter(
  platform: PlatformAdapter['platform'] | string,
  home: string,
  environment: Record<string, string | undefined>,
): PlatformAdapter {
  return { platform: platform as PlatformAdapter['platform'], home, environment };
}

describe('resolvePlatformPaths', () => {
  it('uses XDG variables on Linux when present', () => {
    const paths = resolvePlatformPaths(
      adapter('linux', '/home/alice', {
        XDG_CONFIG_HOME: '/home/alice/.config',
        XDG_DATA_HOME: '/home/alice/.local/share',
        XDG_STATE_HOME: '/home/alice/.local/state',
        XDG_CACHE_HOME: '/home/alice/.cache',
      }),
    );

    expect(paths.config.directory).toBe('/home/alice/.config/jobhunter');
    expect(paths.data.directory).toBe('/home/alice/.local/share/jobhunter');
    expect(paths.logs.directory).toBe('/home/alice/.local/state/jobhunter');
    expect(paths.cache.directory).toBe('/home/alice/.cache/jobhunter');
    expect(paths.diagnostics.directory).toBe('/home/alice/.local/share/jobhunter/diagnostics');
    expect(paths.profileSources.directory).toBe(
      '/home/alice/.local/share/jobhunter/profile-sources',
    );
  });

  it('falls back to ~/.config, ~/.local/share, ~/.local/state, ~/.cache on Linux', () => {
    const paths = resolvePlatformPaths(adapter('linux', '/home/alice', {}));

    expect(paths.config.directory).toBe('/home/alice/.config/jobhunter');
    expect(paths.data.directory).toBe('/home/alice/.local/share/jobhunter');
    expect(paths.logs.directory).toBe('/home/alice/.local/state/jobhunter');
    expect(paths.cache.directory).toBe('/home/alice/.cache/jobhunter');
  });

  it('uses ~/Library paths on macOS', () => {
    const paths = resolvePlatformPaths(adapter('darwin', '/Users/alice', {}));

    expect(paths.config.directory).toBe('/Users/alice/Library/Application Support/JobHunter');
    expect(paths.data.directory).toBe('/Users/alice/Library/Application Support/JobHunter');
    expect(paths.logs.directory).toBe('/Users/alice/Library/Logs/JobHunter');
    expect(paths.cache.directory).toBe('/Users/alice/Library/Caches/JobHunter');
    expect(paths.diagnostics.directory).toBe(
      '/Users/alice/Library/Application Support/JobHunter/diagnostics',
    );
    expect(paths.profileSources.directory).toBe(
      '/Users/alice/Library/Application Support/JobHunter/profile-sources',
    );
  });

  it('uses %APPDATA% and %LOCALAPPDATA% on Windows', () => {
    const paths = resolvePlatformPaths(
      adapter('win32', 'C:\\Users\\Alice', {
        APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
      }),
    );

    expect(paths.config.directory).toBe('C:\\Users\\Alice\\AppData\\Roaming\\JobHunter');
    expect(paths.data.directory).toBe('C:\\Users\\Alice\\AppData\\Local\\JobHunter');
    expect(paths.logs.directory).toBe('C:\\Users\\Alice\\AppData\\Local\\JobHunter\\logs');
    expect(paths.diagnostics.directory).toBe(
      'C:\\Users\\Alice\\AppData\\Local\\JobHunter\\diagnostics',
    );
    expect(paths.cache.directory).toBe('C:\\Users\\Alice\\AppData\\Local\\JobHunter\\cache');
    expect(paths.profileSources.directory).toBe(
      'C:\\Users\\Alice\\AppData\\Local\\JobHunter\\profile-sources',
    );
  });

  it('rejects unsupported platforms', () => {
    expect(() => resolvePlatformPaths(adapter('freebsd', '/home/alice', {}))).toThrow(PathError);
    expect(() => resolvePlatformPaths(adapter('freebsd', '/home/alice', {}))).toThrow(
      expect.objectContaining({ code: 'unsupported_platform' }),
    );
  });

  it('exposes file helpers for known filenames', () => {
    const paths = resolvePlatformPaths(adapter('linux', '/home/alice', {}));

    expect(paths.config.file('config.json')).toBe('/home/alice/.config/jobhunter/config.json');
    expect(paths.data.file('jobhunter.sqlite')).toBe(
      '/home/alice/.local/share/jobhunter/jobhunter.sqlite',
    );
  });
});
