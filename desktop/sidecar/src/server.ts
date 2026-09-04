import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { pino, type Logger as PinoLogger } from 'pino';
import { readEnv, type SidecarEnv } from './env.js';
import { statusFor, envelopeFor } from './errors.js';
import { registerPathsRoute } from './routes/paths.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerPipelineRoutes, abortAllActiveRuns } from './routes/pipeline.js';
import { DEFAULT_REDACT_PATHS, LOG_LEVELS, type LogLevel } from '@jobhunter/core/logging';

function readLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env['LOG_LEVEL'] ?? 'info';
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid LOG_LEVEL: ${raw} (expected one of: ${LOG_LEVELS.join(', ')})`);
  }
  return raw as LogLevel;
}

/**
 * Construct the sidecar's root pino logger with the standard redaction
 * list applied. `createLogger` from `@jobhunter/core/logging` returns a
 * domain `Logger` interface; the sidecar's HTTP routes consume a raw
 * `pino.Logger`, so we build pino directly with the same redaction
 * paths the core uses.
 */
export function createSidecarRootLogger(env: NodeJS.ProcessEnv = process.env): PinoLogger {
  return pino({
    level: readLogLevel(env),
    base: { component: 'sidecar' },
    redact: { paths: [...DEFAULT_REDACT_PATHS], censor: '[Redacted]' },
  });
}

export interface BuildServerOptions {
  readonly env: SidecarEnv;
  readonly rootLogger?: PinoLogger;
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const rootLogger: PinoLogger = opts.rootLogger ?? pino({ level: 'silent' });
  // Passing a pre-constructed pino.Logger to Fastify leaks the logger's
  // generic into `FastifyInstance<..., Logger, ...>`, which then refuses
  // to match the `FastifyInstance<..., FastifyBaseLogger, ...>` that
  // route registrations expect. `loggerInstance` is the v5 API for
  // pre-built loggers and uses the default base logger; a `cast` keeps
  // the downstream types stable without losing type information.
  const app = Fastify({ loggerInstance: rootLogger }) as unknown as FastifyInstance;

  // CORS for the two legitimate caller origins: the Tauri webview
  // (`tauri://localhost`) and the Vite dev server during local development
  // (`http://localhost:<port>`). Whitelist-as-regex keeps this strict —
  // anything not matching falls through to Fastify's default (no CORS
  // header), so a browser with a non-allowlisted origin sees the
  // request fail the CORS check the same way it would on any
  // non-CORS-aware server. Audit flagged this as A.5.1/B2-M2
  // (originally "defense in depth"); turned out to be a functional bug
  // — see issue #91.
  await app.register(cors, {
    origin: /^(http:\/\/localhost(:\d+)?|tauri:\/\/localhost)$/,
    credentials: true,
  });

  app.setErrorHandler((error, _req, reply) => {
    reply.status(statusFor(error)).send(envelopeFor(error));
  });

  app.get('/api/health', async () => ({ schemaVersion: 1, status: 'ok' }));

  await registerPathsRoute(app);

  await registerConfigRoutes(app);

  await registerProfileRoutes(app);

  await registerJobsRoutes(app, { rootLogger });

  await registerRunsRoutes(app);

  await registerPipelineRoutes(app, { rootLogger });

  return app;
}

async function main(): Promise<void> {
  const env = readEnv();
  const rootLogger = createSidecarRootLogger();
  const server = await buildServer({ env, rootLogger });
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
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 5000),
      );
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

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err: unknown) => {
    process.stderr.write(`sidecar boot failed: ${String(err)}\n`);
    process.exit(1);
  });
}
