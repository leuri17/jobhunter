import Fastify, { FastifyInstance } from 'fastify';
import { readEnv, type SidecarEnv } from './env.js';
import { statusFor, envelopeFor } from './errors.js';
import { registerPathsRoute } from './routes/paths.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerPipelineRoutes, abortAllActiveRuns } from './routes/pipeline.js';

export interface BuildServerOptions {
  readonly env: SidecarEnv;
}

export async function buildServer(_opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });

  app.setErrorHandler((error, _req, reply) => {
    reply.status(statusFor(error)).send(envelopeFor(error));
  });

  app.get('/api/health', async () => ({ schemaVersion: 1, status: 'ok' }));

  await registerPathsRoute(app);

  await registerConfigRoutes(app);

  await registerProfileRoutes(app);

  await registerJobsRoutes(app);

  await registerRunsRoutes(app);

  await registerPipelineRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const env = readEnv();
  const server = await buildServer({ env });
  await server.listen({ port: env.port, host: env.host });
  const address = server.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  process.stdout.write(`READY ${port}\n`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`sidecar: received ${signal}, draining (max 5s)...\n`);
    try {
      // Abort in-flight pipelines before closing the HTTP server.
      const aborted = abortAllActiveRuns();
      if (aborted > 0) {
        process.stderr.write(`sidecar: aborted ${aborted} active pipeline run(s)\n`);
      }

      // 5-second deadline for graceful close (race).
      const closePromise = server.close();
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000));
      const result = await Promise.race([closePromise, timeout]);
      if (result === 'timeout') {
        process.stderr.write(`sidecar: graceful close timed out; forcing exit\n`);
        process.exit(1);
      }
      process.exit(0);
    } catch (err) {
      process.stderr.write(`sidecar: shutdown error: ${String(err)}\n`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err: unknown) => {
    process.stderr.write(`sidecar boot failed: ${String(err)}\n`);
    process.exit(1);
  });
}
