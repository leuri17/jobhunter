/**
 * Public barrel for `src/linkedin/`.
 *
 * Re-exports the public surface that the orchestrator
 * consumes. Test helpers (`FakeBrowserSession`, `FakePage`) stay
 * internal — consumers in `tests/linkedin/` import them from
 * their source paths.
 */
export { LinkedInDiscoveryService } from './discovery-service.js';
export type { LinkedInDiscoveryServiceOptions, DiscoverInput } from './discovery-service.js';

export {
  LINKEDIN_DISCOVERY_SCHEMA_VERSION,
  LINKEDIN_JOBS_SEARCH_HOST,
  LINKEDIN_JOBS_SEARCH_PATH,
  AVAILABLE_METADATA_MAX_BYTES,
  createLoadMoreState,
} from './state.js';
export type {
  DiscoveredCard,
  DiscoveredCardError,
  SearchDiscoveryOutcome,
  OverlayDescriptor,
  OverlayDismissalResult,
  OverlayDismissalStrategy,
  LoadMoreOutcome,
  LoadMoreState,
  BrowserCapacity,
  LinkedinDiscoverySchemaVersion,
} from './state.js';

export type { BrowserSession } from './browser-session.js';

export { navigateWithTimeout } from './navigation.js';
export type { NavigationResult, NavigateWithTimeoutOptions } from './navigation.js';

export { truncateAvailableMetadata } from './truncate-metadata.js';
export type {
  TruncateAvailableMetadataOptions,
  TruncateAvailableMetadataResult,
} from './truncate-metadata.js';

export { parseCardJobId } from './card-id.js';
export type { CardIdDocument, MinimalElement } from './card-id.js';

export { detectOverlays, dismissOverlay, dismissRecoverableOverlays } from './overlay.js';
export type { OverlayDetectionOptions } from './overlay.js';

export { loadMoreResults, discoverAllCards } from './load-more.js';
export type { LoadMoreOptions } from './load-more.js';

export {
  LINKEDIN_SELECTORS,
  LINKEDIN_SELECTORS_MAP_VERSION,
  JOB_ID_HREF_PATTERN,
  OVERLAY_DISMISSAL_STRATEGY,
} from './selectors.js';
export type { LinkedinSelectorGroup, LinkedinSelectorKey } from './selectors.js';

export {
  LinkedInScraperError,
  LinkedInAccessBlockedError,
  LinkedInExpectedPageError,
  NavigationTimeoutError,
  OverlayUndismissableError,
  LoadMoreLoopExhaustedError,
  BrowserLaunchError,
  BrowserCapacityExceededError,
} from './errors.js';

export { noopLinkedInScraperLogger, pinoLinkedInScraperLogger } from './log.js';
export type { LinkedInScraperLogger } from './log.js';
