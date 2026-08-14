import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, Repositories } from '../../src/persistence/repositories/index.js';
import { profileVersions as profileVersionsTable } from '../../src/persistence/schema.js';
import {
  ProfileExtractionService,
  type ProfileExtractionConfig,
} from '../../src/profile/extraction-service.js';
import {
  EXTRACTOR_IMPLEMENTATION_VERSION,
  PROFILE_EXTRACTION_PROMPT_VERSION,
  calculateExtractionFingerprint,
} from '../../src/profile/openai/fingerprint.js';
import { STRUCTURED_OUTPUT_SCHEMA_VERSION } from '../../src/profile/openai/structured-output.js';
import {
  OpenAIAuthenticationError,
  OpenAIRateLimitError,
  OpenAIServerError,
} from '../../src/profile/openai/errors.js';
import { FakeOpenAIClient } from '../../src/profile/openai/fake-client.js';
import type { OpenAIExtractionRawResponse } from '../../src/profile/openai/types.js';
import { PROFILE_SCHEMA_VERSION, type ProfessionalProfile } from '../../src/profile/schema.js';
import { hashString } from '../../src/profile/hashing.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const FIXED_NOW_ISO = '2026-08-14T12:00:00.000Z';
const fixedNow = (): Date => new Date(FIXED_NOW_ISO);

const BASE_CONFIG: ProfileExtractionConfig = {
  model: 'gpt-5.6-sol',
  reasoningEffort: 'medium',
};

const DEFAULT_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitter: 'full' as const,
  sleep: async (): Promise<void> => undefined,
  now: (): number => 0,
};

function ref(sourceId: string, section: string | null = null, excerpt: string | null = null) {
  return { sourceId, section, excerpt };
}

function validExtractedJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    basics: {
      headline: 'Senior Engineer',
      professionalSummary: null,
      currentLocation: null,
      totalYearsOfExperience: 7,
    },
    experience: [],
    skills: [],
    languages: [],
    education: [],
    certifications: [],
    projects: [],
    warnings: [],
    ...overrides,
  });
}

function response(rawJsonText: string): OpenAIExtractionRawResponse {
  return {
    rawJsonText,
    tokenUsage: { promptTokens: 100, completionTokens: 200 },
  };
}

function buildProfileJsonString(sourceId: number): string {
  const profile: ProfessionalProfile = {
    schemaVersion: 1,
    id: `profile_seed_${sourceId}`,
    createdAt: FIXED_NOW_ISO,
    updatedAt: FIXED_NOW_ISO,
    contentHash: hashString(`seed-${sourceId}`),
    sourceIds: [`source_${sourceId}`],
    basics: {
      headline: 'Seeded Profile',
      professionalSummary: null,
      currentLocation: null,
      totalYearsOfExperience: null,
    },
    experience: [],
    skills: [],
    languages: [],
    education: [],
    certifications: [],
    projects: [],
    derived: {
      likelySeniority: {
        generatedValue: null,
        overrideActive: false,
        overrideValue: null,
        effectiveValue: null,
        generatedAt: FIXED_NOW_ISO,
        overriddenAt: null,
      },
      primaryRoles: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: FIXED_NOW_ISO,
        overriddenAt: null,
      },
      primaryDomains: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: FIXED_NOW_ISO,
        overriddenAt: null,
      },
      strongestSkills: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: FIXED_NOW_ISO,
        overriddenAt: null,
      },
    },
  };
  return JSON.stringify(profile);
}

describe('ProfileExtractionService', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-extraction-service-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Insert a ProfileSourceRow whose `storedPath` points at a real file in
   * a tmp directory. The default file system + `PlainTextExtractor`
   * recovers the text verbatim, so the test can control the source
   * content without mocking the file system.
   */
  async function seedSource(
    storedPath: string,
    overrides: {
      readonly sourceType?: 'pdf' | 'markdown' | 'plain_text';
      readonly originalFilename?: string;
      readonly textExtractionStatus?: 'pending' | 'success' | 'failed';
      readonly textExtractionMessage?: string | null;
      readonly sha256?: string;
      readonly fileSize?: number;
      readonly warnings?: readonly string[];
    } = {},
  ): Promise<number> {
    const originalFilename = overrides.originalFilename ?? 'cv.md';
    const sourceType = overrides.sourceType ?? 'plain_text';
    const textExtractionStatus = overrides.textExtractionStatus ?? 'success';
    return repositories.profileSources.insert({
      sourceType,
      originalFilename,
      originalAbsolutePath: storedPath,
      storedPath,
      mimeType: 'text/plain',
      fileSize: overrides.fileSize ?? 0,
      sha256: overrides.sha256 ?? 'a'.repeat(64),
      importTimestamp: FIXED_NOW_ISO,
      textExtractionStatus,
      textExtractionMessage: overrides.textExtractionMessage ?? null,
      warnings: overrides.warnings ?? [],
    });
  }

  function writeSourceFile(storedPath: string, text: string): void {
    writeFileSync(storedPath, text, 'utf8');
  }

  it('creates a draft profile version when two sources both extract successfully', async () => {
    const storedPathA = join(directory, 'a.md');
    const storedPathB = join(directory, 'b.md');
    writeSourceFile(storedPathA, 'Alice resume content');
    writeSourceFile(storedPathB, 'Bob resume content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });
    const sourceB = await seedSource(storedPathB, { sha256: 'b'.repeat(64) });

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA, sourceB]);

    expect(status.kind).toBe('created');
    if (status.kind !== 'created') throw new Error('expected created');
    expect(status.conflicts).toBe(0);
    expect(status.warnings).toEqual([]);
    expect(status.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof status.profileVersionId).toBe('number');

    const stored = await repositories.profileVersions.getById(status.profileVersionId);
    expect(stored.status).toBe('draft');
    expect(stored.active).toBe(false);
    expect(stored.sourceIds).toEqual([sourceA, sourceB]);
    expect(stored.extractionFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(client.getRequestCount()).toBe(1);
  });

  it('returns profile_extraction_source_unusable without calling OpenAI when a source extraction failed', async () => {
    const storedPath = join(directory, 'a.md');
    writeSourceFile(storedPath, 'bad content');
    const sourceId = await seedSource(storedPath, {
      textExtractionStatus: 'failed',
      textExtractionMessage: 'ocr_required',
    });

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceId]);

    expect(status.kind).toBe('failed');
    if (status.kind !== 'failed') throw new Error('expected failed');
    expect(status.errorCode).toBe('profile_extraction_source_unusable');
    expect(status.attemptCount).toBe(0);
    expect(client.getRequestCount()).toBe(0);
  });

  it('returns profile_extraction_input_too_large without calling OpenAI when source text exceeds the limit', async () => {
    // Two sources whose combined UTF-8 byte length is larger than a
    // deliberately tiny limit (~32 bytes); the orchestrator must fail
    // before any OpenAI request is issued.
    const storedPathA = join(directory, 'a.md');
    const storedPathB = join(directory, 'b.md');
    writeSourceFile(storedPathA, 'X'.repeat(40));
    writeSourceFile(storedPathB, 'Y'.repeat(40));
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });
    const sourceB = await seedSource(storedPathB, { sha256: 'b'.repeat(64) });

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
      inputByteLimit: 32,
    });

    const status = await service.extract([sourceA, sourceB]);

    expect(status.kind).toBe('failed');
    if (status.kind !== 'failed') throw new Error('expected failed');
    expect(status.errorCode).toBe('profile_extraction_input_too_large');
    expect(status.attemptCount).toBe(0);
    expect(client.getRequestCount()).toBe(0);

    const metadata = await repositories.openaiMetadata.listByOperation('profile_extraction');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.success).toBe(false);
    expect(metadata[0]?.errorCode).toBe('profile_extraction_input_too_large');
    expect(metadata[0]?.attemptCount).toBe(0);
  });

  it('reuses an existing draft row that matches the fingerprint, without calling OpenAI', async () => {
    const storedPathA = join(directory, 'a.md');
    const storedPathB = join(directory, 'b.md');
    writeSourceFile(storedPathA, 'Alice resume content');
    writeSourceFile(storedPathB, 'Bob resume content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });
    const sourceB = await seedSource(storedPathB, { sha256: 'b'.repeat(64) });

    // Pre-seed a draft row with a stable, non-empty fingerprint. We will
    // pin the actual fingerprint after we know what it is.
    const existingId = await repositories.profileVersions.insert({
      status: 'draft',
      schemaVersion: 1,
      contentHash: 'c'.repeat(64),
      extractionFingerprint: 'placeholder-fp',
      sourceIds: [sourceA, sourceB],
      profileJson: buildProfileJsonString(sourceA),
      createdAt: FIXED_NOW_ISO,
      updatedAt: FIXED_NOW_ISO,
    });

    // Compute the fingerprint the orchestrator would compute for these sources.
    const fp = calculateExtractionFingerprint({
      sourceHashes: ['a'.repeat(64), 'b'.repeat(64)],
      schemaVersion: PROFILE_SCHEMA_VERSION,
      promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
      model: BASE_CONFIG.model,
      reasoningEffort: BASE_CONFIG.reasoningEffort,
      structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
      extractorImplementationVersion: EXTRACTOR_IMPLEMENTATION_VERSION,
    });

    // Update the row to use the actual fingerprint.
    await connection.db
      .update(profileVersionsTable)
      .set({ extractionFingerprint: fp })
      .where(eq(profileVersionsTable.id, existingId))
      .run();

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA, sourceB]);

    expect(status.kind).toBe('reused');
    if (status.kind !== 'reused') throw new Error('expected reused');
    expect(status.profileVersionId).toBe(existingId);
    expect(client.getRequestCount()).toBe(0);
  });

  it('falls through to a new OpenAI call when the existing row is rejected (history preserved)', async () => {
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    const fp = calculateExtractionFingerprint({
      sourceHashes: ['a'.repeat(64)],
      schemaVersion: PROFILE_SCHEMA_VERSION,
      promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
      model: BASE_CONFIG.model,
      reasoningEffort: BASE_CONFIG.reasoningEffort,
      structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
      extractorImplementationVersion: EXTRACTOR_IMPLEMENTATION_VERSION,
    });

    const rejectedId = await repositories.profileVersions.insert({
      status: 'rejected',
      schemaVersion: 1,
      contentHash: 'd'.repeat(64),
      extractionFingerprint: fp,
      sourceIds: [sourceA],
      profileJson: buildProfileJsonString(sourceA),
      createdAt: FIXED_NOW_ISO,
      updatedAt: FIXED_NOW_ISO,
    });

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA]);

    expect(status.kind).toBe('created');
    if (status.kind !== 'created') throw new Error('expected created');
    expect(status.profileVersionId).not.toBe(rejectedId);
    expect(client.getRequestCount()).toBe(1);

    // Original rejected row is still in the database, untouched.
    const rejected = await repositories.profileVersions.getById(rejectedId);
    expect(rejected.status).toBe('rejected');
    expect(rejected.extractionFingerprint).toBe(fp);
  });

  it('succeeds when the first response is invalid JSON but the corrective retry is valid', async () => {
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    const client = new FakeOpenAIClient({
      responses: [
        response('{"basics":'), // first response: malformed JSON
        response(validExtractedJson()), // second response: valid
      ],
    });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA]);

    expect(status.kind).toBe('created');
    expect(client.getRequestCount()).toBe(2);
  });

  it('fails with openai_invalid_output after the corrective retry also fails', async () => {
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    const client = new FakeOpenAIClient({
      responses: [response('not json'), response('also not json')],
    });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA]);

    expect(status.kind).toBe('failed');
    if (status.kind !== 'failed') throw new Error('expected failed');
    expect(status.errorCode).toBe('openai_invalid_output');
    expect(status.attemptCount).toBe(2);

    const metadata = await repositories.openaiMetadata.listByOperation('profile_extraction');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.success).toBe(false);
    expect(metadata[0]?.errorCode).toBe('openai_invalid_output');
    expect(metadata[0]?.attemptCount).toBe(2);
  });

  it('succeeds after one rate-limit retry and records attemptCount === 2', async () => {
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    // First script entry: throw rate limit once. Subsequent calls succeed.
    const client = new FakeOpenAIClient([
      { error: new OpenAIRateLimitError(null) },
      { responses: [response(validExtractedJson())] },
    ]);
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA]);

    expect(status.kind).toBe('created');
    expect(client.getRequestCount()).toBe(2);

    const metadata = await repositories.openaiMetadata.listByOperation('profile_extraction');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.success).toBe(true);
    expect(metadata[0]?.attemptCount).toBe(2);
  });

  it('fails after three OpenAI 500s with attemptCount === 3', async () => {
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    const client = new FakeOpenAIClient({ error: new OpenAIServerError() });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA]);

    expect(status.kind).toBe('failed');
    if (status.kind !== 'failed') throw new Error('expected failed');
    expect(status.errorCode).toBe('openai_server_error');
    expect(status.attemptCount).toBe(3);

    const metadata = await repositories.openaiMetadata.listByOperation('profile_extraction');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.success).toBe(false);
    expect(metadata[0]?.errorCode).toBe('openai_server_error');
    expect(metadata[0]?.attemptCount).toBe(3);
  });

  it('fails immediately on a non-retryable OpenAI 401 with attemptCount === 1', async () => {
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    const client = new FakeOpenAIClient({ error: new OpenAIAuthenticationError() });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA]);

    expect(status.kind).toBe('failed');
    if (status.kind !== 'failed') throw new Error('expected failed');
    expect(status.errorCode).toBe('openai_authentication');
    expect(status.attemptCount).toBe(1);

    expect(client.getRequestCount()).toBe(1);
    const metadata = await repositories.openaiMetadata.listByOperation('profile_extraction');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.success).toBe(false);
    expect(metadata[0]?.errorCode).toBe('openai_authentication');
    expect(metadata[0]?.attemptCount).toBe(1);
  });

  it('merges two-source skills and records one conflict for disagreeing endDate', async () => {
    const storedPathA = join(directory, 'a.md');
    const storedPathB = join(directory, 'b.md');
    writeSourceFile(storedPathA, 'source A content');
    writeSourceFile(storedPathB, 'source B content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });
    const sourceB = await seedSource(storedPathB, { sha256: 'b'.repeat(64) });

    const extracted = {
      basics: {
        headline: null,
        professionalSummary: null,
        currentLocation: null,
        totalYearsOfExperience: 5,
      },
      experience: [
        {
          company: 'Acme',
          title: 'Staff Engineer',
          location: null,
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref(`source_${sourceA}`)],
        },
        {
          company: 'Acme',
          title: 'Staff Engineer',
          location: null,
          startDate: '2020-01',
          endDate: '2023-06',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref(`source_${sourceB}`)],
        },
      ],
      skills: [
        {
          name: 'Node.js',
          category: 'programming_language',
          proficiency: 'expert',
          yearsOfExperience: 5,
          lastUsedAt: null,
          evidence: [
            {
              sourceType: 'experience' as const,
              sourceEntityId: null,
              description: 'Built services.',
            },
          ],
        },
        {
          name: 'NodeJS',
          category: 'programming_language',
          proficiency: 'advanced',
          yearsOfExperience: 5,
          lastUsedAt: null,
          evidence: [
            {
              sourceType: 'project' as const,
              sourceEntityId: null,
              description: 'Refactored runtime.',
            },
          ],
        },
      ],
      languages: [],
      education: [],
      certifications: [],
      projects: [],
      warnings: [],
    };

    const client = new FakeOpenAIClient({ responses: [response(JSON.stringify(extracted))] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA, sourceB]);

    expect(status.kind).toBe('created');
    if (status.kind !== 'created') throw new Error('expected created');

    const version = await repositories.profileVersions.getById(status.profileVersionId);
    const profileJson = version.profileJson as ProfessionalProfile;
    expect(profileJson.skills).toHaveLength(1);
    expect(profileJson.skills[0]?.normalizedName).toBe('nodejs');
    expect(profileJson.skills[0]?.evidence).toHaveLength(2);

    const conflicts = await repositories.profileVersions.listConflicts(status.profileVersionId);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict?.conflictType).toBe('work_experience.end_date');
    expect(conflict?.affectedField).toBe('endDate');
    expect(conflict?.valueSourceA).toBe('2022-01');
    expect(conflict?.valueSourceB).toBe('2023-06');
    const sourceRefs = (conflict?.sourceReferences ?? []) as { sourceId: string }[];
    expect(sourceRefs.map((r) => r.sourceId).sort()).toEqual([
      `source_${sourceA}`,
      `source_${sourceB}`,
    ]);
  });

  it('records an openai_request_metadata row with success: true and relatedEntityType profile_version', async () => {
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    const extracted = validExtractedJson();
    const client = new FakeOpenAIClient({ responses: [response(extracted)] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceA]);
    expect(status.kind).toBe('created');
    if (status.kind !== 'created') throw new Error('expected created');

    const metadata = await repositories.openaiMetadata.listByOperation('profile_extraction');
    expect(metadata).toHaveLength(1);
    const row = metadata[0];
    expect(row?.success).toBe(true);
    expect(row?.relatedEntityType).toBe('profile_version');
    expect(row?.relatedEntityId).toBe(status.profileVersionId);
    expect(row?.model).toBe(BASE_CONFIG.model);
    expect(row?.reasoningEffort).toBe(BASE_CONFIG.reasoningEffort);
    expect(row?.attemptCount).toBe(1);
    expect(row?.validatedOutput).toBeDefined();
    expect(row?.startTimestamp).toBe(FIXED_NOW_ISO);
    expect(row?.endTimestamp).toBe(FIXED_NOW_ISO);
  });

  it('does not touch the active approved profile during extraction', async () => {
    // First, set up an active approved profile by importing and approving
    // one source through the persistence layer.
    const storedPathA = join(directory, 'a.md');
    writeSourceFile(storedPathA, 'initial content');
    const sourceA = await seedSource(storedPathA, { sha256: 'a'.repeat(64) });

    const approvedProfileJson: ProfessionalProfile = {
      schemaVersion: 1,
      id: 'profile_existing_active',
      createdAt: FIXED_NOW_ISO,
      updatedAt: FIXED_NOW_ISO,
      contentHash: 'e'.repeat(64),
      sourceIds: [`source_${sourceA}`],
      basics: {
        headline: 'Approved Headline',
        professionalSummary: null,
        currentLocation: null,
        totalYearsOfExperience: null,
      },
      experience: [],
      skills: [],
      languages: [],
      education: [],
      certifications: [],
      projects: [],
      derived: {
        likelySeniority: {
          generatedValue: null,
          overrideActive: false,
          overrideValue: null,
          effectiveValue: null,
          generatedAt: FIXED_NOW_ISO,
          overriddenAt: null,
        },
        primaryRoles: {
          generatedValue: [],
          overrideActive: false,
          overrideValue: null,
          effectiveValue: [],
          generatedAt: FIXED_NOW_ISO,
          overriddenAt: null,
        },
        primaryDomains: {
          generatedValue: [],
          overrideActive: false,
          overrideValue: null,
          effectiveValue: [],
          generatedAt: FIXED_NOW_ISO,
          overriddenAt: null,
        },
        strongestSkills: {
          generatedValue: [],
          overrideActive: false,
          overrideValue: null,
          effectiveValue: [],
          generatedAt: FIXED_NOW_ISO,
          overriddenAt: null,
        },
      },
    };

    const approvedId = await repositories.profileVersions.insert({
      status: 'approved',
      schemaVersion: 1,
      contentHash: approvedProfileJson.contentHash,
      extractionFingerprint: 'preexisting-fp',
      sourceIds: [sourceA],
      profileJson: approvedProfileJson,
      createdAt: FIXED_NOW_ISO,
      updatedAt: FIXED_NOW_ISO,
    });
    await repositories.profileVersions.approve(approvedId, {
      approvedAt: FIXED_NOW_ISO,
      supersededAt: FIXED_NOW_ISO,
    });

    const beforeActive = await repositories.profileVersions.findActiveApproved();
    expect(beforeActive?.id).toBe(approvedId);

    // Now run a fresh extraction against a different source — should not
    // touch the approved row.
    const storedPathB = join(directory, 'b.md');
    writeSourceFile(storedPathB, 'new source content');
    const sourceB = await seedSource(storedPathB, { sha256: 'b'.repeat(64) });

    const client = new FakeOpenAIClient({ responses: [response(validExtractedJson())] });
    const service = new ProfileExtractionService({
      repositories,
      openaiClient: client,
      config: BASE_CONFIG,
      retry: DEFAULT_RETRY,
      now: fixedNow,
    });

    const status = await service.extract([sourceB]);
    expect(status.kind).toBe('created');

    const afterActive = await repositories.profileVersions.findActiveApproved();
    expect(afterActive?.id).toBe(approvedId);
    expect(afterActive?.status).toBe('approved');
    expect(afterActive?.active).toBe(true);

    const approvedRow = await repositories.profileVersions.getById(approvedId);
    expect(approvedRow.contentHash).toBe('e'.repeat(64));
  });
});
