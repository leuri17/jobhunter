import type { DiagnosticScope } from '../filename.js';

export type CaptureArtifactType =
  | 'screenshot'
  | 'current_url'
  | 'stack_trace'
  | 'playwright_trace'
  | 'html_snapshot';

export interface CaptureContext {
  readonly scope: DiagnosticScope;
  readonly timestamp: string;
  readonly error?: unknown;
  readonly currentUrl?: string;
}

export interface CaptureResult {
  readonly artifactType: CaptureArtifactType;
  readonly extension: string;
  readonly mimeType: string;
  readonly contents: Buffer | string;
}

export interface CaptureStrategy {
  readonly artifactType: CaptureArtifactType;
  capture(context: CaptureContext): Promise<CaptureResult>;
}
