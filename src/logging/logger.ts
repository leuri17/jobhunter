import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';

import { multistream, pino, type Logger as PinoLogger, type StreamEntry } from 'pino';

import { LogConfigError } from '../errors/application-error.js';
import { formatError } from './format-error.js';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly prettyTerminal: boolean;
  readonly filePath?: string;
  readonly redactPaths?: readonly string[];
}

export interface Logger {
  trace(context: LogContext, message: string): void;
  debug(context: LogContext, message: string): void;
  info(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  error(context: LogContext, message: string): void;
  fatal(context: LogContext, message: string): void;
  child(context: LogContext): Logger;
}

export interface LogContext {
  readonly component?: string;
  readonly event?: string;
  readonly runId?: string;
  readonly searchId?: string;
  readonly jobId?: string;
  readonly errorCode?: string;
  readonly [key: string]: unknown;
}

export interface LoggerDestinations {
  readonly stdout: Writable;
  readonly stderr?: Writable;
}

/**
 * Top-level secret-bearing key names (audit B1-M1). Each entry is
 * also re-emitted with `*.k`, `*.*.k`, `[*].k`, and `*.[*].k`
 * wildcard forms below so a `apiKey` nested one level deep inside
 * a request envelope (e.g. `request.apiKey`) or two levels deep
 * (e.g. `request.headers.apiKey`) is still redacted.
 *
 * Note on pino's wildcard semantics (10.3.1 / @pinojs/redact 0.4):
 * the wildcards are positional, not recursive — `*.k` matches ONE
 * level deep, `*.*.k` matches TWO. The `**` documented in pino's
 * API surface does NOT actually recurse in this version (it behaves
 * identically to `*.*`), so we enumerate the practical depths
 * explicitly. `[*].k` is included for spec parity even though it
 * does not match on its own (pino's redact requires an explicit
 * parent for array-element paths, e.g. `messages[*].k`); `*.[*].k`
 * covers the common "top-level array of objects" case. Keep the
 * wildcard forms in lockstep when adding a new entry — see
 * `src/logging/codemap.md` for the convention.
 */
const SECRET_KEYS = [
  'OPENAI_API_KEY',
  'apiKey',
  'openaiApiKey',
  'authorization',
  'password',
  'secret',
  'token',
  'prompt',
  'rawPrompt',
  'rawResponse',
  'openai.key',
] as const;

export const DEFAULT_REDACT_PATHS: readonly string[] = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.flatMap((key) => [`*.${key}`, `*.*.${key}`, `[*].${key}`, `*.[*].${key}`]),
];

function assertValidLevel(level: string): asserts level is LogLevel {
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    throw new LogConfigError('invalid_level', `Invalid log level: ${level}`, { level });
  }
}

/**
 * Pino error serializer that delegates to `formatError` so every
 * `Error` (or `Error`-shaped object) reaching the logger — including
 * the full `cause` chain — appears in the JSON output line. Audit
 * H2 / B1-H2. The serializer is registered under both `err`
 * (pino's built-in key) and `error` (the convention adopted by the
 * newer domain log adapters) so call sites can use either.
 */
const errorSerializer = (input: unknown): unknown => formatError(input);

function buildPino(options: LoggerOptions, destinations: LoggerDestinations): PinoLogger {
  assertValidLevel(options.level);
  const redact = new Set<string>([...DEFAULT_REDACT_PATHS, ...(options.redactPaths ?? [])]);
  const streams: StreamEntry[] = [{ stream: destinations.stdout }];
  if (options.filePath !== undefined) {
    mkdirSync(dirname(options.filePath), { recursive: true });
    streams.push({ stream: createWriteStream(options.filePath, { flags: 'a' }) });
  }
  return pino(
    {
      level: options.level,
      base: { component: 'jobhunter' },
      redact: { paths: [...redact], censor: '[Redacted]' },
      serializers: {
        err: errorSerializer,
        error: errorSerializer,
      },
    },
    multistream(streams),
  );
}

function adapt(pino: PinoLogger): Logger {
  const wrap =
    (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal') =>
    (context: LogContext, message: string) => {
      pino[level](context, message);
    };

  return {
    trace: wrap('trace'),
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    fatal: wrap('fatal'),
    child: (context) => adapt(pino.child(context)),
  };
}

function defaultStdout(): Writable {
  return process.stdout;
}

export function createLogger(
  options: LoggerOptions,
  destinations?: Partial<LoggerDestinations>,
): Logger {
  const stdout = destinations?.stdout ?? defaultStdout();
  const base = buildPino(
    { ...options, ...(options.filePath !== undefined ? { filePath: options.filePath } : {}) },
    { stdout, ...(destinations?.stderr !== undefined ? { stderr: destinations.stderr } : {}) },
  );
  return adapt(base);
}
