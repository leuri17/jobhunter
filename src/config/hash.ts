import { createHash } from 'node:crypto';

import type { OperationalConfig } from './schema.js';

export function hashOperationalConfig(config: OperationalConfig): string {
  const stable = JSON.stringify(config, Object.keys(config).sort());
  return createHash('sha256').update(stable).digest('hex');
}
