import type { Logger as CodebaseLogger } from '../logging/logger.js';
import type { InitStepId } from './state.js';

/**
 * Structured-log seam for the init orchestrator. Every `InitOrchestrator`
 * step emits one of the four events below; the production adapter
 * (`pinoInitLogger`) wraps the codebase's `Logger` interface
 * (`src/logging/logger.ts`) so init's structured log shape matches the
 * rest of the codebase (`component: 'init'`, `event`, `stepId`,
 * optional `errorCode`).
 */
export interface InitLogger {
  stepStart(input: { readonly stepId: InitStepId }): void;
  stepSkip(input: { readonly stepId: InitStepId; readonly reason: string }): void;
  stepComplete(input: { readonly stepId: InitStepId; readonly artifactId: string | null }): void;
  stepFail(input: {
    readonly stepId: InitStepId;
    readonly errorCode: string;
    readonly message: string;
  }): void;
}

export const noopInitLogger: InitLogger = {
  stepStart: () => undefined,
  stepSkip: () => undefined,
  stepComplete: () => undefined,
  stepFail: () => undefined,
};

/**
 * Production adapter: wraps the codebase's `Logger` interface and
 * emits structured logs. The orchestrator NEVER imports `pino`
 * directly; it only sees the `InitLogger` interface. The boundaries
 * test (`tests/init/boundaries.test.ts`) asserts no runtime `pino`
 * import anywhere under `src/init/`.
 *
 * The adapter takes the codebase's `Logger` (returned by
 * `createLogger()` in `src/logging/logger.ts`). The Pino instance
 * lives behind that facade and is the underlying transport — `init`
 * does not need direct access to it.
 */
export function pinoInitLogger(logger: CodebaseLogger): InitLogger {
  return {
    stepStart: ({ stepId }) =>
      logger.info({ component: 'init', event: 'step.start', stepId }, 'init step started'),
    stepSkip: ({ stepId, reason }) =>
      logger.info({ component: 'init', event: 'step.skip', stepId, reason }, 'init step skipped'),
    stepComplete: ({ stepId, artifactId }) =>
      logger.info(
        { component: 'init', event: 'step.complete', stepId, artifactId },
        'init step completed',
      ),
    stepFail: ({ stepId, errorCode, message }) =>
      logger.warn({ component: 'init', event: 'step.fail', stepId, errorCode }, message),
  };
}
