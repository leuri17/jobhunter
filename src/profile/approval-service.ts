/**
 * ProfileApprovalService — application service for TASK-009 / SPEC §16.3.
 *
 * Approval is the explicit lifecycle gate that turns a draft into the
 * single active approved profile. The service implements the SPEC §16.3
 * step list:
 *
 *   1. Validate the profile again (Zod parse of the stored JSON).
 *   2. Require every blocking conflict to be resolved (unresolved rows on
 *      `profile_conflicts` AND any `blocking_conflict` warning).
 *   3. Show remaining `warning`-severity rows and require an explicit
 *      confirmation.
 *   4. Mark the draft `approved`, set it active, supersede the prior
 *      active profile, recalculate the final content hash.
 *   5. Invalidate dependent `filter_results` rows tied to the prior
 *      approved profile (SPEC §16.3 step 9). Score-result invalidation is
 *      deferred to TASK-014 because the table lacks a `profile_version_id`
 *      column.
 *
 * `profileVersions.approve` already flips the prior active row to
 * `superseded` and promotes the new row to active inside one transaction
 * (TASK-004). We layer the content-hash update + filter invalidation on
 * top, sequenced so the approval stays atomic and reversible.
 */

import { eq } from 'drizzle-orm';

import { ProfessionalProfileSchema } from './schema.js';
import { calculateProfileContentHash } from './content-hash.js';
import { profileVersions as profileVersionsTable } from '../persistence/schema.js';
import { jsonColumn } from '../persistence/repositories/codecs.js';
import { z } from 'zod';
import type { Repositories } from '../persistence/repositories/index.js';
import { resolveProfileVersionId } from './identifier-resolution.js';
import {
  BlockingConflictsUnresolvedError,
  InvalidProfilePayloadError,
  InvalidProfileStateError,
  UserCancelledApprovalError,
} from './errors.js';

export interface ProfileApprovalPrompts {
  confirmApprovalWithWarnings(input: {
    readonly profileVersionId: number;
    readonly remainingWarnings: readonly string[];
  }): Promise<boolean>;
}

export interface ProfileApprovalServiceOptions {
  readonly repositories: Repositories;
  readonly prompts: ProfileApprovalPrompts;
  readonly now?: () => Date;
}

export interface ProfileApprovalSummary {
  readonly approvedProfileVersionId: number;
  readonly supersededProfileVersionId: number | null;
  readonly invalidatedFilterResults: number;
  readonly remainingWarnings: number;
}

const unknownJson = jsonColumn<unknown>(z.unknown());

export class ProfileApprovalService {
  private readonly repositories: Repositories;
  private readonly prompts: ProfileApprovalPrompts;
  private readonly now: () => Date;

  constructor(options: ProfileApprovalServiceOptions) {
    this.repositories = options.repositories;
    this.prompts = options.prompts;
    this.now = options.now ?? ((): Date => new Date());
  }

  async approve(rawId: string): Promise<ProfileApprovalSummary> {
    const profileVersionId = await resolveProfileVersionId(this.repositories, rawId);
    const row = await this.repositories.profileVersions.getById(profileVersionId);

    if (row.status !== 'draft') {
      throw new InvalidProfileStateError(
        'profile_not_approvable',
        `Profile version ${profileVersionId} cannot be approved in status "${row.status}".`,
        { profileVersionId, status: row.status },
      );
    }

    // 1. Re-validate the stored JSON.
    const parsed = ProfessionalProfileSchema.safeParse(row.profileJson);
    if (!parsed.success) {
      throw new InvalidProfilePayloadError(
        'invalid_profile_payload',
        `Profile version ${profileVersionId} stored JSON failed validation.`,
        { profileVersionId, issues: parsed.error.issues },
      );
    }

    // 2. Refuse if any blocking conflict remains (unresolved conflict row OR
    //    a `blocking_conflict` warning row). Per SPEC §16.5 both surfaces
    //    must be clear before approval proceeds.
    const conflicts = await this.repositories.profileVersions.listConflicts(profileVersionId);
    const warnings = await this.repositories.profileVersions.listWarnings(profileVersionId);
    const unresolvedConflicts = conflicts.filter((c) => c.resolutionStatus === 'unresolved');
    const blockingWarnings = warnings.filter((w) => w.severity === 'blocking_conflict');
    if (unresolvedConflicts.length > 0 || blockingWarnings.length > 0) {
      throw new BlockingConflictsUnresolvedError(
        'blocking_conflicts_unresolved',
        `Profile version ${profileVersionId} has ${unresolvedConflicts.length} unresolved conflict(s) and ${blockingWarnings.length} blocking warning(s). Resolve them before approving.`,
        {
          profileVersionId,
          unresolvedConflictCount: unresolvedConflicts.length,
          blockingWarningCount: blockingWarnings.length,
        },
      );
    }

    // 3. Non-blocking warnings → ask the user to confirm before approval.
    const nonBlockingWarnings = warnings.filter((w) => w.severity === 'warning');
    if (nonBlockingWarnings.length > 0) {
      const confirmed = await this.prompts.confirmApprovalWithWarnings({
        profileVersionId,
        remainingWarnings: nonBlockingWarnings.map((w) => w.message),
      });
      if (!confirmed) {
        throw new UserCancelledApprovalError(
          'approval_cancelled',
          'Approval was cancelled because the user did not confirm the remaining warnings.',
          { profileVersionId, warningCount: nonBlockingWarnings.length },
        );
      }
    }

    // 4. Recalculate the final content hash on the validated profile.
    const finalProfile = { ...parsed.data, contentHash: calculateProfileContentHash(parsed.data) };
    const nowIso = this.now().toISOString();
    const supersededAt = nowIso;

    // 5. Persist the freshly-rehashed profile JSON + content hash.
    this.repositories.db
      .update(profileVersionsTable)
      .set({
        profileJson: unknownJson.encode(finalProfile),
        contentHash: finalProfile.contentHash,
        updatedAt: nowIso,
      })
      .where(eq(profileVersionsTable.id, profileVersionId))
      .run();

    // 6. Find the prior approved+active row (if any) before the swap.
    const priorApproved = await this.repositories.profileVersions.findActiveApproved();
    const supersededProfileVersionId =
      priorApproved !== null && priorApproved.id !== profileVersionId ? priorApproved.id : null;

    // 7. Active swap — atomic in the repository.
    await this.repositories.profileVersions.approve(profileVersionId, {
      approvedAt: nowIso,
      supersededAt,
    });

    // 8. Invalidate dependent filter_results tied to the prior approved
    //    profile. Idempotent — returns 0 when there are no rows.
    const invalidatedFilterResults =
      supersededProfileVersionId !== null
        ? await this.repositories.filterResults.invalidateByProfileVersion(
            supersededProfileVersionId,
          )
        : 0;

    return {
      approvedProfileVersionId: profileVersionId,
      supersededProfileVersionId,
      invalidatedFilterResults,
      remainingWarnings: nonBlockingWarnings.length,
    };
  }
}
