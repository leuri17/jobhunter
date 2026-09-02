import type { FastifyInstance } from 'fastify';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';

export async function registerPathsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/paths', async () => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    return {
      schemaVersion: 1,
      paths: {
        config: paths.config.directory,
        data: paths.data.directory,
        logs: paths.logs.directory,
        diagnostics: paths.diagnostics.directory,
        cache: paths.cache.directory,
        profileSources: paths.profileSources.directory,
      },
    };
  });
}
