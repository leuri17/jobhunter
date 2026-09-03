/**
 * State vocabulary for  — LinkedIn result discovery.
 *
 * The shapes below are the typed contract between `discovery-service.ts`
 * and 's pipeline orchestrator. They are pure
 * TypeScript types (no runtime values, no I/O), so this file has no
 * side effects and no imports beyond the single type import below.
 *
 * Per AGENTS.md §5 / §9: domain code does not import Playwright,
 * Drizzle directly, the `openai` SDK, or Pino directly. This
 * file is a pure vocabulary module — it imports only a type from the
 * persistence barrel.
 *
 * Per the deepwork  / Plan Task 1: the orchestrator's per-card
 * error shape lives here (not on `LinkedInScraperError`); per-card errors
 * are NOT thrown — they are surfaced via `SearchDiscoveryOutcome.errors`
 * and persisted to the `discoveryErrors` table by the orchestrator.
 */
import type { SearchExecutionStatus } from '../persistence/repositories/pipeline-runs.js';

/** Bumped when the shape vocabulary changes; consumers gate migrations on this. */
export const LINKEDIN_DISCOVERY_SCHEMA_VERSION = 1 as const;
export type LinkedinDiscoverySchemaVersion = typeof LINKEDIN_DISCOVERY_SCHEMA_VERSION;

/** LinkedIn URL host + path validation (must be `https://www.linkedin.com/jobs/search/`). */
export const LINKEDIN_JOBS_SEARCH_HOST = 'www.linkedin.com';
export const LINKEDIN_JOBS_SEARCH_PATH = '/jobs/search/';

/** Hard cap on `discoveryErrors.availableMetadata` (bytes, UTF-8). */
export const AVAILABLE_METADATA_MAX_BYTES = 2048;

/**
 * A single discovered job card on a search-results page. The orchestrator
 * builds this shape per card before persisting a `discoveryEvents` row
 * (and possibly a canonical `jobs` row when the card has an ID).
 *
 *  extension: `sourceJobId` is `string | null` to support the
 * no-ID card path. Cards whose anchor has neither a
 * `data-occludable-job-id` attribute nor a parseable
 * `/jobs/view/<digits>/` href are preserved in the loop output with
 * `sourceJobId: null` so the orchestrator can write a `discoveryErrors`
 * row (per Plan  / ).
 */
export interface DiscoveredCard {
  /** LinkedIn numeric job ID (canonical source identifier). `null` for unparseable anchors. */
  readonly sourceJobId: string | null;
  /** 1-based position of the card on the page (top-to-bottom). */
  readonly cardPosition: number;
  /** 0-based index in the DOM list. */
  readonly cardIndex: number;
  /**
   * Optional metadata extracted from the card (title / company / location
   * snippet). Null when the card carried no readable text. The orchestrator
   * passes this through `truncateAvailableMetadata` before
   * persisting to `discoveryErrors.availableMetadata`.
   */
  readonly availableMetadata: Readonly<Record<string, string>> | null;
}

/** How the dismisser should close a detected overlay. */
export type OverlayDismissalStrategy = 'close' | 'escape' | 'outside_click' | 'accept' | 'reject';

/** A visible overlay descriptor (selector + dismissal strategy + label). */
export interface OverlayDescriptor {
  /** Playwright selector that resolves to the overlay's close button or container. */
  readonly selector: string;
  /** Which dismissal strategy applies. */
  readonly strategy: OverlayDismissalStrategy;
  /** Human-readable label for diagnostics. */
  readonly label: string;
}

/**
 * Browser capacity contract (Plan  + ).
 * `BrowserSession` tracks this; the orchestrator opens at most one page
 * per `discover()` invocation and never opens a fallback page in
 * ( owns dedicated-page fallback).
 */
export interface BrowserCapacity {
  readonly activePages: number;
  readonly maxConcurrentPages: 1;
}

/**
 * Result of `dismissOverlay` — discriminated so callers can branch
 * without inspecting thrown errors. `kind: 'undismissable'` carries
 * the reason for diagnostics; the orchestrator converts this to a
 * thrown `OverlayUndismissableError` at the per-search boundary.
 */
export type OverlayDismissalResult =
  | { readonly kind: 'dismissed'; readonly selector: string }
  | { readonly kind: 'undismissable'; readonly selector: string; readonly reason: string };

/**
 * Outcome of the bounded load-more loop. Returned by `loadMoreResults`
 * (, this task). The orchestrator decides whether `kind:
 * 'exhausted'` / `kind: 'no-progress'` surface a soft warning or a
 * `LoadMoreLoopExhaustedError` (Plan ).
 */
export type LoadMoreOutcome =
  | {
      readonly kind: 'complete';
      readonly totalCardsDiscovered: number;
      readonly iterations: number;
    }
  | {
      readonly kind: 'exhausted';
      readonly totalCardsDiscovered: number;
      readonly iterations: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'no-progress';
      readonly totalCardsDiscovered: number;
      readonly iterations: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'cancelled';
      readonly totalCardsDiscovered: number;
      readonly iterations: number;
      readonly reason: string;
    };

/**
 * Mutable loop state carried across iterations of `loadMoreResults`.
 * Exposed here so the test surface can construct a deterministic
 * snapshot for unit tests; production code uses `createLoadMoreState`
 * to initialize it.
 */
export interface LoadMoreState {
  /** Distinct card IDs seen so far (post-dedup). */
  readonly totalCardsSeen: number;
  /** Number of consecutive iterations with no new IDs / no count change. */
  noProgressCount: number;
  /** Current iteration (0-indexed). */
  iteration: number;
  /** Snapshot of the last iteration's card IDs (for no-progress detection). */
  lastIdSet: Set<string>;
}

/**
 * Per-card error shape persisted to `discoveryErrors`. Distinct from
 * `LinkedInScraperError` (which is reserved for unrecoverable per-search
 * failures). A card can have a `null` `sourceJobId` (no ID was parsed)
 * — the orchestrator then writes a row keyed by `cardPosition` /
 * `cardIndex` instead of `jobId`.
 */
export interface DiscoveredCardError {
  readonly cardPosition: number | null;
  readonly cardIndex: number | null;
  readonly errorCode: string;
  readonly diagnosticMessage: string;
  /** Stable identifier returned by `Repositories.jobs.recordDiscoveryError`. */
  readonly discoveryErrorId: number;
}

/**
 * Top-level result returned by `LinkedInDiscoveryService.discover(...)`.
 * Consumed by 's pipeline orchestrator. The orchestrator
 * maps this into `searchExecutions` + `discoveryEvents` +
 * `discoveryErrors` via `Repositories.pipelineRuns.updateSearchStatus`
 * and the per-card insert path.
 */
export interface SearchDiscoveryOutcome {
  readonly schemaVersion: LinkedinDiscoverySchemaVersion;
  /** LinkedIn-side numeric ID of the search execution row ( owns the row). */
  readonly searchExecutionId: number;
  /** Final status to apply to `searchExecutions.finalStatus`. */
  readonly finalStatus: SearchExecutionStatus;
  /** Total distinct job IDs discovered on the page (after dedup). */
  readonly jobsDiscovered: number;
  /** Number of new jobs (not previously in `jobs` table). */
  readonly newJobs: number;
  /** Number of re-discovered jobs (already in `jobs` table). */
  readonly existingJobs: number;
  /**
   * Per-card errors written to `discoveryErrors` ( owns the
   * rows;  surfaces them in the run summary).
   */
  readonly errors: readonly DiscoveredCardError[];
  /** Diagnostic artifact IDs produced during the search. */
  readonly artifactIds: readonly number[];
}

/** Pure factory: initialize a fresh `LoadMoreState`. */
export function createLoadMoreState(): LoadMoreState {
  return {
    totalCardsSeen: 0,
    noProgressCount: 0,
    iteration: 0,
    lastIdSet: new Set<string>(),
  };
}

/**
 * Truncate a card-metadata record to fit within `AVAILABLE_METADATA_MAX_BYTES`
 * (UTF-8) by dropping whole keys in the order they were declared until
 * the size fits. Returns `null` when the input is null or every value
 * is empty. Pure: no I/O, no `Redactor` (redaction is added in ).
 *
 *  ships the size-cap logic without the redaction pass;
 * (`truncate-metadata.ts`) wires `Redactor` from `src/diagnostics/redactor.ts`.
 */
export function truncateAvailableMetadata(
  metadata: Readonly<Record<string, string>> | null,
): Readonly<Record<string, string>> | null {
  if (metadata === null) return null;
  const entries = Object.entries(metadata).filter(([, value]) => value.length > 0);
  if (entries.length === 0) return null;
  // Walk keys in declared order, dropping the longest value first when over budget.
  const out: Array<[string, string]> = [];
  let bytes = 0;
  for (const [key, value] of entries) {
    const entryBytes =
      Buffer.byteLength(`${JSON.stringify(key)}:${JSON.stringify(value)}`, 'utf8') + 1;
    if (bytes + entryBytes > AVAILABLE_METADATA_MAX_BYTES) {
      // Skip this entry; we drop whole keys to preserve readability of the remaining fields.
      continue;
    }
    out.push([key, value]);
    bytes += entryBytes;
  }
  if (out.length === 0) return null;
  return Object.freeze(Object.fromEntries(out));
}
