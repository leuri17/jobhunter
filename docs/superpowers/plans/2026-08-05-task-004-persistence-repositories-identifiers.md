# TASK-004 Implementation Plan — Persistence Repositories, Transactions, Lifecycle Rules, and CLI Identifiers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the Drizzle ORM behind typed, repository-style storage interfaces and provide stable integer-to-prefix CLI identifiers and atomic transactions for the lifecycle transition groups defined by `SPEC.md` §23.5 — so that downstream tasks (filtering, scoring, scraping, inspection) can persist and query every MVP entity without ever importing Drizzle, better-sqlite3, Commander, Inquirer, Playwright, OpenAI, or Pino.

**Architecture:** Each repository is a stateless class that accepts a `RepositoryContext` (a `{ db: DrizzleDB }` shape) and exposes methods that take and return domain DTOs (not Drizzle row types). Repositories are grouped by domain (profile, filter, run, job, score, openai, diagnostics, application metadata) and live in `src/persistence/repositories/`. JSON columns are wrapped with a small codec so callers never touch raw serialized JSON. A pure `identifiers.ts` module formats and resolves the `SPEC.md` §32 prefixed display IDs (`job_42`, `run_18`, etc.) and the dual-format `job_<int>` ↔ numeric LinkedIn `sourceJobId` resolution rule. SPEC §23.5 transaction groups are exposed via per-repository methods that use Drizzle's `db.transaction()` (the repositories are stateless so the same code path works whether the call comes from a plain connection or a wider application transaction). The active-flag invariants for `profile_versions` and `filter_configuration_versions` are enforced by the schema's partial unique indexes plus repository-level `activate()`/`approve()` methods that flip the previous active row to `superseded`/inactive before promoting the new one.

**Tech Stack:** No new dependencies — only types already in `package.json` (`drizzle-orm@0.45.2`, `better-sqlite3@13.0.3`, `zod@4.4.3`). Drizzle's `db.transaction()` provides SQLite transaction boundaries. Zod JSON codecs validate JSON columns at the repository boundary.

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No other LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing.
- **Domain boundaries:** Repository code lives in `src/persistence/repositories/` and may import `drizzle-orm`, `better-sqlite3`, and the schema module. It **must not** import Commander, Inquirer, Playwright, OpenAI, or Pino. CLI handlers (later tasks) call `formatXxxId()` at the presentation boundary; they never craft prefixes themselves.
- **Validation:** Zod parses JSON columns at the boundary. JSON columns are stored as `JSON.stringify(value)`; reading them passes through `JSON.parse` then a permissive Zod schema. Domain-specific shape validation (the profile JSON, filter config JSON, etc.) is the caller's job — the repository only guarantees the column is valid JSON.
- **Errors:** Add typed errors (`InvalidIdentifierError`, `RecordNotFoundError`) extending `ApplicationError`. `InvalidIdentifierError` and `RecordNotFoundError` map to `ExitCode.InvalidUsage` (2) so CLI commands can surface them as `InvalidUsage`. Existing `DatabaseError` and `MigrationError` keep `ExitCode.Fatal` (1).
- **History preservation:** Repositories **never** delete or in-place mutate approved/historical rows. Approval/finalization writes append new rows or flip the `active` flag in a transaction. `profile_sources` are immutable after insert (only the extraction metadata columns may be updated).
- **Identifiers:** Prefixing is a presentation concern. Repositories return integer primary keys; CLI code calls `formatXxxId()` only at the CLI boundary. The identifiers module is pure — no DB, no Drizzle, no I/O.
- **Tests:** Vitest. Use temporary SQLite databases (`mkdtempSync(join(tmpdir(), 'jobhunter-...'))`) for every persistence test — never the user's runtime database. The live LinkedIn suite stays excluded from CI.
- **No secrets:** Repositories must not log API keys, raw prompts, or raw model responses.
- **File boundary:** Every repository file must import only from `src/persistence/*.ts` siblings, `src/errors/application-error.ts`, `drizzle-orm`, `better-sqlite3`, and `zod`. No `node:fs`, no `node:os`, no terminal libraries.

## File Structure

```
src/persistence/
  identifier-errors.ts                        # InvalidIdentifierError (Task 1)
  identifiers.ts                              # format/resolve/pair for 9 entities (Task 1)
  repository-errors.ts                        # RecordNotFoundError (Task 2)
  repositories/
    types.ts                                  # RepositoryContext, DrizzleDB alias (Task 2)
    codecs.ts                                 # JSON column codecs using Zod (Task 2)
    profile-sources.ts                        # profile_sources (Task 3)
    profile-versions.ts                       # profile_versions + revisions + conflicts + warnings + overrides (Task 3)
    filter-configurations.ts                  # filter_configuration_versions (Task 4)
    pipeline-runs.ts                          # pipeline_runs + search_executions (Task 5)
    jobs.ts                                   # jobs + discovery_events + discovery_errors + extraction_attempts (Task 6)
    filter-results.ts                         # filter_results (Task 7)
    score-results.ts                          # score_results (Task 8)
    openai-metadata.ts                        # openai_request_metadata (Task 9)
    diagnostics.ts                            # diagnostic_artifacts (Task 10)
    application-metadata.ts                   # application_metadata (Task 11)
    index.ts                                  # Repositories facade + re-exports (Task 12)
  transactions.ts                             # SPEC §23.5 transaction helpers (Task 12)
  index.ts                                    # Public re-exports update (Task 13)
tests/persistence/
  identifier-errors.test.ts                   # (Task 1)
  identifiers.test.ts                         # (Task 1)
  repository-errors.test.ts                   # (Task 2)
  repositories/
    profile-sources.test.ts                   # (Task 3)
    profile-versions.test.ts                  # (Task 3)
    filter-configurations.test.ts             # (Task 4)
    pipeline-runs.test.ts                     # (Task 5)
    jobs.test.ts                              # (Task 6)
    filter-results.test.ts                    # (Task 7)
    score-results.test.ts                     # (Task 8)
    openai-metadata.test.ts                   # (Task 9)
    diagnostics.test.ts                       # (Task 10)
    application-metadata.test.ts              # (Task 11)
    integration.test.ts                       # (Task 13)
  transactions.test.ts                        # (Task 12)
```

Files change together by responsibility. The identifier and error modules are pure. Repositories are divided by domain because cross-table invariants (active approved profile, filter activation, run+searches composition) align with domain boundaries. The `Repositories` facade exposes the groups to higher layers and provides the §23.5 transaction helpers.

---

### Task 1: Add typed identifier errors and the identifier module

**Files:**

- Create: `src/persistence/identifier-errors.ts`
- Create: `src/persistence/identifiers.ts`
- Create: `tests/persistence/identifier-errors.test.ts`
- Create: `tests/persistence/identifiers.test.ts`

**Interfaces:**

- Consumes: `ApplicationError` from `src/errors/application-error.ts` (TASK-002).
- Produces:

```ts
// identifier-errors.ts
export class InvalidIdentifierError extends ApplicationError {
  constructor(code, message, metadata?, cause?): exitCode = ExitCode.InvalidUsage;
}

// identifiers.ts
export type IdentifierKind =
  | 'job' | 'run' | 'profile' | 'source' | 'search'
  | 'filters' | 'extraction' | 'score' | 'discovery_error';

export function formatId(kind: IdentifierKind, id: number): string;          // e.g. formatId('job', 42) -> 'job_42'
export function resolveId(kind: IdentifierKind, raw: string): number;        // throws InvalidIdentifierError on invalid
export function resolveJobIdentifier(raw: string): { sourceJobId?: string; jobId?: number };  // SPEC §32.1 dual-form
export function parsePrefixedId(raw: string, expectedKind: IdentifierKind): number;          // strict, rejects cross-kind
export const IDENTIFIER_PREFIXES: Readonly<Record<IdentifierKind, string>>;
export const JOB_PREFIX = 'job_';
export const NUMERIC_JOB_PATTERN = /^[0-9]+$/;
```

Identifiers are case-sensitive (`SPEC.md` §32). `resolveId` throws `InvalidIdentifierError` (exit code 2) for malformed input — exactly the error code CLI commands will map to `InvalidUsage` per `SPEC.md` §32.1.

The `resolveJobIdentifier` function implements `SPEC.md` §32.1:

- `job_<integer>` → `{ jobId: <integer> }`
- Numeric-only `<integer>` → `{ sourceJobId: <integer> }`
- Anything else → `InvalidIdentifierError`.

`formatId` is the only writer of prefixes. Repositories never call it; they return integer IDs. CLI code (future tasks) formats at the boundary.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/identifier-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  ExitCode,
  InvalidIdentifierError,
} from '../../src/persistence/identifier-errors.js';

describe('InvalidIdentifierError', () => {
  it('extends ApplicationError', () => {
    expect(InvalidIdentifierError.prototype).toBeInstanceOf(ApplicationError);
  });

  it('defaults to the InvalidUsage exit code', () => {
    const error = new InvalidIdentifierError(
      'invalid_identifier',
      'Identifier "foo" is not a recognized format.',
      { input: 'foo' },
    );
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.code).toBe('invalid_identifier');
    expect(error.metadata).toEqual({ input: 'foo' });
    expect(error.name).toBe('InvalidIdentifierError');
  });

  it('serializes via toJSON()', () => {
    const error = new InvalidIdentifierError('invalid_identifier', 'bad');
    expect(error.toJSON()).toEqual({
      name: 'InvalidIdentifierError',
      code: 'invalid_identifier',
      message: 'bad',
      exitCode: ExitCode.InvalidUsage,
      metadata: {},
    });
  });
});
```

Create `tests/persistence/identifiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  formatId,
  resolveId,
  resolveJobIdentifier,
  parsePrefixedId,
  InvalidIdentifierError,
  IDENTIFIER_PREFIXES,
  JOB_PREFIX,
  NUMERIC_JOB_PATTERN,
} from '../../src/persistence/identifiers.js';

describe('identifier prefixes', () => {
  it('exposes the documented prefixes from SPEC §32', () => {
    expect(IDENTIFIER_PREFIXES).toEqual({
      job: 'job_',
      run: 'run_',
      profile: 'profile_',
      source: 'source_',
      search: 'search_',
      filters: 'filters_',
      extraction: 'extraction_',
      score: 'score_',
      discovery_error: 'discovery_error_',
    });
    expect(JOB_PREFIX).toBe('job_');
    expect(NUMERIC_JOB_PATTERN.test('123456789')).toBe(true);
    expect(NUMERIC_JOB_PATTERN.test('not-a-number')).toBe(false);
  });
});

describe('formatId', () => {
  it('formats every entity kind with its prefix', () => {
    expect(formatId('job', 42)).toBe('job_42');
    expect(formatId('run', 18)).toBe('run_18');
    expect(formatId('profile', 3)).toBe('profile_3');
    expect(formatId('source', 2)).toBe('source_2');
    expect(formatId('search', 7)).toBe('search_7');
    expect(formatId('filters', 4)).toBe('filters_4');
    expect(formatId('extraction', 15)).toBe('extraction_15');
    expect(formatId('score', 21)).toBe('score_21');
    expect(formatId('discovery_error', 5)).toBe('discovery_error_5');
  });

  it('rejects non-integer IDs', () => {
    expect(() => formatId('job', 1.5)).toThrow(InvalidIdentifierError);
    expect(() => formatId('job', Number.NaN)).toThrow(InvalidIdentifierError);
    expect(() => formatId('job', -1)).toThrow(InvalidIdentifierError);
  });
});

describe('resolveId', () => {
  it('resolves every prefixed format', () => {
    expect(resolveId('job', 'job_42')).toBe(42);
    expect(resolveId('run', 'run_18')).toBe(18);
    expect(resolveId('profile', 'profile_3')).toBe(3);
    expect(resolveId('source', 'source_2')).toBe(2);
    expect(resolveId('search', 'search_7')).toBe(7);
    expect(resolveId('filters', 'filters_4')).toBe(4);
    expect(resolveId('extraction', 'extraction_15')).toBe(15);
    expect(resolveId('score', 'score_21')).toBe(21);
    expect(resolveId('discovery_error', 'discovery_error_5')).toBe(5);
  });

  it('rejects missing prefix', () => {
    expect(() => resolveId('job', '42')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('run', 'run-18')).toThrow(InvalidIdentifierError);
  });

  it('rejects wrong-case prefixes (case-sensitive per SPEC §32)', () => {
    expect(() => resolveId('job', 'JOB_42')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('run', 'Run_18')).toThrow(InvalidIdentifierError);
  });

  it('rejects non-integer payloads', () => {
    expect(() => resolveId('job', 'job_')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('job', 'job_3.14')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('job', 'job_abc')).toThrow(InvalidIdentifierError);
  });

  it('rejects empty or whitespace input', () => {
    expect(() => resolveId('job', '')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('job', '   ')).toThrow(InvalidIdentifierError);
  });

  it('rejects numbers that overflow the safe integer range', () => {
    expect(() => resolveId('job', 'job_99999999999999999999')).toThrow(InvalidIdentifierError);
  });
});

describe('parsePrefixedId', () => {
  it('rejects cross-kind prefixes', () => {
    expect(() => parsePrefixedId('run_42', 'job')).toThrow(InvalidIdentifierError);
    expect(() => parsePrefixedId('job_42', 'run')).toThrow(InvalidIdentifierError);
  });

  it('accepts the expected prefix', () => {
    expect(parsePrefixedId('profile_3', 'profile')).toBe(3);
  });
});

describe('resolveJobIdentifier', () => {
  it('parses job_<integer> as a local ID', () => {
    expect(resolveJobIdentifier('job_42')).toEqual({ jobId: 42 });
  });

  it('parses numeric-only as a LinkedIn sourceJobId', () => {
    expect(resolveJobIdentifier('123456789')).toEqual({ sourceJobId: '123456789' });
    expect(resolveJobIdentifier('987654321')).toEqual({ sourceJobId: '987654321' });
  });

  it('rejects prefixed runs, profiles, and other kinds', () => {
    expect(() => resolveJobIdentifier('run_42')).toThrow(InvalidIdentifierError);
    expect(() => resolveJobIdentifier('profile_42')).toThrow(InvalidIdentifierError);
    expect(() => resolveJobIdentifier('job_abc')).toThrow(InvalidIdentifierError);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/identifier-errors.test.ts tests/persistence/identifiers.test.ts
```

Expected: FAIL — modules not yet created.

- [ ] **Step 3: Implement `src/persistence/identifier-errors.ts`**

```ts
import { ApplicationError, ExitCode } from '../errors/application-error.js';

export class InvalidIdentifierError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}
```

The file is a single class. It maps to `InvalidUsage` (exit code 2) because `SPEC.md` §32.1 mandates that invalid formats produce exit code 2.

- [ ] **Step 4: Implement `src/persistence/identifiers.ts`**

```ts
import { InvalidIdentifierError } from './identifier-errors.js';

export type IdentifierKind =
  | 'job'
  | 'run'
  | 'profile'
  | 'source'
  | 'search'
  | 'filters'
  | 'extraction'
  | 'score'
  | 'discovery_error';

export const IDENTIFIER_PREFIXES: Readonly<Record<IdentifierKind, string>> = {
  job: 'job_',
  run: 'run_',
  profile: 'profile_',
  source: 'source_',
  search: 'search_',
  filters: 'filters_',
  extraction: 'extraction_',
  score: 'score_',
  discovery_error: 'discovery_error_',
};

export const JOB_PREFIX = IDENTIFIER_PREFIXES.job;
export const NUMERIC_JOB_PATTERN = /^[0-9]+$/;

const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

function throwInvalid(code: string, message: string, metadata: Record<string, unknown> = {}): never {
  throw new InvalidIdentifierError(code, message, metadata);
}

function isFinitePositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= SAFE_INTEGER_MAX;
}

export function formatId(kind: IdentifierKind, id: number): string {
  if (!isFinitePositiveInteger(id)) {
    throwInvalid(
      'invalid_identifier',
      `Identifier id must be a finite positive integer <= ${SAFE_INTEGER_MAX}.`,
      { kind, id },
    );
  }
  return `${IDENTIFIER_PREFIXES[kind]}${id}`;
}

function parsePrefixed(raw: string): { kind: IdentifierKind; id: number } | null {
  for (const [kind, prefix] of Object.entries(IDENTIFIER_PREFIXES) as Array<[IdentifierKind, string]>) {
    if (raw.startsWith(prefix)) {
      const tail = raw.slice(prefix.length);
      if (!/^[0-9]+$/.test(tail)) return null;
      const id = Number(tail);
      if (!isFinitePositiveInteger(id)) return null;
      return { kind, id };
    }
  }
  return null;
}

export function resolveId(kind: IdentifierKind, raw: string): number {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throwInvalid('invalid_identifier', 'Identifier must be a non-empty string.', { kind, input: raw });
  }
  const prefix = IDENTIFIER_PREFIXES[kind];
  if (!raw.startsWith(prefix)) {
    throwInvalid(
      'invalid_identifier',
      `Identifier "${raw}" must start with "${prefix}".`,
      { kind, input: raw, expectedPrefix: prefix },
    );
  }
  const tail = raw.slice(prefix.length);
  if (!/^[0-9]+$/.test(tail)) {
    throwInvalid(
      'invalid_identifier',
      `Identifier "${raw}" must end with a positive integer.`,
      { kind, input: raw, tail },
    );
  }
  const id = Number(tail);
  if (!isFinitePositiveInteger(id)) {
    throwInvalid(
      'invalid_identifier',
      `Identifier "${raw}" resolves to an out-of-range integer.`,
      { kind, input: raw, id },
    );
  }
  return id;
}

export function parsePrefixedId(raw: string, expectedKind: IdentifierKind): number {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throwInvalid('invalid_identifier', 'Identifier must be a non-empty string.', {
      expectedKind,
      input: raw,
    });
  }
  const parsed = parsePrefixed(raw);
  if (parsed === null) {
    throwInvalid(
      'invalid_identifier',
      `Identifier "${raw}" does not match any known prefix.`,
      { expectedKind, input: raw },
    );
  }
  if (parsed.kind !== expectedKind) {
    throwInvalid(
      'invalid_identifier',
      `Identifier "${raw}" has prefix "${IDENTIFIER_PREFIXES[parsed.kind]}" but "${IDENTIFIER_PREFIXES[expectedKind]}" was expected.`,
      { expectedKind, input: raw, parsedKind: parsed.kind },
    );
  }
  return parsed.id;
}

export interface JobIdentifierResolution {
  readonly jobId?: number;
  readonly sourceJobId?: string;
}

export function resolveJobIdentifier(raw: string): JobIdentifierResolution {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throwInvalid('invalid_identifier', 'Job identifier must be a non-empty string.', { input: raw });
  }
  if (raw.startsWith(JOB_PREFIX)) {
    const id = resolveId('job', raw);
    return { jobId: id };
  }
  if (NUMERIC_JOB_PATTERN.test(raw)) {
    return { sourceJobId: raw };
  }
  throwInvalid(
    'invalid_identifier',
    `Job identifier "${raw}" must be either "${JOB_PREFIX}<integer>" or a numeric LinkedIn sourceJobId.`,
    { input: raw },
  );
}
```

Notes:

- The module is pure — no DB, no I/O, no Drizzle. CLI/presentation code (later tasks) imports `formatId` and `resolveJobIdentifier` from here.
- `IdentifierKind` is exhaustive over the prefixes in SPEC §32. Adding a new prefix requires updating `IDENTIFIER_PREFIXES` and the type.
- `parsePrefixedId` is used by repositories in the next task to detect cross-kind misuse (e.g., a user passing `run_42` to a `job_<int>` command).

- [ ] **Step 5: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/identifier-errors.test.ts tests/persistence/identifiers.test.ts
```

Expected: PASS — 17 tests pass (4 identifier-errors + 13 identifiers).

- [ ] **Step 6: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/identifier-errors.ts src/persistence/identifiers.ts tests/persistence/identifier-errors.test.ts tests/persistence/identifiers.test.ts
git commit -m "feat(persistence): add stable identifier module and CLI identifier errors"
```

---

### Task 2: Add repository errors and the shared repository context

**Files:**

- Create: `src/persistence/repository-errors.ts`
- Create: `src/persistence/repositories/types.ts`
- Create: `src/persistence/repositories/codecs.ts`
- Create: `tests/persistence/repository-errors.test.ts`
- Create: `tests/persistence/repositories/codecs.test.ts`

**Interfaces:**

- Consumes: `ApplicationError` from TASK-002, `drizzle-orm/better-sqlite3` types from TASK-003.
- Produces:

```ts
// repository-errors.ts
export class RecordNotFoundError extends ApplicationError; // exitCode = InvalidUsage (2)

// repositories/types.ts
export type DrizzleDB = BetterSQLite3Database<Schema>;
export interface RepositoryContext {
  readonly db: DrizzleDB;
}

// repositories/codecs.ts
export function jsonColumn<T>(schema: ZodType<T>): {
  encode(value: T): string;
  decode(raw: string | null): T | null;
  decodeRequired(raw: string): T;
};
```

`RecordNotFoundError` exits with `InvalidUsage` (2) because CLI commands map it to the `job_not_found` (or equivalent) error code at the boundary. The repository contract says "ID did not resolve"; presentation (later tasks) decides whether to call that `job_not_found` or `run_not_found`.

The shared `RepositoryContext` is the seam through which repositories receive either a `DatabaseConnection.db` or a Drizzle transaction handle. Both implement the same Drizzle query API, so this keeps the constructor flex without leaking Drizzle type parameters into every signature.

`codecs.ts` exposes JSON column codecs so the JSON columns (profile_json, config_json, rules_evaluated_json, etc.) stay typed at the repository boundary. Each codec encodes via `JSON.stringify` and decodes via `JSON.parse` followed by Zod validation.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repository-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  ExitCode,
  RecordNotFoundError,
} from '../../src/persistence/repository-errors.js';

describe('RecordNotFoundError', () => {
  it('extends ApplicationError', () => {
    expect(RecordNotFoundError.prototype).toBeInstanceOf(ApplicationError);
  });

  it('defaults to InvalidUsage exit code and includes the entity and id in metadata', () => {
    const error = new RecordNotFoundError('job_not_found', 'No job with id 42.', {
      entity: 'job',
      id: 42,
    });
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.code).toBe('job_not_found');
    expect(error.metadata).toEqual({ entity: 'job', id: 42 });
    expect(error.name).toBe('RecordNotFoundError');
  });
});
```

Create `tests/persistence/repositories/codecs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jsonColumn } from '../../src/persistence/repositories/codecs.js';

const schema = z.object({
  name: z.string(),
  count: z.number(),
});

describe('jsonColumn', () => {
  const codec = jsonColumn(schema);

  it('encode then decode roundtrips the value', () => {
    const encoded = codec.encode({ name: 'alpha', count: 3 });
    expect(typeof encoded).toBe('string');
    expect(codec.decode(encoded)).toEqual({ name: 'alpha', count: 3 });
  });

  it('rejects malformed JSON on decode', () => {
    expect(() => codec.decode('not-json')).toThrow();
  });

  it('rejects JSON that fails schema validation', () => {
    expect(() => codec.decode('{"name":1}')).toThrow();
  });

  it('decode returns null when the raw value is null', () => {
    expect(codec.decode(null)).toBeNull();
  });

  it('decodeRequired throws when the raw value is null', () => {
    expect(() => codec.decodeRequired(null)).toThrow();
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repository-errors.test.ts tests/persistence/repositories/codecs.test.ts
```

Expected: FAIL — modules not yet created.

- [ ] **Step 3: Implement `src/persistence/repository-errors.ts`**

```ts
import { ApplicationError, ExitCode } from '../errors/application-error.js';

export class RecordNotFoundError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}
```

- [ ] **Step 4: Implement `src/persistence/repositories/types.ts`**

```ts
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { Schema } from '../schema.js';

export type DrizzleDB = BetterSQLite3Database<Schema>;

export interface RepositoryContext {
  readonly db: DrizzleDB;
}
```

Repositories receive a `RepositoryContext` (or any duck-typed `{ db: DrizzleDB }`). The same context shape works for both a `DatabaseConnection` (Task 3) and a Drizzle transaction handle, which is what `withTransaction` (Task 12) yields.

- [ ] **Step 5: Implement `src/persistence/repositories/codecs.ts`**

```ts
import type { z, ZodType } from 'zod';

import { DatabaseError } from '../errors.js';

export interface JsonColumnCodec<T> {
  encode(value: T): string;
  decode(raw: string | null): T | null;
  decodeRequired(raw: string): T;
}

export function jsonColumn<T>(schema: ZodType<T>): JsonColumnCodec<T> {
  return {
    encode(value: T): string {
      return JSON.stringify(value);
    },
    decode(raw: string | null): T | null {
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        const result = schema.safeParse(parsed);
        if (!result.success) {
          throw new DatabaseError(
            'persisted_json_invalid',
            'Persisted JSON column failed schema validation.',
            { issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })) },
          );
        }
        return result.data;
      } catch (cause) {
        if (cause instanceof DatabaseError) throw cause;
        throw new DatabaseError(
          'persisted_json_invalid',
          'Persisted JSON column could not be parsed.',
          { raw },
          cause instanceof Error ? cause : undefined,
        );
      }
    },
    decodeRequired(raw: string): T {
      const decoded = this.decode(raw);
      if (decoded === null) {
        throw new DatabaseError('persisted_json_missing', 'Required JSON column was null.', { raw: null });
      }
      return decoded;
    },
  };
}

// Re-export z for downstream repositories that build schemas.
export { z };
```

- [ ] **Step 6: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repository-errors.test.ts tests/persistence/repositories/codecs.test.ts
```

Expected: PASS — 6 tests pass (1 error + 5 codec).

- [ ] **Step 7: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repository-errors.ts src/persistence/repositories/types.ts src/persistence/repositories/codecs.ts tests/persistence/repository-errors.test.ts tests/persistence/repositories/codecs.test.ts
git commit -m "feat(persistence): add repository errors, context, and JSON column codecs"
```

---

### Task 3: Profile source + profile version repositories (with revisions, conflicts, warnings, overrides)

**Files:**

- Create: `src/persistence/repositories/profile-sources.ts`
- Create: `src/persistence/repositories/profile-versions.ts`
- Create: `tests/persistence/repositories/profile-sources.test.ts`
- Create: `tests/persistence/repositories/profile-versions.test.ts`

**Interfaces:**

- Consumes: `RepositoryContext`, JSON codec, `RecordNotFoundError`, all profile-related tables.
- Produces:

```ts
// profile-sources.ts
export interface ProfileSourceRow {
  readonly id: number;
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly originalFilename: string;
  readonly originalAbsolutePath: string;
  readonly storedPath: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly sha256: string;
  readonly importTimestamp: string;
  readonly extractedTextHash: string | null;
  readonly textExtractionStatus: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage: string | null;
}

export interface ProfileSourceInsert {
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly originalFilename: string;
  readonly originalAbsolutePath: string;
  readonly storedPath: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly sha256: string;
  readonly importTimestamp: string;
  readonly textExtractionStatus?: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage?: string | null;
}

export class ProfileSourceRepository {
  constructor(ctx: RepositoryContext);
  insert(input: ProfileSourceInsert): Promise<number>;     // returns new id; sha256 unique conflict returns existing id
  findById(id: number): Promise<ProfileSourceRow | null>;
  findBySha256(sha256: string): Promise<ProfileSourceRow | null>;
  updateExtraction(id: number, patch: { extractedTextHash: string; status: 'success' | 'failed'; message?: string | null }): Promise<void>;
  list(): Promise<readonly ProfileSourceRow[]>;
}

// profile-versions.ts
export type ProfileStatus = 'draft' | 'approved' | 'rejected' | 'superseded';

export interface ProfileVersionRow {
  readonly id: number;
  readonly status: ProfileStatus;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly extractionFingerprint: string;
  readonly sourceIds: readonly number[];
  readonly profileJson: unknown;             // decoded JSON; shape validation is the caller's job
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly promptVersion: string | null;
  readonly structuredOutputSchemaVersion: number | null;
  readonly extractorImplementationVersion: string | null;
  readonly validationWarnings: readonly unknown[] | null;
  readonly unresolvedConflicts: readonly unknown[] | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt: string | null;
  readonly supersededAt: string | null;
  readonly active: boolean;
}

export interface ProfileVersionInsert {
  readonly status: ProfileStatus;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly extractionFingerprint: string;
  readonly sourceIds: readonly number[];
  readonly profileJson: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly promptVersion?: string | null;
  readonly model?: string | null;
  readonly reasoningEffort?: string | null;
  readonly structuredOutputSchemaVersion?: number | null;
  readonly extractorImplementationVersion?: string | null;
  readonly validationWarnings?: readonly unknown[] | null;
  readonly unresolvedConflicts?: readonly unknown[] | null;
  readonly active?: boolean;
}

export interface ProfileRevisionRow { /* shape matches schema columns */ }
export interface ProfileConflictRow { /* shape matches schema columns */ }
export interface ProfileWarningRow { /* shape matches schema columns */ }
export interface DerivedOverrideRow { /* shape matches schema columns */ }

export class ProfileVersionRepository {
  constructor(ctx: RepositoryContext);

  insert(input: ProfileVersionInsert): Promise<number>;
  getById(id: number): Promise<ProfileVersionRow>;        // throws RecordNotFoundError
  findById(id: number): Promise<ProfileVersionRow | null>;
  findActiveApproved(): Promise<ProfileVersionRow | null>;
  findByExtractionFingerprint(fp: string): Promise<ProfileVersionRow | null>;
  list(opts?: { status?: ProfileStatus }): Promise<readonly ProfileVersionRow[]>;

  // SPEC §16.3 approval flow + §27.4 result invalidation: deactivate previous,
  // flip this row to active+approved, set approvedAt, set previous.supersededAt.
  approve(id: number, options: { approvedAt: string; supersededAt: string }): Promise<void>;

  // SPEC §16.4 rejection: status='rejected'; previous active profile remains.
  reject(id: number, options: { now: string }): Promise<void>;

  insertRevision(input: Omit<ProfileRevisionRow, 'id'>): Promise<number>;
  listRevisions(profileVersionId: number): Promise<readonly ProfileRevisionRow[]>;

  insertConflict(input: Omit<ProfileConflictRow, 'id'>): Promise<number>;
  listConflicts(profileVersionId: number): Promise<readonly ProfileConflictRow[]>;
  resolveConflict(id: number, options: { resolvedAt: string; resolvedValue: unknown | null }): Promise<void>;

  insertWarning(input: Omit<ProfileWarningRow, 'id'>): Promise<number>;
  listWarnings(profileVersionId: number): Promise<readonly ProfileWarningRow[]>;

  upsertOverride(input: Omit<DerivedOverrideRow, 'id'>): Promise<void>;
  listOverrides(profileVersionId: number): Promise<readonly DerivedOverrideRow[]>;
}
```

Combined into one task because the profile-version domain is a single unit: revisions, conflicts, warnings, and overrides are all owned by a profile version, and tests must exercise the active-approved uniqueness invariant together.

Notes on the design:

- **Immutability of `profile_sources`**: `insert` is the only writer of the immutable columns. `updateExtraction` mutates only the `extracted_text_hash`, `text_extraction_status`, and `text_extraction_message` columns (the metadata for the asynchronous extraction phase). The raw CV path, sha256, and file size are never updated.
- **Active approved profile invariant**: `approve()` is the only writer that sets `active=true` on a profile. It runs in a transaction: the partial unique index guarantees at most one row matches `status='approved' AND active=1`.
- **Lifecycle transitions**: `insert` may insert a non-active row; `approve` flips a draft to approved+active. `reject` flips a draft to rejected (not active). `superseded` is set by `approve` on the previously active row.
- **JSON columns**: `profile_json`, `validation_warnings_json`, `unresolved_conflicts_json`, `previous_value_json`, `new_value_json`, `value_source_a_json`, `value_source_b_json`, `source_references_json`, `provisional_value_json`, `resolved_value_json`, `override_value_json`, `generated_value_json` are all decoded into `unknown` by the codec. The codec does not validate the inner shape (this is the domain's job; the Zod schemas for the actual profile content are defined in Task 8 and re-validated at the call site if needed). The repository's job is to keep the column non-corrupt; the codec enforces that the JSON parses and is not `null`.

**Steps:**

- [ ] **Step 1: Write the failing tests for `ProfileSourceRepository`**

Create `tests/persistence/repositories/profile-sources.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { ProfileSourceRepository } from '../../../src/persistence/repositories/profile-sources.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(connection: DatabaseConnection) {
  return { db: connection.db };
}

describe('ProfileSourceRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: ProfileSourceRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-sources-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new ProfileSourceRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts a new source and returns its id', async () => {
    const id = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf',
      originalAbsolutePath: '/tmp/cv.pdf',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.pdf',
      mimeType: 'application/pdf',
      fileSize: 12345,
      sha256: 'a'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    expect(id).toBeGreaterThan(0);
    const row = await repo.findById(id);
    expect(row).not.toBeNull();
    expect(row?.sourceType).toBe('pdf');
    expect(row?.textExtractionStatus).toBe('pending');
  });

  it('is idempotent on sha256 conflict and returns the existing id', async () => {
    const first = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf',
      originalAbsolutePath: '/tmp/cv.pdf',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.pdf',
      mimeType: 'application/pdf',
      fileSize: 12345,
      sha256: 'b'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    const second = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv-renamed.pdf',
      originalAbsolutePath: '/tmp/cv-renamed.pdf',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.pdf',
      mimeType: 'application/pdf',
      fileSize: 12345,
      sha256: 'b'.repeat(64),
      importTimestamp: '2026-08-05T10:01:00.000Z',
    });
    expect(second).toBe(first);
    const found = await repo.findBySha256('b'.repeat(64));
    expect(found?.id).toBe(first);
  });

  it('updateExtraction patches only the extraction fields', async () => {
    const id = await repo.insert({
      sourceType: 'plain_text',
      originalFilename: 'cv.txt',
      originalAbsolutePath: '/tmp/cv.txt',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.txt',
      mimeType: 'text/plain',
      fileSize: 500,
      sha256: 'c'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    await repo.updateExtraction(id, {
      extractedTextHash: 'd'.repeat(64),
      status: 'success',
      message: null,
    });
    const row = await repo.findById(id);
    expect(row?.extractedTextHash).toBe('d'.repeat(64));
    expect(row?.textExtractionStatus).toBe('success');
    expect(row?.textExtractionMessage).toBeNull();
    expect(row?.sha256).toBe('c'.repeat(64)); // immutable
    expect(row?.fileSize).toBe(500); // immutable
  });

  it('list returns all sources', async () => {
    await repo.insert({
      sourceType: 'pdf', originalFilename: 'a.pdf', originalAbsolutePath: '/tmp/a.pdf',
      storedPath: '/opt/a.pdf', mimeType: 'application/pdf', fileSize: 1, sha256: 'e'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    await repo.insert({
      sourceType: 'markdown', originalFilename: 'b.md', originalAbsolutePath: '/tmp/b.md',
      storedPath: '/opt/b.md', mimeType: 'text/markdown', fileSize: 2, sha256: 'f'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Write the failing tests for `ProfileVersionRepository`**

Create `tests/persistence/repositories/profile-versions.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { profileVersions as profileVersionsTableForTest } from '../../../src/persistence/schema.js';
import { ProfileSourceRepository } from '../../../src/persistence/repositories/profile-sources.js';
import { ProfileVersionRepository } from '../../../src/persistence/repositories/profile-versions.js';
import { RecordNotFoundError } from '../../../src/persistence/repository-errors.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(connection: DatabaseConnection) {
  return { db: connection.db };
}

async function seedSource(repo: ProfileSourceRepository, sha256: string): Promise<number> {
  return repo.insert({
    sourceType: 'pdf',
    originalFilename: `${sha256}.pdf`,
    originalAbsolutePath: `/tmp/${sha256}.pdf`,
    storedPath: `/opt/${sha256}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 100,
    sha256,
    importTimestamp: '2026-08-05T10:00:00.000Z',
  });
}

describe('ProfileVersionRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let sourceRepo: ProfileSourceRepository;
  let versionRepo: ProfileVersionRepository;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-versions-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    sourceRepo = new ProfileSourceRepository(ctxFrom(connection));
    versionRepo = new ProfileVersionRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts a draft and finds it by id', async () => {
    const sourceId = await seedSource(sourceRepo, 'a'.repeat(64));
    const id = await versionRepo.insert({
      status: 'draft',
      schemaVersion: 1,
      contentHash: 'h1',
      extractionFingerprint: 'fp1',
      sourceIds: [sourceId],
      profileJson: { headline: 'Engineer' },
      createdAt: '2026-08-05T10:00:00.000Z',
      updatedAt: '2026-08-05T10:00:00.000Z',
    });
    const row = await versionRepo.getById(id);
    expect(row.status).toBe('draft');
    expect(row.sourceIds).toEqual([sourceId]);
    expect(row.profileJson).toMatchObject({ headline: 'Engineer' });
    expect(row.active).toBe(false);
  });

  it('getById throws RecordNotFoundError for missing ids', async () => {
    await expect(versionRepo.getById(999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('approves a draft and marks the previously active row superseded', async () => {
    const sourceId = await seedSource(sourceRepo, 'b'.repeat(64));
    const first = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.approve(first, { approvedAt: '2026-08-05T10:01:00.000Z', supersededAt: '2026-08-05T10:01:00.000Z' });

    const second = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h2', extractionFingerprint: 'fp2',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T11:00:00.000Z', updatedAt: '2026-08-05T11:00:00.000Z',
    });
    await versionRepo.approve(second, { approvedAt: '2026-08-05T11:01:00.000Z', supersededAt: '2026-08-05T11:01:00.000Z' });

    const active = await versionRepo.findActiveApproved();
    expect(active?.id).toBe(second);
    expect(active?.status).toBe('approved');
    expect(active?.active).toBe(true);
    const previous = await versionRepo.getById(first);
    expect(previous.status).toBe('superseded');
    expect(previous.active).toBe(false);
    expect(previous.supersededAt).toBe('2026-08-05T11:01:00.000Z');
  });

  it('rejects a draft without disturbing the currently active profile', async () => {
    const sourceId = await seedSource(sourceRepo, 'c'.repeat(64));
    const first = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.approve(first, { approvedAt: '2026-08-05T10:01:00.000Z', supersededAt: '2026-08-05T10:01:00.000Z' });

    const second = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h2', extractionFingerprint: 'fp2',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T11:00:00.000Z', updatedAt: '2026-08-05T11:00:00.000Z',
    });
    await versionRepo.reject(second, { now: '2026-08-05T12:00:00.000Z' });

    const active = await versionRepo.findActiveApproved();
    expect(active?.id).toBe(first);
    const rejected = await versionRepo.getById(second);
    expect(rejected.status).toBe('rejected');
  });

  it('only one row can be active+approved (partial unique index enforced)', async () => {
    const sourceId = await seedSource(sourceRepo, 'd'.repeat(64));
    const first = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.approve(first, { approvedAt: '2026-08-05T10:01:00.000Z', supersededAt: '2026-08-05T10:01:00.000Z' });

    // Cannot manually insert a second active+approved row directly.
    await expect(
      connection.db.insert(profileVersionsTableForTest).values({
        status: 'approved',
        schemaVersion: 1,
        contentHash: 'h2',
        extractionFingerprint: 'fp2',
        sourceIdsJson: '[]',
        profileJson: '{}',
        createdAt: '2026-08-05T11:00:00.000Z',
        updatedAt: '2026-08-05T11:00:00.000Z',
        active: true,
      }),
    ).rejects.toThrow();
  });

  it('inserts and lists revisions, conflicts, warnings, and overrides', async () => {
    const sourceId = await seedSource(sourceRepo, 'e'.repeat(64));
    const versionId = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });

    await versionRepo.insertRevision({
      profileVersionId: versionId,
      revisionTimestamp: '2026-08-05T10:00:00.000Z',
      source: 'openai',
      fieldPath: 'headline',
      previousValue: null,
      newValue: 'Engineer',
      note: null,
    });
    await versionRepo.insertConflict({
      profileVersionId: versionId,
      conflictType: 'company_dating',
      affectedField: 'workExperience[0].endDate',
      valueSourceA: '2024-01-01',
      valueSourceB: '2023-12-01',
      sourceReferences: [{ sourceId, field: 'endDate' }],
      provisionalValue: '2023-12-01',
      explanation: 'Two sources disagree.',
      resolutionStatus: 'unresolved',
      resolvedAt: null,
      resolvedValue: null,
    });
    await versionRepo.insertWarning({
      profileVersionId: versionId,
      severity: 'warning',
      warningType: 'missing_field',
      fieldPath: 'certifications',
      message: 'No certifications listed.',
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.upsertOverride({
      profileVersionId: versionId,
      derivedField: 'likelySeniority',
      overrideActive: true,
      overrideValue: 'senior',
      generatedValue: 'mid',
      generatedAt: '2026-08-05T10:00:00.000Z',
      overriddenAt: '2026-08-05T10:01:00.000Z',
    });

    expect(await versionRepo.listRevisions(versionId)).toHaveLength(1);
    expect(await versionRepo.listConflicts(versionId)).toHaveLength(1);
    expect(await versionRepo.listWarnings(versionId)).toHaveLength(1);
    expect(await versionRepo.listOverrides(versionId)).toHaveLength(1);
  });

  it('resolveConflict flips resolutionStatus and stores resolvedValue', async () => {
    const sourceId = await seedSource(sourceRepo, 'f'.repeat(64));
    const versionId = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    const conflictId = await versionRepo.insertConflict({
      profileVersionId: versionId,
      conflictType: 'company_dating',
      affectedField: 'workExperience[0].endDate',
      valueSourceA: '2024-01-01',
      valueSourceB: '2023-12-01',
      sourceReferences: [],
      provisionalValue: '2023-12-01',
      explanation: null,
      resolutionStatus: 'unresolved',
      resolvedAt: null,
      resolvedValue: null,
    });
    await versionRepo.resolveConflict(conflictId, {
      resolvedAt: '2026-08-05T10:00:00.000Z',
      resolvedValue: '2023-12-01',
    });
    const conflicts = await versionRepo.listConflicts(versionId);
    expect(conflicts[0]?.resolutionStatus).toBe('resolved');
    expect(conflicts[0]?.resolvedValue).toBe('2023-12-01');
  });
});
```

- [ ] **Step 3: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/profile-sources.test.ts tests/persistence/repositories/profile-versions.test.ts
```

Expected: FAIL — both repository files not yet created.

- [ ] **Step 4: Implement `src/persistence/repositories/profile-sources.ts`**

```ts
import { eq } from 'drizzle-orm';

import { profileSources } from '../schema.js';
import type { RepositoryContext } from './types.js';

export interface ProfileSourceRow {
  readonly id: number;
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly originalFilename: string;
  readonly originalAbsolutePath: string;
  readonly storedPath: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly sha256: string;
  readonly importTimestamp: string;
  readonly extractedTextHash: string | null;
  readonly textExtractionStatus: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage: string | null;
}

export interface ProfileSourceInsert {
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly originalFilename: string;
  readonly originalAbsolutePath: string;
  readonly storedPath: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly sha256: string;
  readonly importTimestamp: string;
  readonly textExtractionStatus?: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage?: string | null;
}

function rowFromRecord(record: typeof profileSources.$inferSelect): ProfileSourceRow {
  return {
    id: record.id,
    sourceType: record.sourceType,
    originalFilename: record.originalFilename,
    originalAbsolutePath: record.originalAbsolutePath,
    storedPath: record.storedPath,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    sha256: record.sha256,
    importTimestamp: record.importTimestamp,
    extractedTextHash: record.extractedTextHash,
    textExtractionStatus: record.textExtractionStatus,
    textExtractionMessage: record.textExtractionMessage,
  };
}

export class ProfileSourceRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: ProfileSourceInsert): Promise<number> {
    const existing = await this.findBySha256(input.sha256);
    if (existing !== null) return existing.id;
    const result = this.ctx.db
      .insert(profileSources)
      .values({
        sourceType: input.sourceType,
        originalFilename: input.originalFilename,
        originalAbsolutePath: input.originalAbsolutePath,
        storedPath: input.storedPath,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        sha256: input.sha256,
        importTimestamp: input.importTimestamp,
        textExtractionStatus: input.textExtractionStatus ?? 'pending',
        textExtractionMessage: input.textExtractionMessage ?? null,
      })
      .returning({ id: profileSources.id })
      .all();
    const row = result[0];
    if (row === undefined) {
      throw new Error('ProfileSourceRepository.insert: insert returned no rows');
    }
    return row.id;
  }

  async findById(id: number): Promise<ProfileSourceRow | null> {
    const rows = this.ctx.db.select().from(profileSources).where(eq(profileSources.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findBySha256(sha256: string): Promise<ProfileSourceRow | null> {
    const rows = this.ctx.db.select().from(profileSources).where(eq(profileSources.sha256, sha256)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async updateExtraction(
    id: number,
    patch: { extractedTextHash: string; status: 'success' | 'failed'; message?: string | null },
  ): Promise<void> {
    this.ctx.db
      .update(profileSources)
      .set({
        extractedTextHash: patch.extractedTextHash,
        textExtractionStatus: patch.status,
        textExtractionMessage: patch.message ?? null,
      })
      .where(eq(profileSources.id, id))
      .run();
  }

  async list(): Promise<readonly ProfileSourceRow[]> {
    return this.ctx.db.select().from(profileSources).all().map(rowFromRecord);
  }
}
```

- [ ] **Step 5: Implement `src/persistence/repositories/profile-versions.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { DatabaseError } from '../errors.js';
import { RecordNotFoundError } from '../repository-errors.js';
import {
  derivedOverrides,
  profileConflicts,
  profileRevisions,
  profileVersions,
  profileWarnings,
} from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

// JSON columns are decoded with permissive schemas (z.unknown()) so the
// repository doesn't impose a domain shape on the caller.
const unknownJson = jsonColumn<unknown>(z.unknown());

export type ProfileStatus = 'draft' | 'approved' | 'rejected' | 'superseded';

export interface ProfileVersionRow {
  readonly id: number;
  readonly status: ProfileStatus;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly extractionFingerprint: string;
  readonly sourceIds: readonly number[];
  readonly profileJson: unknown;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly promptVersion: string | null;
  readonly structuredOutputSchemaVersion: number | null;
  readonly extractorImplementationVersion: string | null;
  readonly validationWarnings: readonly unknown[] | null;
  readonly unresolvedConflicts: readonly unknown[] | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt: string | null;
  readonly supersededAt: string | null;
  readonly active: boolean;
}

export interface ProfileVersionInsert {
  readonly status: ProfileStatus;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly extractionFingerprint: string;
  readonly sourceIds: readonly number[];
  readonly profileJson: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly promptVersion?: string | null;
  readonly model?: string | null;
  readonly reasoningEffort?: string | null;
  readonly structuredOutputSchemaVersion?: number | null;
  readonly extractorImplementationVersion?: string | null;
  readonly validationWarnings?: readonly unknown[] | null;
  readonly unresolvedConflicts?: readonly unknown[] | null;
  readonly active?: boolean;
}

export interface ProfileRevisionRow {
  readonly id: number;
  readonly profileVersionId: number;
  readonly revisionTimestamp: string;
  readonly source: 'openai' | 'user' | 'conflict_resolution' | 'override';
  readonly fieldPath: string;
  readonly previousValue: unknown | null;
  readonly newValue: unknown | null;
  readonly note: string | null;
}

export interface ProfileConflictRow {
  readonly id: number;
  readonly profileVersionId: number;
  readonly conflictType: string;
  readonly affectedField: string;
  readonly valueSourceA: unknown | null;
  readonly valueSourceB: unknown | null;
  readonly sourceReferences: readonly unknown[];
  readonly provisionalValue: unknown | null;
  readonly explanation: string | null;
  readonly resolutionStatus: 'unresolved' | 'resolved' | 'cleared';
  readonly resolvedAt: string | null;
  readonly resolvedValue: unknown | null;
}

export interface ProfileWarningRow {
  readonly id: number;
  readonly profileVersionId: number;
  readonly severity: 'blocking_conflict' | 'warning';
  readonly warningType: string;
  readonly fieldPath: string | null;
  readonly message: string;
  readonly createdAt: string;
}

export interface DerivedOverrideRow {
  readonly id: number;
  readonly profileVersionId: number;
  readonly derivedField: 'likelySeniority' | 'primaryRoles' | 'primaryDomains' | 'strongestSkills';
  readonly overrideActive: boolean;
  readonly overrideValue: unknown | null;
  readonly generatedValue: unknown | null;
  readonly generatedAt: string | null;
  readonly overriddenAt: string | null;
}

const sourceIdsCodec = jsonColumn<readonly number[]>(z.array(z.number().int()));

function versionRowFromRecord(record: typeof profileVersions.$inferSelect): ProfileVersionRow {
  return {
    id: record.id,
    status: record.status,
    schemaVersion: record.schemaVersion,
    contentHash: record.contentHash,
    extractionFingerprint: record.extractionFingerprint,
    sourceIds: sourceIdsCodec.decodeRequired(record.sourceIdsJson),
    profileJson: unknownJson.decodeRequired(record.profileJson),
    model: record.model,
    reasoningEffort: record.reasoningEffort,
    promptVersion: record.promptVersion,
    structuredOutputSchemaVersion: record.structuredOutputSchemaVersion,
    extractorImplementationVersion: record.extractorImplementationVersion,
    validationWarnings: unknownJson.decode(record.validationWarningsJson),
    unresolvedConflicts: unknownJson.decode(record.unresolvedConflictsJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    approvedAt: record.approvedAt,
    supersededAt: record.supersededAt,
    active: record.active,
  };
}

export class ProfileVersionRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: ProfileVersionInsert): Promise<number> {
    const result = this.ctx.db
      .insert(profileVersions)
      .values({
        status: input.status,
        schemaVersion: input.schemaVersion,
        contentHash: input.contentHash,
        extractionFingerprint: input.extractionFingerprint,
        sourceIdsJson: sourceIdsCodec.encode(input.sourceIds),
        profileJson: unknownJson.encode(input.profileJson),
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        promptVersion: input.promptVersion ?? null,
        structuredOutputSchemaVersion: input.structuredOutputSchemaVersion ?? null,
        extractorImplementationVersion: input.extractorImplementationVersion ?? null,
        validationWarningsJson: input.validationWarnings === undefined
          ? null
          : unknownJson.encode(input.validationWarnings),
        unresolvedConflictsJson: input.unresolvedConflicts === undefined
          ? null
          : unknownJson.encode(input.unresolvedConflicts),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        approvedAt: null,
        supersededAt: null,
        active: input.active ?? false,
      })
      .returning({ id: profileVersions.id })
      .all();
    const row = result[0];
    if (row === undefined) {
      throw new Error('ProfileVersionRepository.insert: insert returned no rows');
    }
    return row.id;
  }

  async getById(id: number): Promise<ProfileVersionRow> {
    const row = await this.findById(id);
    if (row === null) {
      throw new RecordNotFoundError(
        'profile_version_not_found',
        `No profile version with id ${id}.`,
        { entity: 'profile', id },
      );
    }
    return row;
  }

  async findById(id: number): Promise<ProfileVersionRow | null> {
    const rows = this.ctx.db.select().from(profileVersions).where(eq(profileVersions.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : versionRowFromRecord(row);
  }

  async findActiveApproved(): Promise<ProfileVersionRow | null> {
    const rows = this.ctx.db
      .select()
      .from(profileVersions)
      .where(and(eq(profileVersions.status, 'approved'), eq(profileVersions.active, true)))
      .all();
    const row = rows[0];
    return row === undefined ? null : versionRowFromRecord(row);
  }

  async findByExtractionFingerprint(fp: string): Promise<ProfileVersionRow | null> {
    const rows = this.ctx.db
      .select()
      .from(profileVersions)
      .where(eq(profileVersions.extractionFingerprint, fp))
      .all();
    const row = rows[0];
    return row === undefined ? null : versionRowFromRecord(row);
  }

  async list(opts?: { status?: ProfileStatus }): Promise<readonly ProfileVersionRow[]> {
    const base = this.ctx.db.select().from(profileVersions);
    const filtered = opts?.status === undefined ? base : base.where(eq(profileVersions.status, opts.status));
    return filtered.all().map(versionRowFromRecord);
  }

  async approve(id: number, options: { approvedAt: string; supersededAt: string }): Promise<void> {
    this.ctx.db.transaction((tx) => {
      // Step 1: deactivate any currently active+approved row.
      tx.update(profileVersions)
        .set({ active: false, supersededAt: options.supersededAt, status: 'superseded' })
        .where(and(eq(profileVersions.active, true), eq(profileVersions.status, 'approved')))
        .run();
      // Step 2: promote this row.
      tx.update(profileVersions)
        .set({ active: true, status: 'approved', approvedAt: options.approvedAt })
        .where(eq(profileVersions.id, id))
        .run();
    });
  }

  async reject(id: number, options: { now: string }): Promise<void> {
    this.ctx.db
      .update(profileVersions)
      .set({ status: 'rejected', active: false, updatedAt: options.now })
      .where(eq(profileVersions.id, id))
      .run();
  }

  async insertRevision(input: Omit<ProfileRevisionRow, 'id'>): Promise<number> {
    const result = this.ctx.db
      .insert(profileRevisions)
      .values({
        profileVersionId: input.profileVersionId,
        revisionTimestamp: input.revisionTimestamp,
        source: input.source,
        fieldPath: input.fieldPath,
        previousValueJson: input.previousValue === undefined || input.previousValue === null ? null : unknownJson.encode(input.previousValue),
        newValueJson: input.newValue === undefined || input.newValue === null ? null : unknownJson.encode(input.newValue),
        note: input.note,
      })
      .returning({ id: profileRevisions.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('insertRevision returned no rows');
    return row.id;
  }

  async listRevisions(profileVersionId: number): Promise<readonly ProfileRevisionRow[]> {
    const rows = this.ctx.db
      .select()
      .from(profileRevisions)
      .where(eq(profileRevisions.profileVersionId, profileVersionId))
      .all();
    return rows.map((r) => ({
      id: r.id,
      profileVersionId: r.profileVersionId,
      revisionTimestamp: r.revisionTimestamp,
      source: r.source,
      fieldPath: r.fieldPath,
      previousValue: unknownJson.decode(r.previousValueJson),
      newValue: unknownJson.decode(r.newValueJson),
      note: r.note,
    }));
  }

  async insertConflict(input: Omit<ProfileConflictRow, 'id'>): Promise<number> {
    const result = this.ctx.db
      .insert(profileConflicts)
      .values({
        profileVersionId: input.profileVersionId,
        conflictType: input.conflictType,
        affectedField: input.affectedField,
        valueSourceAJson: input.valueSourceA === undefined || input.valueSourceA === null ? null : unknownJson.encode(input.valueSourceA),
        valueSourceBJson: input.valueSourceB === undefined || input.valueSourceB === null ? null : unknownJson.encode(input.valueSourceB),
        sourceReferencesJson: unknownJson.encode(input.sourceReferences),
        provisionalValueJson: input.provisionalValue === undefined || input.provisionalValue === null ? null : unknownJson.encode(input.provisionalValue),
        explanation: input.explanation,
        resolutionStatus: input.resolutionStatus,
        resolvedAt: input.resolvedAt,
        resolvedValueJson: input.resolvedValue === undefined || input.resolvedValue === null ? null : unknownJson.encode(input.resolvedValue),
      })
      .returning({ id: profileConflicts.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('insertConflict returned no rows');
    return row.id;
  }

  async listConflicts(profileVersionId: number): Promise<readonly ProfileConflictRow[]> {
    const rows = this.ctx.db
      .select()
      .from(profileConflicts)
      .where(eq(profileConflicts.profileVersionId, profileVersionId))
      .all();
    return rows.map((r) => ({
      id: r.id,
      profileVersionId: r.profileVersionId,
      conflictType: r.conflictType,
      affectedField: r.affectedField,
      valueSourceA: unknownJson.decode(r.valueSourceAJson),
      valueSourceB: unknownJson.decode(r.valueSourceBJson),
      sourceReferences: unknownJson.decode(r.sourceReferencesJson) as readonly unknown[],
      provisionalValue: unknownJson.decode(r.provisionalValueJson),
      explanation: r.explanation,
      resolutionStatus: r.resolutionStatus,
      resolvedAt: r.resolvedAt,
      resolvedValue: unknownJson.decode(r.resolvedValueJson),
    }));
  }

  async resolveConflict(id: number, options: { resolvedAt: string; resolvedValue: unknown | null }): Promise<void> {
    this.ctx.db
      .update(profileConflicts)
      .set({
        resolutionStatus: 'resolved',
        resolvedAt: options.resolvedAt,
        resolvedValueJson: options.resolvedValue === null ? null : unknownJson.encode(options.resolvedValue),
      })
      .where(eq(profileConflicts.id, id))
      .run();
  }

  async insertWarning(input: Omit<ProfileWarningRow, 'id'>): Promise<number> {
    const result = this.ctx.db
      .insert(profileWarnings)
      .values({
        profileVersionId: input.profileVersionId,
        severity: input.severity,
        warningType: input.warningType,
        fieldPath: input.fieldPath,
        message: input.message,
        createdAt: input.createdAt,
      })
      .returning({ id: profileWarnings.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('insertWarning returned no rows');
    return row.id;
  }

  async listWarnings(profileVersionId: number): Promise<readonly ProfileWarningRow[]> {
    return this.ctx.db
      .select()
      .from(profileWarnings)
      .where(eq(profileWarnings.profileVersionId, profileVersionId))
      .all();
  }

  async upsertOverride(input: Omit<DerivedOverrideRow, 'id'>): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(derivedOverrides)
        .where(
          and(
            eq(derivedOverrides.profileVersionId, input.profileVersionId),
            eq(derivedOverrides.derivedField, input.derivedField),
          ),
        )
        .all();
      if (existing.length > 0) {
        tx.update(derivedOverrides)
          .set({
            overrideActive: input.overrideActive,
            overrideValueJson: input.overrideValue === null ? null : unknownJson.encode(input.overrideValue),
            generatedValueJson: input.generatedValue === null ? null : unknownJson.encode(input.generatedValue),
            generatedAt: input.generatedAt,
            overriddenAt: input.overriddenAt,
          })
          .where(
            and(
              eq(derivedOverrides.profileVersionId, input.profileVersionId),
              eq(derivedOverrides.derivedField, input.derivedField),
            ),
          )
          .run();
        return;
      }
      tx.insert(derivedOverrides)
        .values({
          profileVersionId: input.profileVersionId,
          derivedField: input.derivedField,
          overrideActive: input.overrideActive,
          overrideValueJson: input.overrideValue === null ? null : unknownJson.encode(input.overrideValue),
          generatedValueJson: input.generatedValue === null ? null : unknownJson.encode(input.generatedValue),
          generatedAt: input.generatedAt,
          overriddenAt: input.overriddenAt,
        })
        .run();
    });
  }

  async listOverrides(profileVersionId: number): Promise<readonly DerivedOverrideRow[]> {
    const rows = this.ctx.db
      .select()
      .from(derivedOverrides)
      .where(eq(derivedOverrides.profileVersionId, profileVersionId))
      .all();
    return rows.map((r) => ({
      id: r.id,
      profileVersionId: r.profileVersionId,
      derivedField: r.derivedField,
      overrideActive: r.overrideActive,
      overrideValue: unknownJson.decode(r.overrideValueJson),
      generatedValue: unknownJson.decode(r.generatedValueJson),
      generatedAt: r.generatedAt,
      overriddenAt: r.overriddenAt,
    }));
  }
}
```

Notes:

- `approve(...)` uses `db.transaction()` to make the deactivation-then-promotion atomic. The partial unique index would also catch a race because only one row can match `status='approved' AND active=1`.
- `upsertOverride` reads-then-writes inside a transaction so concurrent override edits do not race.
- The `sourceIds` column has a strict Zod codec because the shape is structurally known (array of integers); the other JSON columns are `unknown`.

- [ ] **Step 6: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/profile-sources.test.ts tests/persistence/repositories/profile-versions.test.ts
```

Expected: PASS — 4 source tests + 7 version tests = 11 tests pass.

- [ ] **Step 7: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/profile-sources.ts src/persistence/repositories/profile-versions.ts tests/persistence/repositories/profile-sources.test.ts tests/persistence/repositories/profile-versions.test.ts
git commit -m "feat(persistence): add profile source and profile version repositories"
```

---

### Task 4: Filter configuration repository

**Files:**

- Create: `src/persistence/repositories/filter-configurations.ts`
- Create: `tests/persistence/repositories/filter-configurations.test.ts`

**Interfaces:**

```ts
export interface FilterConfigurationRow {
  readonly id: number;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly configJson: unknown;             // SPEC §17.2 JSON shape; repository stays shape-agnostic
  readonly createdAt: string;
  readonly active: boolean;
}

export interface FilterConfigurationInsert {
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly configJson: unknown;
  readonly createdAt: string;
  readonly active?: boolean;
}

export class FilterConfigurationRepository {
  constructor(ctx: RepositoryContext);

  insert(input: FilterConfigurationInsert): Promise<number>;
  findById(id: number): Promise<FilterConfigurationRow | null>;
  findActive(): Promise<FilterConfigurationRow | null>;
  findByContentHash(hash: string): Promise<FilterConfigurationRow | null>;
  list(): Promise<readonly FilterConfigurationRow[]>;
  activate(id: number): Promise<void>;       // SPEC §17.3: deactivate others, mark this active
}
```

`activate(id)` is the only writer of `active=true`. The partial unique index `filter_configuration_versions_active_idx` enforces at most one active row. The repository's deactivate-then-activate action runs in a transaction.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/filter-configurations.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { filterConfigurationVersions as filterConfigurationVersionsTableForTest } from '../../../src/persistence/schema.js';
import { FilterConfigurationRepository } from '../../../src/persistence/repositories/filter-configurations.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('FilterConfigurationRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: FilterConfigurationRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-filter-configs-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new FilterConfigurationRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts an inactive configuration and finds it by id', async () => {
    const id = await repo.insert({
      schemaVersion: 1,
      contentHash: 'h1',
      configJson: { excludedCompanies: [], title: { excludedKeywords: [], requiredAnyKeywords: [] } },
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    const row = await repo.findById(id);
    expect(row?.active).toBe(false);
    expect(row?.schemaVersion).toBe(1);
  });

  it('activate flips the active flag and deactivates any previous active row', async () => {
    const first = await repo.insert({
      schemaVersion: 1, contentHash: 'h1', configJson: {}, createdAt: '2026-08-05T10:00:00.000Z', active: true,
    });
    // Inserting a second active row directly is rejected by the partial unique index.
    await expect(
      connection.db.insert(filterConfigurationVersionsTableForTest).values({
        schemaVersion: 1, contentHash: 'h2', configJson: '{}', createdAt: '2026-08-05T11:00:00.000Z', active: true,
      }),
    ).rejects.toThrow();

    const second = await repo.insert({
      schemaVersion: 1, contentHash: 'h3', configJson: {}, createdAt: '2026-08-05T12:00:00.000Z',
    });
    await repo.activate(second);

    const active = await repo.findActive();
    expect(active?.id).toBe(second);
    const firstRow = await repo.findById(first);
    expect(firstRow?.active).toBe(false);
  });

  it('history is preserved: listing returns every row regardless of active flag', async () => {
    const a = await repo.insert({
      schemaVersion: 1, contentHash: 'a', configJson: {}, createdAt: '2026-08-05T10:00:00.000Z', active: true,
    });
    const b = await repo.insert({
      schemaVersion: 1, contentHash: 'b', configJson: {}, createdAt: '2026-08-05T11:00:00.000Z',
    });
    await repo.activate(b);
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/filter-configurations.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/filter-configurations.ts`**

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { filterConfigurationVersions } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export interface FilterConfigurationRow {
  readonly id: number;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly configJson: unknown;
  readonly createdAt: string;
  readonly active: boolean;
}

export interface FilterConfigurationInsert {
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly configJson: unknown;
  readonly createdAt: string;
  readonly active?: boolean;
}

function rowFromRecord(record: typeof filterConfigurationVersions.$inferSelect): FilterConfigurationRow {
  return {
    id: record.id,
    schemaVersion: record.schemaVersion,
    contentHash: record.contentHash,
    configJson: unknownJson.decodeRequired(record.configJson),
    createdAt: record.createdAt,
    active: record.active,
  };
}

export class FilterConfigurationRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: FilterConfigurationInsert): Promise<number> {
    const result = this.ctx.db
      .insert(filterConfigurationVersions)
      .values({
        schemaVersion: input.schemaVersion,
        contentHash: input.contentHash,
        configJson: unknownJson.encode(input.configJson),
        createdAt: input.createdAt,
        active: input.active ?? false,
      })
      .returning({ id: filterConfigurationVersions.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('insert returned no rows');
    return row.id;
  }

  async findById(id: number): Promise<FilterConfigurationRow | null> {
    const rows = this.ctx.db.select().from(filterConfigurationVersions).where(eq(filterConfigurationVersions.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findActive(): Promise<FilterConfigurationRow | null> {
    const rows = this.ctx.db.select().from(filterConfigurationVersions).where(eq(filterConfigurationVersions.active, true)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findByContentHash(hash: string): Promise<FilterConfigurationRow | null> {
    const rows = this.ctx.db.select().from(filterConfigurationVersions).where(eq(filterConfigurationVersions.contentHash, hash)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async list(): Promise<readonly FilterConfigurationRow[]> {
    return this.ctx.db.select().from(filterConfigurationVersions).all().map(rowFromRecord);
  }

  async activate(id: number): Promise<void> {
    this.ctx.db.transaction((tx) => {
      tx.update(filterConfigurationVersions).set({ active: false }).where(eq(filterConfigurationVersions.active, true)).run();
      tx.update(filterConfigurationVersions).set({ active: true }).where(eq(filterConfigurationVersions.id, id)).run();
    });
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/filter-configurations.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/filter-configurations.ts tests/persistence/repositories/filter-configurations.test.ts
git commit -m "feat(persistence): add filter configuration repository with active-version invariant"
```

---

### Task 5: Pipeline run + search execution repository

**Files:**

- Create: `src/persistence/repositories/pipeline-runs.ts`
- Create: `tests/persistence/repositories/pipeline-runs.test.ts`

**Interfaces:**

```ts
export type PipelineRunStatus =
  | 'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
export type SearchExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PipelineRunRow { /* shape matches schema columns */ }
export interface PipelineRunInsert {
  readonly startTimestamp: string;
  readonly status?: PipelineRunStatus;
  readonly configSnapshotJson: unknown;
  readonly configSchemaVersion: number;
  readonly configHash: string;
  readonly applicationVersion: string;
  readonly profileVersionId?: number | null;
  readonly filterConfigVersionId?: number | null;
}
export interface SearchExecutionRow { /* shape matches schema columns */ }
export interface SearchExecutionInsert {
  readonly pipelineRunId: number;
  readonly searchQuery: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
  readonly finalStatus?: SearchExecutionStatus;
}

export class PipelineRunRepository {
  constructor(ctx: RepositoryContext);

  // SPEC §23.5: atomic run + searches creation.
  createRunWithSearches(
    run: PipelineRunInsert,
    searches: readonly SearchExecutionInsert[],
  ): Promise<{ runId: number; searchIds: readonly number[] }>;

  findRunById(id: number): Promise<PipelineRunRow | null>;
  listRuns(opts?: { status?: PipelineRunStatus }): Promise<readonly PipelineRunRow[]>;

  // SPEC §23.5: finalize run statistics.
  finalizeRunStats(id: number, stats: Partial<Pick<PipelineRunRow, 'status' | 'endTimestamp' | 'searchesPlanned' | 'searchesAttempted' | 'searchesCompleted' | 'jobsDiscovered' | 'newCompleteJobs' | 'existingCompleteJobsSkipped' | 'existingPartialJobsSkipped' | 'newPartialJobs' | 'failedExtractions' | 'jobsAccepted' | 'jobsRejected' | 'filterErrors' | 'jobsScored' | 'scoresReused' | 'scoringErrors' | 'scoringDeclinedByUser' | 'cancellationReason' | 'searchErrors'>>): Promise<void>;

  findSearchById(id: number): Promise<SearchExecutionRow | null>;
  listSearchesByRun(pipelineRunId: number): Promise<readonly SearchExecutionRow[]>;
  updateSearchStatus(id: number, patch: Partial<Pick<SearchExecutionRow, 'finalStatus' | 'endTimestamp' | 'jobsDiscovered' | 'newJobs' | 'existingJobs' | 'errors' | 'diagnosticRefs'>>): Promise<void>;
}
```

The `createRunWithSearches` method is the SPEC §23.5 transaction group "creating a run and its searches". The `finalizeRunStats` method is the §23.5 group "finalizing run statistics". Both run in a single Drizzle transaction.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/pipeline-runs.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('PipelineRunRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: PipelineRunRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-pipeline-runs-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new PipelineRunRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('createRunWithSearches atomically persists a run and its searches', async () => {
    const { runId, searchIds } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: { version: 1 },
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0, // ignored by repo
          searchQuery: 'engineer',
          locationName: 'Rotterdam',
          geoId: '100467493',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?keywords=engineer&geoId=100467493',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
        {
          pipelineRunId: 0,
          searchQuery: 'scientist',
          locationName: 'Amsterdam',
          geoId: '100467494',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?keywords=scientist&geoId=100467494',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
      ],
    );
    expect(runId).toBeGreaterThan(0);
    expect(searchIds).toHaveLength(2);

    const run = await repo.findRunById(runId);
    expect(run?.status).toBe('running');
    const searches = await repo.listSearchesByRun(runId);
    expect(searches).toHaveLength(2);
    expect(searches.map((s) => s.searchQuery).sort()).toEqual(['engineer', 'scientist']);
  });

  it('createRunWithSearches rolls back when the in-tx write fails (no orphan rows)', async () => {
    const before = (await repo.listRuns()).length;
    await expect(
      repo.createRunWithSearches(
        {
          startTimestamp: '2026-08-05T10:00:00.000Z',
          configSnapshotJson: {},
          configSchemaVersion: 1,
          configHash: 'cfg-hash',
          applicationVersion: '0.1.0',
        },
        [
          {
            // FK violation: pipelineRunId is overridden by the insert, but we
            // force a failure by passing a search linked to a non-existent run.
            // Easiest path: trigger failure by intentionally violating the
            // search.shall-have-valid-run invariant via Drizzle's FK.
            pipelineRunId: 999999,
            searchQuery: 'broken',
            locationName: 'Nowhere',
            geoId: '1',
            generatedUrl: 'https://www.linkedin.com/jobs/search/?q=broken',
            startTimestamp: '2026-08-05T10:00:00.000Z',
          },
        ],
      ),
    ).rejects.toThrow();
    const after = (await repo.listRuns()).length;
    expect(after).toBe(before);
  });

  it('finalizeRunStats updates the persisted counters', async () => {
    const { runId } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [],
    );
    await repo.finalizeRunStats(runId, {
      status: 'completed',
      endTimestamp: '2026-08-05T10:30:00.000Z',
      searchesPlanned: 2,
      searchesCompleted: 2,
      jobsDiscovered: 7,
      jobsAccepted: 4,
      jobsRejected: 3,
    });
    const run = await repo.findRunById(runId);
    expect(run?.status).toBe('completed');
    expect(run?.jobsDiscovered).toBe(7);
    expect(run?.jobsAccepted).toBe(4);
  });

  it('updateSearchStatus writes the final status and counts', async () => {
    const { searchIds } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'q',
          locationName: 'L',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
      ],
    );
    const searchId = searchIds[0]!;
    await repo.updateSearchStatus(searchId, {
      finalStatus: 'completed',
      endTimestamp: '2026-08-05T10:05:00.000Z',
      jobsDiscovered: 5,
      newJobs: 3,
      existingJobs: 2,
    });
    const search = await repo.findSearchById(searchId);
    expect(search?.finalStatus).toBe('completed');
    expect(search?.jobsDiscovered).toBe(5);
  });
});
```

> **Implementation note for the rollback test:** The `createRunWithSearches` test uses `pipelineRunId: 999999` inside the search row to force a foreign-key violation. The repository must override the `pipelineRunId` of each search to the just-created run id, so by passing a non-existent value the test confirms the FK guard works. Because the repository writes the run first, the in-tx search insert will hit the FK failure and roll back the run as well. If the implementation ever changes the ordering, the test must be updated to inject failure a different way (e.g., a deliberately malformed timestamp or an explicit `throw` inside a wrapping test fixture).

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/pipeline-runs.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/pipeline-runs.ts`**

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { pipelineRuns, searchExecutions } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type PipelineRunStatus =
  | 'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
export type SearchExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PipelineRunRow {
  readonly id: number;
  readonly status: PipelineRunStatus;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly configSnapshotJson: unknown;
  readonly configSchemaVersion: number;
  readonly configHash: string;
  readonly applicationVersion: string;
  readonly profileVersionId: number | null;
  readonly filterConfigVersionId: number | null;
  readonly searchesPlanned: number;
  readonly searchesAttempted: number;
  readonly searchesCompleted: number;
  readonly searchErrors: readonly unknown[] | null;
  readonly jobsDiscovered: number;
  readonly newCompleteJobs: number;
  readonly existingCompleteJobsSkipped: number;
  readonly existingPartialJobsSkipped: number;
  readonly newPartialJobs: number;
  readonly failedExtractions: number;
  readonly jobsAccepted: number;
  readonly jobsRejected: number;
  readonly filterErrors: number;
  readonly jobsScored: number;
  readonly scoresReused: number;
  readonly scoringErrors: number;
  readonly scoringDeclinedByUser: boolean;
  readonly cancellationReason: string | null;
}

export interface PipelineRunInsert {
  readonly startTimestamp: string;
  readonly status?: PipelineRunStatus;
  readonly configSnapshotJson: unknown;
  readonly configSchemaVersion: number;
  readonly configHash: string;
  readonly applicationVersion: string;
  readonly profileVersionId?: number | null;
  readonly filterConfigVersionId?: number | null;
}

export interface SearchExecutionRow {
  readonly id: number;
  readonly pipelineRunId: number;
  readonly searchQuery: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly finalStatus: SearchExecutionStatus;
  readonly jobsDiscovered: number;
  readonly newJobs: number;
  readonly existingJobs: number;
  readonly errors: readonly unknown[] | null;
  readonly diagnosticRefs: readonly unknown[] | null;
}

export interface SearchExecutionInsert {
  readonly pipelineRunId: number; // ignored by createRunWithSearches; filled in by the repo
  readonly searchQuery: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
  readonly finalStatus?: SearchExecutionStatus;
}

function runRowFromRecord(record: typeof pipelineRuns.$inferSelect): PipelineRunRow {
  return {
    id: record.id,
    status: record.status,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    configSnapshotJson: unknownJson.decodeRequired(record.configSnapshotJson),
    configSchemaVersion: record.configSchemaVersion,
    configHash: record.configHash,
    applicationVersion: record.applicationVersion,
    profileVersionId: record.profileVersionId,
    filterConfigVersionId: record.filterConfigVersionId,
    searchesPlanned: record.searchesPlanned,
    searchesAttempted: record.searchesAttempted,
    searchesCompleted: record.searchesCompleted,
    searchErrors: unknownJson.decode(record.searchErrorsJson),
    jobsDiscovered: record.jobsDiscovered,
    newCompleteJobs: record.newCompleteJobs,
    existingCompleteJobsSkipped: record.existingCompleteJobsSkipped,
    existingPartialJobsSkipped: record.existingPartialJobsSkipped,
    newPartialJobs: record.newPartialJobs,
    failedExtractions: record.failedExtractions,
    jobsAccepted: record.jobsAccepted,
    jobsRejected: record.jobsRejected,
    filterErrors: record.filterErrors,
    jobsScored: record.jobsScored,
    scoresReused: record.scoresReused,
    scoringErrors: record.scoringErrors,
    scoringDeclinedByUser: record.scoringDeclinedByUser,
    cancellationReason: record.cancellationReason,
  };
}

function searchRowFromRecord(record: typeof searchExecutions.$inferSelect): SearchExecutionRow {
  return {
    id: record.id,
    pipelineRunId: record.pipelineRunId,
    searchQuery: record.searchQuery,
    locationName: record.locationName,
    geoId: record.geoId,
    generatedUrl: record.generatedUrl,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    finalStatus: record.finalStatus,
    jobsDiscovered: record.jobsDiscovered,
    newJobs: record.newJobs,
    existingJobs: record.existingJobs,
    errors: unknownJson.decode(record.errorsJson),
    diagnosticRefs: unknownJson.decode(record.diagnosticRefsJson),
  };
}

export interface RunStatsPatch {
  readonly status?: PipelineRunStatus;
  readonly endTimestamp?: string | null;
  readonly searchesPlanned?: number;
  readonly searchesAttempted?: number;
  readonly searchesCompleted?: number;
  readonly jobsDiscovered?: number;
  readonly newCompleteJobs?: number;
  readonly existingCompleteJobsSkipped?: number;
  readonly existingPartialJobsSkipped?: number;
  readonly newPartialJobs?: number;
  readonly failedExtractions?: number;
  readonly jobsAccepted?: number;
  readonly jobsRejected?: number;
  readonly filterErrors?: number;
  readonly jobsScored?: number;
  readonly scoresReused?: number;
  readonly scoringErrors?: number;
  readonly scoringDeclinedByUser?: boolean;
  readonly cancellationReason?: string | null;
  readonly searchErrors?: readonly unknown[] | null;
}

export interface SearchStatusPatch {
  readonly finalStatus?: SearchExecutionStatus;
  readonly endTimestamp?: string | null;
  readonly jobsDiscovered?: number;
  readonly newJobs?: number;
  readonly existingJobs?: number;
  readonly errors?: readonly unknown[] | null;
  readonly diagnosticRefs?: readonly unknown[] | null;
}

export class PipelineRunRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async createRunWithSearches(
    run: PipelineRunInsert,
    searches: readonly SearchExecutionInsert[],
  ): Promise<{ runId: number; searchIds: readonly number[] }> {
    return this.ctx.db.transaction((tx) => {
      const runResult = tx
        .insert(pipelineRuns)
        .values({
          status: run.status ?? 'running',
          startTimestamp: run.startTimestamp,
          endTimestamp: null,
          configSnapshotJson: unknownJson.encode(run.configSnapshotJson),
          configSchemaVersion: run.configSchemaVersion,
          configHash: run.configHash,
          applicationVersion: run.applicationVersion,
          profileVersionId: run.profileVersionId ?? null,
          filterConfigVersionId: run.filterConfigVersionId ?? null,
        })
        .returning({ id: pipelineRuns.id })
        .all();
      const runRow = runResult[0];
      if (runRow === undefined) throw new Error('createRunWithSearches: run insert returned no rows');
      const runId = runRow.id;

      const searchIds: number[] = [];
      for (const search of searches) {
        const sResult = tx
          .insert(searchExecutions)
          .values({
            pipelineRunId: runId,
            searchQuery: search.searchQuery,
            locationName: search.locationName,
            geoId: search.geoId,
            generatedUrl: search.generatedUrl,
            startTimestamp: search.startTimestamp,
            endTimestamp: null,
            finalStatus: search.finalStatus ?? 'pending',
            jobsDiscovered: 0,
            newJobs: 0,
            existingJobs: 0,
            errorsJson: null,
            diagnosticRefsJson: null,
          })
          .returning({ id: searchExecutions.id })
          .all();
        const sRow = sResult[0];
        if (sRow === undefined) throw new Error('createRunWithSearches: search insert returned no rows');
        searchIds.push(sRow.id);
      }

      return { runId, searchIds };
    });
  }

  async findRunById(id: number): Promise<PipelineRunRow | null> {
    const rows = this.ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : runRowFromRecord(row);
  }

  async listRuns(opts?: { status?: PipelineRunStatus }): Promise<readonly PipelineRunRow[]> {
    const base = this.ctx.db.select().from(pipelineRuns);
    const filtered = opts?.status === undefined ? base : base.where(eq(pipelineRuns.status, opts.status));
    return filtered.all().map(runRowFromRecord);
  }

  async finalizeRunStats(id: number, stats: RunStatsPatch): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const patch: Record<string, unknown> = {};
      if (stats.status !== undefined) patch.status = stats.status;
      if (stats.endTimestamp !== undefined) patch.endTimestamp = stats.endTimestamp;
      if (stats.searchesPlanned !== undefined) patch.searchesPlanned = stats.searchesPlanned;
      if (stats.searchesAttempted !== undefined) patch.searchesAttempted = stats.searchesAttempted;
      if (stats.searchesCompleted !== undefined) patch.searchesCompleted = stats.searchesCompleted;
      if (stats.jobsDiscovered !== undefined) patch.jobsDiscovered = stats.jobsDiscovered;
      if (stats.newCompleteJobs !== undefined) patch.newCompleteJobs = stats.newCompleteJobs;
      if (stats.existingCompleteJobsSkipped !== undefined) patch.existingCompleteJobsSkipped = stats.existingCompleteJobsSkipped;
      if (stats.existingPartialJobsSkipped !== undefined) patch.existingPartialJobsSkipped = stats.existingPartialJobsSkipped;
      if (stats.newPartialJobs !== undefined) patch.newPartialJobs = stats.newPartialJobs;
      if (stats.failedExtractions !== undefined) patch.failedExtractions = stats.failedExtractions;
      if (stats.jobsAccepted !== undefined) patch.jobsAccepted = stats.jobsAccepted;
      if (stats.jobsRejected !== undefined) patch.jobsRejected = stats.jobsRejected;
      if (stats.filterErrors !== undefined) patch.filterErrors = stats.filterErrors;
      if (stats.jobsScored !== undefined) patch.jobsScored = stats.jobsScored;
      if (stats.scoresReused !== undefined) patch.scoresReused = stats.scoresReused;
      if (stats.scoringErrors !== undefined) patch.scoringErrors = stats.scoringErrors;
      if (stats.scoringDeclinedByUser !== undefined) patch.scoringDeclinedByUser = stats.scoringDeclinedByUser;
      if (stats.cancellationReason !== undefined) patch.cancellationReason = stats.cancellationReason;
      if (stats.searchErrors !== undefined) {
        patch.searchErrorsJson = stats.searchErrors === null ? null : unknownJson.encode(stats.searchErrors);
      }
      tx.update(pipelineRuns).set(patch).where(eq(pipelineRuns.id, id)).run();
    });
  }

  async findSearchById(id: number): Promise<SearchExecutionRow | null> {
    const rows = this.ctx.db.select().from(searchExecutions).where(eq(searchExecutions.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : searchRowFromRecord(row);
  }

  async listSearchesByRun(pipelineRunId: number): Promise<readonly SearchExecutionRow[]> {
    const rows = this.ctx.db.select().from(searchExecutions).where(eq(searchExecutions.pipelineRunId, pipelineRunId)).all();
    return rows.map(searchRowFromRecord);
  }

  async updateSearchStatus(id: number, patch: SearchStatusPatch): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const update: Record<string, unknown> = {};
      if (patch.finalStatus !== undefined) update.finalStatus = patch.finalStatus;
      if (patch.endTimestamp !== undefined) update.endTimestamp = patch.endTimestamp;
      if (patch.jobsDiscovered !== undefined) update.jobsDiscovered = patch.jobsDiscovered;
      if (patch.newJobs !== undefined) update.newJobs = patch.newJobs;
      if (patch.existingJobs !== undefined) update.existingJobs = patch.existingJobs;
      if (patch.errors !== undefined) update.errorsJson = patch.errors === null ? null : unknownJson.encode(patch.errors);
      if (patch.diagnosticRefs !== undefined) update.diagnosticRefsJson = patch.diagnosticRefs === null ? null : unknownJson.encode(patch.diagnosticRefs);
      tx.update(searchExecutions).set(update).where(eq(searchExecutions.id, id)).run();
    });
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/pipeline-runs.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/pipeline-runs.ts tests/persistence/repositories/pipeline-runs.test.ts
git commit -m "feat(persistence): add pipeline run and search execution repository with §23.5 transactions"
```

---

### Task 6: Job + discovery + extraction repository

**Files:**

- Create: `src/persistence/repositories/jobs.ts`
- Create: `tests/persistence/repositories/jobs.test.ts`

**Interfaces:**

```ts
export type ExtractionStatus = 'complete' | 'partial' | 'failed';
export type ExtractionMethod = 'search_detail_panel' | 'dedicated_job_page';

export interface JobRow { /* shape matches schema columns */ }
export interface JobInsert {
  readonly sourceJobId: string;
  readonly extractionStatus: ExtractionStatus;
  readonly firstDiscoveryTimestamp: string;
  readonly lastRediscoveryTimestamp: string;
  readonly title?: string | null;
  readonly company?: string | null;
  readonly location?: string | null;
  readonly description?: string | null;
  readonly successfulMethod?: ExtractionMethod | null;
  readonly createdTimestamp: string;
  readonly updatedTimestamp: string;
}
export interface JobPatch { /* subset of columns updatable post-extraction */ }
export interface DiscoveryEventRow { /* shape matches schema columns */ }
export interface DiscoveryErrorRow { /* shape matches schema columns */ }
export interface ExtractionAttemptRow { /* shape matches schema columns */ }

export class JobRepository {
  constructor(ctx: RepositoryContext);

  // SPEC §23.5: atomic new-job + extraction persistence.
  recordNewJob(input: {
    job: JobInsert;
    discoveryEvent: Omit<DiscoveryEventRow, 'id'>;
    extractionAttempt?: Omit<ExtractionAttemptRow, 'id'>;
  }): Promise<{ jobId: number; discoveryEventId: number; extractionAttemptId?: number }>;

  findBySourceJobId(sourceJobId: string): Promise<JobRow | null>;
  findById(id: number): Promise<JobRow | null>;
  updateExtraction(id: number, patch: JobPatch): Promise<void>;

  recordDiscoveryEvent(input: Omit<DiscoveryEventRow, 'id'>): Promise<number>;
  listDiscoveryEventsByJob(jobId: number): Promise<readonly DiscoveryEventRow[]>;
  listDiscoveryEventsByRun(pipelineRunId: number): Promise<readonly DiscoveryEventRow[]>;

  recordDiscoveryError(input: Omit<DiscoveryErrorRow, 'id'>): Promise<number>;
  listDiscoveryErrorsByRun(pipelineRunId: number): Promise<readonly DiscoveryErrorRow[]>;

  recordExtractionAttempt(input: Omit<ExtractionAttemptRow, 'id'>): Promise<number>;
  listExtractionAttemptsByJob(jobId: number): Promise<readonly ExtractionAttemptRow[]>;
}
```

`recordNewJob` is the SPEC §23.5 "persisting a new job and extraction" transaction group. It inserts a job, a discovery event, and optionally an extraction attempt in a single transaction.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/jobs.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';
import { JobRepository } from '../../../src/persistence/repositories/jobs.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('JobRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let jobRepo: JobRepository;
  let searchId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-jobs-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    jobRepo = new JobRepository(ctxFrom(connection));
    const { searchIds } = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h', applicationVersion: '0.1.0',
      },
      [{
        pipelineRunId: 0, searchQuery: 'q', locationName: 'L', geoId: '1',
        generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
        startTimestamp: '2026-08-05T10:00:00.000Z',
      }],
    );
    searchId = searchIds[0]!;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('recordNewJob atomically creates a job, discovery event, and extraction attempt', async () => {
    const result = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '123',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        title: 'Engineer', company: 'Acme', location: 'Rotterdam', description: 'desc',
        successfulMethod: 'search_detail_panel',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0, pipelineRunId: 1, searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true, currentExtractionState: 'complete', extractionAttempted: true,
        skipReason: null,
      },
      extractionAttempt: {
        jobId: 0, pipelineRunId: 1, searchExecutionId: searchId,
        attemptTimestamp: '2026-08-05T10:00:00.000Z',
        method: 'search_detail_panel', attemptNumber: 1, success: true,
        errorCode: null, errorMessage: null,
      },
    });
    expect(result.jobId).toBeGreaterThan(0);
    expect(result.discoveryEventId).toBeGreaterThan(0);
    expect(result.extractionAttemptId).toBeGreaterThan(0);

    const job = await jobRepo.findBySourceJobId('123');
    expect(job?.title).toBe('Engineer');
    expect((await jobRepo.listDiscoveryEventsByJob(result.jobId))).toHaveLength(1);
    expect((await jobRepo.listExtractionAttemptsByJob(result.jobId))).toHaveLength(1);
  });

  it('recordNewJob rolls back when the discovery event fails (FK violation)', async () => {
    await expect(
      jobRepo.recordNewJob({
        job: {
          sourceJobId: '456',
          extractionStatus: 'complete',
          firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
          lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
          createdTimestamp: '2026-08-05T10:00:00.000Z',
          updatedTimestamp: '2026-08-05T10:00:00.000Z',
        },
        discoveryEvent: {
          jobId: 0, pipelineRunId: 999999, searchExecutionId: searchId,
          timestamp: '2026-08-05T10:00:00.000Z',
          isNew: true, currentExtractionState: 'complete', extractionAttempted: false,
          skipReason: null,
        },
      }),
    ).rejects.toThrow();
    expect(await jobRepo.findBySourceJobId('456')).toBeNull();
  });

  it('updateExtraction preserves history and updates fields', async () => {
    const { jobId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '789',
        extractionStatus: 'partial',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0, pipelineRunId: 1, searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true, currentExtractionState: 'partial', extractionAttempted: true,
        skipReason: null,
      },
    });
    await jobRepo.updateExtraction(jobId, {
      title: 'New Title',
      description: 'Full description',
      extractionStatus: 'complete',
      successfulMethod: 'search_detail_panel',
      lastExtractionAttemptTimestamp: '2026-08-05T10:05:00.000Z',
      updatedTimestamp: '2026-08-05T10:05:00.000Z',
    });
    const job = await jobRepo.findById(jobId);
    expect(job?.title).toBe('New Title');
    expect(job?.extractionStatus).toBe('complete');
    expect(job?.lastExtractionAttemptTimestamp).toBe('2026-08-05T10:05:00.000Z');
  });

  it('records discovery errors and extraction attempts independently', async () => {
    const errorId = await jobRepo.recordDiscoveryError({
      pipelineRunId: 1, searchExecutionId: searchId,
      cardPosition: 1, cardIndex: 0, availableMetadata: null,
      errorCode: 'card_unparseable', diagnosticMessage: 'No source job id',
      timestamp: '2026-08-05T10:00:00.000Z', artifactRefs: null,
    });
    expect(errorId).toBeGreaterThan(0);
    expect(await jobRepo.listDiscoveryErrorsByRun(1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/jobs.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/jobs.ts`**

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { discoveryErrors, discoveryEvents, extractionAttempts, jobs } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type ExtractionStatus = 'complete' | 'partial' | 'failed';
export type ExtractionMethod = 'search_detail_panel' | 'dedicated_job_page';

export interface JobRow {
  readonly id: number;
  readonly sourceJobId: string;
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
  readonly extractionStatus: ExtractionStatus;
  readonly successfulMethod: ExtractionMethod | null;
  readonly firstDiscoveryTimestamp: string;
  readonly lastRediscoveryTimestamp: string;
  readonly lastExtractionAttemptTimestamp: string | null;
  readonly createdTimestamp: string;
  readonly updatedTimestamp: string;
}

export interface JobInsert {
  readonly sourceJobId: string;
  readonly extractionStatus: ExtractionStatus;
  readonly firstDiscoveryTimestamp: string;
  readonly lastRediscoveryTimestamp: string;
  readonly title?: string | null;
  readonly company?: string | null;
  readonly location?: string | null;
  readonly description?: string | null;
  readonly successfulMethod?: ExtractionMethod | null;
  readonly createdTimestamp: string;
  readonly updatedTimestamp: string;
}

export interface JobPatch {
  readonly title?: string | null;
  readonly company?: string | null;
  readonly location?: string | null;
  readonly description?: string | null;
  readonly extractionStatus?: ExtractionStatus;
  readonly successfulMethod?: ExtractionMethod | null;
  readonly lastRediscoveryTimestamp?: string;
  readonly lastExtractionAttemptTimestamp?: string | null;
  readonly updatedTimestamp?: string;
}

export interface DiscoveryEventRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number;
  readonly searchExecutionId: number;
  readonly timestamp: string;
  readonly isNew: boolean;
  readonly currentExtractionState: ExtractionStatus;
  readonly extractionAttempted: boolean;
  readonly skipReason: string | null;
}

export interface DiscoveryErrorRow {
  readonly id: number;
  readonly pipelineRunId: number;
  readonly searchExecutionId: number;
  readonly cardPosition: number | null;
  readonly cardIndex: number | null;
  readonly availableMetadata: unknown | null;
  readonly errorCode: string;
  readonly diagnosticMessage: string;
  readonly timestamp: string;
  readonly artifactRefs: readonly unknown[] | null;
}

export interface ExtractionAttemptRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number;
  readonly searchExecutionId: number;
  readonly attemptTimestamp: string;
  readonly method: ExtractionMethod;
  readonly attemptNumber: number;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

function jobRowFromRecord(record: typeof jobs.$inferSelect): JobRow {
  return {
    id: record.id,
    sourceJobId: record.sourceJobId,
    title: record.title,
    company: record.company,
    location: record.location,
    description: record.description,
    extractionStatus: record.extractionStatus,
    successfulMethod: record.successfulMethod,
    firstDiscoveryTimestamp: record.firstDiscoveryTimestamp,
    lastRediscoveryTimestamp: record.lastRediscoveryTimestamp,
    lastExtractionAttemptTimestamp: record.lastExtractionAttemptTimestamp,
    createdTimestamp: record.createdTimestamp,
    updatedTimestamp: record.updatedTimestamp,
  };
}

function discoveryEventRowFromRecord(record: typeof discoveryEvents.$inferSelect): DiscoveryEventRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    timestamp: record.timestamp,
    isNew: record.isNew,
    currentExtractionState: record.currentExtractionState,
    extractionAttempted: record.extractionAttempted,
    skipReason: record.skipReason,
  };
}

function discoveryErrorRowFromRecord(record: typeof discoveryErrors.$inferSelect): DiscoveryErrorRow {
  return {
    id: record.id,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    cardPosition: record.cardPosition,
    cardIndex: record.cardIndex,
    availableMetadata: unknownJson.decode(record.availableMetadataJson),
    errorCode: record.errorCode,
    diagnosticMessage: record.diagnosticMessage,
    timestamp: record.timestamp,
    artifactRefs: unknownJson.decode(record.artifactRefsJson),
  };
}

function extractionAttemptRowFromRecord(record: typeof extractionAttempts.$inferSelect): ExtractionAttemptRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    attemptTimestamp: record.attemptTimestamp,
    method: record.method,
    attemptNumber: record.attemptNumber,
    success: record.success,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
  };
}

export interface RecordNewJobInput {
  readonly job: JobInsert;
  readonly discoveryEvent: Omit<DiscoveryEventRow, 'id'>;
  readonly extractionAttempt?: Omit<ExtractionAttemptRow, 'id'>;
}

export class JobRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async recordNewJob(input: RecordNewJobInput): Promise<{
    jobId: number;
    discoveryEventId: number;
    extractionAttemptId?: number;
  }> {
    return this.ctx.db.transaction((tx) => {
      const jobResult = tx
        .insert(jobs)
        .values({
          sourceJobId: input.job.sourceJobId,
          extractionStatus: input.job.extractionStatus,
          firstDiscoveryTimestamp: input.job.firstDiscoveryTimestamp,
          lastRediscoveryTimestamp: input.job.lastRediscoveryTimestamp,
          title: input.job.title ?? null,
          company: input.job.company ?? null,
          location: input.job.location ?? null,
          description: input.job.description ?? null,
          successfulMethod: input.job.successfulMethod ?? null,
          lastExtractionAttemptTimestamp: null,
          createdTimestamp: input.job.createdTimestamp,
          updatedTimestamp: input.job.updatedTimestamp,
        })
        .returning({ id: jobs.id })
        .all();
      const jobRow = jobResult[0];
      if (jobRow === undefined) throw new Error('recordNewJob: job insert returned no rows');
      const jobId = jobRow.id;

      const eventResult = tx
        .insert(discoveryEvents)
        .values({
          jobId,
          pipelineRunId: input.discoveryEvent.pipelineRunId,
          searchExecutionId: input.discoveryEvent.searchExecutionId,
          timestamp: input.discoveryEvent.timestamp,
          isNew: input.discoveryEvent.isNew,
          currentExtractionState: input.discoveryEvent.currentExtractionState,
          extractionAttempted: input.discoveryEvent.extractionAttempted,
          skipReason: input.discoveryEvent.skipReason,
        })
        .returning({ id: discoveryEvents.id })
        .all();
      const eventRow = eventResult[0];
      if (eventRow === undefined) throw new Error('recordNewJob: discovery event insert returned no rows');

      let extractionAttemptId: number | undefined;
      if (input.extractionAttempt !== undefined) {
        const attemptResult = tx
          .insert(extractionAttempts)
          .values({
            jobId,
            pipelineRunId: input.extractionAttempt.pipelineRunId,
            searchExecutionId: input.extractionAttempt.searchExecutionId,
            attemptTimestamp: input.extractionAttempt.attemptTimestamp,
            method: input.extractionAttempt.method,
            attemptNumber: input.extractionAttempt.attemptNumber,
            success: input.extractionAttempt.success,
            errorCode: input.extractionAttempt.errorCode,
            errorMessage: input.extractionAttempt.errorMessage,
          })
          .returning({ id: extractionAttempts.id })
          .all();
        const attemptRow = attemptResult[0];
        if (attemptRow === undefined) throw new Error('recordNewJob: extraction attempt insert returned no rows');
        extractionAttemptId = attemptRow.id;
      }

      return { jobId, discoveryEventId: eventRow.id, extractionAttemptId };
    });
  }

  async findBySourceJobId(sourceJobId: string): Promise<JobRow | null> {
    const rows = this.ctx.db.select().from(jobs).where(eq(jobs.sourceJobId, sourceJobId)).all();
    const row = rows[0];
    return row === undefined ? null : jobRowFromRecord(row);
  }

  async findById(id: number): Promise<JobRow | null> {
    const rows = this.ctx.db.select().from(jobs).where(eq(jobs.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : jobRowFromRecord(row);
  }

  async updateExtraction(id: number, patch: JobPatch): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const update: Record<string, unknown> = {};
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.company !== undefined) update.company = patch.company;
      if (patch.location !== undefined) update.location = patch.location;
      if (patch.description !== undefined) update.description = patch.description;
      if (patch.extractionStatus !== undefined) update.extractionStatus = patch.extractionStatus;
      if (patch.successfulMethod !== undefined) update.successfulMethod = patch.successfulMethod;
      if (patch.lastRediscoveryTimestamp !== undefined) update.lastRediscoveryTimestamp = patch.lastRediscoveryTimestamp;
      if (patch.lastExtractionAttemptTimestamp !== undefined) update.lastExtractionAttemptTimestamp = patch.lastExtractionAttemptTimestamp;
      if (patch.updatedTimestamp !== undefined) update.updatedTimestamp = patch.updatedTimestamp;
      tx.update(jobs).set(update).where(eq(jobs.id, id)).run();
    });
  }

  async recordDiscoveryEvent(input: Omit<DiscoveryEventRow, 'id'>): Promise<number> {
    const result = this.ctx.db.insert(discoveryEvents).values({
      jobId: input.jobId,
      pipelineRunId: input.pipelineRunId,
      searchExecutionId: input.searchExecutionId,
      timestamp: input.timestamp,
      isNew: input.isNew,
      currentExtractionState: input.currentExtractionState,
      extractionAttempted: input.extractionAttempted,
      skipReason: input.skipReason,
    }).returning({ id: discoveryEvents.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('recordDiscoveryEvent returned no rows');
    return row.id;
  }

  async listDiscoveryEventsByJob(jobId: number): Promise<readonly DiscoveryEventRow[]> {
    const rows = this.ctx.db.select().from(discoveryEvents).where(eq(discoveryEvents.jobId, jobId)).all();
    return rows.map(discoveryEventRowFromRecord);
  }

  async listDiscoveryEventsByRun(pipelineRunId: number): Promise<readonly DiscoveryEventRow[]> {
    const rows = this.ctx.db.select().from(discoveryEvents).where(eq(discoveryEvents.pipelineRunId, pipelineRunId)).all();
    return rows.map(discoveryEventRowFromRecord);
  }

  async recordDiscoveryError(input: Omit<DiscoveryErrorRow, 'id'>): Promise<number> {
    const result = this.ctx.db.insert(discoveryErrors).values({
      pipelineRunId: input.pipelineRunId,
      searchExecutionId: input.searchExecutionId,
      cardPosition: input.cardPosition,
      cardIndex: input.cardIndex,
      availableMetadataJson: input.availableMetadata === undefined || input.availableMetadata === null ? null : unknownJson.encode(input.availableMetadata),
      errorCode: input.errorCode,
      diagnosticMessage: input.diagnosticMessage,
      timestamp: input.timestamp,
      artifactRefsJson: input.artifactRefs === undefined || input.artifactRefs === null ? null : unknownJson.encode(input.artifactRefs),
    }).returning({ id: discoveryErrors.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('recordDiscoveryError returned no rows');
    return row.id;
  }

  async listDiscoveryErrorsByRun(pipelineRunId: number): Promise<readonly DiscoveryErrorRow[]> {
    const rows = this.ctx.db.select().from(discoveryErrors).where(eq(discoveryErrors.pipelineRunId, pipelineRunId)).all();
    return rows.map(discoveryErrorRowFromRecord);
  }

  async recordExtractionAttempt(input: Omit<ExtractionAttemptRow, 'id'>): Promise<number> {
    const result = this.ctx.db.insert(extractionAttempts).values({
      jobId: input.jobId,
      pipelineRunId: input.pipelineRunId,
      searchExecutionId: input.searchExecutionId,
      attemptTimestamp: input.attemptTimestamp,
      method: input.method,
      attemptNumber: input.attemptNumber,
      success: input.success,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    }).returning({ id: extractionAttempts.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('recordExtractionAttempt returned no rows');
    return row.id;
  }

  async listExtractionAttemptsByJob(jobId: number): Promise<readonly ExtractionAttemptRow[]> {
    const rows = this.ctx.db.select().from(extractionAttempts).where(eq(extractionAttempts.jobId, jobId)).all();
    return rows.map(extractionAttemptRowFromRecord);
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/jobs.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/jobs.ts tests/persistence/repositories/jobs.test.ts
git commit -m "feat(persistence): add job, discovery, and extraction repository with §23.5 transaction"
```

---

### Task 7: Filter result repository

**Files:**

- Create: `src/persistence/repositories/filter-results.ts`
- Create: `tests/persistence/repositories/filter-results.test.ts`

**Interfaces:**

```ts
export type FilterOutcome = 'accepted' | 'rejected' | 'error';

export interface FilterResultRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number | null;
  readonly filterConfigVersionId: number;
  readonly filterConfigHash: string;
  readonly profileVersionId: number | null;
  readonly profileHash: string | null;
  readonly filterImplementationVersion: string;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly unknown[];
  readonly rulesPassed: readonly unknown[];
  readonly rulesFailed: readonly unknown[];
  readonly rejectionReasons: readonly unknown[] | null;
  readonly active: boolean;
}

export interface FilterResultInsert {
  readonly jobId: number;
  readonly pipelineRunId?: number | null;
  readonly filterConfigVersionId: number;
  readonly filterConfigHash: string;
  readonly profileVersionId?: number | null;
  readonly profileHash?: string | null;
  readonly filterImplementationVersion: string;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly unknown[];
  readonly rulesPassed: readonly unknown[];
  readonly rulesFailed: readonly unknown[];
  readonly rejectionReasons?: readonly unknown[] | null;
}

export class FilterResultRepository {
  constructor(ctx: RepositoryContext);

  // SPEC §23.5: atomic active filter result update.
  activateResult(input: Omit<FilterResultInsert, 'active'>): Promise<number>;

  // SPEC §24.3: current result lookup requires a matching fingerprint.
  findActiveByJob(jobId: number, fingerprint: string): Promise<FilterResultRow | null>;
  findById(id: number): Promise<FilterResultRow | null>;
  listByJob(jobId: number): Promise<readonly FilterResultRow[]>;
  listByRun(pipelineRunId: number): Promise<readonly FilterResultRow[]>;
}
```

`activateResult` is the SPEC §23.5 "updating active filter results" transaction group. It runs in a single transaction: deactivate the previous active row for the job, then insert the new active row.

`findActiveByJob` requires a matching fingerprint — the caller (filtering layer) specifies the fingerprint it computed for the current inputs; the repository returns the stored active row only if its fingerprint matches. Stale rows are returned by `listByJob` but never match `findActiveByJob`.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/filter-results.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';
import { FilterConfigurationRepository } from '../../../src/persistence/repositories/filter-configurations.js';
import { FilterResultRepository } from '../../../src/persistence/repositories/filter-results.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('FilterResultRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let configRepo: FilterConfigurationRepository;
  let resultRepo: FilterResultRepository;
  let runId: number;
  let filterConfigId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-filter-results-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    configRepo = new FilterConfigurationRepository(ctxFrom(connection));
    resultRepo = new FilterResultRepository(ctxFrom(connection));
    const { runId: rid } = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h', applicationVersion: '0.1.0',
      },
      [],
    );
    runId = rid;
    filterConfigId = await configRepo.insert({
      schemaVersion: 1, contentHash: 'cfg-hash', configJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', active: true,
    });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('activateResult atomically replaces the previous active row for a job', async () => {
    const first = await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId, filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash', filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-A', timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted', rulesEvaluated: ['r1'], rulesPassed: ['r1'], rulesFailed: [],
    });
    const second = await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId, filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash', filterImplementationVersion: 'filter-impl-2',
      fingerprint: 'fp-B', timestamp: '2026-08-05T11:00:00.000Z',
      overallOutcome: 'rejected', rulesEvaluated: ['r1'], rulesPassed: [], rulesFailed: ['r1'],
      rejectionReasons: ['r1'],
    });
    expect(second).toBeGreaterThan(first);

    const history = await resultRepo.listByJob(1);
    expect(history).toHaveLength(2);
    const active = history.find((r) => r.active);
    expect(active?.id).toBe(second);
    expect(active?.overallOutcome).toBe('rejected');
    const inactive = history.find((r) => !r.active);
    expect(inactive?.id).toBe(first);
  });

  it('findActiveByJob returns the active row only when the fingerprint matches', async () => {
    await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId, filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash', filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-A', timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted', rulesEvaluated: ['r1'], rulesPassed: ['r1'], rulesFailed: [],
    });
    const match = await resultRepo.findActiveByJob(1, 'fp-A');
    expect(match?.fingerprint).toBe('fp-A');
    const miss = await resultRepo.findActiveByJob(1, 'fp-OLD');
    expect(miss).toBeNull();
  });

  it('listByRun returns every filter result for the run', async () => {
    await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId, filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash', filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-1', timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted', rulesEvaluated: [], rulesPassed: [], rulesFailed: [],
    });
    await resultRepo.activateResult({
      jobId: 2, pipelineRunId: runId, filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash', filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-2', timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'rejected', rulesEvaluated: ['r1'], rulesPassed: [], rulesFailed: ['r1'],
      rejectionReasons: ['r1'],
    });
    const rows = await resultRepo.listByRun(runId);
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/filter-results.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/filter-results.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { filterResults } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type FilterOutcome = 'accepted' | 'rejected' | 'error';

export interface FilterResultRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number | null;
  readonly filterConfigVersionId: number;
  readonly filterConfigHash: string;
  readonly profileVersionId: number | null;
  readonly profileHash: string | null;
  readonly filterImplementationVersion: string;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly unknown[];
  readonly rulesPassed: readonly unknown[];
  readonly rulesFailed: readonly unknown[];
  readonly rejectionReasons: readonly unknown[] | null;
  readonly active: boolean;
}

export interface FilterResultInsert {
  readonly jobId: number;
  readonly pipelineRunId?: number | null;
  readonly filterConfigVersionId: number;
  readonly filterConfigHash: string;
  readonly profileVersionId?: number | null;
  readonly profileHash?: string | null;
  readonly filterImplementationVersion: string;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly unknown[];
  readonly rulesPassed: readonly unknown[];
  readonly rulesFailed: readonly unknown[];
  readonly rejectionReasons?: readonly unknown[] | null;
}

function rowFromRecord(record: typeof filterResults.$inferSelect): FilterResultRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    filterConfigVersionId: record.filterConfigVersionId,
    filterConfigHash: record.filterConfigHash,
    profileVersionId: record.profileVersionId,
    profileHash: record.profileHash,
    filterImplementationVersion: record.filterImplementationVersion,
    fingerprint: record.fingerprint,
    timestamp: record.timestamp,
    overallOutcome: record.overallOutcome,
    rulesEvaluated: unknownJson.decodeRequired(record.rulesEvaluatedJson) as readonly unknown[],
    rulesPassed: unknownJson.decodeRequired(record.rulesPassedJson) as readonly unknown[],
    rulesFailed: unknownJson.decodeRequired(record.rulesFailedJson) as readonly unknown[],
    rejectionReasons: unknownJson.decode(record.rejectionReasonsJson),
    active: record.active,
  };
}

export class FilterResultRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async activateResult(input: Omit<FilterResultInsert, 'active'>): Promise<number> {
    return this.ctx.db.transaction((tx) => {
      // SPEC §23.5: deactivate the previous active row for this job, then insert
      // the new active row. The partial unique index `filter_results_active_idx`
      // guarantees at most one active row per job.
      tx.update(filterResults)
        .set({ active: false })
        .where(and(eq(filterResults.jobId, input.jobId), eq(filterResults.active, true)))
        .run();
      const result = tx
        .insert(filterResults)
        .values({
          jobId: input.jobId,
          pipelineRunId: input.pipelineRunId ?? null,
          filterConfigVersionId: input.filterConfigVersionId,
          filterConfigHash: input.filterConfigHash,
          profileVersionId: input.profileVersionId ?? null,
          profileHash: input.profileHash ?? null,
          filterImplementationVersion: input.filterImplementationVersion,
          fingerprint: input.fingerprint,
          timestamp: input.timestamp,
          overallOutcome: input.overallOutcome,
          rulesEvaluatedJson: unknownJson.encode(input.rulesEvaluated),
          rulesPassedJson: unknownJson.encode(input.rulesPassed),
          rulesFailedJson: unknownJson.encode(input.rulesFailed),
          rejectionReasonsJson: input.rejectionReasons === undefined || input.rejectionReasons === null
            ? null
            : unknownJson.encode(input.rejectionReasons),
          active: true,
        })
        .returning({ id: filterResults.id })
        .all();
      const row = result[0];
      if (row === undefined) throw new Error('activateResult returned no rows');
      return row.id;
    });
  }

  async findActiveByJob(jobId: number, fingerprint: string): Promise<FilterResultRow | null> {
    const rows = this.ctx.db
      .select()
      .from(filterResults)
      .where(and(eq(filterResults.jobId, jobId), eq(filterResults.active, true), eq(filterResults.fingerprint, fingerprint)))
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findById(id: number): Promise<FilterResultRow | null> {
    const rows = this.ctx.db.select().from(filterResults).where(eq(filterResults.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByJob(jobId: number): Promise<readonly FilterResultRow[]> {
    const rows = this.ctx.db.select().from(filterResults).where(eq(filterResults.jobId, jobId)).all();
    return rows.map(rowFromRecord);
  }

  async listByRun(pipelineRunId: number): Promise<readonly FilterResultRow[]> {
    const rows = this.ctx.db.select().from(filterResults).where(eq(filterResults.pipelineRunId, pipelineRunId)).all();
    return rows.map(rowFromRecord);
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/filter-results.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/filter-results.ts tests/persistence/repositories/filter-results.test.ts
git commit -m "feat(persistence): add filter result repository with \u00a723.5 active-result transaction"
```

---

### Task 8: Score result repository

**Files:**

- Create: `src/persistence/repositories/score-results.ts`
- Create: `tests/persistence/repositories/score-results.test.ts`

**Interfaces:**

```ts
export interface ScoreResultRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number | null;
  readonly filterResultId: number | null;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly promptVersion: string;
  readonly rubricVersion: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly scorerImplementationVersion: string;
  readonly categoryScores: readonly unknown[];
  readonly overallScore: number;
  readonly explanation: string | null;
  readonly keyMatches: readonly unknown[] | null;
  readonly importantGaps: readonly unknown[] | null;
  readonly importantConcerns: readonly unknown[] | null;
  readonly inferredSeniority: string | null;
  readonly recommendationSummary: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly active: boolean;
}

export interface ScoreResultInsert {
  readonly jobId: number;
  readonly pipelineRunId?: number | null;
  readonly filterResultId?: number | null;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly promptVersion: string;
  readonly rubricVersion: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly scorerImplementationVersion: string;
  readonly categoryScores: readonly unknown[];
  readonly overallScore: number;
  readonly explanation?: string | null;
  readonly keyMatches?: readonly unknown[] | null;
  readonly importantGaps?: readonly unknown[] | null;
  readonly importantConcerns?: readonly unknown[] | null;
  readonly inferredSeniority?: string | null;
  readonly recommendationSummary?: string | null;
  readonly success: boolean;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

export class ScoreResultRepository {
  constructor(ctx: RepositoryContext);

  // SPEC §23.5: atomic active score result update.
  activateResult(input: Omit<ScoreResultInsert, 'active'>): Promise<number>;

  // SPEC §27.3: current result lookup requires a matching fingerprint.
  findActiveByJob(jobId: number, fingerprint: string): Promise<ScoreResultRow | null>;
  findById(id: number): Promise<ScoreResultRow | null>;
  listByJob(jobId: number): Promise<readonly ScoreResultRow[]>;
  listByRun(pipelineRunId: number): Promise<readonly ScoreResultRow[]>;
  topByRun(pipelineRunId: number, limit: number): Promise<readonly ScoreResultRow[]>;
}
```

`activateResult` mirrors the filter result pattern: deactivate-then-insert atomically. `findActiveByJob` requires the fingerprint match.

`topByRun` is the helper used by the inspection command (TASK-016) and the run pipeline (TASK-015) to rank scored jobs by `overallScore` descending.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/score-results.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';
import { ScoreResultRepository } from '../../../src/persistence/repositories/score-results.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('ScoreResultRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let resultRepo: ScoreResultRepository;
  let runId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-score-results-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    resultRepo = new ScoreResultRepository(ctxFrom(connection));
    const { runId: rid } = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h', applicationVersion: '0.1.0',
      },
      [],
    );
    runId = rid;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('activateResult atomically replaces the previous active row for a job', async () => {
    const first = await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId,
      fingerprint: 'fp-A', timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1', rubricVersion: 'r1', model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [{ name: 'skills', value: 0.8 }],
      overallScore: 0.8, success: true,
    });
    const second = await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId,
      fingerprint: 'fp-B', timestamp: '2026-08-05T11:00:00.000Z',
      promptVersion: 'p1', rubricVersion: 'r1', model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-2',
      categoryScores: [{ name: 'skills', value: 0.9 }],
      overallScore: 0.9, success: true,
    });
    expect(second).toBeGreaterThan(first);

    const active = (await resultRepo.listByJob(1)).find((r) => r.active);
    expect(active?.id).toBe(second);
    expect(active?.overallScore).toBe(0.9);
  });

  it('findActiveByJob returns the active row only when the fingerprint matches', async () => {
    await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId,
      fingerprint: 'fp-A', timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1', rubricVersion: 'r1', model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [], overallScore: 0.5, success: true,
    });
    expect((await resultRepo.findActiveByJob(1, 'fp-A'))?.fingerprint).toBe('fp-A');
    expect(await resultRepo.findActiveByJob(1, 'fp-OLD')).toBeNull();
  });

  it('topByRun returns rows ordered by overallScore descending', async () => {
    for (const [jobId, score] of [[1, 0.5], [2, 0.9], [3, 0.7]] as const) {
      await resultRepo.activateResult({
        jobId, pipelineRunId: runId,
        fingerprint: `fp-${jobId}`, timestamp: '2026-08-05T10:00:00.000Z',
        promptVersion: 'p1', rubricVersion: 'r1', model: 'gpt-5.6-sol', reasoningEffort: 'medium',
        scorerImplementationVersion: 'scorer-1',
        categoryScores: [], overallScore: score, success: true,
      });
    }
    const top = await resultRepo.topByRun(runId, 2);
    expect(top.map((r) => r.overallScore)).toEqual([0.9, 0.7]);
  });

  it('preserves history (stale rows are not deleted)', async () => {
    await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId,
      fingerprint: 'fp-A', timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1', rubricVersion: 'r1', model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [], overallScore: 0.5, success: true,
    });
    await resultRepo.activateResult({
      jobId: 1, pipelineRunId: runId,
      fingerprint: 'fp-B', timestamp: '2026-08-05T11:00:00.000Z',
      promptVersion: 'p1', rubricVersion: 'r1', model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [], overallScore: 0.7, success: true,
    });
    const history = await resultRepo.listByJob(1);
    expect(history).toHaveLength(2);
    expect(history.filter((r) => r.active)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/score-results.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/score-results.ts`**

```ts
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { scoreResults } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export interface ScoreResultRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number | null;
  readonly filterResultId: number | null;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly promptVersion: string;
  readonly rubricVersion: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly scorerImplementationVersion: string;
  readonly categoryScores: readonly unknown[];
  readonly overallScore: number;
  readonly explanation: string | null;
  readonly keyMatches: readonly unknown[] | null;
  readonly importantGaps: readonly unknown[] | null;
  readonly importantConcerns: readonly unknown[] | null;
  readonly inferredSeniority: string | null;
  readonly recommendationSummary: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly active: boolean;
}

export interface ScoreResultInsert {
  readonly jobId: number;
  readonly pipelineRunId?: number | null;
  readonly filterResultId?: number | null;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly promptVersion: string;
  readonly rubricVersion: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly scorerImplementationVersion: string;
  readonly categoryScores: readonly unknown[];
  readonly overallScore: number;
  readonly explanation?: string | null;
  readonly keyMatches?: readonly unknown[] | null;
  readonly importantGaps?: readonly unknown[] | null;
  readonly importantConcerns?: readonly unknown[] | null;
  readonly inferredSeniority?: string | null;
  readonly recommendationSummary?: string | null;
  readonly success: boolean;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

function rowFromRecord(record: typeof scoreResults.$inferSelect): ScoreResultRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    filterResultId: record.filterResultId,
    fingerprint: record.fingerprint,
    timestamp: record.timestamp,
    promptVersion: record.promptVersion,
    rubricVersion: record.rubricVersion,
    model: record.model,
    reasoningEffort: record.reasoningEffort,
    scorerImplementationVersion: record.scorerImplementationVersion,
    categoryScores: unknownJson.decodeRequired(record.categoryScoresJson) as readonly unknown[],
    overallScore: record.overallScore,
    explanation: record.explanation,
    keyMatches: unknownJson.decode(record.keyMatchesJson),
    importantGaps: unknownJson.decode(record.importantGapsJson),
    importantConcerns: unknownJson.decode(record.importantConcernsJson),
    inferredSeniority: record.inferredSeniority,
    recommendationSummary: record.recommendationSummary,
    success: record.success,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    active: record.active,
  };
}

export class ScoreResultRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async activateResult(input: Omit<ScoreResultInsert, 'active'>): Promise<number> {
    return this.ctx.db.transaction((tx) => {
      tx.update(scoreResults)
        .set({ active: false })
        .where(and(eq(scoreResults.jobId, input.jobId), eq(scoreResults.active, true)))
        .run();
      const result = tx
        .insert(scoreResults)
        .values({
          jobId: input.jobId,
          pipelineRunId: input.pipelineRunId ?? null,
          filterResultId: input.filterResultId ?? null,
          fingerprint: input.fingerprint,
          timestamp: input.timestamp,
          promptVersion: input.promptVersion,
          rubricVersion: input.rubricVersion,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          scorerImplementationVersion: input.scorerImplementationVersion,
          categoryScoresJson: unknownJson.encode(input.categoryScores),
          overallScore: input.overallScore,
          explanation: input.explanation ?? null,
          keyMatchesJson: input.keyMatches === undefined || input.keyMatches === null ? null : unknownJson.encode(input.keyMatches),
          importantGapsJson: input.importantGaps === undefined || input.importantGaps === null ? null : unknownJson.encode(input.importantGaps),
          importantConcernsJson: input.importantConcerns === undefined || input.importantConcerns === null ? null : unknownJson.encode(input.importantConcerns),
          inferredSeniority: input.inferredSeniority ?? null,
          recommendationSummary: input.recommendationSummary ?? null,
          success: input.success,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          active: true,
        })
        .returning({ id: scoreResults.id })
        .all();
      const row = result[0];
      if (row === undefined) throw new Error('activateResult returned no rows');
      return row.id;
    });
  }

  async findActiveByJob(jobId: number, fingerprint: string): Promise<ScoreResultRow | null> {
    const rows = this.ctx.db
      .select()
      .from(scoreResults)
      .where(and(eq(scoreResults.jobId, jobId), eq(scoreResults.active, true), eq(scoreResults.fingerprint, fingerprint)))
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findById(id: number): Promise<ScoreResultRow | null> {
    const rows = this.ctx.db.select().from(scoreResults).where(eq(scoreResults.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByJob(jobId: number): Promise<readonly ScoreResultRow[]> {
    const rows = this.ctx.db.select().from(scoreResults).where(eq(scoreResults.jobId, jobId)).all();
    return rows.map(rowFromRecord);
  }

  async listByRun(pipelineRunId: number): Promise<readonly ScoreResultRow[]> {
    const rows = this.ctx.db.select().from(scoreResults).where(eq(scoreResults.pipelineRunId, pipelineRunId)).all();
    return rows.map(rowFromRecord);
  }

  async topByRun(pipelineRunId: number, limit: number): Promise<readonly ScoreResultRow[]> {
    const rows = this.ctx.db
      .select()
      .from(scoreResults)
      .where(and(eq(scoreResults.pipelineRunId, pipelineRunId), eq(scoreResults.active, true), eq(scoreResults.success, true)))
      .orderBy(desc(scoreResults.overallScore))
      .limit(limit)
      .all();
    return rows.map(rowFromRecord);
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/score-results.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/score-results.ts tests/persistence/repositories/score-results.test.ts
git commit -m "feat(persistence): add score result repository with §23.5 active-result and top-N queries"
```

---

### Task 9: OpenAI request metadata repository

**Files:**

- Create: `src/persistence/repositories/openai-metadata.ts`
- Create: `tests/persistence/repositories/openai-metadata.test.ts`

**Interfaces:**

```ts
export type OpenAIOperationType = 'profile_extraction' | 'job_scoring';
export type OpenAIEntityRefType = 'profile_version' | 'score_result';

export interface OpenAIRequestMetadataRow {
  readonly id: number;
  readonly operationType: OpenAIOperationType;
  readonly relatedEntityType: OpenAIEntityRefType | null;
  readonly relatedEntityId: number | null;
  readonly inputHashes: readonly unknown[];
  readonly promptVersion: string;
  readonly structuredOutputSchemaVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly configJson: unknown;
  readonly tokenUsage: unknown | null;
  readonly validatedOutput: unknown | null;
  readonly attemptCount: number;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface OpenAIRequestMetadataInsert {
  readonly operationType: OpenAIOperationType;
  readonly relatedEntityType?: OpenAIEntityRefType | null;
  readonly relatedEntityId?: number | null;
  readonly inputHashes: readonly unknown[];
  readonly promptVersion: string;
  readonly structuredOutputSchemaVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly configJson: unknown;
  readonly tokenUsage?: unknown | null;
  readonly validatedOutput?: unknown | null;
  readonly attemptCount: number;
  readonly startTimestamp: string;
  readonly endTimestamp?: string | null;
  readonly success: boolean;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

export class OpenAIRequestMetadataRepository {
  constructor(ctx: RepositoryContext);

  insert(input: OpenAIRequestMetadataInsert): Promise<number>;
  findById(id: number): Promise<OpenAIRequestMetadataRow | null>;
  listByOperation(
    operationType: OpenAIOperationType,
    opts?: { sinceTimestamp?: string; limit?: number },
  ): Promise<readonly OpenAIRequestMetadataRow[]>;
  listByRelatedEntity(
    entityType: OpenAIEntityRefType,
    entityId: number,
  ): Promise<readonly OpenAIRequestMetadataRow[]>;
}
```

OpenAI row insertion is the only writer. The repository does **not** update raw prompts or responses (SPEC §25.4 forbids them). `validatedOutput` is the validated, structured output extracted from the JSON column when the caller wants it.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/openai-metadata.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { OpenAIRequestMetadataRepository } from '../../../src/persistence/repositories/openai-metadata.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('OpenAIRequestMetadataRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: OpenAIRequestMetadataRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-openai-metadata-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new OpenAIRequestMetadataRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts and finds a metadata row', async () => {
    const id = await repo.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result',
      relatedEntityId: 42,
      inputHashes: [{ jobId: 42 }, { profileVersionId: 7 }],
      promptVersion: 'p1',
      structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      configJson: { temperature: 0 },
      tokenUsage: { promptTokens: 100, completionTokens: 50 },
      attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z',
      endTimestamp: '2026-08-05T10:00:01.000Z',
      success: true,
    });
    const row = await repo.findById(id);
    expect(row?.id).toBe(id);
    expect(row?.operationType).toBe('job_scoring');
    expect(row?.relatedEntityId).toBe(42);
    expect(row?.validatedOutput).toBeNull();
  });

  it('listByOperation filters by operation type', async () => {
    await repo.insert({
      operationType: 'profile_extraction',
      inputHashes: [],
      promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z', success: true,
    });
    const scoreId = await repo.insert({
      operationType: 'job_scoring',
      inputHashes: [],
      promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:01:00.000Z', success: true,
    });
    const scoreRows = await repo.listByOperation('job_scoring');
    expect(scoreRows.map((r) => r.id)).toContain(scoreId);
    const profileRows = await repo.listByOperation('profile_extraction');
    expect(profileRows.every((r) => r.operationType === 'profile_extraction')).toBe(true);
  });

  it('listByRelatedEntity returns rows for a given entity', async () => {
    await repo.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result', relatedEntityId: 100,
      inputHashes: [], promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z', success: true,
    });
    await repo.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result', relatedEntityId: 200,
      inputHashes: [], promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:01:00.000Z', success: true,
    });
    const rows = await repo.listByRelatedEntity('score_result', 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relatedEntityId).toBe(100);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/openai-metadata.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/openai-metadata.ts`**

```ts
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import { openaiRequestMetadata } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type OpenAIOperationType = 'profile_extraction' | 'job_scoring';
export type OpenAIEntityRefType = 'profile_version' | 'score_result';

export interface OpenAIRequestMetadataRow {
  readonly id: number;
  readonly operationType: OpenAIOperationType;
  readonly relatedEntityType: OpenAIEntityRefType | null;
  readonly relatedEntityId: number | null;
  readonly inputHashes: readonly unknown[];
  readonly promptVersion: string;
  readonly structuredOutputSchemaVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly configJson: unknown;
  readonly tokenUsage: unknown | null;
  readonly validatedOutput: unknown | null;
  readonly attemptCount: number;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface OpenAIRequestMetadataInsert {
  readonly operationType: OpenAIOperationType;
  readonly relatedEntityType?: OpenAIEntityRefType | null;
  readonly relatedEntityId?: number | null;
  readonly inputHashes: readonly unknown[];
  readonly promptVersion: string;
  readonly structuredOutputSchemaVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly configJson: unknown;
  readonly tokenUsage?: unknown | null;
  readonly validatedOutput?: unknown | null;
  readonly attemptCount: number;
  readonly startTimestamp: string;
  readonly endTimestamp?: string | null;
  readonly success: boolean;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

function rowFromRecord(record: typeof openaiRequestMetadata.$inferSelect): OpenAIRequestMetadataRow {
  return {
    id: record.id,
    operationType: record.operationType,
    relatedEntityType: record.relatedEntityType,
    relatedEntityId: record.relatedEntityId,
    inputHashes: unknownJson.decodeRequired(record.inputHashesJson) as readonly unknown[],
    promptVersion: record.promptVersion,
    structuredOutputSchemaVersion: record.structuredOutputSchemaVersion,
    model: record.model,
    reasoningEffort: record.reasoningEffort,
    configJson: unknownJson.decodeRequired(record.configJson),
    tokenUsage: unknownJson.decode(record.tokenUsageJson),
    validatedOutput: unknownJson.decode(record.validatedOutputJson),
    attemptCount: record.attemptCount,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    success: record.success,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
  };
}

export class OpenAIRequestMetadataRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: OpenAIRequestMetadataInsert): Promise<number> {
    const result = this.ctx.db
      .insert(openaiRequestMetadata)
      .values({
        operationType: input.operationType,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        inputHashesJson: unknownJson.encode(input.inputHashes),
        promptVersion: input.promptVersion,
        structuredOutputSchemaVersion: input.structuredOutputSchemaVersion,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        configJson: unknownJson.encode(input.configJson),
        tokenUsageJson: input.tokenUsage === undefined || input.tokenUsage === null ? null : unknownJson.encode(input.tokenUsage),
        validatedOutputJson: input.validatedOutput === undefined || input.validatedOutput === null ? null : unknownJson.encode(input.validatedOutput),
        attemptCount: input.attemptCount,
        startTimestamp: input.startTimestamp,
        endTimestamp: input.endTimestamp ?? null,
        success: input.success,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .returning({ id: openaiRequestMetadata.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('insert returned no rows');
    return row.id;
  }

  async findById(id: number): Promise<OpenAIRequestMetadataRow | null> {
    const rows = this.ctx.db.select().from(openaiRequestMetadata).where(eq(openaiRequestMetadata.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByOperation(
    operationType: OpenAIOperationType,
    opts?: { sinceTimestamp?: string; limit?: number },
  ): Promise<readonly OpenAIRequestMetadataRow[]> {
    const base = this.ctx.db.select().from(openaiRequestMetadata).where(eq(openaiRequestMetadata.operationType, operationType));
    const filtered = opts?.sinceTimestamp === undefined ? base : base.where(and(eq(openaiRequestMetadata.operationType, operationType), gte(openaiRequestMetadata.startTimestamp, opts.sinceTimestamp)));
    const ordered = filtered.orderBy(desc(openaiRequestMetadata.startTimestamp));
    const limited = opts?.limit === undefined ? ordered : ordered.limit(opts.limit);
    const rows = limited.all();
    return rows.map(rowFromRecord);
  }

  async listByRelatedEntity(
    entityType: OpenAIEntityRefType,
    entityId: number,
  ): Promise<readonly OpenAIRequestMetadataRow[]> {
    const rows = this.ctx.db
      .select()
      .from(openaiRequestMetadata)
      .where(and(eq(openaiRequestMetadata.relatedEntityType, entityType), eq(openaiRequestMetadata.relatedEntityId, entityId)))
      .orderBy(desc(openaiRequestMetadata.startTimestamp))
      .all();
    return rows.map(rowFromRecord);
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/openai-metadata.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/openai-metadata.ts tests/persistence/repositories/openai-metadata.test.ts
git commit -m "feat(persistence): add OpenAI request metadata repository"
```

---

### Task 10: Diagnostic artifact repository

**Files:**

- Create: `src/persistence/repositories/diagnostics.ts`
- Create: `tests/persistence/repositories/diagnostics.test.ts`

**Interfaces:**

```ts
export type DiagnosticArtifactType =
  | 'screenshot' | 'current_url' | 'stack_trace' | 'playwright_trace' | 'html_snapshot' | 'log_file';

export interface DiagnosticArtifactRow {
  readonly id: number;
  readonly pipelineRunId: number | null;
  readonly searchExecutionId: number | null;
  readonly jobId: number | null;
  readonly discoveryErrorId: number | null;
  readonly extractionAttemptId: number | null;
  readonly artifactType: DiagnosticArtifactType;
  readonly storedPath: string;
  readonly relativePath: string;
  readonly mimeType: string | null;
  readonly fileSize: number | null;
  readonly createdAt: string;
  readonly errorCode: string | null;
  readonly description: string | null;
}

export interface DiagnosticArtifactInsert {
  readonly pipelineRunId?: number | null;
  readonly searchExecutionId?: number | null;
  readonly jobId?: number | null;
  readonly discoveryErrorId?: number | null;
  readonly extractionAttemptId?: number | null;
  readonly artifactType: DiagnosticArtifactType;
  readonly storedPath: string;
  readonly relativePath: string;
  readonly mimeType?: string | null;
  readonly fileSize?: number | null;
  readonly createdAt: string;
  readonly errorCode?: string | null;
  readonly description?: string | null;
}

export class DiagnosticArtifactRepository {
  constructor(ctx: RepositoryContext);

  insert(input: DiagnosticArtifactInsert): Promise<number>;
  findById(id: number): Promise<DiagnosticArtifactRow | null>;
  listByRun(pipelineRunId: number): Promise<readonly DiagnosticArtifactRow[]>;
  listBySearch(searchExecutionId: number): Promise<readonly DiagnosticArtifactRow[]>;
  listByJob(jobId: number): Promise<readonly DiagnosticArtifactRow[]>;
  listByDiscoveryError(discoveryErrorId: number): Promise<readonly DiagnosticArtifactRow[]>;
  listByExtractionAttempt(extractionAttemptId: number): Promise<readonly DiagnosticArtifactRow[]>;
}
```

Diagnostic artifacts are read-only after insert. The capturing service (TASK-005) owns the side effect of writing the underlying file; the repository only persists the reference.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/diagnostics.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';
import { DiagnosticArtifactRepository } from '../../../src/persistence/repositories/diagnostics.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('DiagnosticArtifactRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let diagRepo: DiagnosticArtifactRepository;
  let runId: number;
  let searchId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-diagnostics-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    diagRepo = new DiagnosticArtifactRepository(ctxFrom(connection));
    const created = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h', applicationVersion: '0.1.0',
      },
      [{
        pipelineRunId: 0, searchQuery: 'q', locationName: 'L', geoId: '1',
        generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
        startTimestamp: '2026-08-05T10:00:00.000Z',
      }],
    );
    runId = created.runId;
    searchId = created.searchIds[0]!;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts and finds an artifact by id', async () => {
    const id = await diagRepo.insert({
      pipelineRunId: runId,
      artifactType: 'screenshot',
      storedPath: '/opt/jobhunter/diagnostics/run-1/screenshot.png',
      relativePath: 'run-1/screenshot.png',
      mimeType: 'image/png',
      fileSize: 4096,
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    const row = await diagRepo.findById(id);
    expect(row?.artifactType).toBe('screenshot');
    expect(row?.pipelineRunId).toBe(runId);
  });

  it('listByRun, listBySearch, and listByJob scope correctly', async () => {
    await diagRepo.insert({
      pipelineRunId: runId, searchExecutionId: searchId,
      artifactType: 'screenshot', storedPath: '/a', relativePath: 'a',
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    await diagRepo.insert({
      pipelineRunId: runId, jobId: 99,
      artifactType: 'stack_trace', storedPath: '/b', relativePath: 'b',
      createdAt: '2026-08-05T10:01:00.000Z',
    });
    expect(await diagRepo.listByRun(runId)).toHaveLength(2);
    expect(await diagRepo.listBySearch(searchId)).toHaveLength(1);
    expect(await diagRepo.listByJob(99)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/diagnostics.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/diagnostics.ts`**

```ts
import { eq } from 'drizzle-orm';

import { diagnosticArtifacts } from '../schema.js';
import type { RepositoryContext } from './types.js';

export type DiagnosticArtifactType =
  | 'screenshot' | 'current_url' | 'stack_trace' | 'playwright_trace' | 'html_snapshot' | 'log_file';

export interface DiagnosticArtifactRow {
  readonly id: number;
  readonly pipelineRunId: number | null;
  readonly searchExecutionId: number | null;
  readonly jobId: number | null;
  readonly discoveryErrorId: number | null;
  readonly extractionAttemptId: number | null;
  readonly artifactType: DiagnosticArtifactType;
  readonly storedPath: string;
  readonly relativePath: string;
  readonly mimeType: string | null;
  readonly fileSize: number | null;
  readonly createdAt: string;
  readonly errorCode: string | null;
  readonly description: string | null;
}

export interface DiagnosticArtifactInsert {
  readonly pipelineRunId?: number | null;
  readonly searchExecutionId?: number | null;
  readonly jobId?: number | null;
  readonly discoveryErrorId?: number | null;
  readonly extractionAttemptId?: number | null;
  readonly artifactType: DiagnosticArtifactType;
  readonly storedPath: string;
  readonly relativePath: string;
  readonly mimeType?: string | null;
  readonly fileSize?: number | null;
  readonly createdAt: string;
  readonly errorCode?: string | null;
  readonly description?: string | null;
}

function rowFromRecord(record: typeof diagnosticArtifacts.$inferSelect): DiagnosticArtifactRow {
  return {
    id: record.id,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    jobId: record.jobId,
    discoveryErrorId: record.discoveryErrorId,
    extractionAttemptId: record.extractionAttemptId,
    artifactType: record.artifactType,
    storedPath: record.storedPath,
    relativePath: record.relativePath,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    createdAt: record.createdAt,
    errorCode: record.errorCode,
    description: record.description,
  };
}

export class DiagnosticArtifactRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: DiagnosticArtifactInsert): Promise<number> {
    const result = this.ctx.db.insert(diagnosticArtifacts).values({
      pipelineRunId: input.pipelineRunId ?? null,
      searchExecutionId: input.searchExecutionId ?? null,
      jobId: input.jobId ?? null,
      discoveryErrorId: input.discoveryErrorId ?? null,
      extractionAttemptId: input.extractionAttemptId ?? null,
      artifactType: input.artifactType,
      storedPath: input.storedPath,
      relativePath: input.relativePath,
      mimeType: input.mimeType ?? null,
      fileSize: input.fileSize ?? null,
      createdAt: input.createdAt,
      errorCode: input.errorCode ?? null,
      description: input.description ?? null,
    }).returning({ id: diagnosticArtifacts.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('insert returned no rows');
    return row.id;
  }

  async findById(id: number): Promise<DiagnosticArtifactRow | null> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByRun(pipelineRunId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.pipelineRunId, pipelineRunId)).all();
    return rows.map(rowFromRecord);
  }

  async listBySearch(searchExecutionId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.searchExecutionId, searchExecutionId)).all();
    return rows.map(rowFromRecord);
  }

  async listByJob(jobId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.jobId, jobId)).all();
    return rows.map(rowFromRecord);
  }

  async listByDiscoveryError(discoveryErrorId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.discoveryErrorId, discoveryErrorId)).all();
    return rows.map(rowFromRecord);
  }

  async listByExtractionAttempt(extractionAttemptId: number): Promise<readonly DiagnosticArtifactRow[]> {
    const rows = this.ctx.db.select().from(diagnosticArtifacts).where(eq(diagnosticArtifacts.extractionAttemptId, extractionAttemptId)).all();
    return rows.map(rowFromRecord);
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/diagnostics.test.ts
```

Expected: PASS — 2 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/diagnostics.ts tests/persistence/repositories/diagnostics.test.ts
git commit -m "feat(persistence): add diagnostic artifact repository"
```

---

### Task 11: Application metadata repository

**Files:**

- Create: `src/persistence/repositories/application-metadata.ts`
- Create: `tests/persistence/repositories/application-metadata.test.ts`

**Interfaces:**

```ts
export interface ApplicationMetadataRow {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}

export class ApplicationMetadataRepository {
  constructor(ctx: RepositoryContext);

  get(key: string): Promise<ApplicationMetadataRow | null>;
  set(key: string, value: string, updatedAt: string): Promise<void>;  // upsert
  list(): Promise<readonly ApplicationMetadataRow[]>;
  delete(key: string): Promise<void>;
}
```

The `application_metadata` table is a key/value singleton store. The repository provides a thin upsert API and uses the schema's primary key on `key` for atomic write-or-update.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/repositories/application-metadata.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { ApplicationMetadataRepository } from '../../../src/persistence/repositories/application-metadata.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('ApplicationMetadataRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: ApplicationMetadataRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-app-metadata-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new ApplicationMetadataRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('set then get returns the value', async () => {
    await repo.set('init.completedAt', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z');
    const row = await repo.get('init.completedAt');
    expect(row?.value).toBe('2026-08-05T10:00:00.000Z');
  });

  it('set overwrites an existing key', async () => {
    await repo.set('init.completedAt', 'a', '2026-08-05T10:00:00.000Z');
    await repo.set('init.completedAt', 'b', '2026-08-05T11:00:00.000Z');
    const row = await repo.get('init.completedAt');
    expect(row?.value).toBe('b');
    expect(row?.updatedAt).toBe('2026-08-05T11:00:00.000Z');
  });

  it('list returns all rows', async () => {
    await repo.set('a', '1', '2026-08-05T10:00:00.000Z');
    await repo.set('b', '2', '2026-08-05T10:00:00.000Z');
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
  });

  it('delete removes the row', async () => {
    await repo.set('a', '1', '2026-08-05T10:00:00.000Z');
    await repo.delete('a');
    expect(await repo.get('a')).toBeNull();
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/application-metadata.test.ts
```

Expected: FAIL — repository not yet created.

- [ ] **Step 3: Implement `src/persistence/repositories/application-metadata.ts`**

```ts
import { eq } from 'drizzle-orm';

import { applicationMetadata } from '../schema.js';
import type { RepositoryContext } from './types.js';

export interface ApplicationMetadataRow {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}

function rowFromRecord(record: typeof applicationMetadata.$inferSelect): ApplicationMetadataRow {
  return {
    key: record.key,
    value: record.value,
    updatedAt: record.updatedAt,
  };
}

export class ApplicationMetadataRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async get(key: string): Promise<ApplicationMetadataRow | null> {
    const rows = this.ctx.db.select().from(applicationMetadata).where(eq(applicationMetadata.key, key)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async set(key: string, value: string, updatedAt: string): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const existing = tx.select().from(applicationMetadata).where(eq(applicationMetadata.key, key)).all();
      if (existing.length > 0) {
        tx.update(applicationMetadata).set({ value, updatedAt }).where(eq(applicationMetadata.key, key)).run();
        return;
      }
      tx.insert(applicationMetadata).values({ key, value, updatedAt }).run();
    });
  }

  async list(): Promise<readonly ApplicationMetadataRow[]> {
    return this.ctx.db.select().from(applicationMetadata).all().map(rowFromRecord);
  }

  async delete(key: string): Promise<void> {
    this.ctx.db.delete(applicationMetadata).where(eq(applicationMetadata.key, key)).run();
  }
}
```

- [ ] **Step 4: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/application-metadata.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/repositories/application-metadata.ts tests/persistence/repositories/application-metadata.test.ts
git commit -m "feat(persistence): add application metadata repository"
```

---

### Task 12: Transaction helpers and the Repositories facade

**Files:**

- Create: `src/persistence/transactions.ts`
- Create: `src/persistence/repositories/index.ts`
- Create: `tests/persistence/transactions.test.ts`

**Interfaces:**

```ts
// transactions.ts
export type DrizzleTransaction = Parameters<Parameters<BetterSQLite3Database<Schema>['transaction']>[0]>[0];

export function withTransaction<T>(
  connection: DatabaseConnection,
  fn: (tx: DrizzleTransaction) => T,
): T;

// repositories/index.ts
export class Repositories {
  constructor(ctx: RepositoryContext);
  readonly profileSources: ProfileSourceRepository;
  readonly profileVersions: ProfileVersionRepository;
  readonly filterConfigurations: FilterConfigurationRepository;
  readonly pipelineRuns: PipelineRunRepository;
  readonly jobs: JobRepository;
  readonly filterResults: FilterResultRepository;
  readonly scoreResults: ScoreResultRepository;
  readonly openaiMetadata: OpenAIRequestMetadataRepository;
  readonly diagnostics: DiagnosticArtifactRepository;
  readonly applicationMetadata: ApplicationMetadataRepository;

  // Run a block of repository writes inside a single transaction. The block
  // receives a Repositories instance bound to the transaction; every call inside
  // sees the same `tx` handle and participates in the same savepoint.
  transact<T>(fn: (repos: Repositories) => T): T;
}
```

The `Repositories` facade is the primary way downstream tasks (TASK-005 through TASK-017) will obtain repositories. It owns the `RepositoryContext` and exposes one sub-repository per file. The `transact(...)` method lets callers compose cross-repository writes atomically (e.g., "create a new active profile, then write a profile_conflict row, then insert an OpenAI request metadata record") inside a single transaction.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/persistence/transactions.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../src/persistence/connection.js';
import { Repositories } from '../../src/persistence/repositories/index.js';
import { withTransaction } from '../../src/persistence/transactions.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

describe('withTransaction', () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-tx-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('commits when the block returns normally', async () => {
    const repos = new Repositories({ db: connection.db });
    const result = await withTransaction(connection, async (tx) => {
      const txRepos = new Repositories({ db: tx });
      const id = await txRepos.profileSources.insert({
        sourceType: 'pdf',
        originalFilename: 'a.pdf', originalAbsolutePath: '/a.pdf',
        storedPath: '/opt/a.pdf', mimeType: 'application/pdf', fileSize: 1,
        sha256: 'a'.repeat(64), importTimestamp: '2026-08-05T10:00:00.000Z',
      });
      return id;
    });
    expect(await repos.profileSources.findById(result)).not.toBeNull();
  });

  it('rolls back when the block throws', async () => {
    const repos = new Repositories({ db: connection.db });
    await expect(
      withTransaction(connection, async (tx) => {
        const txRepos = new Repositories({ db: tx });
        await txRepos.profileSources.insert({
          sourceType: 'pdf',
          originalFilename: 'a.pdf', originalAbsolutePath: '/a.pdf',
          storedPath: '/opt/a.pdf', mimeType: 'application/pdf', fileSize: 1,
          sha256: 'b'.repeat(64), importTimestamp: '2026-08-05T10:00:00.000Z',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repos.profileSources.findBySha256('b'.repeat(64))).toBeNull();
  });
});

describe('Repositories.transact', () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-repos-transact-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('composes writes across multiple repositories atomically', async () => {
    const repos = new Repositories({ db: connection.db });
    const runId = await repos.transact(async (txRepos) => {
      const { runId } = await txRepos.pipelineRuns.createRunWithSearches(
        {
          startTimestamp: '2026-08-05T10:00:00.000Z',
          configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h', applicationVersion: '0.1.0',
        },
        [],
      );
      await txRepos.applicationMetadata.set('lastRunId', String(runId), '2026-08-05T10:00:00.000Z');
      return runId;
    });
    expect(await repos.applicationMetadata.get('lastRunId')).not.toBeNull();
  });

  it('rolls back all writes when the block throws', async () => {
    const repos = new Repositories({ db: connection.db });
    await expect(
      repos.transact(async (txRepos) => {
        await txRepos.pipelineRuns.createRunWithSearches(
          {
            startTimestamp: '2026-08-05T10:00:00.000Z',
            configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h', applicationVersion: '0.1.0',
          },
          [],
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow();
    expect(await repos.pipelineRuns.listRuns()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/transactions.test.ts
```

Expected: FAIL — modules not yet created.

- [ ] **Step 3: Implement `src/persistence/transactions.ts`**

```ts
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { DatabaseConnection } from './connection.js';
import type { Schema } from './schema.js';

export type DrizzleTransaction = Parameters<
  Parameters<BetterSQLite3Database<Schema>['transaction']>[0]
>[0];

export function withTransaction<T>(
  connection: DatabaseConnection,
  fn: (tx: DrizzleTransaction) => Promise<T> | T,
): Promise<T> | T {
  return connection.db.transaction(async (tx) => fn(tx));
}
```

Notes:

- The `withTransaction` wrapper exists so callers don't need to import `DrizzleTransaction` directly. It also serves as a documentation seam: SPEC §23.5 transaction groups are always expressed as `withTransaction` blocks at the application layer.
- Because `better-sqlite3` is synchronous, the callback can be synchronous. We accept `Promise<T> | T` so callers can use `async` repos uniformly.

- [ ] **Step 4: Implement `src/persistence/repositories/index.ts`**

```ts
import type { DatabaseConnection } from '../connection.js';
import { withTransaction, type DrizzleTransaction } from '../transactions.js';
import { ApplicationMetadataRepository } from './application-metadata.js';
import { DiagnosticArtifactRepository } from './diagnostics.js';
import { FilterConfigurationRepository } from './filter-configurations.js';
import { FilterResultRepository } from './filter-results.js';
import { JobRepository } from './jobs.js';
import { OpenAIRequestMetadataRepository } from './openai-metadata.js';
import { PipelineRunRepository } from './pipeline-runs.js';
import { ProfileSourceRepository } from './profile-sources.js';
import { ProfileVersionRepository } from './profile-versions.js';
import { ScoreResultRepository } from './score-results.js';
import type { RepositoryContext } from './types.js';

export class Repositories {
  readonly profileSources: ProfileSourceRepository;
  readonly profileVersions: ProfileVersionRepository;
  readonly filterConfigurations: FilterConfigurationRepository;
  readonly pipelineRuns: PipelineRunRepository;
  readonly jobs: JobRepository;
  readonly filterResults: FilterResultRepository;
  readonly scoreResults: ScoreResultRepository;
  readonly openaiMetadata: OpenAIRequestMetadataRepository;
  readonly diagnostics: DiagnosticArtifactRepository;
  readonly applicationMetadata: ApplicationMetadataRepository;
  private readonly ctx: RepositoryContext;

  constructor(ctx: RepositoryContext) {
    this.ctx = ctx;
    this.profileSources = new ProfileSourceRepository(ctx);
    this.profileVersions = new ProfileVersionRepository(ctx);
    this.filterConfigurations = new FilterConfigurationRepository(ctx);
    this.pipelineRuns = new PipelineRunRepository(ctx);
    this.jobs = new JobRepository(ctx);
    this.filterResults = new FilterResultRepository(ctx);
    this.scoreResults = new ScoreResultRepository(ctx);
    this.openaiMetadata = new OpenAIRequestMetadataRepository(ctx);
    this.diagnostics = new DiagnosticArtifactRepository(ctx);
    this.applicationMetadata = new ApplicationMetadataRepository(ctx);
  }

  /**
   * Run a block of repository writes inside a single transaction. The block
   * receives a Repositories instance bound to the transaction; every call inside
   * sees the same `tx` handle and participates in the same savepoint.
   */
  transact<T>(fn: (repos: Repositories) => Promise<T> | T): Promise<T> | T {
    return this.ctx.db.transaction((tx: DrizzleTransaction) => {
      const txRepos = new Repositories({ db: tx });
      return fn(txRepos);
    });
  }
}

export function createRepositories(connection: DatabaseConnection): Repositories {
  return new Repositories({ db: connection.db });
}

export {
  ApplicationMetadataRepository,
  DiagnosticArtifactRepository,
  FilterConfigurationRepository,
  FilterResultRepository,
  JobRepository,
  OpenAIRequestMetadataRepository,
  PipelineRunRepository,
  ProfileSourceRepository,
  ProfileVersionRepository,
  ScoreResultRepository,
};
export type { RepositoryContext, DrizzleDB } from './types.js';
```

> **Implementation note:** The `transact` method uses the facade's private `ctx` field to obtain the underlying Drizzle database. Calling a sub-repository's private `ctx` would break encapsulation; the facade holds the canonical context and forwards it to every sub-repository at construction time.

- [ ] **Step 5: Re-run the tests**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/transactions.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 6: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/transactions.ts src/persistence/repositories/index.ts tests/persistence/transactions.test.ts
git commit -m "feat(persistence): add Repositories facade and transaction helpers"
```

---

### Task 13: Public re-exports and a cross-repository integration test

**Files:**

- Modify: `src/persistence/index.ts`
- Create: `tests/persistence/repositories/integration.test.ts`

**Interfaces:**

The public `src/persistence/index.ts` grows to expose the new repositories, identifiers, and transaction helpers. Downstream tasks (TASK-005+) consume only `src/persistence/index.ts`; they never reach into `src/persistence/repositories/*.ts` directly.

**Steps:**

- [ ] **Step 1: Update `src/persistence/index.ts`**

```ts
export {
  DatabaseError,
  MigrationError,
  ApplicationError,
  ExitCode,
} from './errors.js';
export {
  createDatabaseConnection,
  type DatabaseConnection,
} from './connection.js';
export {
  runMigrations,
  type MigrationReport,
  type RunMigrationsOptions,
} from './migrations.js';
export {
  initializeDatabase,
  type DatabaseHandle,
  type InitializeDatabaseOptions,
} from './database.js';
export { schema, type Schema } from './schema.js';

// TASK-004 additions
export {
  InvalidIdentifierError,
} from './identifier-errors.js';
export {
  formatId,
  resolveId,
  resolveJobIdentifier,
  parsePrefixedId,
  IDENTIFIER_PREFIXES,
  JOB_PREFIX,
  NUMERIC_JOB_PATTERN,
  type IdentifierKind,
  type JobIdentifierResolution,
} from './identifiers.js';
export { RecordNotFoundError } from './repository-errors.js';
export {
  Repositories,
  createRepositories,
  ApplicationMetadataRepository,
  DiagnosticArtifactRepository,
  FilterConfigurationRepository,
  FilterResultRepository,
  JobRepository,
  OpenAIRequestMetadataRepository,
  PipelineRunRepository,
  ProfileSourceRepository,
  ProfileVersionRepository,
  ScoreResultRepository,
  type RepositoryContext,
  type DrizzleDB,
} from './repositories/index.js';
export { withTransaction, type DrizzleTransaction } from './transactions.js';
```

- [ ] **Step 2: Write the cross-repository integration test**

Create `tests/persistence/repositories/integration.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { Repositories } from '../../../src/persistence/repositories/index.js';
import { formatId, resolveId, resolveJobIdentifier, InvalidIdentifierError } from '../../../src/persistence/identifiers.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

describe('repository integration + identifier round-trip', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repos: Repositories;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-integration-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repos = new Repositories({ db: connection.db });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('runs a full lifecycle: source → profile → filter config → run → job → filter result → score result', async () => {
    const sourceId = await repos.profileSources.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf', originalAbsolutePath: '/tmp/cv.pdf',
      storedPath: '/opt/cv.pdf', mimeType: 'application/pdf', fileSize: 100,
      sha256: 'a'.repeat(64), importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    const profileId = await repos.profileVersions.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: { headline: 'Engineer' },
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await repos.profileVersions.approve(profileId, {
      approvedAt: '2026-08-05T10:01:00.000Z',
      supersededAt: '2026-08-05T10:01:00.000Z',
    });
    const filterConfigId = await repos.filterConfigurations.insert({
      schemaVersion: 1, contentHash: 'cfg-hash', configJson: { excludedCompanies: [] },
      createdAt: '2026-08-05T10:00:00.000Z', active: true,
    });
    const { runId, searchIds } = await repos.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'cfg-hash',
        applicationVersion: '0.1.0', profileVersionId: profileId, filterConfigVersionId: filterConfigId,
      },
      [{
        pipelineRunId: 0, searchQuery: 'q', locationName: 'L', geoId: '1',
        generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
        startTimestamp: '2026-08-05T10:00:00.000Z',
      }],
    );
    const searchId = searchIds[0]!;

    const { jobId } = await repos.jobs.recordNewJob({
      job: {
        sourceJobId: '123456789',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        title: 'Engineer', company: 'Acme', location: 'Rotterdam', description: 'desc',
        successfulMethod: 'search_detail_panel',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0, pipelineRunId: runId, searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true, currentExtractionState: 'complete', extractionAttempted: true,
        skipReason: null,
      },
    });

    const filterResultId = await repos.filterResults.activateResult({
      jobId, pipelineRunId: runId, filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash', profileVersionId: profileId, profileHash: 'h1',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-A', timestamp: '2026-08-05T10:00:00.000Z',
      overallOutcome: 'accepted', rulesEvaluated: ['r1'], rulesPassed: ['r1'], rulesFailed: [],
    });
    const scoreResultId = await repos.scoreResults.activateResult({
      jobId, pipelineRunId: runId, filterResultId,
      fingerprint: 'fp-B', timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1', rubricVersion: 'r1', model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [{ name: 'skills', value: 0.8 }],
      overallScore: 0.8, success: true,
    });
    await repos.openaiMetadata.insert({
      operationType: 'job_scoring',
      relatedEntityType: 'score_result', relatedEntityId: scoreResultId,
      inputHashes: [{ jobId }], promptVersion: 'p1', structuredOutputSchemaVersion: 1,
      model: 'gpt-5.6-sol', reasoningEffort: 'medium',
      configJson: {}, attemptCount: 1,
      startTimestamp: '2026-08-05T10:00:00.000Z', success: true,
    });
    await repos.diagnostics.insert({
      pipelineRunId: runId,
      artifactType: 'screenshot',
      storedPath: '/opt/diag.png', relativePath: 'run-1/screenshot.png',
      mimeType: 'image/png', fileSize: 100,
      createdAt: '2026-08-05T10:00:00.000Z',
    });

    // Final statistics
    await repos.pipelineRuns.finalizeRunStats(runId, {
      status: 'completed',
      endTimestamp: '2026-08-05T10:30:00.000Z',
      searchesPlanned: 1, searchesCompleted: 1,
      jobsDiscovered: 1, jobsAccepted: 1, jobsRejected: 0,
    });

    // Sanity: identifier round-trip
    expect(formatId('job', jobId)).toBe(`job_${jobId}`);
    expect(resolveId('job', `job_${jobId}`)).toBe(jobId);
    expect(resolveJobIdentifier('123456789')).toEqual({ sourceJobId: '123456789' });
    expect(() => resolveId('job', '123456789')).toThrow(InvalidIdentifierError);

    // Sanity: persisted history
    const finalRun = await repos.pipelineRuns.findRunById(runId);
    expect(finalRun?.status).toBe('completed');
    expect(finalRun?.jobsAccepted).toBe(1);
    const activeScore = await repos.scoreResults.findActiveByJob(jobId, 'fp-B');
    expect(activeScore?.overallScore).toBe(0.8);
  });
});
```

- [ ] **Step 3: Run the integration test**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/repositories/integration.test.ts
```

Expected: PASS — 1 test pass.

- [ ] **Step 4: Lint, typecheck, and commit**

```bash
pnpm lint
pnpm typecheck
git add src/persistence/index.ts tests/persistence/repositories/integration.test.ts
git commit -m "feat(persistence): expose repositories and identifiers through the persistence index"
```

---

### Task 14: Final verification and completion check

**Files:** No new files; this is a verification + recording task.

**Steps:**

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass. The total count should be `existing-tests + 12 new repository test files + transactions + integration + identifiers + identifier-errors + repository-errors + codecs`. From the TASK-003 baseline (63 tests), this task should add roughly 50–60 new tests across the 12 repository files.

- [ ] **Step 2: Run typecheck and build**

```bash
pnpm typecheck
pnpm build
```

Expected: both exit 0.

- [ ] **Step 3: Run lint and format check**

```bash
pnpm lint
pnpm format:check
```

Expected: both exit 0.

- [ ] **Step 4: Verify no domain leakage**

Run a project-wide grep to confirm repositories do not import CLI, browser, OpenAI, or logging modules:

```bash
rg -n 'from .(commander|@inquirer|playwright|openai|pino)' src/persistence || echo "OK: no forbidden imports"
```

Expected: `OK: no forbidden imports`.

- [ ] **Step 5: Verify identifier prefixes match SPEC §32**

```bash
pnpm vitest run --config vitest.config.ts tests/persistence/identifiers.test.ts
```

Expected: PASS — confirms the prefix table matches the SPEC.

- [ ] **Step 6: Smoke-check the CLI still runs**

```bash
node dist/cli.js --help
node dist/cli.js paths
```

Expected: both exit 0 (TASK-002 commands unchanged).

- [ ] **Step 7: Update the task document with implementation results**

Append an "Implementation results" section to `docs/tasks/TASK-004-persistence-repositories-identifiers.md` mirroring the structure of TASK-003's results section:

- Verification date and environment
- Branch name (per `GIT.md`)
- Dependency versions used (no new direct deps)
- List of commits with one-line messages
- Test inventory (file count and test count)
- Smoke-check outputs
- Any deviations from the plan

- [ ] **Step 8: Stop before starting TASK-005**

Per `AGENTS.md` §2, do not begin TASK-005 (diagnostics and artifact management) until the user explicitly approves the next task. Open a separate session for review per `GIT.md` and the established workflow.

---

## Summary

This plan introduces 11 new test files, 11 new repository files, 2 new error modules, 1 pure identifier module, 1 shared types/codec module, 1 transaction helper, 1 facade class, and 1 integration test — built strictly on top of the existing TASK-003 schema and TASK-002 infrastructure. No new dependencies are introduced. Every repository stays within the persistence domain boundary; CLI, browser, OpenAI, and logging modules are not imported. SPEC §23.5 transaction groups are enforced by per-repository methods that Drizzle-transact the related writes. SPEC §32 identifier rules are encoded in a pure module that downstream tasks reuse at the CLI boundary. The active-approved-profile and active-filter-configuration invariants are enforced by the schema's partial unique indexes plus the repo's `approve()` / `activate()` methods. History is preserved by every repository — no deletes, no in-place mutation of approved rows. The plan produces atomic, well-tested, and reviewable commits (one per repository cluster) so reviewers can land the work in stages and the next task can build on a stable foundation.

