import {
  ApplicationError,
  type ApplicationErrorMetadata,
  type ExitCodeValue,
  ExitCode,
} from '../errors/application-error.js';

/**
 * Base class for every error raised by `LinkedInDiscoveryService`.
 * Subclasses pin a specific `ExitCode` so the CLI boundary
 * does not need an `instanceof` cascade. Per-card errors are NOT
 * represented here — they live on `SearchDiscoveryOutcome.errors[]`
 * (see `src/linkedin/state.ts`) and on the `discoveryErrors` table.
 */
export class LinkedInScraperError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    exitCode: ExitCodeValue,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, exitCode, metadata, cause);
  }
}

/** LinkedIn blocked anonymous access (auth wall, captcha, region block). Exit `LinkedInBlocked = 4`. */
export class LinkedInAccessBlockedError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'linkedin_access_blocked',
      'Search page access was blocked by the upstream service.',
      ExitCode.LinkedInBlocked,
      metadata,
      cause,
    );
  }
}

/** Page navigated but the expected search-results DOM was absent. Exit 1. */
export class LinkedInExpectedPageError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'linkedin_expected_page_missing',
      'Search page did not render the expected document markup.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** Navigation exceeded `timeouts.navigationMs`. Exit 1. */
export class NavigationTimeoutError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'navigation_timeout',
      'Search-page navigation timed out.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** Recoverable overlay could not be dismissed within `timeouts.overlayDismissalMs`. Exit 1. */
export class OverlayUndismissableError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'overlay_undismissable',
      'Recoverable overlay could not be dismissed within the bounded timeout.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/**
 * Load-more loop exhausted `maxNoProgressAttempts` consecutive no-progress
 * iterations. Exit 1 — soft warning; 's orchestrator may catch
 * and treat as success. The orchestrator surfaces this only when the
 * page still has more "load-more" controls to click (i.e. a real bug).
 */
export class LoadMoreLoopExhaustedError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'load_more_loop_exhausted',
      'Load-more loop exhausted the no-progress attempt budget.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** Browser launch failed (Playwright Chromium failed to start). Exit 1. */
export class BrowserLaunchError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('browser_launch_failed', 'Browser launch failed.', ExitCode.Fatal, metadata, cause);
  }
}

/**
 * Browser capacity contract violated — more than one fallback page
 * requested. Exit 1. Defensive:  owns the lifecycle and should
 * never hit this; 's orchestrator may hit it during fallback
 * extraction when the orchestrator opens two panels at
 * once.
 */
export class BrowserCapacityExceededError extends LinkedInScraperError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'browser_capacity_exceeded',
      'Browser capacity contract violated (more than one fallback page requested).',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}
