import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';

import { multistream, pino, type Logger as PinoLogger, type StreamEntry } from 'pino';

import { LogConfigError } from '../errors/application-error.js';

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

const DEFAULT_REDACT_PATHS: readonly string[] = [
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
];

function assertValidLevel(level: string): asserts level is LogLevel {
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    throw new LogConfigError('invalid_level', `Invalid log level: ${level}`, { level });
  }
}

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
