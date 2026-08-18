import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, Repositories } from '../../src/persistence/repositories/index.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';
import { createDefaultFileSystem } from '../../src/config/file-system-default.js';
import type { FileSystem } from '../../src/config/file-system.js';
import { updateConfig } from '../../src/config/updater.js';
import { DEFAULT_OPERATIONAL_CONFIG, type OperationalConfig } from '../../src/config/schema.js';
import { JobFilterConfigSchema, type JobFilterConfig } from '../../src/filter/schema.js';
import { ScriptedFilterPrompts } from '../../src/filter/prompts.js';
import { InitOrchestrator } from '../../src/init/init-service.js';
import { ScriptedInitPrompts, createFailingInitPrompts } from '../../src/init/prompts.js';
import {
  SearchCancelledError,
  type SearchPrompts,
  type SearchConfigurationPreview,
} from '../../src/search/index.js';
import { FakeOpenAIClient } from '../../src/profile/openai/fake-client.js';
import type { OpenAIExtractionRawResponse } from '../../src/profile/openai/types.js';
import { PROFILE_SCHEMA_VERSION, type ProfessionalProfile } from '../../src/profile/schema.js';
import { hashString } from '../../src/profile/hashing.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const MIGRATIONS_FOLDER = join(REPO_ROOT, 'drizzle');

function adapter(home: string): PlatformAdapter {
  return { platform: 'linux', home, environment: {} };
}

function minimalConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: [],
    title: { excludedKeywords: [], requiredAnyKeywords: [] },
    description: { excludedKeywords: [], requiredAnyKeywords: [] },
    seniority: { maximum: null },
    languages: { accepted: [], rejectWhenExplicitlyRequiresOtherLanguage: false },
  };
}

function minimalProfileJson(id: string): ProfessionalProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    contentHash: hashString(`init-${id}`),
    sourceIds: [],
    basics: {
      headline: null,
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
        generatedAt: null,
        overriddenAt: null,
      },
      primaryRoles: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: null,
        overriddenAt: null,
      },
      primaryDomains: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: null,
        overriddenAt: null,
      },
      strongestSkills: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: null,
        overriddenAt: null,
      },
    },
  };
}

function openAiResponse(): OpenAIExtractionRawResponse {
  return {
    rawJsonText: JSON.stringify({
      basics: {
        headline: 'Headline',
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
      warnings: [],
    }),
    tokenUsage: { promptTokens: 1, completionTokens: 1 },
  };
}

/**
 * Minimal scripted search prompts that walk through the configure-search
 * flow with a single canned query, workplace type, and location.
 */
function scriptedSearchPrompts(): SearchPrompts {
  return {
    askSearchQueries: async (existing) => (existing.length > 0 ? existing : ['engineer']),
    askDatePosted: async (existing) => existing ?? 86400,
    askWorkplaceTypes: async (existing) =>
      existing.length > 0 ? existing : (['1', '2', '3'] as const),
    askLocationURLs: async () => [
      { name: 'Remote', geoId: '1', originalUrl: 'https://www.linkedin.com/jobs/search?geoId=1' },
    ],
    askLocationName: async () => 'Remote',
    askRenameLabel: async () => false,
    showPreview: async (_preview: SearchConfigurationPreview, _matrixSize: number) => undefined,
    askConfirmation: async (_preview: SearchConfigurationPreview, _matrixSize: number) => true,
  };
}

function scriptedCancellingSearchPrompts(): SearchPrompts {
  return {
    askSearchQueries: async () => ['engineer'],
    askDatePosted: async () => 86400,
    askWorkplaceTypes: async () => ['1', '2', '3'] as const,
    askLocationURLs: async () => [
      { name: 'Remote', geoId: '1', originalUrl: 'https://www.linkedin.com/jobs/search?geoId=1' },
    ],
    askLocationName: async () => 'Remote',
    askRenameLabel: async () => false,
    showPreview: async () => undefined,
    askConfirmation: async () => false, // triggers SearchCancelledError
  };
}

describe('InitOrchestrator', () => {
  const ENV_WITH_KEY: Readonly<Record<string, string | undefined>> = {
    OPENAI_API_KEY: 'test-key',
  };
  const ENV_WITHOUT_KEY: Readonly<Record<string, string | undefined>> = {};
  let tempHome: string;
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;
  let paths: ReturnType<typeof resolvePlatformPaths>;
  let fileSystem: FileSystem;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-init-orchestrator-'));
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-init-orchestrator-db-'));
    mkdirSync(join(tempHome, 'profile-sources'), { recursive: true });
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: MIGRATIONS_FOLDER });
    repositories = createRepositories(connection);
    paths = resolvePlatformPaths(adapter(tempHome));
    fileSystem = createDefaultFileSystem();
  });

  afterEach(() => {
    connection.close();
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  });

  async function seedUsableSource(sha256: string): Promise<number> {
    return repositories.profileSources.insert({
      sourceType: 'plain_text',
      originalFilename: 'cv.txt',
      originalAbsolutePath: '/tmp/cv.txt',
      storedPath: '/tmp/stored/cv.txt',
      mimeType: 'text/plain',
      fileSize: 100,
      sha256,
      importTimestamp: '2026-08-18T10:00:00.000Z',
      textExtractionStatus: 'success',
      textExtractionMessage: null,
    });
  }

  async function seedApprovedProfile(
    opts: {
      readonly jsonId?: string;
      readonly conflictCount?: number;
    } = {},
  ): Promise<number> {
    const jsonId = opts.jsonId ?? 'prf_init';
    const sourceId = await seedUsableSource('a'.repeat(64));
    const id = await repositories.profileVersions.insert({
      status: 'approved',
      schemaVersion: PROFILE_SCHEMA_VERSION,
      contentHash: hashString(jsonId),
      extractionFingerprint: 'fp_' + jsonId,
      sourceIds: [sourceId],
      profileJson: minimalProfileJson(jsonId),
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
      active: true,
    });
    await repositories.profileVersions.approve(id, {
      approvedAt: '2026-08-18T10:00:00.000Z',
      supersededAt: '2026-08-18T10:00:00.000Z',
    });
    if (opts.conflictCount !== undefined && opts.conflictCount > 0) {
      for (let i = 0; i < opts.conflictCount; i++) {
        await repositories.profileVersions.insertConflict({
          profileVersionId: id,
          conflictType: 'test_conflict',
          affectedField: 'basics.headline',
          valueSourceA: 'A',
          valueSourceB: 'B',
          sourceReferences: [],
          provisionalValue: 'A',
          explanation: 'seeded',
          resolutionStatus: 'unresolved',
          resolvedAt: null,
          resolvedValue: null,
        });
      }
    }
    return id;
  }

  async function seedDraftProfile(
    opts: {
      readonly jsonId?: string;
      readonly blockingConflictCount?: number;
      readonly nonBlockingWarnings?: readonly string[];
    } = {},
  ): Promise<number> {
    const jsonId = opts.jsonId ?? 'prf_draft';
    const sourceId = await seedUsableSource('b'.repeat(64));
    const id = await repositories.profileVersions.insert({
      status: 'draft',
      schemaVersion: PROFILE_SCHEMA_VERSION,
      contentHash: hashString(jsonId),
      extractionFingerprint: 'fp_' + jsonId,
      sourceIds: [sourceId],
      profileJson: minimalProfileJson(jsonId),
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
      active: false,
    });
    if (opts.blockingConflictCount !== undefined && opts.blockingConflictCount > 0) {
      await repositories.profileVersions.insertConflict({
        profileVersionId: id,
        conflictType: 'test_conflict',
        affectedField: 'basics.headline',
        valueSourceA: 'A',
        valueSourceB: 'B',
        sourceReferences: [],
        provisionalValue: 'A',
        explanation: 'seeded conflict',
        resolutionStatus: 'unresolved',
        resolvedAt: null,
        resolvedValue: null,
      });
    }
    if (opts.nonBlockingWarnings !== undefined) {
      for (const message of opts.nonBlockingWarnings) {
        await repositories.profileVersions.insertWarning({
          profileVersionId: id,
          severity: 'warning',
          warningType: 'extraction_warning',
          fieldPath: null,
          message,
          createdAt: '2026-08-18T10:00:00.000Z',
        });
      }
    }
    return id;
  }

  async function seedActiveFilterConfig(): Promise<number> {
    return repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-init',
      configJson: minimalConfig(),
      createdAt: '2026-08-18T10:00:00.000Z',
      active: true,
    });
  }

  async function materializeConfig(patch: Partial<OperationalConfig> = {}): Promise<void> {
    await updateConfig(paths, { ...patch }, { confirm: async () => true }, fileSystem);
  }

  // -------------------------------------------------------------------
  // Scenario 1: Fresh HOME, no OpenAI key — pre-seeded everything
  // (config + search + sources + approved profile + filter config);
  // the orchestrator walks every step, finds the extract step
  // incomplete due to the missing key, and returns `ready: false,
  // openAiKeyMissing: true`.
  // -------------------------------------------------------------------
  it('fresh HOME, no OpenAI key: ready=false, openAiKeyMissing=true', async () => {
    await materializeConfig();
    await seedApprovedProfile();
    await seedActiveFilterConfig();

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({ confirmSummary: true }),
      openaiClient: null,
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    const summary = await orchestrator.run(ENV_WITHOUT_KEY);
    expect(summary.ready).toBe(false);
    expect(summary.openAiKeyMissing).toBe(true);
    expect(summary.nextStep).toBe('extract');
    const extractStep = summary.steps.find((s) => s.id === 'extract');
    expect(extractStep?.status).toBe('incomplete');
    expect(extractStep?.reason).toBe('openai_key_missing');
  });

  // -------------------------------------------------------------------
  // Scenario 2: Resume after pre-seeded config + search + approved
  // profile + filter config + draft profile version (so extract is
  // complete) — the orchestrator returns `ready: true`.
  // -------------------------------------------------------------------
  it('resume after fully pre-seeded state: ready=true', async () => {
    await materializeConfig();
    await seedUsableSource('c'.repeat(64));
    await seedApprovedProfile({ jsonId: 'prf_init' });
    await seedDraftProfile({ jsonId: 'prf_draft' });
    await seedActiveFilterConfig();

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({ confirmSummary: true }),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    const summary = await orchestrator.run(ENV_WITH_KEY);
    expect(summary.ready).toBe(true);
    expect(summary.nextStep).toBeNull();
    expect(summary.openAiKeyMissing).toBe(false);
    for (const step of summary.steps) {
      expect(step.status).toBe('complete');
    }
  });

  // -------------------------------------------------------------------
  // Scenario 3: Missing API key, pre-seeded config + approved
  // profile + filter config + source (no draft). The orchestrator
  // walks; the extract step is incomplete with
  // reason='openai_key_missing'.
  // -------------------------------------------------------------------
  it('missing API key with pre-seeded state: extract step reports openai_key_missing', async () => {
    await materializeConfig();
    await seedUsableSource('d'.repeat(64));
    await seedApprovedProfile();
    await seedActiveFilterConfig();

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({ confirmSummary: true }),
      openaiClient: null,
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    const summary = await orchestrator.run(ENV_WITHOUT_KEY);
    expect(summary.ready).toBe(false);
    expect(summary.openAiKeyMissing).toBe(true);
    const extractStep = summary.steps.find((s) => s.id === 'extract');
    expect(extractStep?.status).toBe('incomplete');
    expect(extractStep?.reason).toBe('openai_key_missing');
  });

  // -------------------------------------------------------------------
  // Scenario 4: Draft handoff with askEditHandoff='edit_then_return'
  // — the orchestrator returns a partial summary with
  // nextStep='approvedProfile'. We assert that
  // ProfileEditingService.startEdit was NEVER called by inspecting
  // that no profile_revisions row was inserted during the run.
  // -------------------------------------------------------------------
  it('draft handoff edit_then_return: ready=false, nextStep=approvedProfile, no editing service invoked', async () => {
    await materializeConfig();
    await seedUsableSource('e'.repeat(64));
    const draftId = await seedDraftProfile({ jsonId: 'prf_handoff' });
    await seedActiveFilterConfig();

    const initialRevisionCount = (await repositories.profileVersions.listRevisions(draftId)).length;

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({ editHandoff: 'edit_then_return' }),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    const summary = await orchestrator.run(ENV_WITH_KEY);
    expect(summary.ready).toBe(false);
    expect(summary.nextStep).toBe('approvedProfile');
    const approvedStep = summary.steps.find((s) => s.id === 'approvedProfile');
    expect(approvedStep?.status).toBe('not_started');
    expect(approvedStep?.reason).toBe('edit_handoff');
    expect(approvedStep?.artifactId).toBe(`profile_${draftId}`);
    // No revisions were inserted by an editor.
    const finalRevisionCount = (await repositories.profileVersions.listRevisions(draftId)).length;
    expect(finalRevisionCount).toBe(initialRevisionCount);
  });

  // -------------------------------------------------------------------
  // Scenario 5: Blocking conflicts on approve_now — the orchestrator
  // catches BlockingConflictsUnresolvedError, records the step as
  // failed with errorCode='blocking_conflicts_unresolved', and
  // returns a partial summary.
  // -------------------------------------------------------------------
  it('blocking conflicts on approve_now: step failed, errorCode=blocking_conflicts_unresolved', async () => {
    await materializeConfig();
    await seedUsableSource('f'.repeat(64));
    const draftId = await seedDraftProfile({
      jsonId: 'prf_blocking',
      blockingConflictCount: 1,
    });
    await seedActiveFilterConfig();

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({ editHandoff: 'approve_now' }),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    const summary = await orchestrator.run(ENV_WITH_KEY);
    expect(summary.ready).toBe(false);
    expect(summary.nextStep).toBe('approvedProfile');
    const approvedStep = summary.steps.find((s) => s.id === 'approvedProfile');
    expect(approvedStep?.status).toBe('failed');
    expect(approvedStep?.errorCode).toBe('blocking_conflicts_unresolved');
    expect(approvedStep?.artifactId).toBe(`profile_${draftId}`);
    // The draft was NOT approved (still status=draft, active=false).
    const after = await repositories.profileVersions.findById(draftId);
    expect(after?.status).toBe('draft');
    expect(after?.active).toBe(false);
  });

  // -------------------------------------------------------------------
  // Scenario 6: Cancellation — scripted search prompt returns false
  // (triggers SearchCancelledError). The orchestrator rethrows.
  // -------------------------------------------------------------------
  it('cancellation: SearchCancelledError is rethrown, no partial summary returned', async () => {
    await materializeConfig();
    // No sources / draft / approval / filter — orchestrator walks all
    // the way to search and the scripted prompts cancel.

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({}),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedCancellingSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    await expect(orchestrator.run({})).rejects.toBeInstanceOf(SearchCancelledError);
  });

  // -------------------------------------------------------------------
  // Scenario 7: No-op config seeding — empty HOME, no `config.json`,
  // orchestrator materializes it via `updateConfig(paths, {}, ...)`.
  // -------------------------------------------------------------------
  it('no-op config seeding: updateConfig with {} materializes config.json', async () => {
    // Do NOT materializeConfig. The orchestrator should call
    // updateConfig itself.
    await seedUsableSource('1'.repeat(64));
    await seedApprovedProfile();
    await seedActiveFilterConfig();

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({}),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    const summary = await orchestrator.run(ENV_WITH_KEY);

    // The orchestrator should have walked past the config step.
    const configStep = summary.steps.find((s) => s.id === 'config');
    expect(configStep?.status).toBe('complete');

    // And config.json should now exist on disk.
    const exists = await fileSystem.pathExists(paths.config.file('config.json'));
    expect(exists).toBe(true);
  });

  // -------------------------------------------------------------------
  // Scenario 8: Soft-exit confirmSummary=false on a fully-ready init
  // — the orchestrator returns the summary without throwing.
  // -------------------------------------------------------------------
  it('soft-exit: confirmSummary=false returns the summary without throwing', async () => {
    await materializeConfig();
    await seedUsableSource('2'.repeat(64));
    await seedApprovedProfile({ jsonId: 'prf_ready' });
    await seedDraftProfile({ jsonId: 'prf_draft_ready' });
    await seedActiveFilterConfig();

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({ confirmSummary: false }),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    const summary = await orchestrator.run(ENV_WITH_KEY);
    expect(summary.ready).toBe(true);
    expect(summary.nextStep).toBeNull();
  });

  // -------------------------------------------------------------------
  // Scenario 9: The orchestrator NEVER calls `ProfileEditingService`
  // during the edit_then_return handoff — no ProfileEditingService
  // instance is ever constructed (we never import it in the test
  // module). The presence of the draft post-run proves the editor
  // was bypassed.
  // -------------------------------------------------------------------
  it('does not mutate the draft on edit_then_return', async () => {
    await materializeConfig();
    await seedUsableSource('3'.repeat(64));
    const draftId = await seedDraftProfile({ jsonId: 'prf_unmodified' });
    await seedActiveFilterConfig();

    const draftBefore = await repositories.profileVersions.findById(draftId);

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: new ScriptedInitPrompts({ editHandoff: 'edit_then_return' }),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    await orchestrator.run(ENV_WITH_KEY);

    const draftAfter = await repositories.profileVersions.findById(draftId);
    expect(draftAfter?.status).toBe(draftBefore?.status);
    expect(draftAfter?.active).toBe(draftBefore?.active);
    expect(draftAfter?.contentHash).toBe(draftBefore?.contentHash);
  });

  // -------------------------------------------------------------------
  // Scenario 10: createFailingInitPrompts surfaces a plain Error —
  // the orchestrator does NOT wrap it in any typed lifecycle error.
  // -------------------------------------------------------------------
  it('createFailingInitPrompts: a plain Error surfaces uncaught through run()', async () => {
    await materializeConfig();
    await seedUsableSource('4'.repeat(64));
    // NO approved profile — only a draft — so the orchestrator reaches
    // the approvedProfile step and calls askEditHandoff.
    await seedDraftProfile({ jsonId: 'prf_boom' });
    await seedActiveFilterConfig();

    const orchestrator = new InitOrchestrator({
      paths,
      repositories,
      fileSystem,
      prompts: createFailingInitPrompts('boom'),
      openaiClient: new FakeOpenAIClient({ responses: [openAiResponse()] }),
      searchPrompts: scriptedSearchPrompts(),
      filterPrompts: new ScriptedFilterPrompts({}),
      approvalPrompts: { confirmApprovalWithWarnings: async () => true },
      rejectionPrompts: { confirmRejection: async () => true },
    });

    // The orchestrator reaches the approvedProfile step and
    // askEditHandoff throws `Error('boom')`.
    await expect(orchestrator.run(ENV_WITH_KEY)).rejects.toThrow('boom');
  });
});

/**
 * Sanity-check the JobFilterConfigSchema is wired correctly so the
 * orchestrator's `classifyFilters` step validates against the same
 * shape used by `ConfigureFiltersService`.
 */
describe('init orchestrator — module wiring', () => {
  it('uses the same JobFilterConfigSchema version as ConfigureFiltersService', () => {
    expect(JobFilterConfigSchema.shape.schemaVersion.value).toBe(1);
    // The schema rejects unknown keys (strict mode).
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      unknownKey: 'nope',
    });
    expect(result.success).toBe(false);
    // DEFAULT_OPERATIONAL_CONFIG has the documented search shape.
    expect(DEFAULT_OPERATIONAL_CONFIG.search.searchQueries).toEqual([]);
  });
});
