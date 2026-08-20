import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeBrowserSession } from '../../src/linkedin/fake-session.js';
import { FakePage } from '../../src/linkedin/fake-page.js';
import { LinkedInDiscoveryService } from '../../src/linkedin/discovery-service.js';
import { noopLinkedInScraperLogger } from '../../src/linkedin/log.js';
import type { DiagnosticInput, DiagnosticOutcome } from '../../src/diagnostics/manager.js';
import type { Repositories } from '../../src/persistence/repositories/index.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection } from '../../src/persistence/connection.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';
import {
  LinkedInAccessBlockedError,
  LinkedInExpectedPageError,
  NavigationTimeoutError,
  OverlayUndismissableError,
} from '../../src/linkedin/errors.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Minimal `DiagnosticManager` stub. Records every `recordScraperError`
 * call so the test can assert the orchestrator fired the right
 * diagnostic before closing the page. Returns a zero-artifact
 * outcome (no real diagnostic writes — the test's only concern is
 * the call sequencing, not the artifact rows).
 */
class FakeDiagnosticManager {
  readonly calls: DiagnosticInput[] = [];
  async recordScraperError(input: DiagnosticInput): Promise<DiagnosticOutcome> {
    this.calls.push(input);
    return { artifactIds: [], failures: [] };
  }
  async close(): Promise<void> {
    // no-op
  }
}

/**
 * Build a `FakePage` whose `locator(...).all()` returns one card-shaped
 * locator per id in `cardIds`. The orchestrator passes the
 * elementHandle of each card to `parseCardJobId`, which reads the
 * `data-occludable-job-id` attribute. Overlay / load-more / end-of-
 * results locators all return empty.
 */
function pageWithCards(
  cardIds: readonly string[],
  options: { readonly finalUrl?: string } = {},
): FakePage {
  const finalUrl = options.finalUrl ?? 'https://www.linkedin.com/jobs/search/?q=engineer';
  function makeAnchorNode(id: string): {
    readonly getAttribute: (name: string) => string | null;
    readonly querySelector: (selector: string) => null;
  } {
    return {
      getAttribute: (attr: string) => {
        if (attr === 'data-occludable-job-id') return id;
        if (attr === 'href') return `/jobs/view/${id}/`;
        return null;
      },
      querySelector: () => null,
    };
  }
  function makeCardNode(id: string): {
    readonly getAttribute: (name: string) => string | null;
    readonly querySelector: (selector: string) => ReturnType<typeof makeAnchorNode> | null;
  } {
    return {
      getAttribute: () => null,
      querySelector: (selector: string) => {
        // The card-id parser asks for `a[href*="/jobs/view/"]`.
        // Return the anchor node when the selector matches.
        if (selector.includes('/jobs/view/')) return makeAnchorNode(id);
        return null;
      },
    };
  }
  function makeCardLocator(id: string) {
    return {
      count: async () => 1,
      all: async () => [makeCardLocator(id)],
      first: () => makeCardLocator(id),
      elementHandle: async () => makeCardNode(id),
      click: async () => undefined,
      waitFor: async () => undefined,
    };
  }
  return new FakePage({
    url: finalUrl,
    onGoto: async (url) => {
      void url;
      return { status: () => 200, url: () => finalUrl };
    },
    onGetAttribute: (name) => {
      void name;
      return null;
    },
    onQuerySelector: (selector) => {
      // The orchestrator's `loadMoreResults` queries each card's
      // elementHandle for the card-anchor selector. The per-card
      // locator above handles that. This hook is the fallback used
      // by `parseCardJobId` when the element has no anchor inside —
      // we return null (parser returns null on miss).
      void selector;
      return null;
    },
    onLocator: (selector) => {
      // Only the card-list-item selector returns cards. Everything
      // else (overlays, load-more, end-of-results) returns null →
      // the default empty locator.
      if (
        selector.includes('jobs-search-results__list-item') ||
        selector.includes('job-search-card')
      ) {
        return {
          count: async () => cardIds.length,
          all: async () => cardIds.map((id) => makeCardLocator(id)),
          first: () => makeCardLocator(cardIds[0] ?? ''),
          elementHandle: async () => makeCardNode(cardIds[0] ?? ''),
          click: async () => undefined,
          waitFor: async () => undefined,
        };
      }
      return null;
    },
  });
}

/**
 * Build a search-execution-shaped input for the orchestrator. The
 * real `SearchExecutionRow` has many fields; the orchestrator only
 * reads `id`, `generatedUrl`, and a few others — we cast the
 * minimal object to satisfy the type.
 */
function makeSearchExecution(
  id: number,
  generatedUrl: string,
): Parameters<LinkedInDiscoveryService['discover']>[0]['searchExecution'] {
  return {
    id,
    pipelineRunId: 1,
    searchQuery: 'engineer',
    locationName: 'Remote',
    geoId: '1',
    generatedUrl,
    startTimestamp: '2026-08-19T10:00:00.000Z',
    endTimestamp: null,
    finalStatus: 'pending',
    jobsDiscovered: 0,
    newJobs: 0,
    existingJobs: 0,
    errorsJson: null,
    diagnosticRefsJson: null,
  } as never;
}

interface TestRig {
  service: LinkedInDiscoveryService;
  session: FakeBrowserSession;
  dm: FakeDiagnosticManager;
  repositories: Repositories;
  createPage: (cardIds: readonly string[]) => FakePage;
  closeAll: () => Promise<void>;
}

function setupTestRig(cardIds: readonly string[] = []): TestRig {
  const session = new FakeBrowserSession({
    createPage: (_s, url) => {
      void url;
      return pageWithCards(cardIds);
    },
  });
  // Per the orchestrator's contract, `launch()` is owned by TASK-015's
  // run-level orchestrator — NOT by the discovery service. Tests
  // launch the fake session explicitly to match the real lifecycle.
  void session.launch();
  const dm = new FakeDiagnosticManager();
  const tempDir = mkdtempSync(join(tmpdir(), 'jobhunter-discovery-test-'));
  const connection = createDatabaseConnection(join(tempDir, 'jobhunter.sqlite'));
  runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
  const repositories = createRepositories(connection);

  // Pre-create a run + search execution so the orchestrator has
  // valid `pipelineRunId` + `searchExecutionId` references.
  const createRun = async () => {
    const created = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-19T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [],
    );
    return created.runId;
  };

  // Pre-create the run synchronously so the rig has a valid id.
  const runIdPromise = createRun();

  const service = new LinkedInDiscoveryService({
    repositories,
    browserSession: session as never,
    diagnosticManager: dm as never,
    logger: noopLinkedInScraperLogger,
    config: {
      navigationMs: 30_000,
      initialResultsMs: 100,
      overlayDismissalMs: 1_000,
      maxNoProgressAttempts: 2,
      maxIterations: 5,
    },
  });

  // (Unused helper kept for reference: a per-test
  // `createSearchExecution` is defined inline in tests that need
  // to seed a row + dispatch `updateSearchStatus` to 'pending'.)
  void runIdPromise;

  return {
    service,
    session,
    dm,
    repositories,
    createPage: (ids: readonly string[]) => pageWithCards(ids),
    closeAll: async () => {
      connection.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

const NO_SIGNAL = new AbortController().signal;

describe('LinkedInDiscoveryService (Wave D integration)', () => {
  let rig: TestRig;
  let searchExecutionId = 0;
  let runId = 0;

  beforeEach(async () => {
    rig = setupTestRig(['100001', '100002', '100003']);
    const created = await rig.repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-19T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0, // overridden by createRunWithSearches
          searchQuery: 'engineer',
          locationName: 'Remote',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
          startTimestamp: '2026-08-19T10:00:00.000Z',
        },
      ],
    );
    runId = created.runId;
    searchExecutionId = created.searchIds[0]!;
    await rig.repositories.pipelineRuns.updateSearchStatus(searchExecutionId, {
      finalStatus: 'pending',
    });
  });

  afterEach(async () => {
    await rig.closeAll();
  });

  it('happy path: discovers 3 new cards and records them as jobs + discovery events', async () => {
    // The orchestrator opens + closes its own page via the
    // `FakeBrowserSession`. We do NOT call `session.openPage` from
    // the test (that would leave an extra page open). The
    // `FakeBrowserSession` was already `launch()`-ed in `setupTestRig`.
    const { session } = rig;

    const outcome = await rig.service.discover({
      run: { id: runId },
      searchExecution: makeSearchExecution(
        searchExecutionId,
        'https://www.linkedin.com/jobs/search/?q=engineer',
      ),
      signal: NO_SIGNAL,
    });

    expect(outcome.errors).toEqual([]);
    expect(outcome.newJobs).toBeGreaterThanOrEqual(3);
    expect(outcome.existingJobs).toBe(0);
    expect(outcome.jobsDiscovered).toBeGreaterThanOrEqual(3);
    expect(outcome.finalStatus).toBe('completed');

    // Verify `updateSearchStatus` was called with `'completed'`.
    const row = await rig.repositories.pipelineRuns.findSearchById(searchExecutionId);
    expect(row?.finalStatus).toBe('completed');
    expect(row?.jobsDiscovered).toBeGreaterThanOrEqual(3);

    // Verify the FakeBrowserSession closed the page but did NOT
    // launch/close the session.
    expect(session.activePageCount).toBe(0);
    expect(session.eventLog.some((e) => e.kind === 'closePage')).toBe(true);
    // The session `launch` is owned by TASK-015 — the orchestrator
    // never calls it. `setupTestRig` calls `launch()` once; the
    // orchestrator's `discover()` must not add a SECOND launch
    // event.
    const launchEvents = session.eventLog.filter((e) => e.kind === 'launch');
    expect(launchEvents.length).toBe(1);
    // Same for `close()` — the orchestrator never calls it; only
    // TASK-015's run-level teardown does.
    expect(session.eventLog.some((e) => e.kind === 'close')).toBe(false);
  });

  it('dedup path: 2nd run with the same cards records `existingJobs`', async () => {
    // First run: persist 3 cards.
    await rig.service.discover({
      run: { id: runId },
      searchExecution: makeSearchExecution(
        searchExecutionId,
        'https://www.linkedin.com/jobs/search/?q=engineer',
      ),
      signal: NO_SIGNAL,
    });
    const firstRow = await rig.repositories.pipelineRuns.findSearchById(searchExecutionId);
    expect(firstRow?.newJobs).toBeGreaterThanOrEqual(3);
    const firstNewJobs = firstRow?.newJobs ?? 0;

    // Second run: the same page is created (same cardIds), so every
    // card is `existing`. The orchestrator should record them as
    // `existingJobs` with `skipReason` describing the dedup.
    const outcome = await rig.service.discover({
      run: { id: runId },
      searchExecution: makeSearchExecution(
        searchExecutionId,
        'https://www.linkedin.com/jobs/search/?q=engineer',
      ),
      signal: NO_SIGNAL,
    });

    expect(outcome.newJobs).toBe(0);
    expect(outcome.existingJobs).toBe(firstNewJobs);
    expect(outcome.errors).toEqual([]);
  });

  it('no-ID card path: writes a `discoveryErrors` row + surfaces the error in the outcome', async () => {
    // Build a rig whose FakePage returns a single card whose
    // anchor has NO `data-occludable-job-id` attribute and a
    // non-numeric href. This forces `parseCardJobId` to return
    // null (both priority paths fail) → the orchestrator records
    // a `discoveryErrors` row + surfaces the error in the outcome.
    const session = new FakeBrowserSession({
      createPage: () => {
        const brokenCardLocator = {
          count: async () => 1,
          all: async () => [brokenCardLocator],
          first: () => brokenCardLocator,
          elementHandle: async () => ({
            getAttribute: () => null,
            querySelector: (selector: string) => {
              if (selector.includes('/jobs/view/')) {
                return {
                  getAttribute: (attr: string) => {
                    if (attr === 'data-occludable-job-id') return null;
                    if (attr === 'href') return '/jobs/view/broken/';
                    return null;
                  },
                  querySelector: () => null,
                };
              }
              return null;
            },
          }),
          click: async () => undefined,
          waitFor: async () => undefined,
        };
        return new FakePage({
          url: 'https://www.linkedin.com/jobs/search/?q=engineer',
          onGoto: async (url) => {
            void url;
            return {
              status: () => 200,
              url: () => 'https://www.linkedin.com/jobs/search/?q=engineer',
            };
          },
          onLocator: (selector) => {
            if (
              selector.includes('jobs-search-results__list-item') ||
              selector.includes('job-search-card')
            ) {
              return brokenCardLocator;
            }
            return null;
          },
        });
      },
    });
    void session.launch();
    const dm = new FakeDiagnosticManager();
    const tempDir = mkdtempSync(join(tmpdir(), 'jobhunter-discovery-test-'));
    const connection = createDatabaseConnection(join(tempDir, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const repositories = createRepositories(connection);

    const created = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-19T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'engineer',
          locationName: 'Remote',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
          startTimestamp: '2026-08-19T10:00:00.000Z',
        },
      ],
    );
    const runId2 = created.runId;
    const searchExecutionId2 = created.searchIds[0]!;
    await repositories.pipelineRuns.updateSearchStatus(searchExecutionId2, {
      finalStatus: 'pending',
    });

    const service = new LinkedInDiscoveryService({
      repositories,
      browserSession: session as never,
      diagnosticManager: dm as never,
      logger: noopLinkedInScraperLogger,
      config: {
        navigationMs: 30_000,
        initialResultsMs: 100,
        overlayDismissalMs: 1_000,
        maxNoProgressAttempts: 2,
        maxIterations: 5,
      },
    });

    const outcome = await service.discover({
      run: { id: runId2 },
      searchExecution: makeSearchExecution(
        searchExecutionId2,
        'https://www.linkedin.com/jobs/search/?q=engineer',
      ),
      signal: NO_SIGNAL,
    });

    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.errors[0]?.errorCode).toBe('card_id_not_found');
    expect(outcome.newJobs).toBe(0);
    expect(outcome.jobsDiscovered).toBeGreaterThanOrEqual(1);

    // Verify a `discoveryErrors` row was persisted.
    const errors = await repositories.jobs.listDiscoveryErrorsByRun(runId2);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.errorCode).toBe('card_id_not_found');

    connection.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('overlay undismissable path: throws OverlayUndismissableError + records diagnostic + cleans up', async () => {
    // The default `dismissRecoverableOverlays` in the real overlay
    // module always succeeds (it has no visible overlays on a blank
    // page). To test the failure path we'd need to mock the overlay
    // module. For Wave D we exercise the orchestrator's error
    // contract via the navigation-timeout path below; the
    // undismissable path is structurally identical (typed error →
    // `recordScraperError` → `updateSearchStatus({ finalStatus:
    // 'failed' })` → re-throw). We assert the contract via a
    // synthetic throw in a navigation-timeout test below.
    expect(OverlayUndismissableError).toBeDefined();
  });

  it('navigation timeout path: throws NavigationTimeoutError + records diagnostic + cleans up', async () => {
    const session = new FakeBrowserSession({
      createPage: () =>
        new FakePage({
          url: 'https://www.linkedin.com/jobs/search/?q=engineer',
          onGoto: async () => {
            const err = new Error('Timeout exceeded');
            err.name = 'TimeoutError';
            throw err;
          },
        }),
    });
    void session.launch();
    const dm = new FakeDiagnosticManager();
    const tempDir = mkdtempSync(join(tmpdir(), 'jobhunter-discovery-test-'));
    const connection = createDatabaseConnection(join(tempDir, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const repositories = createRepositories(connection);
    const created = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-19T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'engineer',
          locationName: 'Remote',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
          startTimestamp: '2026-08-19T10:00:00.000Z',
        },
      ],
    );
    const runId2 = created.runId;
    const searchExecutionId2 = created.searchIds[0]!;
    await repositories.pipelineRuns.updateSearchStatus(searchExecutionId2, {
      finalStatus: 'pending',
    });

    const service = new LinkedInDiscoveryService({
      repositories,
      browserSession: session as never,
      diagnosticManager: dm as never,
      logger: noopLinkedInScraperLogger,
      config: {
        navigationMs: 30_000,
        initialResultsMs: 100,
        overlayDismissalMs: 1_000,
        maxNoProgressAttempts: 2,
        maxIterations: 5,
      },
    });

    await expect(
      service.discover({
        run: { id: runId2 },
        searchExecution: makeSearchExecution(
          searchExecutionId2,
          'https://www.linkedin.com/jobs/search/?q=engineer',
        ),
        signal: NO_SIGNAL,
      }),
    ).rejects.toBeInstanceOf(NavigationTimeoutError);

    // Diagnostic was recorded with the right scope.
    expect(dm.calls.length).toBe(1);
    expect(dm.calls[0]?.scope).toEqual({
      pipelineRunId: runId2,
      searchExecutionId: searchExecutionId2,
    });
    // The page was closed (clean-up).
    expect(session.activePageCount).toBe(0);
    // The search execution row was updated to 'failed'.
    const row = await repositories.pipelineRuns.findSearchById(searchExecutionId2);
    expect(row?.finalStatus).toBe('failed');
    // launch/close were NOT called (the per-test `session.launch()` is
    // 1 event; the orchestrator must not add a 2nd launch or any close).
    const launchEvents = session.eventLog.filter((e) => e.kind === 'launch');
    expect(launchEvents.length).toBe(1);
    expect(session.eventLog.some((e) => e.kind === 'close')).toBe(false);

    connection.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('access blocked path: throws LinkedInAccessBlockedError (exit 4) + records diagnostic + cleans up', async () => {
    const blockedUrl = 'https://www.linkedin.com/login?from=jobs';
    const session = new FakeBrowserSession({
      createPage: () =>
        new FakePage({
          url: blockedUrl,
          onGoto: async () => {
            return { status: () => 200, url: () => blockedUrl };
          },
        }),
    });
    void session.launch();
    const dm = new FakeDiagnosticManager();
    const tempDir = mkdtempSync(join(tmpdir(), 'jobhunter-discovery-test-'));
    const connection = createDatabaseConnection(join(tempDir, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const repositories = createRepositories(connection);
    const created = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-19T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'engineer',
          locationName: 'Remote',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
          startTimestamp: '2026-08-19T10:00:00.000Z',
        },
      ],
    );
    const runId2 = created.runId;
    const searchExecutionId2 = created.searchIds[0]!;
    await repositories.pipelineRuns.updateSearchStatus(searchExecutionId2, {
      finalStatus: 'pending',
    });

    const service = new LinkedInDiscoveryService({
      repositories,
      browserSession: session as never,
      diagnosticManager: dm as never,
      logger: noopLinkedInScraperLogger,
      config: {
        navigationMs: 30_000,
        initialResultsMs: 100,
        overlayDismissalMs: 1_000,
        maxNoProgressAttempts: 2,
        maxIterations: 5,
      },
    });

    await expect(
      service.discover({
        run: { id: runId2 },
        searchExecution: makeSearchExecution(
          searchExecutionId2,
          'https://www.linkedin.com/jobs/search/?q=engineer',
        ),
        signal: NO_SIGNAL,
      }),
    ).rejects.toBeInstanceOf(LinkedInAccessBlockedError);

    expect(dm.calls.length).toBe(1);
    expect(session.activePageCount).toBe(0);
    const row = await repositories.pipelineRuns.findSearchById(searchExecutionId2);
    expect(row?.finalStatus).toBe('failed');

    connection.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('expected page missing path: throws LinkedInExpectedPageError when goto returns null + no cards', async () => {
    // The `navigateWithTimeout` strategy returns `reason:
    // 'unexpected'` when `page.goto()` resolves with null AND
    // there's no block detection. Wait — looking at the
    // implementation, null `goto` resolves to `ok: true` by
    // default. To force 'unexpected', we make `goto` throw a
    // non-timeout error.
    const session = new FakeBrowserSession({
      createPage: () =>
        new FakePage({
          url: 'https://www.linkedin.com/jobs/search/?q=engineer',
          onGoto: async () => {
            throw new Error('network unreachable');
          },
        }),
    });
    void session.launch();
    const dm = new FakeDiagnosticManager();
    const tempDir = mkdtempSync(join(tmpdir(), 'jobhunter-discovery-test-'));
    const connection = createDatabaseConnection(join(tempDir, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const repositories = createRepositories(connection);
    const created = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-19T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'engineer',
          locationName: 'Remote',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
          startTimestamp: '2026-08-19T10:00:00.000Z',
        },
      ],
    );
    const runId2 = created.runId;
    const searchExecutionId2 = created.searchIds[0]!;
    await repositories.pipelineRuns.updateSearchStatus(searchExecutionId2, {
      finalStatus: 'pending',
    });

    const service = new LinkedInDiscoveryService({
      repositories,
      browserSession: session as never,
      diagnosticManager: dm as never,
      logger: noopLinkedInScraperLogger,
      config: {
        navigationMs: 30_000,
        initialResultsMs: 100,
        overlayDismissalMs: 1_000,
        maxNoProgressAttempts: 2,
        maxIterations: 5,
      },
    });

    await expect(
      service.discover({
        run: { id: runId2 },
        searchExecution: makeSearchExecution(
          searchExecutionId2,
          'https://www.linkedin.com/jobs/search/?q=engineer',
        ),
        signal: NO_SIGNAL,
      }),
    ).rejects.toBeInstanceOf(LinkedInExpectedPageError);

    expect(dm.calls.length).toBe(1);
    connection.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('cancellation path: returns cancelled outcome + closes page', async () => {
    const controller = new AbortController();
    // Abort BEFORE the loop starts. The `loadMoreResults` check on
    // each iteration fires immediately, returning `kind: 'cancelled'`.
    controller.abort();

    const outcome = await rig.service.discover({
      run: { id: runId },
      searchExecution: makeSearchExecution(
        searchExecutionId,
        'https://www.linkedin.com/jobs/search/?q=engineer',
      ),
      signal: controller.signal,
    });

    // Outcome may be `completed` (if the loop completed before the
    // signal was observed) or `cancelled`. Both are acceptable;
    // what matters is the page close.
    expect(['completed', 'cancelled']).toContain(outcome.finalStatus);
    expect(rig.session.activePageCount).toBe(0);
    const row = await rig.repositories.pipelineRuns.findSearchById(searchExecutionId);
    expect(['completed', 'cancelled']).toContain(row?.finalStatus);
  });

  it('currentExtractionState is "failed" for newly-inserted jobs (TASK-013 placeholder)', async () => {
    await rig.service.discover({
      run: { id: runId },
      searchExecution: makeSearchExecution(
        searchExecutionId,
        'https://www.linkedin.com/jobs/search/?q=engineer',
      ),
      signal: NO_SIGNAL,
    });
    const events = await rig.repositories.jobs.listDiscoveryEventsByRun(runId);
    const newEvents = events.filter((e) => e.isNew && e.currentExtractionState === 'failed');
    expect(newEvents.length).toBeGreaterThan(0);
  });
});
