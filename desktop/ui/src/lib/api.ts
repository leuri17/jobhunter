import { invoke } from '@tauri-apps/api/core';
import { sidecarBaseUrl } from './sidecar-url';
import type {
  ApproveProfileResponse,
  CancelPipelineResponse,
  ConfigResponse,
  GetJobResponse,
  GetProfileResponse,
  GetRunResponse,
  HealthResponse,
  ListJobsResponse,
  ListProfilesResponse,
  ListRunsResponse,
  PathsResponse,
  RejectProfileResponse,
  RunPipelineResponse,
  ValidateConfigResponse,
} from './types.js';
import type { ConfigPatch } from '@jobhunter/core/config';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export async function notifyPipelineComplete({ status, count }: { status: string; count: number }): Promise<void> {
  try {
    await invoke('notify_pipeline_complete', { status, count });
  } catch {
    // best-effort; do not surface to user (dev mode without Tauri, etc.)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const baseUrl = await sidecarBaseUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { code: 'unknown', message: res.statusText } })) as {
      error?: { code?: string; message?: string };
    };
    throw new ApiError(res.status, errBody.error?.code ?? 'unknown', errBody.error?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>('GET', '/api/health'),
  paths: () => request<PathsResponse>('GET', '/api/paths'),
  getConfig: () => request<ConfigResponse>('GET', '/api/config'),
  patchConfig: (patch: ConfigPatch) => request<ConfigResponse>('PATCH', '/api/config', { patch }),
  validateConfig: () => request<ValidateConfigResponse>('POST', '/api/config/validate'),
  listProfiles: (status?: string) =>
    request<ListProfilesResponse>('GET', `/api/profile${status ? `?status=${status}` : ''}`),
  getProfile: (id: string) => request<GetProfileResponse>('GET', `/api/profile/${id}`),
  approveProfile: (id: string, warnings: string[] = []) =>
    request<ApproveProfileResponse>('POST', `/api/profile/${id}/approve`, { warnings }),
  rejectProfile: (id: string) =>
    request<RejectProfileResponse>('POST', `/api/profile/${id}/reject`),
  listJobs: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return request<ListJobsResponse>('GET', `/api/jobs${qs ? `?${qs}` : ''}`);
  },
  getJob: (id: string) => request<GetJobResponse>('GET', `/api/jobs/${id}`),
  reevaluateJobs: (body: { scope: string; jobId?: number; dryRun?: boolean; confirmScoring?: boolean }) =>
    // Reevaluation plan shape isn't yet zod-narrowed; the sidecar returns the
    // service's `plan` field directly. Kept as `unknown` until Phase E adds
    // a typed schema for reevaluation outcomes.
    request<{ schemaVersion: 1; plan: unknown }>('POST', '/api/jobs/reevaluate', body),
  listRuns: (limit = 20) =>
    request<ListRunsResponse>('GET', `/api/runs?limit=${limit}`),
  getRun: (id: string) => request<GetRunResponse>('GET', `/api/runs/${id}`),
  runPipeline: () => request<RunPipelineResponse>('POST', '/api/pipeline/run'),
  cancelPipeline: (runId: string) =>
    request<CancelPipelineResponse>('POST', `/api/pipeline/${runId}/cancel`),
};