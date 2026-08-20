import {
  SCORING_STRUCTURED_OUTPUT_JSON_SCHEMA,
  SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
} from '../../scoring/schema.js';
import { STRUCTURED_OUTPUT_SCHEMA } from './prompt.js';
import { STRUCTURED_OUTPUT_SCHEMA_VERSION } from './structured-output.js';

/**
 * Response-schema registry for the OpenAI client.
 *
 * Every operation that calls `OpenAIClient.extract` identifies its
 * expected response shape with a `responseSchemaName`. The client looks
 * the name up in this registry to find the matching JSON Schema +
 * version, then sends both to the OpenAI SDK.
 *
 * Adding a new operation is a three-step process:
 *   1. Define the Zod source of truth in a domain module.
 *   2. Project the Zod schema to JSON Schema in that module.
 *   3. Register the JSON Schema here under a stable name + version.
 *
 * The registry is intentionally a `Readonly<Record<...>>` literal so
 * TypeScript checks the entry shape at definition time and no consumer
 * can mutate the catalog at runtime.
 *
 * Cross-module dependency: `src/scoring/schema.ts` is imported here so
 * the OpenAI client surface can serve scoring requests. The dependency
 * flows one way — `src/scoring/` does NOT import from
 * `src/profile/openai/`. The scoring module is otherwise self-contained
 * and is consumed by `src/scoring/service.ts` in Wave D.
 */
export interface ResponseSchemaEntry {
  readonly schema: Record<string, unknown>;
  readonly version: number;
}

export const RESPONSE_SCHEMA_REGISTRY: Readonly<Record<string, ResponseSchemaEntry>> = {
  ExtractedProfile: {
    schema: STRUCTURED_OUTPUT_SCHEMA,
    version: STRUCTURED_OUTPUT_SCHEMA_VERSION,
  },
  ScoringStructuredOutput: {
    schema: SCORING_STRUCTURED_OUTPUT_JSON_SCHEMA,
    version: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
  },
};

export const RESPONSE_SCHEMA_NAMES: readonly string[] = Object.keys(RESPONSE_SCHEMA_REGISTRY);

/**
 * Raised when a request's `responseSchemaName` is not registered. This
 * is a configuration error (a developer passed a wrong name) — it is
 * NOT a runtime OpenAI failure, so the retry policy does not apply.
 */
export class UnknownResponseSchemaError extends Error {
  public readonly responseSchemaName: string;

  constructor(responseSchemaName: string) {
    super(
      `Unknown response schema name: "${responseSchemaName}". Known names: ${RESPONSE_SCHEMA_NAMES.join(', ')}.`,
    );
    this.name = 'UnknownResponseSchemaError';
    this.responseSchemaName = responseSchemaName;
  }
}

/**
 * Raised when a request's `structuredOutputSchemaVersion` does not
 * match the version currently registered for the response schema. This
 * usually means a stale request payload was built before a schema bump
 * and must be rebuilt.
 */
export class ResponseSchemaVersionMismatchError extends Error {
  public readonly responseSchemaName: string;
  public readonly expectedVersion: number;
  public readonly actualVersion: number;

  constructor(responseSchemaName: string, expectedVersion: number, actualVersion: number) {
    super(
      `Response schema "${responseSchemaName}" version mismatch: expected ${expectedVersion}, got ${actualVersion}.`,
    );
    this.name = 'ResponseSchemaVersionMismatchError';
    this.responseSchemaName = responseSchemaName;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Look up a registered response schema by name + version. Throws
 * `UnknownResponseSchemaError` if the name is not registered, or
 * `ResponseSchemaVersionMismatchError` if the version does not match.
 */
export function getResponseSchema(name: string, version: number): ResponseSchemaEntry {
  const entry = RESPONSE_SCHEMA_REGISTRY[name];
  if (entry === undefined) {
    throw new UnknownResponseSchemaError(name);
  }
  if (entry.version !== version) {
    throw new ResponseSchemaVersionMismatchError(name, entry.version, version);
  }
  return entry;
}
