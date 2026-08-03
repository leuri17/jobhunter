import path from 'node:path';

import { PathError } from '../errors/application-error.js';
import type { PlatformAdapter } from './platform.js';

export interface PlatformPathSlot {
  readonly directory: string;
  file(name: string): string;
}

export interface PlatformPaths {
  readonly config: PlatformPathSlot;
  readonly data: PlatformPathSlot;
  readonly logs: PlatformPathSlot;
  readonly diagnostics: PlatformPathSlot;
  readonly cache: PlatformPathSlot;
  readonly profileSources: PlatformPathSlot;
}

const joinPosix = (...segments: string[]): string => path.posix.join(...segments);
const joinWin32 = (...segments: string[]): string => path.win32.join(...segments);

function linuxPaths(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): PlatformPaths {
  const configHome = env.XDG_CONFIG_HOME ?? joinPosix(home, '.config');
  const dataHome = env.XDG_DATA_HOME ?? joinPosix(home, '.local', 'share');
  const stateHome = env.XDG_STATE_HOME ?? joinPosix(home, '.local', 'state');
  const cacheHome = env.XDG_CACHE_HOME ?? joinPosix(home, '.cache');

  const configDir = joinPosix(configHome, 'jobhunter');
  const dataDir = joinPosix(dataHome, 'jobhunter');

  return {
    config: { directory: configDir, file: (name) => joinPosix(configDir, name) },
    data: { directory: dataDir, file: (name) => joinPosix(dataDir, name) },
    logs: {
      directory: joinPosix(stateHome, 'jobhunter'),
      file: (name) => joinPosix(stateHome, 'jobhunter', name),
    },
    diagnostics: {
      directory: joinPosix(dataDir, 'diagnostics'),
      file: (name) => joinPosix(dataDir, 'diagnostics', name),
    },
    cache: {
      directory: joinPosix(cacheHome, 'jobhunter'),
      file: (name) => joinPosix(cacheHome, 'jobhunter', name),
    },
    profileSources: {
      directory: joinPosix(dataDir, 'profile-sources'),
      file: (name) => joinPosix(dataDir, 'profile-sources', name),
    },
  };
}

function darwinPaths(home: string): PlatformPaths {
  const appSupport = joinPosix(home, 'Library', 'Application Support', 'JobHunter');
  return {
    config: { directory: appSupport, file: (name) => joinPosix(appSupport, name) },
    data: { directory: appSupport, file: (name) => joinPosix(appSupport, name) },
    logs: {
      directory: joinPosix(home, 'Library', 'Logs', 'JobHunter'),
      file: (name) => joinPosix(home, 'Library', 'Logs', 'JobHunter', name),
    },
    diagnostics: {
      directory: joinPosix(appSupport, 'diagnostics'),
      file: (name) => joinPosix(appSupport, 'diagnostics', name),
    },
    cache: {
      directory: joinPosix(home, 'Library', 'Caches', 'JobHunter'),
      file: (name) => joinPosix(home, 'Library', 'Caches', 'JobHunter', name),
    },
    profileSources: {
      directory: joinPosix(appSupport, 'profile-sources'),
      file: (name) => joinPosix(appSupport, 'profile-sources', name),
    },
  };
}

function windowsPaths(env: Readonly<Record<string, string | undefined>>): PlatformPaths {
  if (env.APPDATA === undefined || env.LOCALAPPDATA === undefined) {
    throw new PathError(
      'windows_missing_environment',
      'Windows requires both APPDATA and LOCALAPPDATA environment variables to resolve paths.',
    );
  }
  const configDir = joinWin32(env.APPDATA, 'JobHunter');
  const dataDir = joinWin32(env.LOCALAPPDATA, 'JobHunter');
  return {
    config: { directory: configDir, file: (name) => joinWin32(configDir, name) },
    data: { directory: dataDir, file: (name) => joinWin32(dataDir, name) },
    logs: {
      directory: joinWin32(dataDir, 'logs'),
      file: (name) => joinWin32(dataDir, 'logs', name),
    },
    diagnostics: {
      directory: joinWin32(dataDir, 'diagnostics'),
      file: (name) => joinWin32(dataDir, 'diagnostics', name),
    },
    cache: {
      directory: joinWin32(dataDir, 'cache'),
      file: (name) => joinWin32(dataDir, 'cache', name),
    },
    profileSources: {
      directory: joinWin32(dataDir, 'profile-sources'),
      file: (name) => joinWin32(dataDir, 'profile-sources', name),
    },
  };
}

export function resolvePlatformPaths(adapter: PlatformAdapter): PlatformPaths {
  switch (adapter.platform) {
    case 'linux':
      return linuxPaths(adapter.home, adapter.environment);
    case 'darwin':
      return darwinPaths(adapter.home);
    case 'win32':
      return windowsPaths(adapter.environment);
    default: {
      const exhaustive: never = adapter.platform;
      throw new PathError(
        'unsupported_platform',
        `Unsupported platform: ${exhaustive as string}. Supported platforms are linux, darwin, and win32.`,
      );
    }
  }
}

export type RuntimeDirectoryCategory = keyof PlatformPaths;

export interface EnsureRuntimeDirectoriesOptions {
  readonly categories?: readonly RuntimeDirectoryCategory[];
}

const ALL_RUNTIME_CATEGORIES: readonly RuntimeDirectoryCategory[] = [
  'config',
  'data',
  'logs',
  'diagnostics',
  'cache',
  'profileSources',
];

export async function ensureDirectory(
  directory: string,
  category: RuntimeDirectoryCategory,
): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  try {
    await mkdir(directory, { recursive: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new PathError(
      'directory_create_failed',
      `Failed to create ${category} directory at ${directory}: ${message}`,
      { category, directory },
      cause instanceof Error ? cause : undefined,
    );
  }
}

export async function ensureRuntimeDirectories(
  paths: PlatformPaths,
  options: EnsureRuntimeDirectoriesOptions = {},
): Promise<void> {
  const categories = options.categories ?? ALL_RUNTIME_CATEGORIES;
  for (const category of categories) {
    await ensureDirectory(paths[category].directory, category);
  }
}
