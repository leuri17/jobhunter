import type { BrowserContext, Page } from 'playwright';

import type { DiagnosticScope } from '../filename.js';

export type CaptureArtifactType =
  | 'screenshot'
  | 'current_url'
  | 'stack_trace'
  | 'playwright_trace'
  | 'html_snapshot';

/**
 * Wave C extension: the two Playwright-backed capture strategies
 * (screenshot + playwright-trace) need a live `Page` + `BrowserContext`
 * to function. The fields are OPTIONAL so the non-Playwright
 * strategies (`stack-trace`, `current-url`) keep working unchanged
 * — they ignore the new fields entirely.
 *
 * `DiagnosticManager.recordScraperError` populates these from the
 * `DiagnosticInput` (also extended in Wave C) so the manager stays
 * the single point of context construction.
 */
export interface CaptureContext {
  readonly scope: DiagnosticScope;
  readonly timestamp: string;
  readonly error?: unknown;
  readonly currentUrl?: string;
  /** Playwright page — populated by the orchestrator when screenshot capture is enabled. */
  readonly page?: Page;
  /** Playwright browser context — populated by the orchestrator when trace capture is enabled. */
  readonly browserContext?: BrowserContext;
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