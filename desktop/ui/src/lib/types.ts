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