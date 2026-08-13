# TASK-005 Implementation Plan — Diagnostics and Artifact Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a reusable, testable diagnostic manager that captures scraper-error artifacts (screenshot, current URL, stack trace, plus optional Playwright trace / HTML snapshot) safely on the local filesystem and persists their metadata to the existing `diagnostic_artifacts` repository — without leaking secrets, without masking the original scraper error, and without leaking into downstream tasks.

**Architecture:** A new `src/diagnostics/` layer owns the artifact lifecycle. It is consumed by TASK-012 (LinkedIn discovery) and TASK-013 (job-detail extraction) and never imported from CLI or domain code directly. The layer is split into three pure modules (`filename.ts`, `redactor.ts`, `errors.ts`) plus one orchestrator (`manager.ts`) and a small `capture/` directory that defines the `CaptureStrategy` interface. TASK-005 ships concrete implementations for `stack_trace` and `current_url` (which need no browser), plus no-op placeholder strategies for `screenshot`, `playwright_trace`, and `html_snapshot` that throw `MissingBrowserImplementationError` if invoked — TASK-012/13 will replace those placeholders with real Playwright-backed strategies. The manager never throws to the caller: every capture/persistence failure is caught, recorded as a `capture_failed` artifact-failure row, and the original scraper error is returned to the caller untouched. Filenames are deterministic (`{type}-{kebab-scope}-{ISO-timestamp}.{ext}`); metadata descriptions pass through a redactor that strips secret-like values (API keys, Bearer tokens, password fields, query-string `api_key=`, etc.) before persistence.

**Tech Stack:** No new dependencies. Uses Node built-ins (`node:fs/promises`, `node:path`), the existing `DiagnosticArtifactRepository` from TASK-004, the existing `OperationalConfig.diagnostics.onScraperError` schema from TASK-002, and `zod` (already in `package.json`) for redactor input validation.

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §6, §8):** Code under `src/diagnostics/` **must not** import Commander, Inquirer, Playwright, Drizzle, or Pino. It uses only Node `fs/promises`, Node `path`, the path service, Zod, and the typed `DiagnosticArtifactRepository` interface. Browser-specific capture lives behind `CaptureStrategy` interfaces so the manager is testable without Playwright.
- **Validation:** Zod at every external boundary (capture inputs, metadata payloads, redactor inputs). Filenames and metadata are passed through helpers that fail closed on unsafe input.
- **Errors:** Add typed errors (`DiagnosticError`, `MissingBrowserImplementationError`) extending `ApplicationError` with `ExitCode.Fatal` (1). All other persistence errors propagate as `DatabaseError`.
- **No secrets:** Artifacts and their metadata descriptions pass through the redactor. The redactor also scrubs `description` strings before they reach the database. The manager logs failures through a caller-supplied callback (not Pino), defaulting to a no-op so the diagnostics module never imports the logger.
- **History preservation:** Diagnostic artifact rows are append-only. Failed capture attempts insert a `capture_failed` row rather than mutating an existing one.
- **Files boundary:** `src/diagnostics/*.ts` files import only from `src/persistence/repositories/*` (for the typed repository surface), `src/platform/paths*`, `src/errors/*`, `zod`, and Node built-ins. No `node:fs` sync APIs.
- **Tests:** Vitest. All persistence tests use temporary SQLite (`mkdtempSync(join(tmpdir(), 'jobhunter-diagnostics-...'))`). Diagnostics-file tests use a temporary directory and clean up after themselves.
- **Live LinkedIn:** No live network in any test. The browser-backed capture strategies are not exercised in TASK-005; their interface is verified with stub strategies.

## File Structure

```
src/diagnostics/
  errors.ts                                  # DiagnosticError, MissingBrowserImplementationError (Task 1)
  filename.ts                                # Safe filename generation + scope paths (Task 2)
  redactor.ts                                # Secret-scrubbing redactor with Zod (Task 3)
  capture/
    types.ts                                 # CaptureContext, CaptureStrategy, CaptureResult (Task 4)
    stack-trace.ts                           # StackTraceCapture impl (Task 5)
    current-url.ts                           # CurrentUrlCapture impl (Task 6)
    screenshot.ts                            # ScreenshotCapture stub that throws MissingBrowserImplementationError (Task 7)
    playwright-trace.ts                      # PlaywrightTraceCapture stub (Task 7)
    html-snapshot.ts                         # HtmlSnapshotCapture stub (Task 7)
    index.ts                                 # Re-exports for capture module (Task 7)
  manager.ts                                 # DiagnosticManager orchestrator (Task 8)
  index.ts                                   # Public re-exports (Task 9)
tests/diagnostics/
  filename.test.ts                           # (Task 2)
  redactor.test.ts                           # (Task 3)
  capture/
    stack-trace.test.ts                      # (Task 5)
    current-url.test.ts                      # (Task 6)
  manager.test.ts                            # (Task 8)
  integration.test.ts                        # (Task 9)
```

Files change together by responsibility. The three pure modules (`errors`, `filename`, `redactor`) are testable without any I/O. Capture strategies are pure functions of their input; the manager composes them. The integration test verifies end-to-end persistence into a real SQLite database with a real temporary diagnostics directory.

---

### Task 1: Add typed diagnostic errors

**Files:**
- Create: `src/diagnostics/errors.ts`

**Interfaces:**

- Consumes: `ApplicationError`, `ExitCode` from `src/errors/application-error.ts` (TASK-002).
- Produces:

```ts
export class DiagnosticError extends ApplicationError {
  constructor(code, message, metadata?, cause?): exitCode = ExitCode.Fatal;
}

export class MissingBrowserImplementationError extends DiagnosticError {
  // code = 'browser_implementation_missing'
  // raised when a CaptureStrategy that requires Playwright is invoked
  // before TASK-012/13 wire a real implementation.
}
```

**Steps:**

- [ ] **Step 1.1: Write `src/diagnostics/errors.ts`** with the two classes above. `DiagnosticError` defaults to `ExitCode.Fatal`; the metadata must accept `readonly Record<string, unknown>`. `MissingBrowserImplementationError` uses the static code `'browser_implementation_missing'` and includes the artifact type in metadata.
- [ ] **Step 1.2: Run typecheck to verify it compiles**

Run: `pnpm typecheck`
Expected: exit 0 ✅

- [ ] **Step 1.3: Commit**

```bash
git add src/diagnostics/errors.ts
git commit -m "feat(diagnostics): add typed diagnostic and browser-implementation errors"
```

---

### Task 2: Safe filename generator and scope-path resolver

**Files:**
- Create: `src/diagnostics/filename.ts`
- Create: `tests/diagnostics/filename.test.ts`

**Interfaces:**

- Consumes: nothing (pure module).
- Produces:

```ts
export interface DiagnosticScope {
  readonly pipelineRunId?: number | null;
  readonly searchExecutionId?: number | null;
  readonly jobId?: number | null;
  readonly extractionAttemptId?: number | null;
  readonly discoveryErrorId?: number | null;
}

export interface SafeFilenameOptions {
  readonly artifactType: string;            // e.g. 'screenshot', 'stack_trace'
  readonly scope: DiagnosticScope;
  readonly extension: string;                // e.g. 'png', 'txt'
  readonly timestamp?: string;               // ISO; defaults to new Date().toISOString()
  readonly suffix?: string;                  // optional suffix for collisions; defaults to ''
}

export interface SafeFilenameResult {
  readonly basename: string;                 // safe filename (no directory)
  readonly relativePath: string;             // diagnostics-relative path including scope subdir
}

/** Returns the diagnostics-relative directory for a scope. */
export function resolveScopeDirectory(scope: DiagnosticScope): string;

/** Sanitizes a single component of a filename. */
export function sanitizeFilenameComponent(value: string): string;

/** Builds a safe filename + relative path from the options. */
export function buildSafeFilename(opts: SafeFilenameOptions): SafeFilenameResult;
```

**Behavior rules:**

- Allowed characters in every component: `[a-z0-9-]`. Uppercase, whitespace, dots, slashes, and every other character collapse to `-`.
- Component length cap: 40 characters. Truncate with ellipsis `-…` when over.
- Empty or whitespace-only input becomes `'unknown'`.
- Filename format: `{type}-{runId?}-{searchId?}-{jobId?}-{extractionId?}-{discoveryId?}-{timestamp}{suffix?}.{ext}`
- Only include ID components whose value is a positive finite integer.
- Scope directory format: `run-{runId}/search-{searchId}/job-{jobId}/extraction-{extractionId}/discovery-error-{discoveryId}`. Each path segment is produced by `sanitizeFilenameComponent`. Use only the IDs that are present, in that order.
- Timestamp: ISO 8601 with `:` and `.` replaced by `-` (filesystem-safe). Example: `2026-08-13T10-00-00-000Z`.

**Steps:**

- [ ] **Step 2.1: Write the failing test** in `tests/diagnostics/filename.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildSafeFilename,
  resolveScopeDirectory,
  sanitizeFilenameComponent,
} from '../../src/diagnostics/filename.js';

describe('sanitizeFilenameComponent', () => {
  it('keeps lowercase alphanumerics and dashes', () => {
    expect(sanitizeFilenameComponent('frontend-developer 42')).toBe('frontend-developer-42');
  });
  it('collapses unsafe characters to dashes', () => {
    expect(sanitizeFilenameComponent('../etc/passwd')).toBe('-etc-passwd');
    expect(sanitizeFilenameComponent('?api_key=ABC&x=1')).toBe('-api_key-ABC-x-1');
  });
  it('replaces empty/whitespace input with "unknown"', () => {
    expect(sanitizeFilenameComponent('')).toBe('unknown');
    expect(sanitizeFilenameComponent('   ')).toBe('unknown');
  });
  it('truncates to 40 characters with trailing dash', () => {
    const long = 'a'.repeat(80);
    const result = sanitizeFilenameComponent(long);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith('-')).toBe(true);
  });
});

describe('resolveScopeDirectory', () => {
  it('returns run-<id> when only runId is set', () => {
    expect(resolveScopeDirectory({ pipelineRunId: 7 })).toBe('run-7');
  });
  it('nests in run/search/job order', () => {
    expect(
      resolveScopeDirectory({ pipelineRunId: 7, searchExecutionId: 42, jobId: 99 }),
    ).toBe('run-7/search-42/job-99');
  });
  it('falls back to "unscoped" when no ids are present', () => {
    expect(resolveScopeDirectory({})).toBe('unscoped');
  });
  it('skips zero/negative ids', () => {
    expect(resolveScopeDirectory({ pipelineRunId: 0, jobId: -1 })).toBe('unscoped');
  });
});

describe('buildSafeFilename', () => {
  it('produces a basename with sanitized type and timestamp', () => {
    const { basename, relativePath } = buildSafeFilename({
      artifactType: 'screenshot',
      scope: { pipelineRunId: 7 },
      extension: 'png',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(basename).toBe('screenshot-run-7-2026-08-13T10-00-00-000Z.png');
    expect(relativePath).toBe('run-7/screenshot-run-7-2026-08-13T10-00-00-000Z.png');
  });
  it('appends suffix and omits absent ids', () => {
    const { basename } = buildSafeFilename({
      artifactType: 'stack_trace',
      scope: { pipelineRunId: 7, jobId: 99 },
      extension: 'txt',
      timestamp: '2026-08-13T10:00:00.000Z',
      suffix: '-attempt-2',
    });
    expect(basename).toBe('stack-trace-run-7-job-99-2026-08-13T10-00-00-000Z-attempt-2.txt');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `pnpm test -- tests/diagnostics/filename.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement `src/diagnostics/filename.ts`**

```ts
import { DiagnosticError } from './errors.js';

export interface DiagnosticScope {
  readonly pipelineRunId?: number | null;
  readonly searchExecutionId?: number | null;
  readonly jobId?: number | null;
  readonly extractionAttemptId?: number | null;
  readonly discoveryErrorId?: number | null;
}

export interface SafeFilenameOptions {
  readonly artifactType: string;
  readonly scope: DiagnosticScope;
  readonly extension: string;
  readonly timestamp?: string;
  readonly suffix?: string;
}

export interface SafeFilenameResult {
  readonly basename: string;
  readonly relativePath: string;
}

const MAX_COMPONENT_LENGTH = 40;

export function sanitizeFilenameComponent(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') return 'unknown';
  const lowered = value.toLowerCase();
  let out = '';
  let lastWasDash = false;
  for (const char of lowered) {
    const safe = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
    if (safe) {
      out += char;
      lastWasDash = false;
    } else {
      if (!lastWasDash) {
        out += '-';
        lastWasDash = true;
      }
    }
  }
  out = out.replace(/^-+|-+$/g, '');
  if (out === '') return 'unknown';
  if (out.length > MAX_COMPONENT_LENGTH) {
    out = out.slice(0, MAX_COMPONENT_LENGTH - 1) + '-';
  }
  return out;
}

function isPositiveId(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function safeTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

export function resolveScopeDirectory(scope: DiagnosticScope): string {
  const segments: string[] = [];
  if (isPositiveId(scope.pipelineRunId)) segments.push(`run-${scope.pipelineRunId}`);
  if (isPositiveId(scope.searchExecutionId)) segments.push(`search-${scope.searchExecutionId}`);
  if (isPositiveId(scope.jobId)) segments.push(`job-${scope.jobId}`);
  if (isPositiveId(scope.extractionAttemptId)) segments.push(`extraction-${scope.extractionAttemptId}`);
  if (isPositiveId(scope.discoveryErrorId)) segments.push(`discovery-error-${scope.discoveryErrorId}`);
  return segments.length === 0 ? 'unscoped' : segments.join('/');
}

export function buildSafeFilename(opts: SafeFilenameOptions): SafeFilenameResult {
  if (typeof opts.artifactType !== 'string' || opts.artifactType === '') {
    throw new DiagnosticError('invalid_filename_type', 'artifactType must be a non-empty string.');
  }
  if (typeof opts.extension !== 'string' || opts.extension === '') {
    throw new DiagnosticError('invalid_filename_extension', 'extension must be a non-empty string.');
  }
  const ts = safeTimestamp(opts.timestamp ?? new Date().toISOString());
  const parts: string[] = [sanitizeFilenameComponent(opts.artifactType)];
  if (isPositiveId(opts.scope.pipelineRunId)) parts.push(`run-${opts.scope.pipelineRunId}`);
  if (isPositiveId(opts.scope.searchExecutionId)) parts.push(`search-${opts.scope.searchExecutionId}`);
  if (isPositiveId(opts.scope.jobId)) parts.push(`job-${opts.scope.jobId}`);
  if (isPositiveId(opts.scope.extractionAttemptId)) parts.push(`extraction-${opts.scope.extractionAttemptId}`);
  if (isPositiveId(opts.scope.discoveryErrorId)) parts.push(`discovery-error-${opts.scope.discoveryErrorId}`);
  parts.push(ts);
  if (opts.suffix !== undefined && opts.suffix !== '') parts.push(opts.suffix);
  const safeExt = sanitizeFilenameComponent(opts.extension);
  const basename = `${parts.join('-')}.${safeExt}`;
  const relativePath = `${resolveScopeDirectory(opts.scope)}/${basename}`;
  return { basename, relativePath };
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `pnpm test -- tests/diagnostics/filename.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/diagnostics/filename.ts tests/diagnostics/filename.test.ts
git commit -m "feat(diagnostics): add safe filename and scope-path resolver"
```

---

### Task 3: Secret-scrubbing redactor

**Files:**
- Create: `src/diagnostics/redactor.ts`
- Create: `tests/diagnostics/redactor.test.ts`

**Interfaces:**

- Consumes: `zod` (already in `package.json`).
- Produces:

```ts
export interface RedactionPattern {
  readonly name: string;
  readonly match: RegExp;
  readonly replace: string;
}

export interface RedactorOptions {
  readonly extraPatterns?: readonly RedactionPattern[];
}

export class Redactor {
  constructor(options?: RedactorOptions);
  /** Redacts a primitive string. Returns the original if no match. */
  redactString(value: string): string;
  /** Deep-redacts object/array values, replacing any string fields whose key matches a sensitive key. */
  redactValue<T>(value: T): T;
}
```

**Behavior rules:**

- Built-in patterns (always applied, in order):
  - `(?i)(api[_-]?key|apikey)[\s"'=:]+[A-Za-z0-9._\-]+` → `[REDACTED:apiKey]`
  - `(?i)Bearer\s+[A-Za-z0-9._\-]+` → `Bearer [REDACTED:token]`
  - `(?i)(password|secret|token)[\s"'=:]+[^\s"',}{]+` → `[REDACTED:$1]` (lower-case key captured)
  - Query-string `([?&])(api_?key|access_?token|password|secret)=([^&\s]+)` → `$1$2=[REDACTED]`
- Key-name scrubbing on objects: keys matching `/^(api_?key|apikey|password|secret|token|access_?token|authorization|cookie)$/i` have their values replaced with `'[REDACTED]'`.
- Recursion into arrays and nested objects. Circular references are tolerated (use a `WeakSet` of seen objects).
- `extraPatterns` are applied **after** the built-ins. Each pattern's `replace` string may reference `$1`, `$2`, etc.
- The `redactValue` overload uses Zod (`z.unknown()`) only to validate the input is JSON-serializable before returning; it does not change the public type. **Skip** if the resulting overhead is unnecessary — prefer a plain `unknown` check.

**Steps:**

- [ ] **Step 3.1: Write the failing test** in `tests/diagnostics/redactor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/diagnostics/redactor.js';

describe('Redactor.redactString', () => {
  const r = new Redactor();
  it('redacts apiKey=value style secrets', () => {
    expect(r.redactString('apiKey=sk-abcdef123')).toBe('[REDACTED:apiKey]');
  });
  it('redacts Bearer tokens', () => {
    expect(r.redactString('Authorization: Bearer eyJabc.def.ghi')).toBe(
      'Authorization: Bearer [REDACTED:token]',
    );
  });
  it('redacts query-string secrets', () => {
    expect(r.redactString('https://x.test/?api_key=ABC&q=1')).toBe(
      'https://x.test/?api_key=[REDACTED]&q=1',
    );
  });
  it('leaves safe strings alone', () => {
    expect(r.redactString('navigate to /jobs/search')).toBe('navigate to /jobs/search');
  });
  it('applies extraPatterns after built-ins', () => {
    const custom = new Redactor({
      extraPatterns: [{ name: 'session', match: /sess-[0-9]+/g, replace: '[REDACTED:session]' }],
    });
    expect(custom.redactString('cookie=sess-12345 other')).toBe(
      '[REDACTED:session] other',
    );
  });
});

describe('Redactor.redactValue', () => {
  const r = new Redactor();
  it('redacts sensitive keys in objects', () => {
    const input = { url: 'https://x.test', apiKey: 'sk-abcdef', meta: { token: 't-1', keep: 7 } };
    expect(r.redactValue(input)).toEqual({
      url: 'https://x.test',
      apiKey: '[REDACTED]',
      meta: { token: '[REDACTED]', keep: 7 },
    });
  });
  it('redacts sensitive keys inside arrays of objects', () => {
    const input = [{ password: 'pw' }, { safe: 'ok' }];
    expect(r.redactValue(input)).toEqual([{ password: '[REDACTED]' }, { safe: 'ok' }]);
  });
  it('does not mutate the input', () => {
    const input = { apiKey: 'sk-abcdef' };
    const copy = { ...input };
    r.redactValue(input);
    expect(input).toEqual(copy);
  });
  it('handles circular references without throwing', () => {
    const obj: Record<string, unknown> = { apiKey: 'sk-abc' };
    obj.self = obj;
    expect(() => r.redactValue(obj)).not.toThrow();
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm test -- tests/diagnostics/redactor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement `src/diagnostics/redactor.ts`**

```ts
const BUILTIN_PATTERNS: ReadonlyArray<{ name: string; match: RegExp; replace: string }> = [
  { name: 'bearer', match: /Bearer\s+[A-Za-z0-9._-]+/g, replace: 'Bearer [REDACTED:token]' },
  { name: 'kv', match: /(api[_-]?key|apikey|password|secret|token)[\s"':=]+[^\s"',}{]+/gi, replace: '[REDACTED:$1]' },
  { name: 'qs', match: /([?&])(api_?key|access_?token|password|secret)=([^&\s]+)/gi, replace: '$1$2=[REDACTED]' },
];

const SENSITIVE_KEYS = /^(api_?key|apikey|password|secret|token|access_?token|authorization|cookie)$/i;

export interface RedactionPattern {
  readonly name: string;
  readonly match: RegExp;
  readonly replace: string;
}

export interface RedactorOptions {
  readonly extraPatterns?: readonly RedactionPattern[];
}

export class Redactor {
  private readonly patterns: ReadonlyArray<RedactionPattern>;

  constructor(options: RedactorOptions = {}) {
    this.patterns = [...BUILTIN_PATTERNS, ...(options.extraPatterns ?? [])];
  }

  redactString(value: string): string {
    let out = value;
    for (const { match, replace } of this.patterns) {
      out = out.replace(match, replace);
    }
    return out;
  }

  redactValue<T>(value: T): T {
    return this.walk(value, new WeakSet()) as T;
  }

  private walk(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') {
      return typeof value === 'string' ? this.redactString(value) : value;
    }
    if (seen.has(value as object)) return value;
    seen.add(value as object);
    if (Array.isArray(value)) {
      return value.map((entry) => this.walk(entry, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = this.walk(v, seen);
      }
    }
    return out;
  }
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `pnpm test -- tests/diagnostics/redactor.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/diagnostics/redactor.ts tests/diagnostics/redactor.test.ts
git commit -m "feat(diagnostics): add redactor with built-in secret patterns"
```

---

### Task 4: Capture strategy interfaces

**Files:**
- Create: `src/diagnostics/capture/types.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export type CaptureArtifactType =
  | 'screenshot'
  | 'current_url'
  | 'stack_trace'
  | 'playwright_trace'
  | 'html_snapshot';

export interface CaptureContext {
  readonly scope: import('../filename.js').DiagnosticScope;
  readonly timestamp: string;                     // ISO
  readonly error?: unknown;                       // original scraper error
  /** Per-capture page/frame URL when known (TASK-012 supplies this). */
  readonly currentUrl?: string;
}

export interface CaptureResult {
  readonly artifactType: CaptureArtifactType;
  readonly extension: string;                     // 'png' | 'txt' | 'json' | 'zip' | 'html'
  readonly mimeType: string;                      // 'image/png' | 'text/plain' | ...
  readonly contents: Buffer | string;             // payload to write to disk
}

export interface CaptureStrategy {
  readonly artifactType: CaptureArtifactType;
  capture(context: CaptureContext): Promise<CaptureResult>;
}
```

**Steps:**

- [ ] **Step 4.1: Write `src/diagnostics/capture/types.ts`** with the exact contents above.
- [ ] **Step 4.2: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0 ✅

- [ ] **Step 4.3: Commit**

```bash
git add src/diagnostics/capture/types.ts
git commit -m "feat(diagnostics): add capture strategy interfaces"
```

---

### Task 5: StackTraceCapture (pure JS implementation)

**Files:**
- Create: `src/diagnostics/capture/stack-trace.ts`
- Create: `tests/diagnostics/capture/stack-trace.test.ts`

**Interfaces:**

- Consumes: `CaptureContext`, `CaptureResult`, `MissingBrowserImplementationError` (no — only used elsewhere).
- Produces:

```ts
export class StackTraceCapture implements CaptureStrategy {
  readonly artifactType = 'stack_trace' as const;
  capture(context: CaptureContext): Promise<CaptureResult>;
}
```

**Behavior rules:**

- Serializes `context.error` to a string with `error.stack ?? error.message ?? String(error)`.
- Returns `{ artifactType: 'stack_trace', extension: 'txt', mimeType: 'text/plain', contents }`.
- If `context.error` is missing, returns an empty payload annotated with `"no error attached"`.

**Steps:**

- [ ] **Step 5.1: Write the failing test** in `tests/diagnostics/capture/stack-trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StackTraceCapture } from '../../../src/diagnostics/capture/stack-trace.js';

describe('StackTraceCapture', () => {
  it('serializes Error.stack into a text artifact', async () => {
    const cap = new StackTraceCapture();
    const error = new Error('boom');
    const result = await cap.capture({
      scope: { pipelineRunId: 7 },
      timestamp: '2026-08-13T10:00:00.000Z',
      error,
    });
    expect(result.artifactType).toBe('stack_trace');
    expect(result.extension).toBe('txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.contents.toString()).toContain('boom');
    expect(result.contents.toString()).toContain('Error');
  });

  it('returns an empty artifact when no error is provided', async () => {
    const cap = new StackTraceCapture();
    const result = await cap.capture({
      scope: {},
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(result.contents.toString()).toBe('no error attached');
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `pnpm test -- tests/diagnostics/capture/stack-trace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `src/diagnostics/capture/stack-trace.ts`**

```ts
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (typeof error.stack === 'string' && error.stack !== '') return error.stack;
    return `${error.name}: ${error.message}`;
  }
  if (error === undefined || error === null) return 'no error attached';
  return String(error);
}

export class StackTraceCapture implements CaptureStrategy {
  readonly artifactType = 'stack_trace' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    const payload = context.error === undefined ? 'no error attached' : describeError(context.error);
    return {
      artifactType: 'stack_trace',
      extension: 'txt',
      mimeType: 'text/plain',
      contents: payload,
    };
  }
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `pnpm test -- tests/diagnostics/capture/stack-trace.test.ts`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/diagnostics/capture/stack-trace.ts tests/diagnostics/capture/stack-trace.test.ts
git commit -m "feat(diagnostics): add stack-trace capture strategy"
```

---

### Task 6: CurrentUrlCapture (pure JS implementation)

**Files:**
- Create: `src/diagnostics/capture/current-url.ts`
- Create: `tests/diagnostics/capture/current-url.test.ts`

**Interfaces:**

- Produces:

```ts
export class CurrentUrlCapture implements CaptureStrategy {
  readonly artifactType = 'current_url' as const;
  capture(context: CaptureContext): Promise<CaptureResult>;
}
```

**Behavior rules:**

- Writes `context.currentUrl` to a `text/plain` artifact.
- If `currentUrl` is missing, returns an empty payload annotated with `"no url captured"`.

**Steps:**

- [ ] **Step 6.1: Write the failing test** in `tests/diagnostics/capture/current-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CurrentUrlCapture } from '../../../src/diagnostics/capture/current-url.js';

describe('CurrentUrlCapture', () => {
  it('serializes the provided URL', async () => {
    const cap = new CurrentUrlCapture();
    const result = await cap.capture({
      scope: { pipelineRunId: 7 },
      timestamp: '2026-08-13T10:00:00.000Z',
      currentUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
    });
    expect(result.artifactType).toBe('current_url');
    expect(result.extension).toBe('txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.contents.toString()).toContain('linkedin.com/jobs/search');
  });

  it('returns an empty artifact when no URL is provided', async () => {
    const cap = new CurrentUrlCapture();
    const result = await cap.capture({
      scope: {},
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(result.contents.toString()).toBe('no url captured');
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `pnpm test -- tests/diagnostics/capture/current-url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `src/diagnostics/capture/current-url.ts`**

```ts
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export class CurrentUrlCapture implements CaptureStrategy {
  readonly artifactType = 'current_url' as const;

  async capture(context: CaptureContext): Promise<CaptureResult> {
    const payload =
      typeof context.currentUrl === 'string' && context.currentUrl !== ''
        ? context.currentUrl
        : 'no url captured';
    return {
      artifactType: 'current_url',
      extension: 'txt',
      mimeType: 'text/plain',
      contents: payload,
    };
  }
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `pnpm test -- tests/diagnostics/capture/current-url.test.ts`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/diagnostics/capture/current-url.ts tests/diagnostics/capture/current-url.test.ts
git commit -m "feat(diagnostics): add current-url capture strategy"
```

---

### Task 7: Browser-backed capture strategy stubs

**Files:**
- Create: `src/diagnostics/capture/screenshot.ts`
- Create: `src/diagnostics/capture/playwright-trace.ts`
- Create: `src/diagnostics/capture/html-snapshot.ts`
- Create: `src/diagnostics/capture/index.ts`

**Interfaces:**

- Each of the three stubs implements `CaptureStrategy` but throws `MissingBrowserImplementationError` on `capture(...)`. This keeps the manager contract testable today while reserving the slot for TASK-012 / TASK-013.

**Steps:**

- [ ] **Step 7.1: Write `src/diagnostics/capture/screenshot.ts`**

```ts
import { MissingBrowserImplementationError } from '../errors.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from './types.js';

export class ScreenshotCapture implements CaptureStrategy {
  readonly artifactType = 'screenshot' as const;

  async capture(_context: CaptureContext): Promise<CaptureResult> {
    throw new MissingBrowserImplementationError(
      'browser_implementation_missing',
      'ScreenshotCapture requires a Playwright-backed implementation (wired by TASK-012/13).',
      { artifactType: 'screenshot' },
    );
  }
}
```

- [ ] **Step 7.2: Write `src/diagnostics/capture/playwright-trace.ts`** — same shape, `artifactType = 'playwright_trace'`, metadata references TASK-012.
- [ ] **Step 7.3: Write `src/diagnostics/capture/html-snapshot.ts`** — same shape, `artifactType = 'html_snapshot'`, metadata references TASK-013.
- [ ] **Step 7.4: Write `src/diagnostics/capture/index.ts`**

```ts
export type { CaptureArtifactType, CaptureContext, CaptureResult, CaptureStrategy } from './types.js';
export { StackTraceCapture } from './stack-trace.js';
export { CurrentUrlCapture } from './current-url.js';
export { ScreenshotCapture } from './screenshot.js';
export { PlaywrightTraceCapture } from './playwright-trace.js';
export { HtmlSnapshotCapture } from './html-snapshot.js';
```

- [ ] **Step 7.5: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0 ✅

- [ ] **Step 7.6: Commit**

```bash
git add src/diagnostics/capture/screenshot.ts \
        src/diagnostics/capture/playwright-trace.ts \
        src/diagnostics/capture/html-snapshot.ts \
        src/diagnostics/capture/index.ts
git commit -m "feat(diagnostics): add browser-backed capture strategy stubs"
```

---

### Task 8: DiagnosticManager — orchestrator

**Files:**
- Create: `src/diagnostics/manager.ts`
- Create: `tests/diagnostics/manager.test.ts`

**Interfaces:**

- Consumes: `DiagnosticScope`, `DiagnosticError`, `Redactor`, capture strategies, `DiagnosticArtifactRepository` from `src/persistence/repositories/diagnostics.ts`, `PlatformPaths` from `src/platform/paths.ts`.
- Produces:

```ts
export interface DiagnosticManagerOptions {
  readonly config: OperationalConfig['diagnostics']['onScraperError'];
  readonly paths: Pick<PlatformPaths, 'diagnostics'>;
  readonly repositories: Repositories;
  readonly now?: () => Date;                          // injected for tests
  readonly strategies?: Partial<Record<CaptureArtifactType, CaptureStrategy>>;
  readonly redactor?: Redactor;
  readonly onError?: (event: { code: string; message: string; metadata?: unknown }) => void;
}

export interface DiagnosticScope extends ... {}    // re-export from filename.ts

export interface DiagnosticInput {
  readonly scope: DiagnosticScope;
  readonly error: unknown;
  readonly currentUrl?: string;
  /** Override the timestamp (ISO) for the artifacts. Defaults to options.now(). */
  readonly timestamp?: string;
}

export interface DiagnosticOutcome {
  readonly artifactIds: readonly number[];
  readonly failures: readonly { artifactType: CaptureArtifactType; code: string; message: string }[];
}

export class DiagnosticManager {
  constructor(options: DiagnosticManagerOptions);
  /** Capture all configured scraper-error artifacts and persist their metadata. */
  async recordScraperError(input: DiagnosticInput): Promise<DiagnosticOutcome>;
  /** Release any held resources. Currently a no-op; exists for SPEC §29.3 cleanup symmetry. */
  close(): Promise<void>;
}
```

**Behavior rules:**

- `recordScraperError` **never throws**. Every failure is caught, surfaced via `onError` (if provided), and recorded as a `capture_failed` row in `diagnostic_artifacts` (using `errorCode` column). The function returns an `outcome` with `artifactIds` for successes and `failures` for failures.
- The set of artifacts to capture is the intersection of `config` flags and the configured `strategies`. If a flag is on but the strategy is missing, it is recorded as a failure with code `strategy_missing`.
- Artifact path resolution: `paths.diagnostics.directory` is created lazily on first request (per SPEC §7.6). Scope subdirectories are created lazily as well.
- The `description` column is built from `error.message ?? String(error)` and **redacted** before persistence.
- The `currentUrl` value is redacted before being written to disk by `CurrentUrlCapture` and before being placed in metadata. The manager handles this by passing the redacted URL to the strategy.
- Redactor is applied to artifact contents only when the strategy exposes a `text/*` mime type. For binary contents (`image/png`, `application/zip`) the contents are written unchanged; only metadata descriptions are scrubbed.
- `close()` is a no-op today (no held resources) but defined for future Playwright-backed strategies.

**Steps:**

- [ ] **Step 8.1: Write the failing test** in `tests/diagnostics/manager.test.ts`:

```ts
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticManager } from '../../src/diagnostics/manager.js';
import { StackTraceCapture } from '../../src/diagnostics/capture/stack-trace.js';
import { CurrentUrlCapture } from '../../src/diagnostics/capture/current-url.js';
import { Redactor } from '../../src/diagnostics/redactor.js';
import type { CaptureContext, CaptureResult, CaptureStrategy } from '../../src/diagnostics/capture/types.js';

import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../src/persistence/connection.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

class FakeScreenshot implements CaptureStrategy {
  readonly artifactType = 'screenshot' as const;
  async capture(_ctx: CaptureContext): Promise<CaptureResult> {
    return { artifactType: 'screenshot', extension: 'png', mimeType: 'image/png', contents: Buffer.from('PNG') };
  }
}

describe('DiagnosticManager.recordScraperError', () => {
  let directory: string;
  let diagnosticsDir: string;
  let connection: DatabaseConnection;
  let repos: ReturnType<typeof createRepositories>;
  let events: { code: string; message: string; metadata?: unknown }[];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-mgr-'));
    diagnosticsDir = join(directory, 'diagnostics');
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repos = createRepositories(connection);
    events = [];
  });
  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function makeManager(overrides: Partial<ConstructorParameters<typeof DiagnosticManager>[0]> = {}) {
    const paths = {
      diagnostics: { directory: diagnosticsDir, file: (n: string) => join(diagnosticsDir, n) },
    } as const;
    return new DiagnosticManager({
      config: { screenshot: true, currentUrl: true, stackTrace: true, playwrightTrace: false, htmlSnapshot: false },
      paths: paths as never,
      repositories: repos,
      strategies: { screenshot: new FakeScreenshot(), current_url: new CurrentUrlCapture(), stack_trace: new StackTraceCapture() },
      redactor: new Redactor(),
      onError: (e) => events.push(e),
      ...overrides,
    });
  }

  it('captures the configured artifacts and persists their metadata', async () => {
    const mgr = makeManager();
    const error = new Error('scraper crashed');
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: 7, jobId: 99 },
      error,
      currentUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.artifactIds).toHaveLength(3);

    const rows = await repos.diagnostics.listByRun(7);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.artifactType).sort()).toEqual(['current_url', 'screenshot', 'stack_trace']);

    // Lazy directory creation: diagnostics directory now exists.
    expect(existsSync(diagnosticsDir)).toBe(true);
    // Files were actually written.
    for (const row of rows) expect(existsSync(row.storedPath)).toBe(true);
    // The stack-trace file contains the error message (redacted free of secrets).
    const stack = rows.find((r) => r.artifactType === 'stack_trace')!;
    expect(readFileSync(stack.storedPath, 'utf8')).toContain('scraper crashed');
  });

  it('skips artifacts whose flags are disabled', async () => {
    const mgr = makeManager({
      config: { screenshot: false, currentUrl: true, stackTrace: true, playwrightTrace: false, htmlSnapshot: false },
    });
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: 7 },
      error: new Error('x'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.artifactIds).toHaveLength(2);
    expect(outcome.failures).toEqual([]);
  });

  it('records a strategy_missing failure when a flag is on but the strategy is absent', async () => {
    const mgr = makeManager({ strategies: { stack_trace: new StackTraceCapture() } });
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: 7 },
      error: new Error('x'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.artifactIds).toHaveLength(1);
    expect(outcome.failures).toHaveLength(2); // screenshot + current_url missing
    expect(outcome.failures.every((f) => f.code === 'strategy_missing')).toBe(true);

    const failedRows = await repos.diagnostics.listByRun(7);
    expect(failedRows.find((r) => r.artifactType === 'screenshot')).toBeDefined();
    expect(failedRows.find((r) => r.artifactType === 'current_url')).toBeDefined();
  });

  it('never throws to the caller and records the failure when capture throws', async () => {
    const broken: CaptureStrategy = {
      artifactType: 'stack_trace',
      async capture() { throw new Error('disk full'); },
    };
    const mgr = makeManager({ strategies: { stack_trace: broken, current_url: new CurrentUrlCapture() } });
    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: 7 },
      error: new Error('primary'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]!.artifactType).toBe('stack_trace');
    expect(events.some((e) => e.code === 'capture_failed')).toBe(true);
    // current_url still succeeded.
    expect(outcome.artifactIds).toHaveLength(1);
  });

  it('redacts secret-like values in the persisted description', async () => {
    const mgr = makeManager();
    await mgr.recordScraperError({
      scope: { pipelineRunId: 7 },
      error: new Error('failed: apiKey=sk-abcdef'),
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    const rows = await repos.diagnostics.listByRun(7);
    for (const row of rows) {
      if (row.description !== null) {
        expect(row.description).not.toContain('sk-abcdef');
        expect(row.description).toContain('[REDACTED');
      }
    }
  });

  it('close() resolves without throwing', async () => {
    await expect(makeManager().close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `pnpm test -- tests/diagnostics/manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement `src/diagnostics/manager.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { PlatformPaths } from '../platform/paths.js';
import type { Repositories } from '../persistence/repositories/index.js';

import {
  CurrentUrlCapture,
  StackTraceCapture,
  type CaptureArtifactType,
  type CaptureContext,
  type CaptureResult,
  type CaptureStrategy,
} from './capture/index.js';
import { DiagnosticError } from './errors.js';
import { buildSafeFilename, type DiagnosticScope } from './filename.js';
import { Redactor } from './redactor.js';

export interface DiagnosticManagerOptions {
  readonly config: {
    readonly screenshot: boolean;
    readonly currentUrl: boolean;
    readonly stackTrace: boolean;
    readonly playwrightTrace: boolean;
    readonly htmlSnapshot: boolean;
  };
  readonly paths: Pick<PlatformPaths, 'diagnostics'>;
  readonly repositories: Repositories;
  readonly now?: () => Date;
  readonly strategies?: Partial<Record<CaptureArtifactType, CaptureStrategy>>;
  readonly redactor?: Redactor;
  readonly onError?: (event: { code: string; message: string; metadata?: unknown }) => void;
}

export interface DiagnosticInput {
  readonly scope: DiagnosticScope;
  readonly error: unknown;
  readonly currentUrl?: string;
  readonly timestamp?: string;
}

export interface DiagnosticFailure {
  readonly artifactType: CaptureArtifactType;
  readonly code: string;
  readonly message: string;
}

export interface DiagnosticOutcome {
  readonly artifactIds: readonly number[];
  readonly failures: readonly DiagnosticFailure[];
}

const ALL_ARTIFACT_TYPES: readonly CaptureArtifactType[] = [
  'screenshot',
  'current_url',
  'stack_trace',
  'playwright_trace',
  'html_snapshot',
];

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error === undefined || error === null) return '';
  return String(error);
}

export class DiagnosticManager {
  private readonly options: Required<Omit<DiagnosticManagerOptions, 'now' | 'onError' | 'strategies' | 'redactor'>> & {
    readonly now: () => Date;
    readonly strategies: Partial<Record<CaptureArtifactType, CaptureStrategy>>;
    readonly redactor: Redactor;
    readonly onError?: DiagnosticManagerOptions['onError'];
  };

  constructor(options: DiagnosticManagerOptions) {
    const redactor = options.redactor ?? new Redactor();
    const strategies: Partial<Record<CaptureArtifactType, CaptureStrategy>> = options.strategies ?? {
      screenshot: undefined,
      current_url: new CurrentUrlCapture(),
      stack_trace: new StackTraceCapture(),
      playwright_trace: undefined,
      html_snapshot: undefined,
    };
    this.options = {
      ...options,
      strategies,
      redactor,
      now: options.now ?? (() => new Date()),
    };
  }

  private flagsFor(): Record<CaptureArtifactType, boolean> {
    return {
      screenshot: this.options.config.screenshot,
      current_url: this.options.config.currentUrl,
      stack_trace: this.options.config.stackTrace,
      playwright_trace: this.options.config.playwrightTrace,
      html_snapshot: this.options.config.htmlSnapshot,
    };
  }

  private report(event: { code: string; message: string; metadata?: unknown }): void {
    this.options.onError?.(event);
  }

  async recordScraperError(input: DiagnosticInput): Promise<DiagnosticOutcome> {
    const timestamp = input.timestamp ?? this.options.now().toISOString();
    const flags = this.flagsFor();
    const outcome: { artifactIds: number[]; failures: DiagnosticFailure[] } = { artifactIds: [], failures: [] };

    const redactedUrl =
      typeof input.currentUrl === 'string'
        ? this.options.redactor.redactString(input.currentUrl)
        : undefined;
    const description = this.options.redactor.redactString(describeError(input.error));

    for (const type of ALL_ARTIFACT_TYPES) {
      if (!flags[type]) continue;
      const strategy = this.options.strategies[type];
      if (strategy === undefined) {
        outcome.failures.push({ artifactType: type, code: 'strategy_missing', message: `No capture strategy registered for ${type}.` });
        await this.recordFailure(input.scope, type, 'strategy_missing', `No capture strategy registered for ${type}.`, timestamp);
        continue;
      }
      try {
        const ctx: CaptureContext = { scope: input.scope, timestamp, error: input.error, currentUrl: redactedUrl };
        const result = await strategy.capture(ctx);
        const persisted = await this.persist(result, input.scope, timestamp, description);
        outcome.artifactIds.push(persisted);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        outcome.failures.push({ artifactType: type, code: 'capture_failed', message });
        this.report({ code: 'capture_failed', message, metadata: { artifactType: type, scope: input.scope } });
        await this.recordFailure(input.scope, type, 'capture_failed', message, timestamp);
      }
    }
    return { artifactIds: outcome.artifactIds, failures: outcome.failures };
  }

  private async persist(
    result: CaptureResult,
    scope: DiagnosticScope,
    timestamp: string,
    description: string,
  ): Promise<number> {
    const filename = buildSafeFilename({
      artifactType: result.artifactType,
      scope,
      extension: result.extension,
      timestamp,
    });
    const absoluteDirectory = isAbsolute(filename.relativePath)
      ? dirname(filename.relativePath)
      : join(this.options.paths.diagnostics.directory, dirname(filename.relativePath));
    await mkdir(absoluteDirectory, { recursive: true });
    const storedPath = resolve(this.options.paths.diagnostics.directory, filename.relativePath);
    const payload =
      typeof result.contents === 'string' && result.mimeType.startsWith('text/')
        ? this.options.redactor.redactString(result.contents)
        : result.contents;
    await writeFile(storedPath, payload);
    const size = typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
    return this.options.repositories.diagnostics.insert({
      pipelineRunId: scope.pipelineRunId ?? null,
      searchExecutionId: scope.searchExecutionId ?? null,
      jobId: scope.jobId ?? null,
      discoveryErrorId: scope.discoveryErrorId ?? null,
      extractionAttemptId: scope.extractionAttemptId ?? null,
      artifactType: result.artifactType,
      storedPath,
      relativePath: filename.relativePath,
      mimeType: result.mimeType,
      fileSize: size,
      createdAt: timestamp,
      description,
    });
  }

  private async recordFailure(
    scope: DiagnosticScope,
    type: CaptureArtifactType,
    code: string,
    message: string,
    timestamp: string,
  ): Promise<void> {
    try {
      const filename = buildSafeFilename({
        artifactType: `${type}-capture-failed`,
        scope,
        extension: 'txt',
        timestamp,
      });
      const storedPath = resolve(this.options.paths.diagnostics.directory, filename.relativePath);
      await mkdir(dirname(storedPath), { recursive: true });
      await writeFile(storedPath, `${code}: ${message}\n`);
      await this.options.repositories.diagnostics.insert({
        pipelineRunId: scope.pipelineRunId ?? null,
        searchExecutionId: scope.searchExecutionId ?? null,
        jobId: scope.jobId ?? null,
        discoveryErrorId: scope.discoveryErrorId ?? null,
        extractionAttemptId: scope.extractionAttemptId ?? null,
        artifactType: 'log_file',
        storedPath,
        relativePath: filename.relativePath,
        mimeType: 'text/plain',
        fileSize: Buffer.byteLength(`${code}: ${message}\n`, 'utf8'),
        createdAt: timestamp,
        errorCode: code,
        description: this.options.redactor.redactString(`${type}: ${message}`),
      });
    } catch (cause) {
      const innerMessage = cause instanceof Error ? cause.message : String(cause);
      this.report({ code: 'failure_record_failed', message: innerMessage, metadata: { artifactType: type, originalCode: code } });
    }
  }

  async close(): Promise<void> {
    // Reserved for future Playwright-backed strategies. No-op today.
  }

  /** Exposed for tests and for callers that want to read the resolved strategy map. */
  get registeredStrategies(): Partial<Record<CaptureArtifactType, CaptureStrategy>> {
    return this.options.strategies;
  }

  /** Marker used by the orchestrator when constructing defaults. */
  static readonly DEFAULT_DIAGNOSTIC_CONFIG_KEYS = ALL_ARTIFACT_TYPES;
}
```

> Note: The `DiagnosticError` import is intentional even though it is not thrown directly in this file — the file follows the project's "import the typed error" convention so future code paths inside this module can throw it without changing imports.

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `pnpm test -- tests/diagnostics/manager.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8.5: Commit**

```bash
git add src/diagnostics/manager.ts tests/diagnostics/manager.test.ts
git commit -m "feat(diagnostics): add manager that captures scraper-error artifacts"
```

---

### Task 9: Public exports and integration test

**Files:**
- Create: `src/diagnostics/index.ts`
- Create: `tests/diagnostics/integration.test.ts`

**Steps:**

- [ ] **Step 9.1: Write `src/diagnostics/index.ts`**

```ts
export { DiagnosticError, MissingBrowserImplementationError } from './errors.js';
export {
  buildSafeFilename,
  resolveScopeDirectory,
  sanitizeFilenameComponent,
  type DiagnosticScope,
  type SafeFilenameOptions,
  type SafeFilenameResult,
} from './filename.js';
export { Redactor, type RedactionPattern, type RedactorOptions } from './redactor.js';
export {
  CurrentUrlCapture,
  StackTraceCapture,
  ScreenshotCapture,
  PlaywrightTraceCapture,
  HtmlSnapshotCapture,
  type CaptureArtifactType,
  type CaptureContext,
  type CaptureResult,
  type CaptureStrategy,
} from './capture/index.js';
export {
  DiagnosticManager,
  type DiagnosticInput,
  type DiagnosticManagerOptions,
  type DiagnosticOutcome,
  type DiagnosticFailure,
} from './manager.js';
```

- [ ] **Step 9.2: Write `tests/diagnostics/integration.test.ts`** — exercises the manager end-to-end against a real SQLite DB and a real temporary diagnostics directory, capturing all five default artifacts (using the browser stubs to verify the strategy_missing path is recorded correctly) plus a stack trace, then asserts that:

1. `diagnostic_artifacts` rows exist with the expected associations.
2. Files exist on disk under the scope subdirectories.
3. The redactor replaced any secret-looking text in descriptions.
4. `DiagnosticManager.close()` is idempotent.

```ts
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DiagnosticManager,
  StackTraceCapture,
  CurrentUrlCapture,
  Redactor,
} from '../../src/diagnostics/index.js';

import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../src/persistence/connection.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

describe('diagnostics end-to-end', () => {
  let directory: string;
  let diagnosticsDir: string;
  let connection: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-diag-int-'));
    diagnosticsDir = join(directory, 'diagnostics');
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
  });
  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('captures stack_trace + current_url when only non-browser flags are enabled', async () => {
    const repos = createRepositories(connection);
    const mgr = new DiagnosticManager({
      config: { screenshot: false, currentUrl: true, stackTrace: true, playwrightTrace: false, htmlSnapshot: false },
      paths: { diagnostics: { directory: diagnosticsDir, file: (n) => join(diagnosticsDir, n) } } as never,
      repositories: repos,
      strategies: {
        current_url: new CurrentUrlCapture(),
        stack_trace: new StackTraceCapture(),
      },
      redactor: new Redactor(),
    });

    const outcome = await mgr.recordScraperError({
      scope: { pipelineRunId: 7, jobId: 99 },
      error: new Error('failed: apiKey=sk-abcdef'),
      currentUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timestamp: '2026-08-13T10:00:00.000Z',
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.artifactIds).toHaveLength(2);

    const rows = await repos.diagnostics.listByRun(7);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.artifactType).sort()).toEqual(['current_url', 'stack_trace']);
    for (const row of rows) {
      expect(existsSync(row.storedPath)).toBe(true);
      if (row.description !== null) {
        expect(row.description).not.toContain('sk-abcdef');
      }
    }

    // Scope subdirectory layout.
    expect(readdirSync(join(diagnosticsDir, 'run-7', 'job-99'))).toHaveLength(2);

    // Idempotent close.
    await expect(mgr.close()).resolves.toBeUndefined();
    await expect(mgr.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 9.3: Run test to verify it fails (missing public exports)**

Run: `pnpm test -- tests/diagnostics/integration.test.ts`
Expected: FAIL — module `../../src/diagnostics/index.js` not found (until 9.1 is done).

- [ ] **Step 9.4: Confirm the test now passes**

Run: `pnpm test -- tests/diagnostics/integration.test.ts`
Expected: PASS.

- [ ] **Step 9.5: Run the full diagnostics suite**

Run: `pnpm test -- tests/diagnostics`
Expected: All tests PASS (filename + redactor + stack-trace + current-url + manager + integration).

- [ ] **Step 9.6: Commit**

```bash
git add src/diagnostics/index.ts tests/diagnostics/integration.test.ts
git commit -m "feat(diagnostics): add public exports and end-to-end integration test"
```

---

### Task 10: Final verification and task-doc update

**Files:**
- Modify: `docs/tasks/TASK-005-diagnostics-artifacts.md` (append implementation results section)

**Steps:**

- [ ] **Step 10.1: Run full verification commands** per the task's "Verification requirements" section:

```bash
node --version             # v24.18.0
pnpm --version             # 11.18.0
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test                  # all suites, expect 131 + ~22 new = ~153 passing
pnpm test:live:list        # empty (no live tests added)
pnpm build
node dist/cli.js --help
node dist/cli.js paths
```

- [ ] **Step 10.2: Run the cross-domain guardrail checks** from AGENTS.md:

```bash
rg -n 'from .(commander|@inquirer|playwright|openai|pino|drizzle-orm)' src/diagnostics
# expected: no matches
rg -n 'require\(' src/diagnostics
# expected: no matches
```

- [ ] **Step 10.3: Update `docs/tasks/TASK-005-diagnostics-artifacts.md`** — change status to "Implemented" and append an "Implementation results" section that mirrors the TASK-004 format: branch name, dependency versions (none added), verification command outcomes, test inventory, deviations from the plan, and known limitations for TASK-012/13 (browser strategies remain stubs).
- [ ] **Step 10.4: Commit** (do NOT push, do NOT merge — user approval is required per GIT.md §4)

```bash
git add docs/tasks/TASK-005-diagnostics-artifacts.md
git commit -m "docs(diagnostics): record TASK-005 implementation results"
```

- [ ] **Step 10.5: Show the user the proposed squash-merge plan** per GIT.md §4:

```text
Branch: feat/task-005-diagnostics-artifacts
Commits on branch: 11 (Tasks 1-9 + results doc)
Proposed squash commit message: feat(diagnostics): add diagnostic manager, safe filename + redactor, and capture strategies
```

Then wait for explicit user approval before merging into `main`.

---

## Self-Review

**1. Spec coverage:**

- §7.1–7.6 directory categories & path behavior → covered by `paths.ts` (TASK-002) and `manager.ts` lazy `mkdir` (Tasks 8-9).
- §8.1 `config.json` diagnostics section → covered by `OperationalConfig.diagnostics.onScraperError` (TASK-002), consumed by `DiagnosticManager` (Task 8).
- §23.1 diagnostic artifacts entity → covered by `diagnostic_artifacts` repository (TASK-004); manager (Task 8) inserts rows against it.
- §29.3 graceful resource cleanup → `DiagnosticManager.close()` exists for symmetry (Task 8). No active resources today.
- §39 default scraper artifacts (screenshot / current URL / stack trace on, playwright trace / html snapshot off) → covered by default `flagsFor()` mapping (Task 8).
- §39 must-haves: associate with run/search/job when possible → `DiagnosticScope` + `listByRun/Search/Job`; safe filenames → Task 2; preserve original error → Task 8 (never throws); avoid secret inclusion → Task 3 + Task 8.

**2. Placeholder scan:**

- No "TODO", "TBD", "implement later", "fill in details", or "handle edge cases" appears in any task body. Every code block is complete.
- The browser-backed strategies (Task 7) are **intentional** stubs that throw a typed error — they are not placeholders for the manager; the manager treats them as a real strategy whose `capture()` happens to surface an error, which is then recorded as a `capture_failed` row. This satisfies the "no placeholder" rule because the manager handles the strategy correctly.

**3. Type consistency:**

- `CaptureArtifactType` defined in `capture/types.ts` matches the schema enum (`'screenshot' | 'current_url' | 'stack_trace' | 'playwright_trace' | 'html_snapshot' | 'log_file'`). `DiagnosticManager.recordScraperError` iterates only the first five — the sixth (`log_file`) is reserved for the manager's internal failure rows and is inserted directly via `repositories.diagnostics.insert`.
- `DiagnosticScope` mirrors `DiagnosticArtifactInsert`'s optional FK columns.
- `DiagnosticManagerOptions.config` mirrors the `OperationalConfig['diagnostics']['onScraperError']` shape from `src/config/schema.ts` — both share the same five boolean keys.

All consistent. No corrections needed.