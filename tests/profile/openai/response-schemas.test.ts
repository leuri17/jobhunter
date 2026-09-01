import { describe, expect, it } from 'vitest';

import {
  RESPONSE_SCHEMA_NAMES,
  RESPONSE_SCHEMA_REGISTRY,
  ResponseSchemaVersionMismatchError,
  UnknownResponseSchemaError,
  getResponseSchema,
} from '../../../src/profile/openai/response-schemas.js';
import { SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION } from '../../../src/scoring/schema.js';
import { STRUCTURED_OUTPUT_SCHEMA_VERSION } from '../../../src/profile/openai/structured-output.js';

describe('RESPONSE_SCHEMA_REGISTRY', () => {
  it('registers the profile extraction schema under "ExtractedProfile"', () => {
    const entry = RESPONSE_SCHEMA_REGISTRY['ExtractedProfile']!;
    expect(entry).toBeDefined();
    expect(entry.version).toBe(STRUCTURED_OUTPUT_SCHEMA_VERSION);
    expect(entry.schema['type']).toBe('object');
  });

  it('registers the scoring schema under "ScoringStructuredOutput"', () => {
    const entry = RESPONSE_SCHEMA_REGISTRY['ScoringStructuredOutput']!;
    expect(entry).toBeDefined();
    expect(entry.version).toBe(SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION);
    expect(entry.schema['type']).toBe('object');
    // The 7 categories from  must all be present on the
    // projected JSON Schema so OpenAI strict mode can validate them.
    const properties = entry.schema['properties'] as Record<string, unknown>;
    const categoryScores = properties['categoryScores'] as Record<string, unknown>;
    const categoryProperties = categoryScores['properties'] as Record<string, unknown>;
    expect(Object.keys(categoryProperties).sort()).toEqual(
      [
        'domainIndustryFit',
        'locationWorkplaceCompatibility',
        'relevantExperience',
        'roleResponsibilityFit',
        'seniorityFit',
        'spokenLanguageCompatibility',
        'technicalSkills',
      ].sort(),
    );
  });

  it('exposes the registered names via RESPONSE_SCHEMA_NAMES', () => {
    expect(new Set(RESPONSE_SCHEMA_NAMES)).toEqual(
      new Set(['ExtractedProfile', 'ScoringStructuredOutput']),
    );
  });
});

describe('getResponseSchema', () => {
  it('returns the entry for a known name + matching version', () => {
    const entry = getResponseSchema('ExtractedProfile', STRUCTURED_OUTPUT_SCHEMA_VERSION);
    expect(entry.schema).toBe(RESPONSE_SCHEMA_REGISTRY['ExtractedProfile']!.schema);
    expect(entry.version).toBe(STRUCTURED_OUTPUT_SCHEMA_VERSION);
  });

  it('throws UnknownResponseSchemaError for an unregistered name', () => {
    expect(() => getResponseSchema('NoSuchSchema', 1)).toThrow(UnknownResponseSchemaError);
    try {
      getResponseSchema('NoSuchSchema', 1);
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownResponseSchemaError);
      expect((error as UnknownResponseSchemaError).responseSchemaName).toBe('NoSuchSchema');
      expect((error as UnknownResponseSchemaError).message).toContain('ExtractedProfile');
      expect((error as UnknownResponseSchemaError).message).toContain('ScoringStructuredOutput');
    }
  });

  it('throws ResponseSchemaVersionMismatchError when the version does not match', () => {
    expect(() => getResponseSchema('ExtractedProfile', 999)).toThrow(
      ResponseSchemaVersionMismatchError,
    );
    try {
      getResponseSchema('ExtractedProfile', 999);
    } catch (error) {
      expect(error).toBeInstanceOf(ResponseSchemaVersionMismatchError);
      const mismatch = error as ResponseSchemaVersionMismatchError;
      expect(mismatch.responseSchemaName).toBe('ExtractedProfile');
      expect(mismatch.expectedVersion).toBe(STRUCTURED_OUTPUT_SCHEMA_VERSION);
      expect(mismatch.actualVersion).toBe(999);
    }
  });

  it('returns the scoring entry for a known name + matching version', () => {
    const entry = getResponseSchema(
      'ScoringStructuredOutput',
      SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
    );
    expect(entry.schema).toBe(RESPONSE_SCHEMA_REGISTRY['ScoringStructuredOutput']!.schema);
    expect(entry.version).toBe(SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION);
  });
});
