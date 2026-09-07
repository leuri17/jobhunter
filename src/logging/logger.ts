import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';

import { multistream, pino, type Logger as PinoLogger, type MultiStreamRes } from 'pino';

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

/**
 * Pino's `MultiStreamRes.streams` is typed as `StreamEntry[]`
 * (just `{ stream, level? }`) but the runtime shape also carries
 * an `id` that `multistream.remove(id)` consumes. Likewise, the
 * public `MultiStreamRes` type omits the runtime `remove(id)` and
 * `emit(...)` methods (they're plain JS functions on the closure,
 * not declared in the .d.ts). Both extensions are captured in the
 * local alias below so we can detach a broken file stream at run
 * time without reaching for `any`.
 */
type StreamEntryWithId = { id: number; stream: Writable };
type MutableMultiStream = MultiStreamRes & {
  readonly remove: (id: number) => unknown;
};

/**
 * Emit a single warning line directly to the `stdout` sink.
 *
 * The pino instance isn't built yet at boot-time, so the logger
 * cannot log its own boot failures. We hand-write a JSON line in
 * the same shape pino would emit so downstream tooling (file
 * shippers, log search) treats it as a first-class log line.
 * `formatError` is invoked without `includeStack` so no file paths
 * from the runtime environment leak into stderr-bound logs.
 */
function warnBootFailure(stdout: Writable, event: string, path: string, err: unknown): void {
  const detail = formatError(err);
  const line = JSON.stringify({
    level: 40,
    time: Date.now(),
    component: 'jobhunter',
    event,
    path,
    code: detail.code,
    name: detail.name,
    message: detail.message,
  });
  stdout.write(line + '\n');
}

/**
 * Attach an `'error'` listener that removes the broken file stream
 * from pino's multistream and writes a warning to `stdout`. Pino's
 * multistream re-reads its `streams` array on every `write` call
 * (see pino/lib/multistream.js: `const { streams } = this`), so the
 * `remove()` is observed by the next log line. We also `destroy()`
 * the underlying stream to release the file handle; the Node
 * `EventEmitter` would otherwise crash the process on an unhandled
 * `'error'` event.
 *
 * Uses `on` (not `once`) so a hypothetical future reopen — if the
 * caller rotates the file — would still get its first error handled
 * the same way. There is no automatic reopen in this codebase; the
 * listener simply fires once and the stream is detached.
 */
function attachFileStreamErrorListener(
  multi: MutableMultiStream,
  fileStreamId: number,
  fileStream: Writable,
  stdout: Writable,
  path: string,
): void {
  fileStream.on('error', (err: Error) => {
    warnBootFailure(stdout, 'log.file.error', path, err);
    multi.remove(fileStreamId);
    fileStream.destroy();
  });
}

function buildPino(options: LoggerOptions, destinations: LoggerDestinations): PinoLogger {
  assertValidLevel(options.level);
  const redact = new Set<string>([...DEFAULT_REDACT_PATHS, ...(options.redactPaths ?? [])]);
  const multi = multistream([{ stream: destinations.stdout }]) as MutableMultiStream;
  if (options.filePath !== undefined) {
    // Audit B1-M2: guard the file-destination block. Pre-fix,
    // `mkdirSync` or `createWriteStream` throwing synchronously
    // would abort the pino factory (and therefore sidecar bootstrap)
    // with no warning surfaced; an async `'error'` event on the
    // file stream would also be unhandled and crash the process.
    try {
      mkdirSync(dirname(options.filePath), { recursive: true });
      const fileStream = createWriteStream(options.filePath, { flags: 'a' });
      multi.add({ stream: fileStream });
      const streams = multi.streams as unknown as readonly StreamEntryWithId[];
      const entry = streams.find((s) => s.stream === fileStream);
      if (entry !== undefined) {
        attachFileStreamErrorListener(
          multi,
          entry.id,
          fileStream,
          destinations.stdout,
          options.filePath,
        );
      }
    } catch (err) {
      warnBootFailure(destinations.stdout, 'log.file.open_failed', options.filePath, err);
    }
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
    multi,
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
