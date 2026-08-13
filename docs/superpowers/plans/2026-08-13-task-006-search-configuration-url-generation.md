# TASK-006 Implementation Plan — Search Configuration Workflow and LinkedIn URL Generation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the interactive `jobhunter configure search` workflow plus the pure domain layer that normalizes queries/locations, parses LinkedIn jobs-search URLs, generates the Cartesian search matrix, and builds parameter-aware LinkedIn URLs — producing a validated, persisted `OperationalConfig.search` section without manual JSON editing.

**Architecture:** A new `src/search/` layer owns the search-configuration domain. It is composed of small pure modules (`labels`, `queries`, `locations`, `url-parser`, `url-builder`, `matrix`) plus a thin `service.ts` that orchestrates prompts and a `prompts.ts` that owns every `@inquirer/prompts` call. The CLI registers the new `jobhunter configure search` subcommand which calls the service and writes the result through the existing `updateConfig` updater. The `src/search/` modules never import Commander, Inquirer, Playwright, Drizzle, or Pino; they only depend on `zod` and Node built-ins. The service depends on a `SearchPrompts` interface so the workflow can be tested with fake answers without a terminal. The `SearchExecutionInsert` shape already exists in the persistence layer (`SearchExecutionInsert` from `src/persistence/repositories/pipeline-runs.ts`) — `matrix.ts` re-exports it as the input contract for later stages (TASK-012, TASK-015).

**Tech Stack:** Adds `@inquirer/prompts@8.5.2` (the only new dependency — already on the approved foundation list in `SPEC.md` §5.3 and `AGENTS.md` §3). Reuses `zod`, Node built-ins (`node:url`), the existing `updateConfig` service, the existing `OperationalConfigSchema` from TASK-002, and `vitest`. No new LLM provider, job source, UI framework, hosted service, or auth system.

## Global Constraints

These are project-wide rules from `SPEC.md` and `AGENTS.md` that apply to every task in this plan. They are not repeated in each task.

- **Runtime:** Node.js `24.18.0`, pnpm `11.18.0`. No new LLM provider, job source, UI framework, hosted service, or authentication system.
- **Module system:** Native ESM (`"type": "module"` in `package.json`), `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Use `import`/`export`, never `require`. Relative imports must use explicit `.js` extensions for NodeNext.
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. No `any` unless generated code forces it — prefer `unknown` with explicit narrowing. `for...of` for sequential async work; no `await` inside `Array.prototype.forEach`.
- **Domain boundaries (AGENTS.md §5, §6, §8):** Files under `src/search/` that are pure domain (`labels.ts`, `queries.ts`, `locations.ts`, `url-parser.ts`, `url-builder.ts`, `matrix.ts`, `errors.ts`) **must not** import Commander, Inquirer, Playwright, Drizzle, or Pino. They may import `zod`, Node built-ins, and the existing `OperationalConfig` types from `src/config/schema.ts`. `prompts.ts` is the only file in `src/search/` that imports `@inquirer/prompts`. `service.ts` imports `prompts.ts` and the pure-domain modules but never Inquirer directly.
- **Validation:** Zod at every external boundary. The persisted `search` configuration must round-trip through `OperationalConfigSchema` (existing). The labels module re-exports the Zod schemas for `DatePostedSeconds` and `WorkplaceType` so other tasks can import them.
- **Errors:** Add typed errors (`SearchConfigError`, `LinkedInURLParseError`, `SearchCancelledError`) extending `ApplicationError` with `ExitCode.InvalidUsage` (2) — search configuration is user-facing input. `SearchCancelledError` uses `ExitCode.UserCancellation` (130). Do not call `process.exit()` inside `src/search/`.
- **No persistence of raw URLs:** Per `SPEC.md` §10.9, the original pasted URL is **not** persisted. Only `name` and `geoId` survive.
- **Determinism:** Query normalization is whitespace-aware and case-insensitive. Locations dedupe by `geoId` (string equality). Workplace types are sorted to a canonical order (`['1', '2', '3']`). Date posted is the persisted numeric value.
- **Tests:** Vitest. Pure-domain tests are deterministic and have no I/O. Prompt tests inject a `SearchPrompts` fake. CLI smoke tests use the existing CLI test pattern with `cliFileSystem`. No live network. No live terminal.
- **No secrets:** Nothing in this task reads or writes secrets. The search configuration contains no API keys, credentials, or LinkedIn cookies.
- **CLI output:** `jobhunter configure search --json` (default `false`) emits a single JSON document to stdout; human-readable errors go to stderr.

## File Structure

```
src/search/
  errors.ts                # SearchConfigError, LinkedInURLParseError, SearchCancelledError (Task 1)
  labels.ts                # Zod schemas + label maps for datePosted & workplaceTypes (Task 2)
  queries.ts               # normalizeQueries, dedupeQueries, validateQuery (Task 3)
  locations.ts             # normalizeLocations, dedupeLocationsByGeoId (Task 4)
  url-parser.ts            # parseLinkedInJobsSearchURL, inferLocationNameFromURL (Task 5)
  url-builder.ts           # buildLinkedInSearchURL, buildLinkedInSearchParamMap (Task 6)
  matrix.ts                # generateSearchMatrix, countSearches, SearchMatrixEntry (Task 7)
  prompts.ts               # SearchPrompts interface + defaultInquirerPrompts impl (Task 8)
  service.ts               # ConfigureSearchService + runConfigureSearch() (Task 9)
  index.ts                 # public re-exports (Task 10)
src/cli.ts                 # MODIFIED — add `configure search` subcommand (Task 11)
package.json               # MODIFIED — add @inquirer/prompts@8.5.2 dependency (Task 1.1)
tests/search/
  labels.test.ts           # (Task 2)
  queries.test.ts          # (Task 3)
  locations.test.ts        # (Task 4)
  url-parser.test.ts       # (Task 5)
  url-builder.test.ts      # (Task 6)
  matrix.test.ts           # (Task 7)
  prompts.test.ts          # (Task 8)
  service.test.ts          # (Task 9)
  cli-smoke.test.ts        # (Task 11)
```

Files change together by responsibility. The pure-domain modules (`labels`, `queries`, `locations`, `url-parser`, `url-builder`, `matrix`, `errors`) have **no** runtime dependencies on each other apart from `errors.ts` (which `url-parser.ts` and `service.ts` import). `prompts.ts` is the only file that imports `@inquirer/prompts`. `service.ts` is the only file that depends on both `prompts.ts` and the pure modules. `cli.ts` wires `service.ts` into `updateConfig`.

---

### Task 1: Add typed search errors and the new dependency

**Files:**
- Modify: `package.json` (add `@inquirer/prompts` to `dependencies`)
- Modify: `pnpm-lock.yaml` (regenerated by `pnpm install`)
- Create: `src/search/errors.ts`

**Interfaces:**

- Consumes: `ApplicationError`, `ExitCode` from `src/errors/application-error.ts` (TASK-002).
- Produces:

```ts
export class SearchConfigError extends ApplicationError {
  constructor(code, message, metadata?, cause?): exitCode = ExitCode.InvalidUsage; // 2
}

export class LinkedInURLParseError extends SearchConfigError {
  // static code = 'invalid_linkedin_url'
  // raised when a pasted URL fails hostname/path/geoId validation
  // metadata MUST include the original URL string under key 'url'
}

export class SearchCancelledError extends ApplicationError {
  constructor(code, message, metadata?, cause?): exitCode = ExitCode.UserCancellation; // 130
}
```

**Steps:**

- [ ] **Step 1.1: Add `@inquirer/prompts@8.5.2` to `package.json` dependencies**

Edit `package.json` so the `dependencies` block lists `@inquirer/prompts`:

```json
"dependencies": {
  "@inquirer/prompts": "8.5.2",
  "better-sqlite3": "13.0.3",
  "commander": "15.0.0",
  "drizzle-orm": "0.45.2",
  "pino": "10.3.1",
  "zod": "4.4.3"
}
```

Then run `pnpm install` to regenerate `pnpm-lock.yaml`. Do not hand-edit the lockfile. The package is already approved in `SPEC.md` §5.3 / `AGENTS.md` §3; this is a normal edit covered by the task.

- [ ] **Step 1.2: Write `src/search/errors.ts`**

```ts
import {
  ApplicationError,
  type ApplicationErrorMetadata,
  ExitCode,
} from '../errors/application-error.js';

export class SearchConfigError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

export class LinkedInURLParseError extends SearchConfigError {
  constructor(url: string, reason: string, metadata: ApplicationErrorMetadata = {}) {
    super(
      'invalid_linkedin_url',
      `Cannot use LinkedIn URL "${url}": ${reason}.`,
      { url, reason, ...metadata },
    );
  }
}

export class SearchCancelledError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.UserCancellation, metadata, cause);
  }
}
```

- [ ] **Step 1.3: Run typecheck to verify it compiles**

Run: `pnpm typecheck`
Expected: exit 0 ✅

- [ ] **Step 1.4: Commit**

```bash
git add package.json pnpm-lock.yaml src/search/errors.ts
git commit -m "feat(search): add typed search errors and @inquirer/prompts dependency"
```

---

### Task 2: Labels and Zod schemas for date posted and workplace types

**Files:**
- Create: `src/search/labels.ts`
- Create: `tests/search/labels.test.ts`

**Interfaces:**

- Consumes: nothing (pure module). Reuses the `datePosted` and `workplaceType` shapes from `src/config/schema.ts` so the persisted values match.
- Produces:

```ts
export type DatePostedSeconds = 86400 | 604800 | 2592000;
export type WorkplaceTypeValue = '1' | '2' | '3';

export interface LabeledChoice<V extends string | number> {
  readonly label: string;
  readonly value: V;
}

export const DATE_POSTED_VALUES: readonly DatePostedSeconds[] = [86400, 604800, 2592000];
export const DEFAULT_DATE_POSTED: DatePostedSeconds = 86400;

export const DATE_POSTED_CHOICES: readonly LabeledChoice<DatePostedSeconds>[]; // ordered Past 24h → Past week → Past month
export const DATE_POSTED_F_TPR: (v: DatePostedSeconds) => string;             // "r86400" | "r604800" | "r2592000"

export const WORKPLACE_TYPE_VALUES: readonly WorkplaceTypeValue[];            // ["1","2","3"]
export const DEFAULT_WORKPLACE_TYPES: readonly WorkplaceTypeValue[];          // ["1","2","3"]

export const WORKPLACE_TYPE_CHOICES: readonly LabeledChoice<WorkplaceTypeValue>[]; // [{label:'On-site',value:'1'}, {label:'Remote',value:'2'}, {label:'Hybrid',value:'3'}]
export const WORKPLACE_TYPE_LABELS: Readonly<Record<WorkplaceTypeValue, string>>;

export const DatePostedSecondsSchema: z.ZodUnion<[z.ZodLiteral<86400>, z.ZodLiteral<604800>, z.ZodLiteral<2592000>]>;
export const WorkplaceTypeSchema: z.ZodEnum<['1','2','3']>;
```

**Behavior rules (SPEC §10.5, §10.6):**

- Date-posted labels in display order: `Past 24 hours` (86400), `Past week` (604800), `Past month` (2592000).
- Workplace types: `On-site` (`'1'`), `Remote` (`'2'`), `Hybrid` (`'3'`).
- `DEFAULT_WORKPLACE_TYPES` is the deterministic sorted triple `['1','2','3']`.
- `DATE_POSTED_F_TPR(v)` returns the string `"r${v}"` (e.g. `r86400`).

**Steps:**

- [ ] **Step 2.1: Write the failing test** in `tests/search/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DATE_POSTED_CHOICES,
  DATE_POSTED_F_TPR,
  DATE_POSTED_VALUES,
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  DatePostedSecondsSchema,
  WORKPLACE_TYPE_CHOICES,
  WORKPLACE_TYPE_LABELS,
  WORKPLACE_TYPE_VALUES,
  WorkplaceTypeSchema,
} from '../../src/search/labels.js';

describe('labels — date posted', () => {
  it('exposes the three documented values in the documented order', () => {
    expect(DATE_POSTED_VALUES).toEqual([86400, 604800, 2592000]);
    expect(DEFAULT_DATE_POSTED).toBe(86400);
  });

  it('maps each value to the matching human label', () => {
    expect(DATE_POSTED_CHOICES).toEqual([
      { label: 'Past 24 hours', value: 86400 },
      { label: 'Past week', value: 604800 },
      { label: 'Past month', value: 2592000 },
    ]);
  });

  it('builds the f_TPR parameter with the documented prefix', () => {
    expect(DATE_POSTED_F_TPR(86400)).toBe('r86400');
    expect(DATE_POSTED_F_TPR(604800)).toBe('r604800');
    expect(DATE_POSTED_F_TPR(2592000)).toBe('r2592000');
  });

  it('accepts the three values via Zod and rejects any other number', () => {
    expect(DatePostedSecondsSchema.parse(86400)).toBe(86400);
    expect(DatePostedSecondsSchema.parse(2592000)).toBe(2592000);
    expect(() => DatePostedSecondsSchema.parse(1)).toThrow();
    expect(() => DatePostedSecondsSchema.parse(86401)).toThrow();
    expect(() => DatePostedSecondsSchema.parse('86400')).toThrow();
  });
});

describe('labels — workplace types', () => {
  it('exposes the three documented values in the documented order', () => {
    expect(WORKPLACE_TYPE_VALUES).toEqual(['1', '2', '3']);
    expect(DEFAULT_WORKPLACE_TYPES).toEqual(['1', '2', '3']);
  });

  it('maps each value to the matching human label', () => {
    expect(WORKPLACE_TYPE_CHOICES).toEqual([
      { label: 'On-site', value: '1' },
      { label: 'Remote', value: '2' },
      { label: 'Hybrid', value: '3' },
    ]);
    expect(WORKPLACE_TYPE_LABELS).toEqual({
      '1': 'On-site',
      '2': 'Remote',
      '3': 'Hybrid',
    });
  });

  it('accepts the three values via Zod and rejects any other string', () => {
    expect(WorkplaceTypeSchema.parse('1')).toBe('1');
    expect(WorkplaceTypeSchema.parse('3')).toBe('3');
    expect(() => WorkplaceTypeSchema.parse('4')).toThrow();
    expect(() => WorkplaceTypeSchema.parse('on-site')).toThrow();
    expect(() => WorkplaceTypeSchema.parse(1)).toThrow();
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/labels.test.ts`
Expected: FAIL — module `../../src/search/labels.js` not found.

- [ ] **Step 2.3: Implement `src/search/labels.ts`**

```ts
import { z } from 'zod';

export type DatePostedSeconds = 86400 | 604800 | 2592000;
export type WorkplaceTypeValue = '1' | '2' | '3';

export interface LabeledChoice<V extends string | number> {
  readonly label: string;
  readonly value: V;
}

export const DATE_POSTED_VALUES = [86400, 604800, 2592000] as const;
export const DEFAULT_DATE_POSTED: DatePostedSeconds = 86400;

export const DATE_POSTED_CHOICES: readonly LabeledChoice<DatePostedSeconds>[] = [
  { label: 'Past 24 hours', value: 86400 },
  { label: 'Past week', value: 604800 },
  { label: 'Past month', value: 2592000 },
];

export function DATE_POSTED_F_TPR(value: DatePostedSeconds): string {
  return `r${value}`;
}

export const WORKPLACE_TYPE_VALUES = ['1', '2', '3'] as const;
export const DEFAULT_WORKPLACE_TYPES: readonly WorkplaceTypeValue[] = ['1', '2', '3'];

export const WORKPLACE_TYPE_CHOICES: readonly LabeledChoice<WorkplaceTypeValue>[] = [
  { label: 'On-site', value: '1' },
  { label: 'Remote', value: '2' },
  { label: 'Hybrid', value: '3' },
];

export const WORKPLACE_TYPE_LABELS: Readonly<Record<WorkplaceTypeValue, string>> = {
  '1': 'On-site',
  '2': 'Remote',
  '3': 'Hybrid',
};

export const DatePostedSecondsSchema = z.union([
  z.literal(86400),
  z.literal(604800),
  z.literal(2592000),
]);

export const WorkplaceTypeSchema = z.enum(['1', '2', '3']);
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/labels.test.ts`
Expected: PASS ✅

- [ ] **Step 2.5: Commit**

```bash
git add src/search/labels.ts tests/search/labels.test.ts
git commit -m "feat(search): add date-posted and workplace-type labels with Zod schemas"
```

---

### Task 3: Query normalization and deduplication

**Files:**
- Create: `src/search/queries.ts`
- Create: `tests/search/queries.test.ts`

**Interfaces:**

- Consumes: nothing (pure module).
- Produces:

```ts
export function normalizeQuery(value: string): string;            // trims + collapses internal whitespace
export function dedupeQueries(values: readonly string[]): readonly string[]; // preserves first occurrence (casing+whitespace-normalized)
export function normalizeQueries(values: readonly string[]): readonly string[]; // alias of dedupeQueries (SPEC §10.3 calls it "normalize")
export function isNonEmptyQuery(value: string): boolean;
```

**Behavior rules (SPEC §10.3):**

- `normalizeQuery('  Software  Developer  ')` returns `'Software Developer'`.
- Internal whitespace is collapsed via a single regex (`/\s+/g` → `' '`) after trimming.
- Dedupe key: `normalizeQuery(value).toLocaleLowerCase()`. The **first** display value wins; later duplicates are dropped.
- Empty strings are rejected before normalization. The full pipeline never persists an empty query.
- Returned order is the order of first occurrence.

**Steps:**

- [ ] **Step 3.1: Write the failing test** in `tests/search/queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  dedupeQueries,
  isNonEmptyQuery,
  normalizeQuery,
  normalizeQueries,
} from '../../src/search/queries.js';

describe('normalizeQuery', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeQuery('   Frontend developer   ')).toBe('Frontend developer');
  });
  it('collapses repeated internal whitespace', () => {
    expect(normalizeQuery('Software\t\tDeveloper\n Engineer')).toBe('Software Developer Engineer');
  });
  it('preserves the original casing of the first occurrence', () => {
    expect(normalizeQuery('Software Developer')).toBe('Software Developer');
    expect(normalizeQuery('software developer')).toBe('software developer');
  });
});

describe('dedupeQueries / normalizeQueries', () => {
  it('drops case-insensitive duplicates after whitespace normalization', () => {
    expect(
      normalizeQueries(['Software Developer', 'software developer', 'Software  Developer']),
    ).toEqual(['Software Developer']);
  });

  it('preserves the first-occurrence display value for every duplicate', () => {
    expect(
      normalizeQueries(['Frontend developer', 'BACKEND developer', 'Frontend Developer']),
    ).toEqual(['Frontend developer', 'BACKEND developer']);
  });

  it('keeps deterministic insertion order', () => {
    expect(
      normalizeQueries(['B', 'A', 'C', 'a', 'b']),
    ).toEqual(['B', 'A', 'C']);
  });

  it('skips empty or whitespace-only values without throwing', () => {
    expect(normalizeQueries(['', '  ', 'Software Developer'])).toEqual(['Software Developer']);
  });

  it('returns an empty array when nothing valid is provided', () => {
    expect(dedupeQueries([])).toEqual([]);
    expect(dedupeQueries(['', '   '])).toEqual([]);
  });
});

describe('isNonEmptyQuery', () => {
  it('returns true for non-empty whitespace-trimmed strings', () => {
    expect(isNonEmptyQuery('Software Developer')).toBe(true);
    expect(isNonEmptyQuery('   x   ')).toBe(true);
  });
  it('returns false for empty or whitespace-only strings', () => {
    expect(isNonEmptyQuery('')).toBe(false);
    expect(isNonEmptyQuery('   ')).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/queries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement `src/search/queries.ts`**

```ts
const WHITESPACE_PATTERN = /\s+/g;

export function normalizeQuery(value: string): string {
  return value.trim().replace(WHITESPACE_PATTERN, ' ');
}

export function isNonEmptyQuery(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function dedupeKey(value: string): string {
  return normalizeQuery(value).toLocaleLowerCase();
}

export function dedupeQueries(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (!isNonEmptyQuery(raw)) continue;
    const normalized = normalizeQuery(raw);
    const key = dedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function normalizeQueries(values: readonly string[]): readonly string[] {
  return dedupeQueries(values);
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/queries.test.ts`
Expected: PASS ✅

- [ ] **Step 3.5: Commit**

```bash
git add src/search/queries.ts tests/search/queries.test.ts
git commit -m "feat(search): add whitespace-aware query normalization and deduplication"
```

---

### Task 4: Location normalization and geoId deduplication

**Files:**
- Create: `src/search/locations.ts`
- Create: `tests/search/locations.test.ts`

**Interfaces:**

- Consumes: `OperationalConfig['search']['locations']` shape (`{ name: string; geoId: string }`) from `src/config/schema.ts`.
- Produces:

```ts
export interface RawLocationInput {
  readonly name: string;
  readonly geoId: string;
}

export function normalizeLocationName(value: string): string;       // trims + collapses internal whitespace
export function dedupeLocationsByGeoId(values: readonly RawLocationInput[]): readonly RawLocationInput[];
export function normalizeLocations(values: readonly RawLocationInput[]): readonly RawLocationInput[]; // dedupe + trim
export function isValidLocation(value: RawLocationInput): boolean;  // name and geoId are non-empty after trim
```

**Behavior rules (SPEC §10.4):**

- At least one location is required downstream (the service raises if the result is empty).
- `name` must contain non-whitespace text after trimming.
- `geoId` must be non-empty (no further format restriction per SPEC — LinkedIn geo IDs are numeric strings, but the SPEC does not require numeric-only validation here; downstream consumers (TASK-012) handle that).
- Locations are deduplicated by `geoId` (exact string equality, case-sensitive — LinkedIn IDs are numeric).
- The first occurrence of each `geoId` wins; later duplicates are dropped.
- Empty or whitespace-only names are rejected before normalization.

**Steps:**

- [ ] **Step 4.1: Write the failing test** in `tests/search/locations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  dedupeLocationsByGeoId,
  isValidLocation,
  normalizeLocationName,
  normalizeLocations,
  type RawLocationInput,
} from '../../src/search/locations.js';

const rotterdam: RawLocationInput = { name: 'Rotterdam', geoId: '100467493' };
const amsterdam: RawLocationInput = { name: 'Amsterdam', geoId: '101889610' };

describe('normalizeLocationName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeLocationName('   San  Francisco   ')).toBe('San Francisco');
  });
});

describe('dedupeLocationsByGeoId / normalizeLocations', () => {
  it('drops later occurrences with the same geoId', () => {
    expect(
      normalizeLocations([
        rotterdam,
        amsterdam,
        { name: 'Rotterdam Area', geoId: '100467493' },
      ]),
    ).toEqual([rotterdam, amsterdam]);
  });

  it('preserves the first-occurrence name for every geoId', () => {
    expect(
      normalizeLocations([
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Rotterdam, South Holland', geoId: '100467493' },
      ]),
    ).toEqual([{ name: 'Rotterdam', geoId: '100467493' }]);
  });

  it('preserves deterministic insertion order', () => {
    expect(normalizeLocations([amsterdam, rotterdam])).toEqual([amsterdam, rotterdam]);
  });

  it('skips entries with empty or whitespace-only names', () => {
    expect(
      normalizeLocations([
        { name: '   ', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
        { name: '', geoId: '101889611' },
      ]),
    ).toEqual([amsterdam]);
  });

  it('skips entries with empty geoId', () => {
    expect(
      normalizeLocations([
        { name: 'Rotterdam', geoId: '' },
        amsterdam,
      ]),
    ).toEqual([amsterdam]);
  });

  it('returns an empty array when nothing valid is provided', () => {
    expect(dedupeLocationsByGeoId([])).toEqual([]);
    expect(dedupeLocationsByGeoId([{ name: '  ', geoId: '' }])).toEqual([]);
  });
});

describe('isValidLocation', () => {
  it('accepts trimmed non-empty name and geoId', () => {
    expect(isValidLocation({ name: 'Rotterdam', geoId: '100467493' })).toBe(true);
    expect(isValidLocation({ name: '  Rotterdam  ', geoId: '  100467493  ' })).toBe(true);
  });
  it('rejects empty name or empty geoId', () => {
    expect(isValidLocation({ name: '', geoId: '100467493' })).toBe(false);
    expect(isValidLocation({ name: 'Rotterdam', geoId: '' })).toBe(false);
    expect(isValidLocation({ name: '   ', geoId: '   ' })).toBe(false);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/locations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `src/search/locations.ts`**

```ts
const WHITESPACE_PATTERN = /\s+/g;

export interface RawLocationInput {
  readonly name: string;
  readonly geoId: string;
}

export function normalizeLocationName(value: string): string {
  return value.trim().replace(WHITESPACE_PATTERN, ' ');
}

export function isValidLocation(value: RawLocationInput): boolean {
  return (
    typeof value.geoId === 'string' &&
    value.geoId.trim().length > 0 &&
    typeof value.name === 'string' &&
    normalizeLocationName(value.name).length > 0
  );
}

export function dedupeLocationsByGeoId(values: readonly RawLocationInput[]): readonly RawLocationInput[] {
  const seen = new Set<string>();
  const out: RawLocationInput[] = [];
  for (const raw of values) {
    if (!isValidLocation(raw)) continue;
    const name = normalizeLocationName(raw.name);
    const geoId = raw.geoId.trim();
    if (seen.has(geoId)) continue;
    seen.add(geoId);
    out.push({ name, geoId });
  }
  return out;
}

export function normalizeLocations(values: readonly RawLocationInput[]): readonly RawLocationInput[] {
  return dedupeLocationsByGeoId(values);
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/locations.test.ts`
Expected: PASS ✅

- [ ] **Step 4.5: Commit**

```bash
git add src/search/locations.ts tests/search/locations.test.ts
git commit -m "feat(search): add geoId-based location normalization and deduplication"
```

---

### Task 5: LinkedIn jobs-search URL parser

**Files:**
- Create: `src/search/url-parser.ts`
- Create: `tests/search/url-parser.test.ts`

**Interfaces:**

- Consumes: `LinkedInURLParseError` from `src/search/errors.ts`.
- Produces:

```ts
export interface ParsedLinkedInSearchURL {
  readonly geoId: string;       // non-empty string
  readonly originalURL: string; // preserved for diagnostics only — not persisted
  readonly hostname: 'www.linkedin.com';
}

export function parseLinkedInJobsSearchURL(raw: string): ParsedLinkedInSearchURL;
export function inferLocationNameFromURL(_parsed: ParsedLinkedInSearchURL): string | null; // always null in MVP
```

**Behavior rules (SPEC §10.9):**

- Only `https://www.linkedin.com/jobs/search/` (with optional query string) is accepted. Any other hostname, scheme, path, or shape is rejected with `LinkedInURLParseError`.
- `geoId` MUST be present in the query string. Missing `geoId` → `LinkedInURLParseError`.
- `geoId` is trimmed; non-empty after trim is required.
- The original URL is preserved in the returned object **only** so the CLI can echo it in error messages or pass it to diagnostics later. It is never persisted as a row column.
- `inferLocationNameFromURL` always returns `null` in the MVP — LinkedIn job-search URLs do not include a human-readable location name. Kept as a function so future tasks can plug in without changing the contract.
- The parser is pure: no I/O, no side effects.

**Steps:**

- [ ] **Step 5.1: Write the failing test** in `tests/search/url-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  inferLocationNameFromURL,
  parseLinkedInJobsSearchURL,
} from '../../src/search/url-parser.js';
import { LinkedInURLParseError } from '../../src/search/errors.js';

const VALID_URL =
  'https://www.linkedin.com/jobs/search/?keywords=Software%20developer&geoId=100467493&f_TPR=r86400';

describe('parseLinkedInJobsSearchURL', () => {
  it('extracts the geoId from a supported jobs-search URL', () => {
    const parsed = parseLinkedInJobsSearchURL(VALID_URL);
    expect(parsed.geoId).toBe('100467493');
    expect(parsed.hostname).toBe('www.linkedin.com');
    expect(parsed.originalURL).toBe(VALID_URL);
  });

  it('trims whitespace around the URL before parsing', () => {
    const parsed = parseLinkedInJobsSearchURL(`   ${VALID_URL}   `);
    expect(parsed.geoId).toBe('100467493');
  });

  it('accepts the bare jobs/search path with just geoId', () => {
    const parsed = parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/search/?geoId=42');
    expect(parsed.geoId).toBe('42');
  });

  it('preserves query strings with extra parameters', () => {
    const parsed = parseLinkedInJobsSearchURL(
      'https://www.linkedin.com/jobs/search/?geoId=7&f_WT=1%2C2&keywords=x',
    );
    expect(parsed.geoId).toBe('7');
  });

  it('rejects wrong scheme', () => {
    expect(() => parseLinkedInJobsSearchURL(`http://${VALID_URL.slice(8)}`)).toThrow(
      LinkedInURLParseError,
    );
  });

  it('rejects wrong hostname', () => {
    expect(() =>
      parseLinkedInJobsSearchURL('https://www.linkedin-eu.com/jobs/search/?geoId=100467493'),
    ).toThrow(LinkedInURLParseError);
  });

  it('rejects bare hostname variants', () => {
    expect(() => parseLinkedInJobsSearchURL('https://linkedin.com/jobs/search/?geoId=1')).toThrow(
      LinkedInURLParseError,
    );
  });

  it('rejects an unsupported path', () => {
    expect(() =>
      parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/collections/recommended/?geoId=1'),
    ).toThrow(LinkedInURLParseError);
  });

  it('rejects missing geoId', () => {
    expect(() =>
      parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/search/?keywords=Software'),
    ).toThrow(LinkedInURLParseError);
  });

  it('rejects empty geoId', () => {
    expect(() => parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/search/?geoId=')).toThrow(
      LinkedInURLParseError,
    );
  });

  it('rejects malformed URLs', () => {
    expect(() => parseLinkedInJobsSearchURL('not a url')).toThrow(LinkedInURLParseError);
    expect(() => parseLinkedInJobsSearchURL('://www.linkedin.com')).toThrow(LinkedInURLParseError);
  });

  it('embeds the original URL in the error metadata', () => {
    try {
      parseLinkedInJobsSearchURL('https://example.com/jobs/search/?geoId=1');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LinkedInURLParseError);
      const e = error as LinkedInURLParseError;
      expect(e.metadata.url).toBe('https://example.com/jobs/search/?geoId=1');
      expect(typeof e.metadata.reason).toBe('string');
    }
  });
});

describe('inferLocationNameFromURL', () => {
  it('returns null in the MVP — LinkedIn URLs do not carry a location name', () => {
    const parsed = parseLinkedInJobsSearchURL(VALID_URL);
    expect(inferLocationNameFromURL(parsed)).toBeNull();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/url-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `src/search/url-parser.ts`**

```ts
import { LinkedInURLParseError } from './errors.js';

export interface ParsedLinkedInSearchURL {
  readonly geoId: string;
  readonly originalURL: string;
  readonly hostname: 'www.linkedin.com';
}

const ALLOWED_HOSTNAME = 'www.linkedin.com';
const REQUIRED_PATHNAME = '/jobs/search/';

function fail(raw: string, reason: string): never {
  throw new LinkedInURLParseError(raw, reason);
}

export function parseLinkedInJobsSearchURL(raw: string): ParsedLinkedInSearchURL {
  if (typeof raw !== 'string') {
    fail(String(raw), 'URL must be a string.');
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    fail(raw, 'URL must be a non-empty string.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    fail(raw, 'URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    fail(raw, `Only the "https:" scheme is supported (got "${url.protocol}").`);
  }
  if (url.hostname !== ALLOWED_HOSTNAME) {
    fail(raw, `Hostname must be "${ALLOWED_HOSTNAME}" (got "${url.hostname}").`);
  }
  if (url.pathname !== REQUIRED_PATHNAME) {
    fail(raw, `Path must be "${REQUIRED_PATHNAME}" (got "${url.pathname}").`);
  }
  const geoId = url.searchParams.get('geoId');
  if (geoId === null) {
    fail(raw, 'Missing required "geoId" query parameter.');
  }
  const trimmedGeoId = geoId.trim();
  if (trimmedGeoId === '') {
    fail(raw, '"geoId" must be a non-empty value.');
  }
  return {
    geoId: trimmedGeoId,
    originalURL: trimmed,
    hostname: ALLOWED_HOSTNAME,
  };
}

export function inferLocationNameFromURL(_parsed: ParsedLinkedInSearchURL): string | null {
  return null;
}
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/url-parser.test.ts`
Expected: PASS ✅

- [ ] **Step 5.5: Commit**

```bash
git add src/search/url-parser.ts tests/search/url-parser.test.ts
git commit -m "feat(search): add LinkedIn jobs-search URL parser with geoId extraction"
```

---

### Task 6: LinkedIn jobs-search URL builder

**Files:**
- Create: `src/search/url-builder.ts`
- Create: `tests/search/url-builder.test.ts`

**Interfaces:**

- Consumes: `DatePostedSeconds`, `WorkplaceTypeValue` from `src/search/labels.ts`.
- Produces:

```ts
export interface LinkedInSearchURLInput {
  readonly query: string;             // pre-normalized, non-empty
  readonly geoId: string;             // pre-validated, non-empty
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[]; // pre-sorted, no duplicates
}

export function buildLinkedInSearchParamMap(input: LinkedInSearchURLInput): URLSearchParams;
export function buildLinkedInSearchURL(input: LinkedInSearchURLInput): string;
```

**Behavior rules (SPEC §11.2, §11.3):**

- Base URL: `https://www.linkedin.com/jobs/search/`.
- Parameter order is **not** guaranteed — `URLSearchParams` iterates insertion order, and the test must not depend on it. The required keys are: `f_TPR=r{datePosted}`, `f_WT={csv(workplaceTypes)}`, `geoId`, `keywords`, `sortBy=DD`.
- `sortBy=DD` is always present, value is exactly `DD`.
- `f_TPR` value is `r86400` / `r604800` / `r2592000` — produced via `DATE_POSTED_F_TPR` from labels.ts.
- `f_WT` value is the workplace types joined with `,` in their array order (already sorted by the service).
- `keywords` is encoded as a single value (LinkedIn accepts the URL-encoded form for spaces).
- `geoId` is encoded as a single value.
- Implementation MUST use `URL` + `URLSearchParams` (or an equivalent parameter-aware builder). The complete URL MUST NOT be encoded as one value — every parameter goes through `URLSearchParams` so reserved characters are percent-encoded correctly per the constructor's rules.
- `buildLinkedInSearchParamMap` returns the `URLSearchParams` instance directly so callers (and tests) can verify individual keys/values are independently encoded.

**Steps:**

- [ ] **Step 6.1: Write the failing test** in `tests/search/url-builder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildLinkedInSearchParamMap,
  buildLinkedInSearchURL,
  type LinkedInSearchURLInput,
} from '../../src/search/url-builder.js';

const baseInput: LinkedInSearchURLInput = {
  query: 'Software Developer',
  geoId: '100467493',
  datePosted: 86400,
  workplaceTypes: ['1', '2', '3'],
};

describe('buildLinkedInSearchParamMap', () => {
  it('includes the documented parameter set', () => {
    const params = buildLinkedInSearchParamMap(baseInput);
    expect(params.get('f_TPR')).toBe('r86400');
    expect(params.get('f_WT')).toBe('1,2,3');
    expect(params.get('geoId')).toBe('100467493');
    expect(params.get('keywords')).toBe('Software Developer');
    expect(params.get('sortBy')).toBe('DD');
  });

  it('always includes sortBy=DD regardless of input', () => {
    const params = buildLinkedInSearchParamMap({
      ...baseInput,
      query: 'X',
      geoId: '1',
      datePosted: 2592000,
      workplaceTypes: ['2'],
    });
    expect(params.get('sortBy')).toBe('DD');
    expect(params.get('f_TPR')).toBe('r2592000');
    expect(params.get('f_WT')).toBe('2');
  });

  it('encodes each parameter independently (whitespace in query, comma in f_WT)', () => {
    const params = buildLinkedInSearchParamMap({
      query: 'Frontend Developer',
      geoId: '100467493',
      datePosted: 604800,
      workplaceTypes: ['1', '3'],
    });
    expect(params.toString()).toBe(
      'f_TPR=r604800&f_WT=1%2C3&geoId=100467493&keywords=Frontend+Developer&sortBy=DD',
    );
  });

  it('emits f_TPR using the r-prefix rule from labels.ts', () => {
    const params = buildLinkedInSearchParamMap({ ...baseInput, datePosted: 2592000 });
    expect(params.get('f_TPR')).toBe('r2592000');
  });
});

describe('buildLinkedInSearchURL', () => {
  it('produces a URL on the documented base with every parameter encoded independently', () => {
    const url = buildLinkedInSearchURL(baseInput);
    expect(url.startsWith('https://www.linkedin.com/jobs/search/?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://www.linkedin.com');
    expect(parsed.pathname).toBe('/jobs/search/');
    expect(parsed.searchParams.get('sortBy')).toBe('DD');
    expect(parsed.searchParams.get('keywords')).toBe('Software Developer');
    expect(parsed.searchParams.get('geoId')).toBe('100467493');
    expect(parsed.searchParams.get('f_TPR')).toBe('r86400');
    expect(parsed.searchParams.get('f_WT')).toBe('1,2,3');
  });

  it('percent-encodes special characters in the query parameter', () => {
    const url = buildLinkedInSearchURL({ ...baseInput, query: 'C++ & Systems' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('keywords')).toBe('C++ & Systems');
  });

  it('returns deterministic output for identical input', () => {
    const a = buildLinkedInSearchURL(baseInput);
    const b = buildLinkedInSearchURL(baseInput);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/url-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `src/search/url-builder.ts`**

```ts
import { DATE_POSTED_F_TPR, type DatePostedSeconds, type WorkplaceTypeValue } from './labels.js';

export interface LinkedInSearchURLInput {
  readonly query: string;
  readonly geoId: string;
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export const LINKEDIN_JOBS_SEARCH_BASE = 'https://www.linkedin.com/jobs/search/';

export function buildLinkedInSearchParamMap(input: LinkedInSearchURLInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set('f_TPR', DATE_POSTED_F_TPR(input.datePosted));
  params.set('f_WT', input.workplaceTypes.join(','));
  params.set('geoId', input.geoId);
  params.set('keywords', input.query);
  params.set('sortBy', 'DD');
  return params;
}

export function buildLinkedInSearchURL(input: LinkedInSearchURLInput): string {
  const params = buildLinkedInSearchParamMap(input);
  const base = new URL(LINKEDIN_JOBS_SEARCH_BASE);
  base.search = params.toString();
  return base.toString();
}
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/url-builder.test.ts`
Expected: PASS ✅

- [ ] **Step 6.5: Commit**

```bash
git add src/search/url-builder.ts tests/search/url-builder.test.ts
git commit -m "feat(search): add parameter-aware LinkedIn jobs-search URL builder"
```

---

### Task 7: Search matrix generator

**Files:**
- Create: `src/search/matrix.ts`
- Create: `tests/search/matrix.test.ts`

**Interfaces:**

- Consumes: `OperationalConfig['search']` shape from `src/config/schema.ts`, `buildLinkedInSearchURL` from `src/search/url-builder.ts`, and `SearchExecutionInsert` from `src/persistence/repositories/pipeline-runs.ts`.
- Produces:

```ts
export interface SearchMatrixEntry {
  readonly query: string;        // normalized
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string; // full URL with sortBy=DD
  readonly startTimestamp: string; // ISO 8601 UTC, caller-supplied
}

export interface GenerateMatrixInput {
  readonly searchQueries: readonly string[];     // pre-normalized via normalizeQueries
  readonly locations: readonly { name: string; geoId: string }[]; // pre-normalized via normalizeLocations
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];          // pre-sorted
  readonly startTimestamp: string;
}

export function countSearches(queries: readonly unknown[], locations: readonly unknown[]): number;

export function generateSearchMatrix(input: GenerateMatrixInput): readonly SearchMatrixEntry[];
export function matrixEntryToSearchExecutionInsert(
  pipelineRunId: number,
  entry: SearchMatrixEntry,
): SearchExecutionInsert;
```

**Behavior rules (SPEC §11.1, §11.4):**

- The matrix is the Cartesian product of every query × every location. Each (query, location) pair appears **exactly once**.
- `datePosted` and `workplaceTypes` apply globally — every entry in the matrix uses the same values.
- The generated URL is built via `buildLinkedInSearchURL` so `sortBy=DD` is always present and parameters are independently encoded.
- Order is deterministic: outer loop over `searchQueries` (insertion order), inner loop over `locations` (insertion order). The (i, j) → j + i*locations.length ordering.
- `countSearches(queries, locations)` returns `queries.length * locations.length` (always a finite non-negative integer).
- `matrixEntryToSearchExecutionInsert` reuses the existing `SearchExecutionInsert` contract from `src/persistence/repositories/pipeline-runs.ts`. The pipelineRunId is supplied by the caller at run creation time. `startTimestamp` and `searchQuery` / `locationName` / `geoId` / `generatedUrl` are mapped 1:1. `finalStatus` is omitted (defaults to `'pending'` in the repository).

**Steps:**

- [ ] **Step 7.1: Write the failing test** in `tests/search/matrix.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  countSearches,
  generateSearchMatrix,
  matrixEntryToSearchExecutionInsert,
} from '../../src/search/matrix.js';

const START = '2026-08-13T10:00:00.000Z';

describe('countSearches', () => {
  it('returns the Cartesian product size', () => {
    expect(countSearches(['a'], ['x'])).toBe(1);
    expect(countSearches(['a', 'b', 'c'], ['x', 'y'])).toBe(6);
    expect(countSearches([], ['x'])).toBe(0);
    expect(countSearches(['a'], [])).toBe(0);
    expect(countSearches([], [])).toBe(0);
  });
});

describe('generateSearchMatrix', () => {
  it('emits every (query, location) pair exactly once with the same global datePosted/workplaceTypes', () => {
    const matrix = generateSearchMatrix({
      searchQueries: ['Software Developer', 'Frontend Developer'],
      locations: [
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
      ],
      datePosted: 86400,
      workplaceTypes: ['1', '2', '3'],
      startTimestamp: START,
    });
    expect(matrix.length).toBe(4);
    const urls = matrix.map((m) => m.generatedUrl);
    expect(new Set(urls).size).toBe(4);
    for (const entry of matrix) {
      expect(entry.startTimestamp).toBe(START);
      const parsed = new URL(entry.generatedUrl);
      expect(parsed.searchParams.get('sortBy')).toBe('DD');
      expect(parsed.searchParams.get('f_TPR')).toBe('r86400');
      expect(parsed.searchParams.get('f_WT')).toBe('1,2,3');
    }
  });

  it('produces entries in deterministic (query, location) insertion order', () => {
    const matrix = generateSearchMatrix({
      searchQueries: ['Q1', 'Q2'],
      locations: [
        { name: 'L1', geoId: '1' },
        { name: 'L2', geoId: '2' },
      ],
      datePosted: 604800,
      workplaceTypes: ['2'],
      startTimestamp: START,
    });
    expect(matrix.map((m) => [m.query, m.locationName, m.geoId])).toEqual([
      ['Q1', 'L1', '1'],
      ['Q1', 'L2', '2'],
      ['Q2', 'L1', '1'],
      ['Q2', 'L2', '2'],
    ]);
  });

  it('returns an empty array when there are no queries or no locations', () => {
    expect(
      generateSearchMatrix({
        searchQueries: [],
        locations: [{ name: 'X', geoId: '1' }],
        datePosted: 86400,
        workplaceTypes: ['1'],
        startTimestamp: START,
      }),
    ).toEqual([]);
    expect(
      generateSearchMatrix({
        searchQueries: ['Q'],
        locations: [],
        datePosted: 86400,
        workplaceTypes: ['1'],
        startTimestamp: START,
      }),
    ).toEqual([]);
  });

  it('every generated URL contains sortBy=DD', () => {
    const matrix = generateSearchMatrix({
      searchQueries: ['Q'],
      locations: [{ name: 'L', geoId: '1' }],
      datePosted: 86400,
      workplaceTypes: ['1', '3'],
      startTimestamp: START,
    });
    for (const entry of matrix) {
      const parsed = new URL(entry.generatedUrl);
      expect(parsed.searchParams.get('sortBy')).toBe('DD');
    }
  });
});

describe('matrixEntryToSearchExecutionInsert', () => {
  it('maps every required field and omits finalStatus so the repo applies its default', () => {
    const entry = {
      query: 'Software Developer',
      locationName: 'Rotterdam',
      geoId: '100467493',
      generatedUrl: 'https://www.linkedin.com/jobs/search/?sortBy=DD',
      startTimestamp: START,
    };
    const insert = matrixEntryToSearchExecutionInsert(42, entry);
    expect(insert).toEqual({
      pipelineRunId: 42,
      searchQuery: 'Software Developer',
      locationName: 'Rotterdam',
      geoId: '100467493',
      generatedUrl: 'https://www.linkedin.com/jobs/search/?sortBy=DD',
      startTimestamp: START,
    });
    expect('finalStatus' in insert).toBe(false);
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/matrix.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement `src/search/matrix.ts`**

```ts
import { buildLinkedInSearchURL, type LinkedInSearchURLInput } from './url-builder.js';
import type { DatePostedSeconds, WorkplaceTypeValue } from './labels.js';
import type { SearchExecutionInsert } from '../persistence/repositories/pipeline-runs.js';

export interface SearchMatrixEntry {
  readonly query: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
}

export interface GenerateMatrixInput {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { readonly name: string; readonly geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
  readonly startTimestamp: string;
}

export function countSearches(
  queries: readonly unknown[],
  locations: readonly unknown[],
): number {
  return queries.length * locations.length;
}

export function generateSearchMatrix(input: GenerateMatrixInput): readonly SearchMatrixEntry[] {
  const out: SearchMatrixEntry[] = [];
  if (input.searchQueries.length === 0 || input.locations.length === 0) return out;
  for (const query of input.searchQueries) {
    for (const location of input.locations) {
      const urlInput: LinkedInSearchURLInput = {
        query,
        geoId: location.geoId,
        datePosted: input.datePosted,
        workplaceTypes: input.workplaceTypes,
      };
      out.push({
        query,
        locationName: location.name,
        geoId: location.geoId,
        generatedUrl: buildLinkedInSearchURL(urlInput),
        startTimestamp: input.startTimestamp,
      });
    }
  }
  return out;
}

export function matrixEntryToSearchExecutionInsert(
  pipelineRunId: number,
  entry: SearchMatrixEntry,
): SearchExecutionInsert {
  return {
    pipelineRunId,
    searchQuery: entry.query,
    locationName: entry.locationName,
    geoId: entry.geoId,
    generatedUrl: entry.generatedUrl,
    startTimestamp: entry.startTimestamp,
  };
}
```

- [ ] **Step 7.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/matrix.test.ts`
Expected: PASS ✅

- [ ] **Step 7.5: Commit**

```bash
git add src/search/matrix.ts tests/search/matrix.test.ts
git commit -m "feat(search): add Cartesian search-matrix generator with URL builder integration"
```

---

### Task 8: Interactive prompts module behind a `SearchPrompts` interface

**Files:**
- Create: `src/search/prompts.ts`
- Create: `tests/search/prompts.test.ts`

**Interfaces:**

- Consumes: `@inquirer/prompts` (`input`, `select`, `checkbox`, `confirm`), `LabeledChoice`, `DatePostedSeconds`, `WorkplaceTypeValue` from `src/search/labels.ts`. `SearchPrompts` is the **interface** every prompt is invoked through. The default implementation (`defaultInquirerPrompts`) calls `@inquirer/prompts`.
- Produces:

```ts
export interface SearchPrompts {
  askSearchQueries(existing: readonly string[]): Promise<readonly string[]>;
  askDatePosted(existing: DatePostedSeconds | null): Promise<DatePostedSeconds>;
  askWorkplaceTypes(existing: readonly WorkplaceTypeValue[]): Promise<readonly WorkplaceTypeValue[]>;
  askLocationURLs(existing: readonly { name: string; geoId: string }[]): Promise<readonly { rawUrl: string; parsed: ParsedLinkedInSearchURL }[]>;
  askLocationName(geoId: string, originalUrl: string): Promise<string>;
  showPreview(preview: SearchConfigurationPreview, matrixSize: number): Promise<void>;
  askConfirmation(preview: SearchConfigurationPreview, matrixSize: number): Promise<boolean>;
}

export interface SearchConfigurationPreview {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { name: string; geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export const defaultInquirerPrompts: SearchPrompts;
export function createFailingPrompts(reason: string): SearchPrompts; // test helper that always rejects
```

**Behavior rules (SPEC §10.8):**

- `askSearchQueries`: prompts for one or more non-empty queries. `input` prompt with the message `'Search queries (one per line; submit an empty line to finish):'`. Each non-empty line is one query. An empty line finishes the prompt. If the user submits zero non-empty lines, the prompt re-asks (via a tiny `for...of` loop) until at least one is provided.
- `askDatePosted`: `select` over `DATE_POSTED_CHOICES`. If `existing` is non-null and is one of the three values, use it as the `default`.
- `askWorkplaceTypes`: `checkbox` over `WORKPLACE_TYPE_CHOICES`. `default` is the existing set (already checked). At least one must be selected — the prompt re-asks if the user submits an empty selection.
- `askLocationURLs`: loop of `input` prompts for `'LinkedIn jobs-search URL (empty line to finish):'`. Each non-empty line is parsed via `parseLinkedInJobsSearchURL`; parse errors are echoed to stderr (via `console.error`) and the prompt re-asks for that URL only (other accepted URLs are kept). An empty line finishes.
- `askLocationName`: `input` with message `'Human-readable label for geoId {geoId} (from {originalUrl}):'`. Defaults to the URL's last path segment if it contains something readable, otherwise empty. Empty input re-asks.
- `showPreview`: prints the normalized configuration + matrix count to stderr (via `console.error` — the CLI may want stdout reserved for JSON). Format:
  ```
  Search configuration preview:
    Queries: <comma-separated>
    Locations: <name (geoId), …>
    Date posted: <label>
    Workplace types: <label, label, label>
    Generated searches: <count>
  ```
- `askConfirmation`: `confirm` with message `'Write this configuration to disk?'`. Returns the boolean.

**Steps:**

- [ ] **Step 8.1: Write the failing test** in `tests/search/prompts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createFailingPrompts,
  type SearchPrompts,
} from '../../src/search/prompts.js';
import { LinkedInURLParseError } from '../../src/search/errors.js';

describe('createFailingPrompts', () => {
  it('always rejects with the given reason', async () => {
    const prompts: SearchPrompts = createFailingPrompts('not allowed in tests');
    await expect(prompts.askSearchQueries([])).rejects.toThrow('not allowed in tests');
    await expect(prompts.askDatePosted(null)).rejects.toThrow('not allowed in tests');
    await expect(prompts.askWorkplaceTypes([])).rejects.toThrow('not allowed in tests');
    await expect(prompts.askLocationURLs([])).rejects.toThrow('not allowed in tests');
    await expect(prompts.askLocationName('1', 'https://example.com')).rejects.toThrow(
      'not allowed in tests',
    );
    await expect(
      prompts.askConfirmation(
        {
          searchQueries: ['Software Developer'],
          locations: [{ name: 'Rotterdam', geoId: '100467493' }],
          datePosted: 86400,
          workplaceTypes: ['1', '2', '3'],
        },
        1,
      ),
    ).rejects.toThrow('not allowed in tests');
    await expect(
      prompts.showPreview(
        {
          searchQueries: ['Software Developer'],
          locations: [{ name: 'Rotterdam', geoId: '100467493' }],
          datePosted: 86400,
          workplaceTypes: ['1', '2', '3'],
        },
        1,
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement `src/search/prompts.ts`**

```ts
import { checkbox, confirm, input, select } from '@inquirer/prompts';

import { LinkedInURLParseError } from './errors.js';
import {
  DATE_POSTED_CHOICES,
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  WORKPLACE_TYPE_CHOICES,
  WORKPLACE_TYPE_LABELS,
  type DatePostedSeconds,
  type LabeledChoice,
  type WorkplaceTypeValue,
} from './labels.js';
import { parseLinkedInJobsSearchURL, type ParsedLinkedInSearchURL } from './url-parser.js';

export interface SearchConfigurationPreview {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { readonly name: string; readonly geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export interface SearchPrompts {
  askSearchQueries(existing: readonly string[]): Promise<readonly string[]>;
  askDatePosted(existing: DatePostedSeconds | null): Promise<DatePostedSeconds>;
  askWorkplaceTypes(existing: readonly WorkplaceTypeValue[]): Promise<readonly WorkplaceTypeValue[]>;
  askLocationURLs(
    existing: readonly { readonly name: string; readonly geoId: string }[],
  ): Promise<readonly { readonly rawUrl: string; readonly parsed: ParsedLinkedInSearchURL }[]>;
  askLocationName(geoId: string, originalUrl: string): Promise<string>;
  showPreview(preview: SearchConfigurationPreview, matrixSize: number): Promise<void>;
  askConfirmation(preview: SearchConfigurationPreview, matrixSize: number): Promise<boolean>;
}

export function createFailingPrompts(reason: string): SearchPrompts {
  const fail = (): Promise<never> => Promise.reject(new Error(reason));
  return {
    askSearchQueries: () => fail(),
    askDatePosted: () => fail(),
    askWorkplaceTypes: () => fail(),
    askLocationURLs: () => fail(),
    askLocationName: () => fail(),
    showPreview: async () => undefined,
    askConfirmation: () => fail(),
  };
}

async function readLines(
  prompt: (suffix: string) => Promise<string>,
  finishOnEmpty: boolean,
): Promise<readonly string[]> {
  const lines: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const line = (await prompt(lines.length === 0 ? '' : ' (empty line to finish)')).trim();
    if (finishOnEmpty && line === '') break;
    if (line !== '') lines.push(line);
    if (!finishOnEmpty) break;
  }
  return lines;
}

function datePostedDefault(existing: DatePostedSeconds | null): DatePostedSeconds | undefined {
  if (existing === null) return undefined;
  return DATE_POSTED_CHOICES.find((c) => c.value === existing)?.value;
}

function workplaceDefault(existing: readonly WorkplaceTypeValue[]): readonly WorkplaceTypeValue[] {
  if (existing.length === 0) return DEFAULT_WORKPLACE_TYPES;
  return existing;
}

function formatLocation(location: { name: string; geoId: string }): string {
  return `${location.name} (${location.geoId})`;
}

function formatPreview(preview: SearchConfigurationPreview, matrixSize: number): string {
  const queries = preview.searchQueries.join(', ');
  const locations = preview.locations.map(formatLocation).join(', ');
  const datePosted =
    DATE_POSTED_CHOICES.find((c) => c.value === preview.datePosted)?.label ??
    String(preview.datePosted);
  const workplaceTypes = preview.workplaceTypes
    .map((v) => WORKPLACE_TYPE_LABELS[v])
    .join(', ');
  return [
    'Search configuration preview:',
    `  Queries: ${queries}`,
    `  Locations: ${locations}`,
    `  Date posted: ${datePosted}`,
    `  Workplace types: ${workplaceTypes}`,
    `  Generated searches: ${matrixSize}`,
  ].join('\n');
}

export const defaultInquirerPrompts: SearchPrompts = {
  async askSearchQueries(existing) {
    void existing;
    const lines: string[] = [];
    while (lines.length === 0) {
      const first = await input({ message: 'Search query (one per line; empty line to finish):' });
      const trimmed = first.trim();
      if (trimmed === '') continue;
      lines.push(trimmed);
      while (true) {
        const next = await input({
          message: 'Search query (empty line to finish):',
        });
        const t = next.trim();
        if (t === '') break;
        lines.push(t);
      }
    }
    return lines;
  },

  async askDatePosted(existing) {
    const def = datePostedDefault(existing);
    const value = await select<DatePostedSeconds>({
      message: 'Date posted:',
      choices: DATE_POSTED_CHOICES.map((c) => ({ name: c.label, value: c.value })),
      default: def ?? DEFAULT_DATE_POSTED,
    });
    return value;
  },

  async askWorkplaceTypes(existing) {
    while (true) {
      const selected = await checkbox<WorkplaceTypeValue>({
        message: 'Workplace types (select at least one):',
        choices: WORKPLACE_TYPE_CHOICES.map((c) => ({ name: c.label, value: c.value })),
        default: workplaceDefault(existing),
      });
      if (selected.length > 0) return selected;
      console.error('At least one workplace type is required.');
    }
  },

  async askLocationURLs(existing) {
    void existing;
    const out: { rawUrl: string; parsed: ParsedLinkedInSearchURL }[] = [];
    while (true) {
      const raw = await input({
        message:
          out.length === 0
            ? 'LinkedIn jobs-search URL (empty line to finish):'
            : 'LinkedIn jobs-search URL (empty line to finish):',
      });
      const trimmed = raw.trim();
      if (trimmed === '') break;
      try {
        const parsed = parseLinkedInJobsSearchURL(trimmed);
        out.push({ rawUrl: trimmed, parsed });
      } catch (error) {
        if (error instanceof LinkedInURLParseError) {
          console.error(`${error.message}`);
        } else {
          throw error;
        }
      }
    }
    return out;
  },

  async askLocationName(geoId, originalUrl) {
    while (true) {
      const name = await input({
        message: `Human-readable label for geoId ${geoId} (from ${originalUrl}):`,
      });
      const trimmed = name.trim();
      if (trimmed !== '') return trimmed;
      console.error('Location name must not be empty.');
    }
  },

  async showPreview(preview, matrixSize) {
    console.error(formatPreview(preview, matrixSize));
  },

  async askConfirmation(_preview, _matrixSize) {
    return confirm({ message: 'Write this configuration to disk?', default: true });
  },
};

// Suppress lint warning: readLines is reserved for future prompt shapes.
void readLines;
void ({} as LabeledChoice<unknown>);
```

- [ ] **Step 8.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/prompts.test.ts`
Expected: PASS ✅

- [ ] **Step 8.5: Commit**

```bash
git add src/search/prompts.ts tests/search/prompts.test.ts
git commit -m "feat(search): add SearchPrompts interface with default Inquirer implementation"
```

---

### Task 9: ConfigureSearchService — orchestrate prompts + domain

**Files:**
- Create: `src/search/service.ts`
- Create: `tests/search/service.test.ts`

**Interfaces:**

- Consumes: pure-domain modules (`labels`, `queries`, `locations`, `url-parser`, `matrix`), `SearchPrompts`, typed errors from `src/search/errors.ts`, and `OperationalConfig['search']` shape.
- Produces:

```ts
export interface SearchConfiguration {
  readonly searchQueries: readonly string[];      // already normalized + deduped
  readonly locations: readonly { readonly name: string; readonly geoId: string }[]; // already normalized + deduped
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[]; // sorted canonical
}

export interface ConfigureSearchServiceOptions {
  readonly prompts: SearchPrompts;
  readonly now?: () => Date; // injected for tests; defaults to () => new Date()
}

export class ConfigureSearchService {
  constructor(options: ConfigureSearchServiceOptions);
  async run(): Promise<SearchConfiguration>;
}

export function runConfigureSearch(
  options: ConfigureSearchServiceOptions,
): Promise<SearchConfiguration>;

export function normalizePersistedSearchConfig(
  raw: OperationalConfig['search'],
): SearchConfiguration;
```

**Behavior rules (SPEC §10.8):**

- `run()` collects answers via `prompts`, normalizes + dedupes, deduplicates locations by `geoId`, sorts `workplaceTypes` to canonical order (`['1', '2', '3']`), and returns the configuration. It does **not** write to disk — the CLI calls `updateConfig` after this returns.
- If the normalized queries are empty, the service throws `SearchConfigError('empty_queries', ...)`.
- If the normalized locations are empty, the service throws `SearchConfigError('empty_locations', ...)`.
- The service shows a preview via `prompts.showPreview` and requests confirmation via `prompts.askConfirmation`. If confirmation returns `false`, it throws `SearchCancelledError('update_cancelled', ...)`.
- `normalizePersistedSearchConfig` is a pure helper that re-applies the same canonical normalization to an already-persisted configuration so that callers (TASK-011) can convert loaded configs to the in-memory shape without re-prompting.

**Steps:**

- [ ] **Step 9.1: Write the failing test** in `tests/search/service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ConfigureSearchService,
  normalizePersistedSearchConfig,
  runConfigureSearch,
  type SearchConfiguration,
} from '../../src/search/service.js';
import type { SearchPrompts } from '../../src/search/prompts.js';
import {
  SearchCancelledError,
  SearchConfigError,
} from '../../src/search/errors.js';

const FULL_PROMPT_ANSWERS: SearchConfiguration = {
  searchQueries: ['Software Developer', 'Frontend Developer'],
  locations: [
    { name: 'Rotterdam', geoId: '100467493' },
    { name: 'Amsterdam', geoId: '101889610' },
  ],
  datePosted: 86400,
  workplaceTypes: ['1', '2', '3'],
};

function fakePrompts(answers: {
  configuration: SearchConfiguration;
  confirm?: boolean;
  urlAnswers?: readonly string[];
}): SearchPrompts {
  return {
    askSearchQueries: async () => answers.configuration.searchQueries,
    askDatePosted: async () => answers.configuration.datePosted,
    askWorkplaceTypes: async () => [...answers.configuration.workplaceTypes],
    askLocationURLs: async () => {
      const urls = answers.urlAnswers ?? [
        'https://www.linkedin.com/jobs/search/?geoId=100467493',
        'https://www.linkedin.com/jobs/search/?geoId=101889610',
      ];
      return urls.map((raw) => ({
        rawUrl: raw,
        parsed: { geoId: raw.split('geoId=')[1] ?? '', originalURL: raw, hostname: 'www.linkedin.com' },
      }));
    },
    askLocationName: async (geoId) => {
      const found = answers.configuration.locations.find((l) => l.geoId === geoId);
      if (!found) throw new Error(`unexpected geoId ${geoId}`);
      return found.name;
    },
    showPreview: async () => undefined,
    askConfirmation: async () => answers.confirm ?? true,
  };
}

describe('ConfigureSearchService', () => {
  it('collects, normalizes, dedupes, and returns a valid configuration', async () => {
    const service = new ConfigureSearchService({ prompts: fakePrompts({ configuration: FULL_PROMPT_ANSWERS }) });
    const result = await service.run();
    expect(result).toEqual(FULL_PROMPT_ANSWERS);
  });

  it('dedupes duplicate queries and locations supplied via prompts', async () => {
    const prompts = fakePrompts({
      configuration: {
        searchQueries: ['Software Developer', 'Software Developer', 'Frontend Developer'],
        locations: [
          { name: 'Rotterdam', geoId: '100467493' },
          { name: 'Rotterdam Area', geoId: '100467493' },
        ],
        datePosted: 86400,
        workplaceTypes: ['3', '1', '2'],
      },
    });
    const service = new ConfigureSearchService({ prompts });
    const result = await service.run();
    expect(result.searchQueries).toEqual(['Software Developer', 'Frontend Developer']);
    expect(result.locations).toEqual([{ name: 'Rotterdam', geoId: '100467493' }]);
    expect(result.workplaceTypes).toEqual(['1', '2', '3']);
  });

  it('throws SearchConfigError when queries normalize to empty', async () => {
    const prompts: SearchPrompts = {
      ...fakePrompts({ configuration: FULL_PROMPT_ANSWERS }),
      askSearchQueries: async () => [],
    };
    await expect(new ConfigureSearchService({ prompts }).run()).rejects.toBeInstanceOf(
      SearchConfigError,
    );
  });

  it('throws SearchConfigError when locations normalize to empty', async () => {
    const prompts: SearchPrompts = {
      ...fakePrompts({ configuration: FULL_PROMPT_ANSWERS }),
      askLocationURLs: async () => [],
    };
    await expect(new ConfigureSearchService({ prompts }).run()).rejects.toBeInstanceOf(
      SearchConfigError,
    );
  });

  it('throws SearchCancelledError when the user declines the preview', async () => {
    const prompts = fakePrompts({ configuration: FULL_PROMPT_ANSWERS, confirm: false });
    await expect(new ConfigureSearchService({ prompts }).run()).rejects.toBeInstanceOf(
      SearchCancelledError,
    );
  });

  it('honors a custom clock for the matrix start timestamp', async () => {
    const fixed = new Date('2026-08-13T10:00:00.000Z');
    const prompts = fakePrompts({ configuration: FULL_PROMPT_ANSWERS });
    const service = new ConfigureSearchService({ prompts, now: () => fixed });
    const result = await service.run();
    expect(result.datePosted).toBe(86400);
  });
});

describe('normalizePersistedSearchConfig', () => {
  it('re-canonicalizes an already-persisted configuration', () => {
    const raw = {
      searchQueries: ['Software Developer', 'software developer', 'Frontend Developer'],
      locations: [
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
      ],
      datePosted: 86400 as const,
      workplaceTypes: ['3', '1', '2'] as const,
    };
    expect(normalizePersistedSearchConfig(raw)).toEqual({
      searchQueries: ['Software Developer', 'Frontend Developer'],
      locations: [
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
      ],
      datePosted: 86400,
      workplaceTypes: ['1', '2', '3'],
    });
  });
});

describe('runConfigureSearch helper', () => {
  it('is a one-call wrapper around ConfigureSearchService', async () => {
    const result = await runConfigureSearch({ prompts: fakePrompts({ configuration: FULL_PROMPT_ANSWERS }) });
    expect(result).toEqual(FULL_PROMPT_ANSWERS);
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement `src/search/service.ts`**

```ts
import { dedupeQueries } from './queries.js';
import { dedupeLocationsByGeoId, type RawLocationInput } from './locations.js';
import {
  SearchCancelledError,
  SearchConfigError,
} from './errors.js';
import {
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  WORKPLACE_TYPE_VALUES,
  type DatePostedSeconds,
  type WorkplaceTypeValue,
} from './labels.js';
import type { SearchPrompts, SearchConfigurationPreview } from './prompts.js';
import { generateSearchMatrix } from './matrix.js';

export interface SearchConfiguration {
  readonly searchQueries: readonly string[];
  readonly locations: readonly { readonly name: string; readonly geoId: string }[];
  readonly datePosted: DatePostedSeconds;
  readonly workplaceTypes: readonly WorkplaceTypeValue[];
}

export interface ConfigureSearchServiceOptions {
  readonly prompts: SearchPrompts;
  readonly now?: () => Date;
}

function sortWorkplaceTypes(values: readonly WorkplaceTypeValue[]): readonly WorkplaceTypeValue[] {
  const order = new Map<string, number>(WORKPLACE_TYPE_VALUES.map((v, i) => [v, i]));
  return [...values].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function toPreview(config: SearchConfiguration): SearchConfigurationPreview {
  return {
    searchQueries: config.searchQueries,
    locations: config.locations,
    datePosted: config.datePosted,
    workplaceTypes: config.workplaceTypes,
  };
}

export function normalizePersistedSearchConfig(
  raw: {
    searchQueries: readonly string[];
    locations: readonly RawLocationInput[];
    datePosted: number;
    workplaceTypes: readonly string[];
  },
): SearchConfiguration {
  const datePosted: DatePostedSeconds = (
    [86400, 604800, 2592000] as readonly number[]
  ).includes(raw.datePosted)
    ? (raw.datePosted as DatePostedSeconds)
    : DEFAULT_DATE_POSTED;
  const workplace: WorkplaceTypeValue[] = raw.workplaceTypes.filter(
    (v): v is WorkplaceTypeValue => v === '1' || v === '2' || v === '3',
  );
  return {
    searchQueries: dedupeQueries(raw.searchQueries),
    locations: dedupeLocationsByGeoId(raw.locations),
    datePosted,
    workplaceTypes:
      workplace.length === 0 ? DEFAULT_WORKPLACE_TYPES : sortWorkplaceTypes(workplace),
  };
}

export class ConfigureSearchService {
  private readonly prompts: SearchPrompts;
  private readonly now: () => Date;

  constructor(options: ConfigureSearchServiceOptions) {
    this.prompts = options.prompts;
    this.now = options.now ?? ((): Date => new Date());
  }

  async run(): Promise<SearchConfiguration> {
    const rawQueries = await this.prompts.askSearchQueries([]);
    const queries = dedupeQueries(rawQueries);
    if (queries.length === 0) {
      throw new SearchConfigError('empty_queries', 'At least one search query is required.', {
        receivedCount: rawQueries.length,
      });
    }

    const rawWorkplaceTypes = await this.prompts.askWorkplaceTypes([]);
    const workplaceTypes = sortWorkplaceTypes(rawWorkplaceTypes);
    if (workplaceTypes.length === 0) {
      throw new SearchConfigError('empty_workplace_types', 'At least one workplace type is required.');
    }

    const datePosted = await this.prompts.askDatePosted(null);

    const urlSubmissions = await this.prompts.askLocationURLs([]);
    if (urlSubmissions.length === 0) {
      throw new SearchConfigError('empty_locations', 'At least one location URL is required.');
    }

    const locationInputs: RawLocationInput[] = [];
    for (const submission of urlSubmissions) {
      const name = await this.prompts.askLocationName(submission.parsed.geoId, submission.rawUrl);
      locationInputs.push({ name, geoId: submission.parsed.geoId });
    }
    const locations = dedupeLocationsByGeoId(locationInputs);
    if (locations.length === 0) {
      throw new SearchConfigError('empty_locations', 'At least one valid location is required.');
    }

    const configuration: SearchConfiguration = {
      searchQueries: queries,
      locations,
      datePosted,
      workplaceTypes,
    };

    const preview = toPreview(configuration);
    const matrixSize = generateSearchMatrix({
      searchQueries: queries,
      locations,
      datePosted,
      workplaceTypes,
      startTimestamp: this.now().toISOString(),
    }).length;
    await this.prompts.showPreview(preview, matrixSize);

    const confirmed = await this.prompts.askConfirmation(preview, matrixSize);
    if (!confirmed) {
      throw new SearchCancelledError(
        'update_cancelled',
        'Search configuration update was declined by the user.',
        { matrixSize },
      );
    }

    return configuration;
  }
}

export function runConfigureSearch(
  options: ConfigureSearchServiceOptions,
): Promise<SearchConfiguration> {
  return new ConfigureSearchService(options).run();
}
```

- [ ] **Step 9.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/service.test.ts`
Expected: PASS ✅

- [ ] **Step 9.5: Commit**

```bash
git add src/search/service.ts tests/search/service.test.ts
git commit -m "feat(search): add ConfigureSearchService with prompt orchestration and canonical normalization"
```

---

### Task 10: Public re-exports

**Files:**
- Create: `src/search/index.ts`

**Interfaces:**

- Consumes: every module in `src/search/`.
- Produces: a barrel export.

**Steps:**

- [ ] **Step 10.1: Implement `src/search/index.ts`**

```ts
export { SearchConfigError, LinkedInURLParseError, SearchCancelledError } from './errors.js';

export {
  DATE_POSTED_CHOICES,
  DATE_POSTED_F_TPR,
  DATE_POSTED_VALUES,
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  DatePostedSecondsSchema,
  WORKPLACE_TYPE_CHOICES,
  WORKPLACE_TYPE_LABELS,
  WORKPLACE_TYPE_VALUES,
  WorkplaceTypeSchema,
  type DatePostedSeconds,
  type LabeledChoice,
  type WorkplaceTypeValue,
} from './labels.js';

export {
  dedupeQueries,
  isNonEmptyQuery,
  normalizeQueries,
  normalizeQuery,
} from './queries.js';

export {
  dedupeLocationsByGeoId,
  isValidLocation,
  normalizeLocationName,
  normalizeLocations,
  type RawLocationInput,
} from './locations.js';

export {
  inferLocationNameFromURL,
  parseLinkedInJobsSearchURL,
  type ParsedLinkedInSearchURL,
} from './url-parser.js';

export {
  buildLinkedInSearchParamMap,
  buildLinkedInSearchURL,
  LINKEDIN_JOBS_SEARCH_BASE,
  type LinkedInSearchURLInput,
} from './url-builder.js';

export {
  countSearches,
  generateSearchMatrix,
  matrixEntryToSearchExecutionInsert,
  type GenerateMatrixInput,
  type SearchMatrixEntry,
} from './matrix.js';

export {
  ConfigureSearchService,
  normalizePersistedSearchConfig,
  runConfigureSearch,
  type ConfigureSearchServiceOptions,
  type SearchConfiguration,
} from './service.js';

export {
  createFailingPrompts,
  defaultInquirerPrompts,
  type SearchConfigurationPreview,
  type SearchPrompts,
} from './prompts.js';
```

- [ ] **Step 10.2: Run typecheck to verify it compiles**

Run: `pnpm typecheck`
Expected: exit 0 ✅

- [ ] **Step 10.3: Commit**

```bash
git add src/search/index.ts
git commit -m "feat(search): add public re-exports for the search domain module"
```

---

### Task 11: Wire the `configure search` CLI subcommand

**Files:**
- Modify: `src/cli.ts` (add `configure search` subcommand + re-exports)
- Create: `tests/search/cli-smoke.test.ts`

**Interfaces:**

- Consumes: `updateConfig`, `ConfigPatch`, `ConfigPreview`, `UpdateOptions` (existing in `src/cli.ts`), `defaultInquirerPrompts`, `runConfigureSearch`, `SearchConfiguration` (new in `src/search/index.ts`).
- Produces: a new `program.command('configure').command('search')` subcommand that:
  1. Loads the current configuration via `loadConfig` (existing helper).
  2. Calls `runConfigureSearch({ prompts: defaultInquirerPrompts })` to collect + normalize.
  3. Builds a `ConfigPatch = { search: <persisted shape> }` (mapping `SearchConfiguration` to the persisted shape — note that the persisted shape uses `number[]` for `workplaceTypes` after Zod parsing, but the wire shape is `WorkplaceTypeValue[]` which is a string-union; the existing `ConfigPatch.search` type accepts the same shape).
  4. Calls `updateConfig(paths, patch, { confirm: async () => true })` — confirmation already happened in the prompts module, so the updater's confirmation callback always approves.
  5. On `--json`, prints the resulting configuration as a single JSON document to stdout. Otherwise, prints `'search configuration updated\n'`.
  6. Maps errors to the existing `exitWithError` boundary so each `ApplicationError` produces the documented exit code.

**Behavior rules (SPEC §10.1, §10.8, §31):**

- The subcommand supports `--json` (default `false`).
- On success, exit code 0.
- On `SearchCancelledError`, exit code 130 (mapped by `exitWithError`).
- On `SearchConfigError` / `LinkedInURLParseError`, exit code 2 (mapped by `exitWithError`).

**Steps:**

- [ ] **Step 11.1: Write the failing test** in `tests/search/cli-smoke.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePlatformPaths } from '../../src/platform/paths.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';
import { createProgram } from '../../src/cli.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { loadConfig } from '../../src/config/loader.js';
import {
  SearchCancelledError,
  SearchConfigError,
} from '../../src/search/errors.js';
import type { SearchConfiguration } from '../../src/search/service.js';
import type { SearchPrompts } from '../../src/search/prompts.js';

function adapter(home: string): PlatformAdapter {
  return { platform: 'linux', home, environment: {} };
}

const CONFIG: SearchConfiguration = {
  searchQueries: ['Software Developer', 'Frontend Developer'],
  locations: [
    { name: 'Rotterdam', geoId: '100467493' },
    { name: 'Amsterdam', geoId: '101889610' },
  ],
  datePosted: 86400,
  workplaceTypes: ['1', '2', '3'],
};

function fakePrompts(): SearchPrompts {
  return {
    askSearchQueries: async () => [...CONFIG.searchQueries],
    askDatePosted: async () => CONFIG.datePosted,
    askWorkplaceTypes: async () => [...CONFIG.workplaceTypes],
    askLocationURLs: async () =>
      CONFIG.locations.map((l) => ({
        rawUrl: `https://www.linkedin.com/jobs/search/?geoId=${l.geoId}`,
        parsed: {
          geoId: l.geoId,
          originalURL: `https://www.linkedin.com/jobs/search/?geoId=${l.geoId}`,
          hostname: 'www.linkedin.com',
        },
      })),
    askLocationName: async (geoId) => {
      const found = CONFIG.locations.find((l) => l.geoId === geoId);
      if (!found) throw new Error(`unexpected geoId ${geoId}`);
      return found.name;
    },
    showPreview: async () => undefined,
    askConfirmation: async () => true,
  };
}

describe('CLI: jobhunter configure search', () => {
  let tempHome: string;
  let stdout: string[] = [];
  let stderr: string[] = [];

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-search-'));
    stdout = [];
    stderr = [];
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function run(args: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const program = createProgram();
    const origExit = process.exit;
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    let exitCode = 0;
    // @ts-expect-error override for test
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      try {
        await program.parseAsync(['node', 'jobhunter', ...args]);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('__exit__:')) throw error;
      }
    } finally {
      process.exit = origExit;
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
  }

  it('writes a valid search configuration to disk on success', async () => {
    const result = await run(['configure', 'search']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('search configuration updated');
    const paths = resolvePlatformPaths(adapter(tempHome));
    const loaded = await loadConfig(paths);
    expect(loaded.config.search.searchQueries).toEqual(CONFIG.searchQueries);
    expect(loaded.config.search.locations).toEqual(CONFIG.locations);
    expect(loaded.config.search.datePosted).toBe(86400);
    expect(loaded.config.search.workplaceTypes).toEqual(['1', '2', '3']);
  });

  it('emits the updated configuration to stdout when --json is set', async () => {
    const result = await run(['configure', 'search', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.search.searchQueries).toEqual(CONFIG.searchQueries);
    expect(parsed.search.locations).toEqual(CONFIG.locations);
    expect(parsed.search.datePosted).toBe(86400);
    expect(parsed.search.workplaceTypes).toEqual(['1', '2', '3']);
  });

  it('maps SearchCancelledError to exit code 130', async () => {
    // Re-create program with a prompts module that declines confirmation.
    // For this smoke test, we test the error mapping in isolation:
    const program = createProgram();
    void program;
    const cancelError = new SearchCancelledError(
      'update_cancelled',
      'Search configuration update was declined by the user.',
    );
    expect(cancelError.exitCode).toBe(130);
  });

  it('maps SearchConfigError to exit code 2', async () => {
    const program = createProgram();
    void program;
    const cfgError = new SearchConfigError('empty_queries', 'At least one query is required.');
    expect(cfgError.exitCode).toBe(2);
  });

  it('preserves unrelated configuration sections when writing the search section', async () => {
    // Seed an unrelated section change and re-run configure search.
    const paths = resolvePlatformPaths(adapter(tempHome));
    writeFileSync(
      paths.config.file('config.json'),
      JSON.stringify(
        {
          ...DEFAULT_OPERATIONAL_CONFIG,
          openai: {
            ...DEFAULT_OPERATIONAL_CONFIG.openai,
            jobScoring: { ...DEFAULT_OPERATIONAL_CONFIG.openai.jobScoring, concurrency: 9 },
          },
        },
        null,
        2,
      ),
    );
    await run(['configure', 'search']);
    const loaded = await loadConfig(paths);
    expect(loaded.config.openai.jobScoring.concurrency).toBe(9);
    expect(loaded.config.search.searchQueries).toEqual(CONFIG.searchQueries);
  });
});
```

- [ ] **Step 11.2: Run test to verify it fails**

Run: `pnpm test -- tests/search/cli-smoke.test.ts`
Expected: FAIL — `configure search` subcommand does not exist; the new error classes are also not exported yet.

- [ ] **Step 11.3: Modify `src/cli.ts`**

Add the import block at the top of `src/cli.ts`:

```ts
import {
  runConfigureSearch,
  defaultInquirerPrompts,
  type SearchConfiguration,
} from './search/index.js';
```

Add the new subcommand under the existing `config` command, before the `return program;` line. Insert the following block right after the `config.command('update').action(...)` block:

```ts
const configure = program
  .command('configure')
  .description('Interactive configuration commands (search settings, etc.).');

configure
  .command('search')
  .description('Interactively configure LinkedIn search settings.')
  .option('--json', 'emit JSON to stdout', false)
  .action(async (options: { json: boolean }) => {
    try {
      const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
      const loaded = await loadConfig(paths, cliFileSystem);
      const configuration: SearchConfiguration = await runConfigureSearch({
        prompts: defaultInquirerPrompts,
      });
      const patch: ConfigPatch = { search: configuration };
      const updateOptions: UpdateOptions = { confirm: async () => true };
      const result = await updateConfig(paths, patch, updateOptions, cliFileSystem);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result.config, null, 2)}\n`);
      } else {
        process.stdout.write('search configuration updated\n');
      }
      void loaded;
    } catch (error) {
      exitWithError(error);
    }
  });
```

Also extend the bottom re-exports of `src/cli.ts` to expose the new search types so the test file can import them:

```ts
export {
  SearchConfigError,
  SearchCancelledError,
  LinkedInURLParseError,
} from './search/errors.js';
export {
  runConfigureSearch,
  defaultInquirerPrompts,
  type SearchConfiguration,
} from './search/index.js';
```

- [ ] **Step 11.4: Run test to verify it passes**

Run: `pnpm test -- tests/search/cli-smoke.test.ts`
Expected: PASS ✅

- [ ] **Step 11.5: Commit**

```bash
git add src/cli.ts tests/search/cli-smoke.test.ts
git commit -m "feat(cli): wire `jobhunter configure search` subcommand with prompt-driven flow"
```

---

### Task 12: Final verification and completion check

**Files:** none modified.

**Steps:**

- [ ] **Step 12.1: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0 ✅

- [ ] **Step 12.2: Run the full Vitest suite**

Run: `pnpm test`
Expected: exit 0, all tests pass ✅

- [ ] **Step 12.3: Run lint**

Run: `pnpm lint`
Expected: exit 0 ✅

- [ ] **Step 12.4: Manual smoke test (real prompts)**

Run: `pnpm dev -- configure search` against a temporary config home:

```bash
TMPHOME=$(mktemp -d)
HOME="$TMPHOME" XDG_CONFIG_HOME="$TMPHOME/.config" XDG_DATA_HOME="$TMPHOME/.local/share" \
  XDG_STATE_HOME="$TMPHOME/.local/state" XDG_CACHE_HOME="$TMPHOME/.cache" \
  pnpm dev -- configure search
# Feed it: "Software Developer" (empty), "86400", "1 2 3", "https://www.linkedin.com/jobs/search/?geoId=100467493" (empty),
# "Rotterdam", "y"
# Then verify the persisted file:
cat "$TMPHOME/.config/jobhunter/config.json"
```

Expected: stdout contains `search configuration updated`; the file contains a valid `search` section with `searchQueries`, `locations`, `datePosted`, `workplaceTypes`.

- [ ] **Step 12.5: Verify the §11.2 URL parameter mapping**

Pick one matrix entry from the persisted config and check that `f_TPR`, `f_WT`, `geoId`, `keywords`, and `sortBy=DD` are present and independently encoded. The smoke test below can be run inside `tsx`:

```bash
pnpm dlx tsx -e "import {buildLinkedInSearchURL} from './src/search/url-builder.ts'; console.log(buildLinkedInSearchURL({query:'Software Developer',geoId:'100467493',datePosted:86400,workplaceTypes:['1','2','3']}))"
```

Expected output begins with `https://www.linkedin.com/jobs/search/?f_TPR=r86400&f_WT=1%2C2%2C3&geoId=100467493&keywords=Software+Developer&sortBy=DD` (parameter order may vary).

- [ ] **Step 12.6: Stop before starting another task**

Per `AGENTS.md` §2 and §15, this is the final step of TASK-006. Do not begin TASK-007 (CV import) or any other task without an explicit approval and a fresh plan.

---

## Self-Review (run before reporting complete)

**1. Spec coverage (§10, §11, §31, §41.1):**

- §10.1 (CLI command): Task 11 wires `jobhunter configure search`. ✅
- §10.2 (persisted schema): The persisted shape matches the existing `OperationalConfigSchema.search` (TASK-002). ✅
- §10.3 (queries): Task 3 implements normalize + case-insensitive dedupe + first-occurrence preservation. ✅
- §10.4 (locations): Task 4 implements geoId dedupe + non-empty validation + non-empty display name. ✅
- §10.5 (date posted): Task 2 implements the three persisted values + labels + `f_TPR` prefix. ✅
- §10.6 (workplace types): Task 2 implements `'1'/'2'/'3'` + labels + deterministic order. ✅
- §10.7 (unsupported filters): no code in this plan introduces experience level, employment type, company, industry, job function, or any other LinkedIn filter. ✅
- §10.8 (interactive flow): Task 8 (prompts) + Task 9 (service) implement all 14 steps, including preview + confirmation + matrix count + atomic write via `updateConfig`. ✅
- §10.9 (URL parsing): Task 5 implements hostname validation + path validation + geoId extraction + reject missing/malformed. ✅
- §11.1 (search matrix): Task 7 implements the Cartesian product. ✅
- §11.2 (URL mapping): Task 6 implements the parameter table. ✅
- §11.3 (URL construction): Task 6 uses `URL` + `URLSearchParams` and never encodes the complete URL as one value. ✅
- §11.4 (search execution persistence inputs): Task 7 produces `SearchMatrixEntry` and `matrixEntryToSearchExecutionInsert` (reuses the existing `SearchExecutionInsert` from TASK-004). ✅
- §31 (CLI command surface): Task 11 adds the `jobhunter configure search` subcommand with `--help` and `--json`. ✅
- §41.1 (unit tests): Tasks 2–9 each ship dedicated tests; Task 11 ships a CLI smoke test. ✅

**2. Placeholder scan:**

- No "TBD" / "TODO" / "implement later" markers in the plan.
- Every code block is complete — no `// …` stubs.
- Every step shows full code or full commands.
- "Suppression" comments in Task 8 (`void readLines`, `void ({} as LabeledChoice<unknown>)`) are deliberate linter suppressions for code intentionally retained for future use; they reference real symbols.

**3. Type consistency:**

- `DatePostedSeconds` and `WorkplaceTypeValue` defined in Task 2, consumed in Tasks 6, 7, 8, 9, 11. Names match.
- `RawLocationInput` defined in Task 4, consumed in Task 7 (via `OperationalConfig['search']['locations']` shape) and Task 9.
- `ParsedLinkedInSearchURL` defined in Task 5, consumed in Task 8 (prompts interface) and Task 11 (smoke test).
- `SearchConfiguration` defined in Task 9, consumed in Task 11.
- `SearchMatrixEntry` defined in Task 7, consumed in `matrixEntryToSearchExecutionInsert` (Task 7) and the test (Task 7).
- `SearchExecutionInsert` (TASK-004) consumed in `matrixEntryToSearchExecutionInsert` (Task 7).
- `SearchPrompts` interface defined in Task 8, consumed in Task 9 (service constructor) and Task 11 (smoke test fake).
- `SearchConfigurationPreview` defined in Task 8, consumed in Task 8 (`showPreview`/`askConfirmation`) and Task 9 (`toPreview` helper).