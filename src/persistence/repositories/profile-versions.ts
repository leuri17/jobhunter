import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

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
    validationWarnings: unknownJson.decode(record.validationWarningsJson) as
      readonly unknown[] | null,
    unresolvedConflicts: unknownJson.decode(record.unresolvedConflictsJson) as
      readonly unknown[] | null,
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
        validationWarningsJson:
          input.validationWarnings === undefined
            ? null
            : unknownJson.encode(input.validationWarnings),
        unresolvedConflictsJson:
          input.unresolvedConflicts === undefined
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
    const filtered =
      opts?.status === undefined ? base : base.where(eq(profileVersions.status, opts.status));
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
        previousValueJson:
          input.previousValue === undefined || input.previousValue === null
            ? null
            : unknownJson.encode(input.previousValue),
        newValueJson:
          input.newValue === undefined || input.newValue === null
            ? null
            : unknownJson.encode(input.newValue),
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
        valueSourceAJson:
          input.valueSourceA === undefined || input.valueSourceA === null
            ? null
            : unknownJson.encode(input.valueSourceA),
        valueSourceBJson:
          input.valueSourceB === undefined || input.valueSourceB === null
            ? null
            : unknownJson.encode(input.valueSourceB),
        sourceReferencesJson: unknownJson.encode(input.sourceReferences),
        provisionalValueJson:
          input.provisionalValue === undefined || input.provisionalValue === null
            ? null
            : unknownJson.encode(input.provisionalValue),
        explanation: input.explanation,
        resolutionStatus: input.resolutionStatus,
        resolvedAt: input.resolvedAt,
        resolvedValueJson:
          input.resolvedValue === undefined || input.resolvedValue === null
            ? null
            : unknownJson.encode(input.resolvedValue),
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

  async resolveConflict(
    id: number,
    options: { resolvedAt: string; resolvedValue: unknown | null },
  ): Promise<void> {
    this.ctx.db
      .update(profileConflicts)
      .set({
        resolutionStatus: 'resolved',
        resolvedAt: options.resolvedAt,
        resolvedValueJson:
          options.resolvedValue === null ? null : unknownJson.encode(options.resolvedValue),
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
            overrideValueJson:
              input.overrideValue === null ? null : unknownJson.encode(input.overrideValue),
            generatedValueJson:
              input.generatedValue === null ? null : unknownJson.encode(input.generatedValue),
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
          overrideValueJson:
            input.overrideValue === null ? null : unknownJson.encode(input.overrideValue),
          generatedValueJson:
            input.generatedValue === null ? null : unknownJson.encode(input.generatedValue),
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
