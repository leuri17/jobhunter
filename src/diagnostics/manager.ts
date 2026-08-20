import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { BrowserContext, Page } from 'playwright';
import type { Repositories } from '../persistence/repositories/index.js';
import type { PlatformPaths } from '../platform/paths.js';

import {
  CurrentUrlCapture,
  StackTraceCapture,
  type CaptureArtifactType,
  type CaptureContext,
  type CaptureResult,
  type CaptureStrategy,
} from './capture/index.js';
import { buildSafeFilename, type DiagnosticScope } from './filename.js';
import { Redactor } from './redactor.js';

export interface DiagnosticManagerOptions {
  readonly config: {
    readonly screenshot: boolean;
    readonly currentUrl: boolean;
    readonly stackTrace: boolean;
    readonly playwrightTrace: boolean;
    readonly htmlSnapshot: boolean;
  };
  readonly paths: Pick<PlatformPaths, 'diagnostics'>;
  readonly repositories: Repositories;
  readonly now?: () => Date;
  readonly strategies?: Partial<Record<CaptureArtifactType, CaptureStrategy>>;
  readonly redactor?: Redactor;
  readonly onError?: (event: { code: string; message: string; metadata?: unknown }) => void;
}

export interface DiagnosticInput {
  readonly scope: DiagnosticScope;
  readonly error: unknown;
  readonly currentUrl?: string;
  readonly timestamp?: string;
  /**
   * Wave C extension: optional Playwright handles for the live
   * capture strategies. The orchestrator passes the active page +
   * context; the manager forwards them to the capture context.
   * When both are absent, the new strategies throw
   * `MissingBrowserImplementationError` (handled by the manager's
   * try/catch as a `capture_failed` failure).
   */
  readonly page?: Page;
  readonly browserContext?: BrowserContext;
}

export interface DiagnosticFailure {
  readonly artifactType: CaptureArtifactType;
  readonly code: string;
  readonly message: string;
}

export interface DiagnosticOutcome {
  readonly artifactIds: readonly number[];
  readonly failures: readonly DiagnosticFailure[];
}

const ALL_ARTIFACT_TYPES: readonly CaptureArtifactType[] = [
  'screenshot',
  'current_url',
  'stack_trace',
  'playwright_trace',
  'html_snapshot',
];

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error === undefined || error === null) return '';
  return String(error);
}

export class DiagnosticManager {
  private readonly config: DiagnosticManagerOptions['config'];
  private readonly paths: Pick<PlatformPaths, 'diagnostics'>;
  private readonly repositories: Repositories;
  private readonly now: () => Date;
  private readonly strategies: Partial<Record<CaptureArtifactType, CaptureStrategy>>;
  private readonly redactor: Redactor;
  private readonly onError: DiagnosticManagerOptions['onError'];

  constructor(options: DiagnosticManagerOptions) {
    this.config = options.config;
    this.paths = options.paths;
    this.repositories = options.repositories;
    this.now = options.now ?? (() => new Date());
    this.strategies = options.strategies ?? {
      current_url: new CurrentUrlCapture(),
      stack_trace: new StackTraceCapture(),
    };
    this.redactor = options.redactor ?? new Redactor();
    this.onError = options.onError;
  }

  private flagsFor(): Record<CaptureArtifactType, boolean> {
    return {
      screenshot: this.config.screenshot,
      current_url: this.config.currentUrl,
      stack_trace: this.config.stackTrace,
      playwright_trace: this.config.playwrightTrace,
      html_snapshot: this.config.htmlSnapshot,
    };
  }

  async recordScraperError(input: DiagnosticInput): Promise<DiagnosticOutcome> {
    const timestamp = input.timestamp ?? this.now().toISOString();
    const flags = this.flagsFor();
    const artifactIds: number[] = [];
    const failures: DiagnosticFailure[] = [];

    const redactedUrl =
      typeof input.currentUrl === 'string'
        ? this.redactor.redactString(input.currentUrl)
        : undefined;
    const description = this.redactor.redactString(describeError(input.error));

    for (const type of ALL_ARTIFACT_TYPES) {
      if (!flags[type]) continue;
      const strategy = this.strategies[type];
      if (strategy === undefined) {
        const message = `No capture strategy registered for ${type}.`;
        failures.push({ artifactType: type, code: 'strategy_missing', message });
        await this.recordFailure(input.scope, type, 'strategy_missing', message, timestamp);
        continue;
      }
      try {
        const ctx: CaptureContext = {
          scope: input.scope,
          timestamp,
          error: input.error,
          ...(redactedUrl !== undefined ? { currentUrl: redactedUrl } : {}),
          ...(input.page !== undefined ? { page: input.page } : {}),
          ...(input.browserContext !== undefined ? { browserContext: input.browserContext } : {}),
        };
        const result = await strategy.capture(ctx);
        const persisted = await this.persist(result, input.scope, timestamp, description);
        artifactIds.push(persisted);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        failures.push({ artifactType: type, code: 'capture_failed', message });
        this.onError?.({ code: 'capture_failed', message, metadata: { artifactType: type, scope: input.scope } });
        await this.recordFailure(input.scope, type, 'capture_failed', message, timestamp);
      }
    }
    return { artifactIds, failures };
  }

  private async persist(
    result: CaptureResult,
    scope: DiagnosticScope,
    timestamp: string,
    description: string,
  ): Promise<number> {
    const filename = buildSafeFilename({
      artifactType: result.artifactType,
      scope,
      extension: result.extension,
      timestamp,
    });
    const absoluteDirectory = isAbsolute(filename.relativePath)
      ? dirname(filename.relativePath)
      : join(this.paths.diagnostics.directory, dirname(filename.relativePath));
    await mkdir(absoluteDirectory, { recursive: true });
    const storedPath = resolve(this.paths.diagnostics.directory, filename.relativePath);
    const payload =
      typeof result.contents === 'string' && result.mimeType.startsWith('text/')
        ? this.redactor.redactString(result.contents)
        : result.contents;
    await writeFile(storedPath, payload);
    const size = typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
    return this.repositories.diagnostics.insert({
      pipelineRunId: scope.pipelineRunId ?? null,
      searchExecutionId: scope.searchExecutionId ?? null,
      jobId: scope.jobId ?? null,
      discoveryErrorId: scope.discoveryErrorId ?? null,
      extractionAttemptId: scope.extractionAttemptId ?? null,
      artifactType: result.artifactType,
      storedPath,
      relativePath: filename.relativePath,
      mimeType: result.mimeType,
      fileSize: size,
      createdAt: timestamp,
      description,
    });
  }

  private async recordFailure(
    scope: DiagnosticScope,
    type: CaptureArtifactType,
    code: string,
    message: string,
    timestamp: string,
  ): Promise<void> {
    try {
      const filename = buildSafeFilename({
        artifactType: `${type}-capture-failed`,
        scope,
        extension: 'txt',
        timestamp,
      });
      const storedPath = resolve(this.paths.diagnostics.directory, filename.relativePath);
      await mkdir(dirname(storedPath), { recursive: true });
      const body = `${code}: ${message}\n`;
      await writeFile(storedPath, body);
      await this.repositories.diagnostics.insert({
        pipelineRunId: scope.pipelineRunId ?? null,
        searchExecutionId: scope.searchExecutionId ?? null,
        jobId: scope.jobId ?? null,
        discoveryErrorId: scope.discoveryErrorId ?? null,
        extractionAttemptId: scope.extractionAttemptId ?? null,
        artifactType: 'log_file',
        storedPath,
        relativePath: filename.relativePath,
        mimeType: 'text/plain',
        fileSize: Buffer.byteLength(body, 'utf8'),
        createdAt: timestamp,
        errorCode: code,
        description: this.redactor.redactString(`${type}: ${message}`),
      });
    } catch (cause) {
      const innerMessage = cause instanceof Error ? cause.message : String(cause);
      this.onError?.({
        code: 'failure_record_failed',
        message: innerMessage,
        metadata: { artifactType: type, originalCode: code },
      });
    }
  }

  async close(): Promise<void> {
    // Reserved for future Playwright-backed strategies. No-op today.
  }
}
