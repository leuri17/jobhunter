// Centralized types for the desktop UI's API client.
//
// Re-exports zod-derived types and inspection/profile/config payloads
// from `@jobhunter/core/*` so Phase E pages can consume typed response
// payloads without depending on each core barrel directly.

import type { OperationalConfig } from '@jobhunter/core/config';
import type {
  ProfileApprovalSummary,
  ProfileListEntry,
  ProfileRejectionResult,
  ProfileShowPayload,
} from '@jobhunter/core/profile';
import type {
  JobListRow,
  JobListState,
  JobShowPayload,
  RunListRow,
  RunShowPayload,
} from '@jobhunter/core/inspection';

// Re-export the inferred types under their original names for callers that
// import directly from `./types`.
export type {
  JobListRow,
  JobListState,
  JobShowPayload,
  RunListRow,
  RunShowPayload,
  OperationalConfig,
  ProfileApprovalSummary,
  ProfileListEntry,
  ProfileRejectionResult,
  ProfileShowPayload,
};

// --- API response shapes (mirror desktop/sidecar/src/routes/* handlers) ---

export interface HealthResponse {
  readonly schemaVersion: 1;
  readonly status: 'ok';
}

export interface PathsResponse {
  readonly schemaVersion: 1;
  readonly paths: Record<string, string>;
}

export interface ConfigResponse {
  readonly schemaVersion: 1;
  readonly config: OperationalConfig;
}

export interface ValidateConfigResponse {
  readonly schemaVersion: 1;
  readonly valid: true;
}

/** Where the sidecar persists the OpenAI API key (issue #211). */
export type SecretsBackend = 'keychain' | 'file';

/**
 * Why the backend fell back to the file store. Present only on
 * `file`; the UI matches on these stable tokens, never on messages.
 */
export type SecretsBackendReason = 'bridge_not_configured' | 'keychain_unavailable';

/** Backend fields carried by every /api/secrets/api-key response. */
interface SecretsBackendFields {
  readonly backend: SecretsBackend;
  readonly backendReason?: SecretsBackendReason;
}

/**
 * The API key itself is never returned. `masked` is enough for the UI
 * to show that a key exists without ever holding the real value.
 * GET additionally reports whether a pre-keychain secrets file still
 * exists on disk so the UI can offer migration.
 */
export interface ApiKeyResponse extends SecretsBackendFields {
  readonly schemaVersion: 1;
  readonly configured: boolean;
  readonly source: 'stored' | 'environment' | 'none';
  readonly masked: string;
  readonly legacyFilePresent: boolean;
}

/**
 * PUT /api/secrets/api-key response. Validation failures reject with
 * real HTTP error statuses (401 rejected / 503 unverifiable) and arrive
 * as a thrown `ApiError`, so `validated` is the only 200 shape.
 */
export interface PutApiKeyResponse extends SecretsBackendFields {
  readonly schemaVersion: 1;
  readonly status: 'validated';
  readonly configured: boolean;
  readonly source: 'stored' | 'none';
  readonly masked: string;
}

/**
 * GET /api/openai/models response. `configured: false` with an empty
 * list is the no-key outcome, not a failure — the UI keeps free-text
 * entry. Real failures (401 rejected / 503 unverifiable) reject as
 * `ApiError`.
 */
export interface OpenAiModelsResponse {
  readonly schemaVersion: 1;
  readonly configured: boolean;
  readonly models: readonly string[];
}

/** DELETE /api/secrets/api-key response. */
export interface ClearApiKeyResponse extends SecretsBackendFields {
  readonly schemaVersion: 1;
  readonly configured: false;
  readonly source: 'none';
  readonly masked: '';
}

/**
 * POST /api/secrets/api-key/migrate response. `migrated: false` is a
 * 200 outcome, not a failure: there was nothing to move, or no
 * keychain backend is in play. Real failures (409 shadowed, 500
 * verification, 503 backend) reject as `ApiError`.
 */
export type MigrateApiKeyResponse =
  | {
      readonly schemaVersion: 1;
      readonly migrated: true;
      readonly source: 'stored';
      readonly backend: 'keychain';
      readonly masked: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly migrated: false;
      readonly reason: 'nothing_to_migrate' | 'no_keychain_backend';
    };

export interface ListProfilesResponse {
  readonly schemaVersion: 1;
  readonly profiles: readonly ProfileListEntry[];
}

export interface GetProfileResponse extends ProfileShowPayload {
  readonly schemaVersion: 1;
}

export interface ApproveProfileResponse extends ProfileApprovalSummary {
  readonly schemaVersion: 1;
}

export interface RejectProfileResponse extends ProfileRejectionResult {
  readonly schemaVersion: 1;
}

export interface ListJobsResponse {
  readonly schemaVersion: 1;
  readonly state: JobListState;
  readonly limit: number;
  readonly returned: number;
  readonly jobs: readonly JobListRow[];
}

export interface GetJobResponse extends JobShowPayload {
  readonly schemaVersion: 1;
}

export interface ListRunsResponse {
  readonly schemaVersion: 1;
  readonly limit: number;
  readonly returned: number;
  readonly runs: readonly RunListRow[];
}

export interface GetRunResponse extends RunShowPayload {
  readonly schemaVersion: 1;
}

export interface RunPipelineResponse {
  readonly schemaVersion: 1;
  readonly runId: string;
}

export interface CancelPipelineResponse {
  readonly schemaVersion: 1;
  readonly status: 'cancelling';
}

export interface GeoHit {
  readonly id: string;
  readonly type: 'GEO';
  readonly displayName: string;
  readonly trackingId?: string;
}

export interface GeoTypeaheadResponse {
  readonly schemaVersion: 1;
  readonly hits: readonly GeoHit[];
}
