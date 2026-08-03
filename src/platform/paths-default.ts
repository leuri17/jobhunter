import os from 'node:os';

import type { Platform, PlatformAdapter } from './platform.js';

export function createDefaultPlatformAdapter(): PlatformAdapter {
  const platform = process.platform as Platform;
  return {
    platform,
    home: os.homedir(),
    environment: process.env,
  };
}
