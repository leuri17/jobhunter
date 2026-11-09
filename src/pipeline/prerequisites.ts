import type { Repositories } from '../persistence/repositories/index.js';
import { PipelinePrerequisiteError } from './errors.js';

/**
 * Assert the persisted prerequisites a pipeline run needs before it can
 * start: an active approved profile and an active filter configuration.
 * Shared by the orchestrator's pre-run validation and the sidecar's
 * synchronous run preflight so the error codes and user-facing copy
 * cannot drift between the two.
 */
export async function assertPipelinePrerequisites(repositories: Repositories): Promise<void> {
  const activeProfile = await repositories.profileVersions.findActiveApproved();
  if (activeProfile === null) {
    throw new PipelinePrerequisiteError(
      'no_active_profile',
      'No active approved profile. Approve a profile on the Profile page before starting a run.',
    );
  }
  const activeFilter = await repositories.filterConfigurations.findActive();
  if (activeFilter === null) {
    throw new PipelinePrerequisiteError(
      'no_active_filter',
      'No active filter configuration. One is created during first-run setup; in-app filter management is tracked in issue #301.',
    );
  }
}
