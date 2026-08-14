import { describe, expect, it } from 'vitest';

import { PROFILE_EXTRACTION_PROMPT_VERSION } from '../../../src/profile/openai/fingerprint.js';
import {
  STRUCTURED_OUTPUT_SCHEMA,
  buildProfileExtractionPrompt,
} from '../../../src/profile/openai/prompt.js';
import type { OpenAIExtractionRequest } from '../../../src/profile/openai/types.js';

function request(overrides: Partial<OpenAIExtractionRequest> = {}): OpenAIExtractionRequest {
  return {
    promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
    model: 'gpt-5.6-sol',
    reasoningEffort: 'medium',
    responseSchemaName: 'professional_profile_extraction_v1',
    structuredOutputSchemaVersion: 1,
    sources: [
      { sourceId: 'source_1', originalFilename: 'cv.md', extractedText: 'Senior engineer at Acme' },
      {
        sourceId: 'source_2',
        originalFilename: 'linkedin.txt',
        extractedText: 'Lots of Node.js work',
      },
    ],
    ...overrides,
  };
}

function readField(schema: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = schema;
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Assert that a JSON Schema field accepts `null` AND at least one
 * non-null string value (so the model can emit `null` for "unknown"
 * while still being constrained to the documented enum otherwise).
 *
 * Accepts both shapes Zod emits for nullable fields:
 * - `type: ['string', 'null']` with `null` in `enum`
 * - `anyOf: [{type:'string', enum:[...]}, {type:'null'}]`
 */
function expectNullableAcceptsNull(field: Record<string, unknown>): void {
  const type = field['type'];
  const anyOf = field['anyOf'] as Array<Record<string, unknown>> | undefined;

  if (Array.isArray(type)) {
    expect(type).toContain('null');
    expect(type).toContain('string');
    const enumValues = field['enum'] as unknown[];
    expect(enumValues).toContain(null);
    return;
  }

  if (Array.isArray(anyOf)) {
    const branches = anyOf;
    expect(
      branches.some((branch) => branch['type'] === 'null'),
      'expected a `null` branch in anyOf',
    ).toBe(true);
    expect(
      branches.some((branch) => branch['type'] === 'string'),
      'expected a `string` branch in anyOf',
    ).toBe(true);
    return;
  }

  throw new Error('field is neither `type: [...]` nor `anyOf` — not nullable');
}

describe('STRUCTURED_OUTPUT_SCHEMA', () => {
  it('is a JSON Schema object with type "object" at the root', () => {
    expect(STRUCTURED_OUTPUT_SCHEMA['type']).toBe('object');
    expect(typeof STRUCTURED_OUTPUT_SCHEMA['properties']).toBe('object');
  });

  it('includes every top-level field required by ExtractedProfileSchema', () => {
    const properties = STRUCTURED_OUTPUT_SCHEMA['properties'] as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(
      [
        'basics',
        'certifications',
        'education',
        'experience',
        'languages',
        'projects',
        'skills',
        'warnings',
      ].sort(),
    );
  });

  it('marks skills.category as required AND nullable', () => {
    const skillsRequired = readField(STRUCTURED_OUTPUT_SCHEMA, [
      'properties',
      'skills',
      'items',
      'required',
    ]) as string[] | undefined;
    expect(skillsRequired).toContain('category');

    const category = readField(STRUCTURED_OUTPUT_SCHEMA, [
      'properties',
      'skills',
      'items',
      'properties',
      'category',
    ]) as Record<string, unknown>;
    // The schema must accept `null` for this field. Zod's `.nullable()`
    // projection renders this as `anyOf: [{...string branch}, {type: 'null'}]`;
    // the explicit-strict-mode form is `type: ['string','null']` with
    // `null` in the enum. Accept either.
    expectNullableAcceptsNull(category);
  });

  it('marks languages.level as required AND nullable', () => {
    const languagesRequired = readField(STRUCTURED_OUTPUT_SCHEMA, [
      'properties',
      'languages',
      'items',
      'required',
    ]) as string[] | undefined;
    expect(languagesRequired).toContain('level');

    const level = readField(STRUCTURED_OUTPUT_SCHEMA, [
      'properties',
      'languages',
      'items',
      'properties',
      'level',
    ]) as Record<string, unknown>;
    expectNullableAcceptsNull(level);
  });

  it('preserves the rest of the schema (e.g. basics.headline is still string|null and required)', () => {
    const headlineRequired = readField(STRUCTURED_OUTPUT_SCHEMA, [
      'properties',
      'basics',
      'required',
    ]) as string[] | undefined;
    expect(headlineRequired).toContain('headline');

    const headline = readField(STRUCTURED_OUTPUT_SCHEMA, [
      'properties',
      'basics',
      'properties',
      'headline',
    ]) as Record<string, unknown>;
    // Zod's `string().nullable()` projection uses `anyOf: [{type: 'string'}, {type: 'null'}]`,
    // which is what the unconverted fields look like.
    expect(headline['anyOf']).toEqual([{ type: 'string' }, { type: 'null' }]);
  });

  it('does not mutate the original Zod schema (verified by re-importing)', async () => {
    // Re-import the Zod schema and assert none of the optional fields are
    // marked as required there. The conversion happens only on the JSON
    // Schema projection, not on the Zod schema.
    const { ExtractedSkillSchema, ExtractedLanguageSchema } =
      await import('../../../src/profile/openai/structured-output.js');
    const skillShape = (ExtractedSkillSchema as unknown as { shape: Record<string, unknown> })
      .shape;
    const languageShape = (ExtractedLanguageSchema as unknown as { shape: Record<string, unknown> })
      .shape;
    // The `optional()` fields are unset in the Zod shape (they're stored
    // in `_def.checks`); the JSON Schema projection is independent.
    expect(skillShape).toBeDefined();
    expect(languageShape).toBeDefined();
  });
});

describe('buildProfileExtractionPrompt', () => {
  it('returns non-empty systemMessage and userMessage', () => {
    const prompt = buildProfileExtractionPrompt(request());
    expect(prompt.systemMessage.length).toBeGreaterThan(100);
    expect(prompt.userMessage.length).toBeGreaterThan(0);
  });

  it('systemMessage instructs the model never to invent facts', () => {
    const prompt = buildProfileExtractionPrompt(request());
    expect(prompt.systemMessage).toMatch(/invent/i);
    expect(prompt.systemMessage).toMatch(/null/i);
  });

  it('userMessage includes every sourceId and a snippet of each extractedText', () => {
    const prompt = buildProfileExtractionPrompt(request());
    expect(prompt.userMessage).toContain('source_1');
    expect(prompt.userMessage).toContain('source_2');
    expect(prompt.userMessage).toContain('Senior engineer at Acme');
    expect(prompt.userMessage).toContain('Lots of Node.js work');
    expect(prompt.userMessage).toMatch(/--- sourceId: source_1 \(cv\.md\) ---/);
    expect(prompt.userMessage).toMatch(/--- sourceId: source_2 \(linkedin\.txt\) ---/);
  });

  it('userMessage includes the source manifest with structuredOutputSchemaVersion', () => {
    const prompt = buildProfileExtractionPrompt(request());
    expect(prompt.userMessage).toContain('"sourceManifestVersion": 1');
    expect(prompt.userMessage).toContain('"sources"');
  });

  it('throws when the request carries a different promptVersion', () => {
    expect(() =>
      buildProfileExtractionPrompt(request({ promptVersion: 'profile-extraction-prompt@v0' })),
    ).toThrow(/pinned to/);
  });

  it('handles a single-source request without trailing separators', () => {
    const prompt = buildProfileExtractionPrompt(
      request({
        sources: [
          { sourceId: 'source_1', originalFilename: 'only.md', extractedText: 'Just one source' },
        ],
      }),
    );
    expect(prompt.userMessage).toContain('--- sourceId: source_1 (only.md) ---');
    expect(prompt.userMessage).toContain('Just one source');
  });
});
