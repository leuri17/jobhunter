import { DiagnosticManager } from './manager.js';
import type { Repositories } from '../persistence/repositories/index.js';
import type { PlatformPaths } from '../platform/paths.js';

export interface CreateDefaultDiagnosticManagerInput {
  readonly config: {
    readonly screenshot: boolean;
    readonly currentUrl: boolean;
    readonly stackTrace: boolean;
    readonly playwrightTrace: boolean;
    readonly htmlSnapshot: boolean;
  };
  readonly paths: PlatformPaths;
  readonly repositories: Repositories;
}

/**
 * Factory: create the default `DiagnosticManager` wired to the
 * operational config's `onScraperError` flags. The desktop sidecar
 * composes this at boot; tests inject their own manager via
 * constructor injection on the orchestrator.
 */
export function createDefaultDiagnosticManager(
  input: CreateDefaultDiagnosticManagerInput,
): DiagnosticManager {
  return new DiagnosticManager({
    config: input.config,
    paths: input.paths,
    repositories: input.repositories,
  });
}