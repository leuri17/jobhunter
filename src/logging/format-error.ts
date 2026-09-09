/**
 * Serialise an `unknown` thrown value (or any value reaching a log
 * call as an error-shaped object) into a plain JSON-safe shape that
 * preserves the full `cause` chain. Designed for the pino error
 * serializer and the `ScoringLogger` / `PipelineLogger` /
 * `DiagnosticManager.onError` sites that audit H2 / B1-H2 flagged.
 *
 * Rules (see `tests/logging/format-error.test.ts` for the oracles):
 *   - `null`, `undefined`, strings, and primitives are wrapped in a
 *     `SerialisedError` with `name: 'NonError'` so downstream log
 *     consumers always see a uniform shape.
 *   - Anything else is duck-typed: `name` defaults to `'Error'`,
 *     `message` falls back to `String(value)` when the input does not
 *     expose one.
 *   - `code` is preserved when the input carries a string or number
 *     `code` field (matches `ApplicationError.code` +
 *     `OpenAI*.code` + Node `SystemError.code`).
 *   - `metadata` is preserved when the input carries a plain object
 *     with that name (matches `ApplicationError.metadata`).
 *   - `cause` is recursed up to `options.maxDepth` (default 5). When
 *     the chain is longer than the budget, the leaf is replaced with
 *     a `<truncated>` sentinel so consumers see the cut instead of
 *     an unbounded loop on a cyclic chain.
 *   - `stack` is **omitted by default** (PII risk on stderr-bound
 *     logs); opt in with `includeStack: true`. The opt-in flag is
 *     used by the test suite only.
 */
export interface SerialisedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly cause?: SerialisedError;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface FormatErrorOptions {
  /** Maximum depth for the cause chain. Default 5. */
  readonly maxDepth?: number;
  /**
   * Whether to include `stack` on every level of the chain. Off by
   * default so the helper is safe to call from the hot path of every
   * error log site without leaking file paths / secrets to stderr.
   * Tests opt in to verify the chain.
   */
  readonly includeStack?: boolean;
}

/** Sentinel name used when the cause chain exceeds `maxDepth`. */
const TRUNCATED_NAME = '<truncated>';

export function formatError(err: unknown, options: FormatErrorOptions = {}): SerialisedError {
  const maxDepth = options.maxDepth ?? 5;
  const includeStack = options.includeStack ?? false;
  return formatErrorInner(err, maxDepth, includeStack, 0);
}

function formatErrorInner(
  err: unknown,
  maxDepth: number,
  includeStack: boolean,
  depth: number,
): SerialisedError {
  if (err === null) {
    return { name: 'NonError', message: 'null' };
  }
  if (err === undefined) {
    return { name: 'NonError', message: 'undefined' };
  }
  if (typeof err === 'string') {
    return { name: 'NonError', message: err };
  }
  if (typeof err !== 'object') {
    return { name: 'NonError', message: String(err) };
  }

  const obj = err as Record<string, unknown>;
  const name = typeof obj.name === 'string' && obj.name.length > 0 ? obj.name : 'Error';
  const message = typeof obj.message === 'string' ? obj.message : String(err);
  const out: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    cause?: SerialisedError;
    metadata?: Readonly<Record<string, unknown>>;
  } = { name, message };

  if (typeof obj.code === 'string') {
    out.code = obj.code;
  } else if (typeof obj.code === 'number') {
    out.code = String(obj.code);
  }

  if (includeStack && typeof obj.stack === 'string') {
    out.stack = obj.stack;
  }

  if (typeof obj.metadata === 'object' && obj.metadata !== null && !Array.isArray(obj.metadata)) {
    out.metadata = obj.metadata as Readonly<Record<string, unknown>>;
  }

  if (obj.cause === undefined || obj.cause === null) {
    return out;
  }

  if (depth < maxDepth) {
    out.cause = formatErrorInner(obj.cause, maxDepth, includeStack, depth + 1);
  } else {
    out.cause = {
      name: TRUNCATED_NAME,
      message: `<cause chain truncated at depth ${maxDepth}>`,
    };
  }
  return out;
}
