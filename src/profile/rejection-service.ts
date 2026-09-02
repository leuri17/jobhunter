/**
 * ProfileRejectionService — application service for  / .
 *
 * Rejection marks a draft `rejected` and leaves the previously approved
 * profile active. No dependent results are invalidated (per :
 * "Avoid invalidating existing results").
 *
 * Allowed input states:
 *
 *   - draft            → mark `rejected`, leave active=false
 *   - approved         → refuse with `InvalidProfileStateError`
 *   - superseded       → refuse with `InvalidProfileStateError`
 *   - rejected         → refuse with `InvalidProfileStateError`
 *
* The user-cancellation seam is exposed via `ProfileRejectionPrompts` so
 * the desktop shell can drive the rejection confirmation dialog. The
 * default desktop adapter wires this to a confirmation component.
*
 * The service depends on the repositories and the identifier-resolution
 * helper; it never touches Playwright, Drizzle
 * directly, or the OpenAI SDK.
 */

import type { Repositories } from '../persistence/repositories/index.js';
import { resolveProfileVersionId } from './identifier-resolution.js';
import { InvalidProfileStateError, UserCancelledRejectionError } from './errors.js';

export interface ProfileRejectionPrompts {
  confirmRejection(input: { readonly profileVersionId: number }): Promise<boolean>;
}

export interface ProfileRejectionServiceOptions {
  readonly repositories: Repositories;
  readonly prompts: ProfileRejectionPrompts;
  readonly now?: () => Date;
}

export interface ProfileRejectionResult {
  readonly rejectedProfileVersionId: number;
}

export class ProfileRejectionService {
  private readonly repositories: Repositories;
  private readonly prompts: ProfileRejectionPrompts;
  private readonly now: () => Date;

  constructor(options: ProfileRejectionServiceOptions) {
    this.repositories = options.repositories;
    this.prompts = options.prompts;
    this.now = options.now ?? ((): Date => new Date());
  }

  async reject(rawId: string): Promise<ProfileRejectionResult> {
    const profileVersionId = await resolveProfileVersionId(this.repositories, rawId);
    const row = await this.repositories.profileVersions.getById(profileVersionId);
    if (row.status !== 'draft') {
      throw new InvalidProfileStateError(
        'profile_not_rejectable',
        `Profile version ${profileVersionId} cannot be rejected in status "${row.status}".`,
        { profileVersionId, status: row.status },
      );
    }
    const confirmed = await this.prompts.confirmRejection({ profileVersionId });
    if (!confirmed) {
      throw new UserCancelledRejectionError(
        'rejection_cancelled',
        'Rejection was cancelled by the user.',
        { profileVersionId },
      );
    }
    await this.repositories.profileVersions.reject(profileVersionId, {
      now: this.now().toISOString(),
    });
    return { rejectedProfileVersionId: profileVersionId };
  }
}
