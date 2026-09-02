/**
 * ProfileReviewService — read-side application service for
 *
 * Two operations:
 *
 *   - `list` returns a flattened list of every persisted profile version
 *     (or a status-filtered subset), ordered most-recent-first by id.
 *   - `show` resolves a profile CLI identifier via `resolveProfileVersionId`
 *     and returns the full payload (profile + warnings + conflicts +
 *     overrides + revisions) needed by the profile-show HTTP route and by the
 *     editor's review view.
 *
 * The service depends on the repositories and the pure review helpers; it
 * never touches Playwright, Drizzle directly, or the
 * OpenAI SDK. It does NOT validate the stored `profileJson` against
 * `ProfessionalProfileSchema` itself — the caller's persistence boundary
 * already does that — but `show` rejects rows whose JSON fails Zod with
 * `InvalidProfilePayloadError` so the desktop app can surface the
 * failure cleanly.
 */

import { ProfessionalProfileSchema, type ProfessionalProfile } from './schema.js';
import {
  type ProfileConflictRow,
  type ProfileRevisionRow,
  type ProfileStatus,
  type ProfileWarningRow,
  type DerivedOverrideRow,
} from '../persistence/repositories/profile-versions.js';
import type { Repositories } from '../persistence/repositories/index.js';
import { resolveProfileVersionId } from './identifier-resolution.js';
import { InvalidProfilePayloadError } from './errors.js';

export interface ProfileListEntry {
  readonly profileVersionId: number;
  readonly profileId: string;
  readonly status: ProfileStatus;
  readonly active: boolean;
  readonly contentHash: string;
  readonly sourceIds: readonly number[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt: string | null;
}

export interface ProfileShowPayload {
  readonly profile: ProfessionalProfile;
  readonly status: ProfileStatus;
  readonly active: boolean;
  readonly contentHash: string;
  readonly extractionFingerprint: string;
  readonly warnings: readonly ProfileWarningRow[];
  readonly conflicts: readonly ProfileConflictRow[];
  readonly overrides: readonly DerivedOverrideRow[];
  readonly revisions: readonly ProfileRevisionRow[];
}

function extractProfileId(profileJson: unknown): string {
  if (
    profileJson !== null &&
    typeof profileJson === 'object' &&
    'id' in profileJson &&
    typeof (profileJson as { id: unknown }).id === 'string'
  ) {
    return (profileJson as { id: string }).id;
  }
  return '';
}

export class ProfileReviewService {
  constructor(private readonly repositories: Repositories) {}

  /**
   * Return every persisted profile version, optionally filtered by status.
   * Order is most-recent-first (id DESC) so the CLI default output reads
   * naturally top-to-bottom.
   */
  async list(opts?: { status?: ProfileStatus }): Promise<readonly ProfileListEntry[]> {
    const rows = await this.repositories.profileVersions.list(
      opts?.status === undefined ? undefined : { status: opts.status },
    );
    // The repository returns rows in PK ASC order; flip to DESC for display.
    const sorted = [...rows].sort((a, b) => b.id - a.id);
    return sorted.map((row) => ({
      profileVersionId: row.id,
      profileId: extractProfileId(row.profileJson),
      status: row.status,
      active: row.active,
      contentHash: row.contentHash,
      sourceIds: row.sourceIds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      approvedAt: row.approvedAt,
    }));
  }

  /**
   * Resolve the CLI identifier and assemble the full review payload.
   * Throws `InvalidProfileIdentifierError` for unknown / malformed ids and
   * `InvalidProfilePayloadError` if the stored JSON fails Zod validation.
   */
  async show(rawId: string): Promise<ProfileShowPayload> {
    const profileVersionId = await resolveProfileVersionId(this.repositories, rawId);
    const row = await this.repositories.profileVersions.getById(profileVersionId);
    const parsed = ProfessionalProfileSchema.safeParse(row.profileJson);
    if (!parsed.success) {
      throw new InvalidProfilePayloadError(
        'invalid_profile_payload',
        `Profile version ${profileVersionId} stored JSON failed validation.`,
        { profileVersionId, issues: parsed.error.issues },
      );
    }
    const [warnings, conflicts, overrides, revisions] = await Promise.all([
      this.repositories.profileVersions.listWarnings(profileVersionId),
      this.repositories.profileVersions.listConflicts(profileVersionId),
      this.repositories.profileVersions.listOverrides(profileVersionId),
      this.repositories.profileVersions.listRevisions(profileVersionId),
    ]);
    return {
      profile: parsed.data,
      status: row.status,
      active: row.active,
      contentHash: row.contentHash,
      extractionFingerprint: row.extractionFingerprint,
      warnings,
      conflicts,
      overrides,
      revisions,
    };
  }
}
