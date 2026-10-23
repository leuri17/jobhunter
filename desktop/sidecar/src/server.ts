import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cors from '@fastify/cors';
import { pino, transport, multistream, type Logger as PinoLogger, type StreamEntry } from 'pino';
import { readEnv, type SidecarEnv } from './env.js';
import { statusFor, envelopeFor } from './errors.js';
import { registerPathsRoute } from './routes/paths.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerPipelineRoutes, abortAllActiveRuns } from './routes/pipeline.js';
import { registerLinkedinGeoTypeaheadRoute } from './routes/linkedin-geo-typeahead.js';
import {
  DEFAULT_REDACT_PATHS,
  LOG_LEVELS,
  createRotatingFileStream,
  resolveDefaultLogPath,
  type LogLevel,
} from '@jobhunter/core/logging';
import {
  loadConfig,
  resolveRefusalDetection,
  type FileSystem,
  type LoadedConfig,
} from '@jobhunter/core/config';
import type { DefaultOpenAIClientRefusalOptions } from '@jobhunter/core/profile';
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
 * For config-aware construction (which honors `config.logging.{level,
 * prettyTerminal, filePath}`), use `createSidecarRootLoggerFromConfig`.
 */
export function createSidecarRootLogger(env: NodeJS.ProcessEnv = process.env): PinoLogger {
  return pino({
    level: readLogLevel(env),
    base: { component: 'sidecar' },
    redact: { paths: [...DEFAULT_REDACT_PATHS], censor: '[Redacted]' },
  });
}

/**
 * Adapt a pino.Logger to Fastify's `FastifyBaseLogger`. Without this, passing
 * `pino.Logger` to Fastify's `loggerInstance` infers
 * `FastifyInstance<..., pino.Logger, ...>`, which drifts from the
 * `FastifyBaseLogger` the route registrations expect (pino's `BaseLogger`
 * requires `msgPrefix`, which `FastifyBaseLogger` does not declare). The
 * adapter exposes only the FastifyBaseLogger surface while preserving the
 * underlying pino instance for callers that need it (the pipeline routes).
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
  /**
   * Which source supplied `level`, and whether the environment set a
   * different value that the config is shadowing. Reported at startup so
   * an operator can see which one won without inspecting config files.
   */
  readonly levelSource: 'config' | 'environment' | 'default';
  readonly shadowedEnvLevel?: LogLevel;
}

/**
 * Merge a possibly-null loaded config with the environment.
 *
 * Config wins when present, which is the long-standing behaviour and the
 * right default: a value the user deliberately set in Settings should not
 * be overridden by a stale shell profile. The consequence is that
 * `LOG_LEVEL` is unreachable once a `config.json` exists, so when both are
 * set and disagree the divergence is recorded on
 * {@link ResolvedLogConfig.levelSource} and logged at startup rather than
 * left to be discovered.
 */
export function resolveLogConfig(
  processEnv: NodeJS.ProcessEnv,
  loaded: LoadedConfig | null,
): ResolvedLogConfig {
  const cfg = loaded?.config.logging;
  const envRaw = processEnv['LOG_LEVEL'];

  if (cfg?.level !== undefined) {
    const envLevel =
      envRaw !== undefined && (LOG_LEVELS as readonly string[]).includes(envRaw)
        ? (envRaw as LogLevel)
        : undefined;
    return {
      level: cfg.level,
      prettyTerminal: cfg.prettyTerminal ?? false,
      levelSource: 'config',
      ...(envLevel !== undefined && envLevel !== cfg.level ? { shadowedEnvLevel: envLevel } : {}),
    };
  }

  return {
    level: readLogLevel(processEnv),
    prettyTerminal: cfg?.prettyTerminal ?? false,
    levelSource: envRaw === undefined ? 'default' : 'environment',
  };
}

/**
 * Build the sidecar's root pino logger honoring the merged
 * {@link ResolvedLogConfig}. `prettyTerminal` routes the console sink
 * through the `pino-pretty` worker transport. When `paths` is supplied
 * the log is additionally written to a rotating file under
 * `PlatformPaths.logs`; the file destination is never user-configurable
 * and a failure to open it degrades to a stderr warning. Both sinks
 * stack on top of `DEFAULT_REDACT_PATHS`.
 */
export function createSidecarRootLoggerFromConfig(
  processEnv: NodeJS.ProcessEnv,
  loaded: LoadedConfig | null,
  paths?: PlatformPaths,
): PinoLogger {
  const { level, prettyTerminal, levelSource, shadowedEnvLevel } = resolveLogConfig(
    processEnv,
    loaded,
  );
  const streams: StreamEntry[] = [];

  if (prettyTerminal) {
    streams.push({
      stream: transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      }),
    });
  } else {
    streams.push({ stream: process.stderr });
  }

  if (paths !== undefined) {
    streams.push({ stream: createRotatingFileStream({ dest: resolveDefaultLogPath(paths) }) });
  }

  const logger = pino(
    {
      level,
      base: { component: 'sidecar' },
      redact: { paths: [...DEFAULT_REDACT_PATHS], censor: '[Redacted]' },
    },
    multistream(streams),
  );

  logger.info(
    {
      event: 'log.level.resolved',
      level,
      levelSource,
      ...(shadowedEnvLevel !== undefined ? { shadowedEnvLevel } : {}),
    },
    'log level resolved',
  );
  if (shadowedEnvLevel !== undefined) {
    logger.warn(
      {
        event: 'log.level.env_shadowed',
        level,
        levelSource,
        shadowedEnvLevel,
      },
      'LOG_LEVEL is set but overridden by config.json; remove it from your environment to change the level',
    );
  }

  return logger;
}

export interface BuildServerOptions {
  readonly env: SidecarEnv;
  readonly rootLogger?: PinoLogger;
  /**
   * When provided, the sidecar calls `loadConfig(paths, fileSystem)` at
   * startup and honors `config.logging.{level, prettyTerminal}`, and
   * always writes to a rotating log file under `paths.logs`. A failed
   * `loadConfig` falls back to env-only level resolution so a malformed
   * user config never crashes the boot.
   */
  readonly paths?: PlatformPaths;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly fileSystem?: FileSystem;
  /**
   * Optional test/alternative seam: probes a candidate OpenAI key.
   * Defaults to a throwaway `createDefaultOpenAIClient` with a short
   * 10 s timeout. Resolves = key accepted; rejects = rejected or
   * unverifiable (the route maps typed errors to outcomes).
   */
  readonly validateApiKey?: (apiKey: string) => Promise<void>;
}

async function resolveRootLogger(
  opts: BuildServerOptions,
  loadedOverride: LoadedConfig | null,
): Promise<PinoLogger> {
  if (opts.rootLogger !== undefined) return opts.rootLogger;
  if (opts.paths === undefined) return pino({ level: 'silent' });
  const processEnv = opts.processEnv ?? process.env;
  const loaded =
    loadedOverride ?? (await loadConfig(opts.paths, opts.fileSystem).catch((): null => null));
  if (loaded === null) return createSidecarRootLoggerFromConfig(processEnv, null, opts.paths);
  return createSidecarRootLoggerFromConfig(processEnv, loaded, opts.paths);
}

export interface HealthProbeLogging {
  readonly logLevel: 'silent';
  readonly onResponse: (request: FastifyRequest, reply: FastifyReply) => void;
}

/**
 * Route logging config for `/api/health`. The UI polls the probe every few
 * seconds and a successful liveness probe carries no diagnostic value, so
 * the route's request logger is silenced outright instead of demoting its
 * records: Fastify logs "incoming request"/"request completed" at `info`
 * through a per-route child logger, and `logLevel: 'silent'` mutes exactly
 * that child. Failed probes are diagnostic, so non-2xx outcomes are
 * re-emitted on the root logger (`request.server.log`), which the silenced
 * child cannot carry, keeping failures in the rotating log file.
 */
export function healthProbeLogging(): HealthProbeLogging {
  return {
    logLevel: 'silent',
    onResponse: (request, reply): void => {
      if (reply.statusCode < 400) return;
      request.server.log.error(
        {
          event: 'health.probe.failed',
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
        },
        'health probe failed',
      );
    },
  };
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  // Load `config.json` once at boot and reuse for both logger and
  // refusal-detection derivation — keeps the I/O on a single pass
  // and guarantees the two derivations agree when the file fails
  // to parse (both fall back to defaults in lockstep).
  const loaded: LoadedConfig | null =
    opts.paths === undefined
      ? null
      : await loadConfig(opts.paths, opts.fileSystem).catch((): null => null);
  const rootLogger = await resolveRootLogger(opts, loaded);
  const refusal: DefaultOpenAIClientRefusalOptions = resolveRefusalDetection(loaded);
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
  //
  // `methods` must be spelled out: `@fastify/cors` defaults to
  // `GET,HEAD,POST`, and the desktop UI issues `PATCH /api/config` and
  // `PUT /api/secrets/api-key` with JSON bodies. A method missing from the
  // allowlist never reaches its handler: the browser blocks the request at
  // preflight with "Method PATCH is not allowed by Access-Control-Allow-Methods."
  await app.register(cors, {
    origin: /^(http:\/\/localhost(:\d+)?|tauri:\/\/localhost)$/,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setErrorHandler((error, _req, reply) => {
    reply.status(statusFor(error)).send(envelopeFor(error));
  });

  app.get('/api/health', healthProbeLogging(), async () => ({
    schemaVersion: 1,
    status: 'ok',
  }));

  await registerPathsRoute(app);

  await registerConfigRoutes(
    app,
    opts.validateApiKey !== undefined ? { validateApiKey: opts.validateApiKey } : {},
  );

  await registerProfileRoutes(app, { refusal });

  await registerJobsRoutes(app, { rootLogger, refusal });

  await registerRunsRoutes(app);

  await registerPipelineRoutes(app, { rootLogger, refusal });

  await registerLinkedinGeoTypeaheadRoute(app);

  return app;
}

async function main(): Promise<void> {
  const env = readEnv();
  const { resolvePlatformPaths, createDefaultPlatformAdapter } =
    await import('@jobhunter/core/platform');
  const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
  const server = await buildServer({ env, paths, processEnv: process.env });
  await server.listen({ port: env.port, host: env.host });
  const address = server.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  process.stderr.write(`READY ${port}\n`);

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
