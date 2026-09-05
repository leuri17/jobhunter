import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  pino,
  transport,
  destination,
  multistream,
  type Logger as PinoLogger,
  type StreamEntry,
} from 'pino';
import { readEnv, type SidecarEnv } from './env.js';
import { statusFor, envelopeFor } from './errors.js';
import { registerPathsRoute } from './routes/paths.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerPipelineRoutes, abortAllActiveRuns } from './routes/pipeline.js';
import {
  DEFAULT_REDACT_PATHS,
  LOG_LEVELS,
  type LogLevel,
} from '@jobhunter/core/logging';
import {
  loadConfig,
  type FileSystem,
  type LoadedConfig,
} from '@jobhunter/core/config';
import type { PlatformPaths } from '@jobhunter/core/platform';

function readLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env['LOG_LEVEL'] ?? 'info';
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid LOG_LEVEL: ${raw} (expected one of: ${LOG_LEVELS.join(', ')})`);
  }
  return raw as LogLevel;
}

/**
 * Construct the sidecar's root pino logger from environment variables only.
 * `createLogger` from `@jobhunter/core/logging` returns a domain `Logger`
 * interface; the sidecar's HTTP routes consume a raw `pino.Logger`, so we
 * build pino directly with the same redaction paths the core uses.
 *
 * For config-aware logger construction (which honors
 * `config.logging.{level, prettyTerminal, filePath}`), use
 * `createSidecarRootLoggerFromConfig` instead.
 */
export function createSidecarRootLogger(env: NodeJS.ProcessEnv = process.env): PinoLogger {
  return pino({
    level: readLogLevel(env),
    base: { component: 'sidecar' },
    redact: { paths: [...DEFAULT_REDACT_PATHS], censor: '[Redacted]' },
  });
}

/**
 * Adapt a pino.Logger to Fastify's `FastifyBaseLogger` so the Fastify
 * factory infers `FastifyInstance<..., FastifyBaseLogger, ...>` rather
 * than the wider `FastifyInstance<..., pino.Logger, ...>`. The latter
 * drifts from the `FastifyBaseLogger` the route registrations expect
 * (pino's `BaseLogger` requires `msgPrefix`, which `FastifyBaseLogger`
 * does not declare), which is why a direct return-type assignment
 * fails to typecheck. We expose only the FastifyBaseLogger surface;
 * the underlying pino instance is preserved for callers that still
 * need a full `pino.Logger` (the sidecar's pipeline routes).
 */
function asFastifyBaseLogger(p: PinoLogger): FastifyBaseLogger {
  return {
    level: p.level,
    info: p.info.bind(p),
    error: p.error.bind(p),
    debug: p.debug.bind(p),
    fatal: p.fatal.bind(p),
    warn: p.warn.bind(p),
    trace: p.trace.bind(p),
    silent: p.silent.bind(p),
    child: (bindings, options) => asFastifyBaseLogger(p.child(bindings, options)),
  };
}

export interface ResolvedLogConfig {
  readonly level: LogLevel;
  readonly prettyTerminal: boolean;
  readonly filePath: string | undefined;
}

/**
 * Merge a possibly-null loaded config with the environment to resolve the
 * sidecar's logger settings. The precedence is: config value when present,
 * otherwise the env value (for `level`), otherwise a sensible default
 * (`prettyTerminal: false`, `filePath: undefined`). Returning a single
 * flat shape keeps the pino-construction logic below linear and easy to
 * reason about.
 */
export function resolveLogConfig(
  processEnv: NodeJS.ProcessEnv,
  loaded: LoadedConfig | null,
): ResolvedLogConfig {
  const cfg = loaded?.config.logging;
  return {
    level: (cfg?.level ?? readLogLevel(processEnv)) as LogLevel,
    prettyTerminal: cfg?.prettyTerminal ?? false,
    filePath: cfg?.filePath,
  };
}

/**
 * Build the sidecar's root pino logger honoring the merged
 * {@link ResolvedLogConfig}. Routes the stdout stream through the
 * `pino-pretty` worker transport when `prettyTerminal` is true and adds
 * an append-mode file destination when `filePath` is set. Both are
 * optional and stack on top of the standard redaction list.
 */
export function createSidecarRootLoggerFromConfig(
  processEnv: NodeJS.ProcessEnv,
  loaded: LoadedConfig | null,
): PinoLogger {
  const { level, prettyTerminal, filePath } = resolveLogConfig(processEnv, loaded);
  const streams: StreamEntry[] = [];

  if (prettyTerminal) {
    // pino.transport spawns a worker thread; the returned stream is
    // cleaned up automatically when the process exits.
    streams.push({
      stream: transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      }),
    });
  } else {
    streams.push({ stream: process.stdout });
  }

  if (filePath !== undefined) {
    // destination with sync:false and mkdir:true creates the parent
    // directory if missing and writes asynchronously for throughput.
    streams.push({ stream: destination({ dest: filePath, sync: false, mkdir: true }) });
  }

  return pino(
    {
      level,
      base: { component: 'sidecar' },
      redact: { paths: [...DEFAULT_REDACT_PATHS], censor: '[Redacted]' },
    },
    multistream(streams),
  );
}

export interface BuildServerOptions {
  readonly env: SidecarEnv;
  readonly rootLogger?: PinoLogger;
  /**
   * When provided, the sidecar calls `loadConfig(paths, fileSystem)` at
   * startup and honors `config.logging.{level, prettyTerminal, filePath}`
   * for the root logger. If `loadConfig` throws (corrupt file, I/O error,
   * validation failure), the sidecar falls back to the env-only logger
   * constructed by {@link createSidecarRootLogger} so a malformed user
   * config never crashes the boot.
   */
  readonly paths?: PlatformPaths;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly fileSystem?: FileSystem;
}

async function resolveRootLogger(opts: BuildServerOptions): Promise<PinoLogger> {
  if (opts.rootLogger !== undefined) return opts.rootLogger;
  if (opts.paths === undefined) {
    // No config plumbing requested — keep the legacy env-only path. This
    // is what every existing sidecar test exercises.
    return pino({ level: 'silent' });
  }
  const processEnv = opts.processEnv ?? process.env;
  // Config load failure: fall back to env-only logger rather than crash
  // the server. We deliberately swallow the error here; the caller's UX
  // requirement (acceptance criteria #3) is "don't crash the boot."
  const loaded = await loadConfig(opts.paths, opts.fileSystem).catch(
    (): null => null,
  );
  if (loaded === null) return createSidecarRootLogger(processEnv);
  return createSidecarRootLoggerFromConfig(processEnv, loaded);
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const rootLogger = await resolveRootLogger(opts);
  // `loggerInstance` accepts FastifyBaseLogger; the adapter keeps the
  // underlying pino instance intact for downstream route handlers that
  // need the full pino API (see `makeTeeLogger` in routes/pipeline.ts).
  const app = Fastify({ loggerInstance: asFastifyBaseLogger(rootLogger) });

  // CORS for the two legitimate caller origins: the Tauri webview
  // (`tauri://localhost`) and the Vite dev server during local development
  // (`http://localhost:<port>`). Whitelist-as-regex keeps this strict —
  // anything not matching falls through to Fastify's default (no CORS
  // header), so a browser with a non-allowlisted origin sees the
  // request fail the CORS check the same way it would on any
  // non-CORS-aware server. Closes issue #91 — without this registration,
  // the Tauri webview's cross-origin fetch from `tauri://localhost` to
  // `http://127.0.0.1:<port>` fails CORS even though the sidecar itself
  // responds 200.
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
  // Resolve platform paths at boot so the sidecar can read the user's
  // operational config from disk and honor config.logging.{level,
  // prettyTerminal, filePath}. See buildServer's `paths` option for the
  // fallback semantics when config is missing or malformed.
  const { resolvePlatformPaths, createDefaultPlatformAdapter } = await import(
    '@jobhunter/core/platform'
  );
  const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const server = await buildServer({ env, paths, processEnv: process.env });
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