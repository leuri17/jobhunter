import { InvalidIdentifierError } from './identifier-errors.js';

export { InvalidIdentifierError };

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
