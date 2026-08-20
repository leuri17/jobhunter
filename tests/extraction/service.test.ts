/**
 * Full integration tests for `LinkedInExtractionService` (TASK-013
 * Plan Task 13, Wave D, SPEC §22 + §23).
 *
 * Strategy: a custom `FakeBrowserSession` that routes BOTH the
 * search-page URL and the dedicated-page URL to fixture HTML. The
 * orchestrator gets the same FakePage-shaped object for both URLs;
 * the fixture selection is driven by the URL.
 *
 * Per Decision 25 + the plan's test plan:
 *   - happy path (panel-complete) → kind: 'complete'
 *   - skip-complete → kind: 'skipped', zero DB writes
 *   - skip-partial → kind: 'skipped', zero DB writes
 *   - panel-mismatch → fallback to dedicated → kind: 'complete'
 *   - both panel and dedicated fail → kind: 'failed', 2 attempts
 *   - extractBatch with 3 jobs → sequential processing
 *
 * The FakeBrowserSession in this file is more elaborate than the
 * one in `tests/linkedin/discovery-service.test.ts` because the
 * service needs both a primary page (the search page) AND a
 * fallback page (the dedicated URL). Each `openPage` /
 * `openFallbackPage` call gets a fresh FakePage that knows its
 * URL and serves the right fixture HTML.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseHTML } from 'linkedom';
import type { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DiagnosticInput, DiagnosticOutcome } from '../../src/diagnostics/manager.js';
import { FakeBrowserSession, type CreateFakePage } from '../../src/linkedin/fake-session.js';
import { FakePage } from '../../src/linkedin/fake-page.js';
import { LINKEDIN_SELECTORS } from '../../src/linkedin/selectors.js';
import { LinkedInExtractionService } from '../../src/linkedin/extraction/service.js';
import type { LinkedInExtractionLogger } from '../../src/linkedin/extraction/log.js';
import type { SearchExecutionRow } from '../../src/persistence/repositories/pipeline-runs.js';
import { createDatabaseConnection } from '../../src/persistence/connection.js';
import { createRepositories, type Repositories } from '../../src/persistence/repositories/index.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { loadFixture, type FixtureName } from './fixtures/loadFixture.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Capture every logger call so the tests can assert the orchestrator
 * emitted the expected structured events.
 */
class CapturingLogger implements LinkedInExtractionLogger {
  readonly calls: { readonly method: string; readonly args: Record<string, unknown> }[] = [];
  extractionStart(a: { jobId: number; sourceJobId: string }): void {
    this.calls.push({ method: 'extractionStart', args: { ...a } });
  }
  extractionComplete(a: { jobId: number; kind: string }): void {
    this.calls.push({ method: 'extractionComplete', args: { ...a } });
  }
  extractionSkip(a: { jobId: number; reason: string }): void {
    this.calls.push({ method: 'extractionSkip', args: { ...a } });
  }
  extractionFail(a: { jobId: number; errorCode: string; method?: string }): void {
    this.calls.push({ method: 'extractionFail', args: { ...a } });
  }
  panelMismatch(a: {
    jobId: number;
    expectedSourceJobId: string;
    actualSourceJobId: string;
  }): void {
    this.calls.push({ method: 'panelMismatch', args: { ...a } });
  }
  fallbackStart(a: { jobId: number; url: string }): void {
    this.calls.push({ method: 'fallbackStart', args: { ...a } });
  }
  fallbackClose(a: { jobId: number }): void {
    this.calls.push({ method: 'fallbackClose', args: { ...a } });
  }
}

/**
 * Minimal DiagnosticManager stub — records the calls but produces
 * no artifacts. The orchestrator doesn't call `recordScraperError`
 * in Wave D (per-job errors are surfaced as outcomes), so this stub
 * just satisfies the constructor signature.
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
 * Minimal `Page`-shaped test double that reads fields from a
 * linkedom-parsed HTML string. Honours the multi-selector
 * `LINKEDIN_SELECTORS.panel.description` list (first-match wins).
 *
 * This is a lighter version of the `panel-parser.test.ts` /
 * `dedicated-parser.test.ts` fakes — both have the same locator
 * shape; the service exercises both via the search page and the
 * fallback page.
 */
interface FakeElement {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string;
}
interface FakeDocument {
  readonly querySelector: (selector: string) => FakeElement | null;
  readonly querySelectorAll: (selector: string) => FakeElement[];
}
function parseDocument(html: string): FakeDocument {
  const { document: rawDoc } = parseHTML(html);
  return rawDoc as unknown as FakeDocument;
}
function firstMatchingSelector(doc: FakeDocument, selectorList: string): FakeElement | null {
  for (const part of selectorList.split(',')) {
    const trimmed = part.trim();
    const node = doc.querySelector(trimmed);
    if (node !== null) return node;
  }
  return null;
}
function pickNode(doc: FakeDocument, selector: string): FakeElement | null {
  if (selector.includes(',')) return firstMatchingSelector(doc, selector);
  return doc.querySelector(selector);
}

/** Wrap a `FakePage` so it satisfies the Playwright `Page` type
 * for the orchestrator's input. The cast is safe because the
 * service only calls `url()` + `locator()` + `goto()` + `close()`
 * — all covered by `FakePage`. */
function asPage(fake: FakePage): Page {
  return fake as unknown as Page;
}

function makeFixturePage(html: string, url: string): FakePage {
  const doc = parseDocument(html);
  const fakeLocator = (selector: string) => ({
    first: () => fakeLocator(selector),
    textContent: async (opts?: { readonly timeout?: number }) => {
      void opts;
      const node = pickNode(doc, selector);
      return node?.textContent ?? null;
    },
    getAttribute: async (name: string) => {
      const node = pickNode(doc, selector);
      return node?.getAttribute(name) ?? null;
    },
    waitFor: async (opts: { state: string; timeout: number }) => {
      void opts.state;
      // Match the parser contract: the description selector MUST be
      // visible for the parse to succeed. Other selectors (title,
      // company, location, titleAnchor) succeed as long as any
      // matching node exists in the parsed DOM.
      if (selector === LINKEDIN_SELECTORS.panel.description) {
        const node = firstMatchingSelector(doc, LINKEDIN_SELECTORS.panel.description);
        if (node === null) {
          const err = new Error(`waitFor timed out for selector ${selector}`);
          err.name = 'Error';
          throw err;
        }
      }
      void opts.timeout;
      return undefined;
    },
    count: async () => {
      // For the overlay detector's `count()` — return 0 so no overlays
      // are detected. The service doesn't exercise the overlay path
      // because the fake page never has visible overlays.
      return 0;
    },
    click: async () => undefined,
    all: async () => [],
    elementHandle: async () => ({
      getAttribute: (name: string) => {
        const node = pickNode(doc, selector);
        return node?.getAttribute(name) ?? null;
      },
      querySelector: (sel: string) => {
        const node = pickNode(doc, sel);
        if (node === null) return null;
        return {
          getAttribute: (name: string) => node.getAttribute(name),
          querySelector: (s: string) => {
            const inner = pickNode(doc, s);
            if (inner === null) return null;
            return {
              getAttribute: (name: string) => inner.getAttribute(name),
              querySelector: () => null,
            };
          },
        };
      },
    }),
  });
  return new FakePage({
    url,
    onGoto: async () => null,
    onLocator: (selector: string) => fakeLocator(selector),
  });
}

const PANEL_COMPLETE_URL = 'https://www.linkedin.com/jobs/search/?keywords=engineer';
const PANEL_PARTIAL_URL = 'https://www.linkedin.com/jobs/search/?keywords=staff';

/**
 * Fixture-routing `FakeBrowserSession` — the `createPage` factory
 * picks the right fixture HTML based on the URL the orchestrator
 * passed to `openPage` / `openFallbackPage`.
 *
 * `panelByUrl[url]` selects the panel fixture for the primary page;
 * `dedicatedUrl` selects the dedicated fixture for the fallback
 * page. When a URL doesn't match, the page resolves to an empty
 * document (the parsers then throw `description_not_visible`).
 */
class FixtureRoutingSession extends FakeBrowserSession {
  constructor(
    private readonly panelByUrl: ReadonlyMap<string, FixtureName>,
    private readonly dedicatedByUrl: ReadonlyMap<string, FixtureName>,
    private readonly fallbackFailure: boolean,
    private readonly dedicatedNavigationFails: boolean = false,
  ) {
    const createFn: CreateFakePage = (_session, url) => {
      if (url.includes('/jobs/view/')) {
        if (this.dedicatedNavigationFails) {
          // Build a FakePage whose goto() throws a TimeoutError so
          // `navigateWithTimeout` returns `{ ok: false, reason: 'timeout' }`
          // and the service records the dedicated attempt as a
          // `DedicatedPageError` failure (kind = 'failed').
          return new FakePage({
            url,
            onGoto: async () => {
              const err = new Error('Timeout exceeded');
              err.name = 'TimeoutError';
              throw err;
            },
          });
        }
        const fixture = this.dedicatedByUrl.get(url);
        if (fixture === undefined || this.fallbackFailure) {
          return makeFixturePage('<html><body></body></html>', url);
        }
        return makeFixturePage(loadFixture(fixture), url);
      }
      const fixture = this.panelByUrl.get(url);
      if (fixture === undefined) {
        return makeFixturePage('<html><body></body></html>', url);
      }
      return makeFixturePage(loadFixture(fixture), url);
    };
    super({ createPage: createFn });
  }
}

interface TestRig {
  service: LinkedInExtractionService;
  session: FixtureRoutingSession;
  dm: FakeDiagnosticManager;
  logger: CapturingLogger;
  repositories: Repositories;
  closeAll: () => Promise<void>;
}

async function setupTestRig(): Promise<TestRig> {
  const tempDir = mkdtempSync(join(tmpdir(), 'jobhunter-extraction-service-'));
  const connection = createDatabaseConnection(join(tempDir, 'jobhunter.sqlite'));
  runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
  const repositories = createRepositories(connection);
  const dm = new FakeDiagnosticManager();
  const logger = new CapturingLogger();
  const session = new FixtureRoutingSession(new Map(), new Map(), false);
  void session.launch();
  const service = new LinkedInExtractionService({
    repositories,
    browserSession: session,
    diagnosticManager: dm as never,
    logger,
    config: {
      navigationMs: 30_000,
      detailPanelMs: 10_000,
      dedicatedPageMs: 20_000,
      overlayDismissalMs: 1_000,
    },
  });
  return {
    service,
    session,
    dm,
    logger,
    repositories,
    closeAll: async () => {
      connection.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a pipeline run + search execution so the orchestrator has
 * valid `pipelineRunId` + `searchExecutionId` references.
 */
async function seedRunAndSearch(
  repositories: Repositories,
  searchUrl: string,
): Promise<{ runId: number; searchExecutionId: number }> {
  const created = await repositories.pipelineRuns.createRunWithSearches(
    {
      startTimestamp: '2026-08-20T10:00:00.000Z',
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
        generatedUrl: searchUrl,
        startTimestamp: '2026-08-20T10:00:00.000Z',
      },
    ],
  );
  return { runId: created.runId, searchExecutionId: created.searchIds[0]! };
}

function makeSearchExecution(id: number, generatedUrl: string): SearchExecutionRow {
  return {
    id,
    pipelineRunId: 1,
    searchQuery: 'engineer',
    locationName: 'Remote',
    geoId: '1',
    generatedUrl,
    startTimestamp: '2026-08-20T10:00:00.000Z',
    endTimestamp: null,
    finalStatus: 'pending',
    jobsDiscovered: 0,
    newJobs: 0,
    existingJobs: 0,
    errorsJson: null,
    diagnosticRefsJson: null,
  } as unknown as SearchExecutionRow;
}

/**
 * Insert a job via `recordNewJob` (returns `discoveryEventId`).
 * Mimics TASK-012's discovery flow: extractionStatus: 'failed'
 * placeholder; the orchestrator promotes it via `updateExtraction`.
 */
async function seedJob(
  repositories: Repositories,
  args: {
    pipelineRunId: number;
    searchExecutionId: number;
    sourceJobId: string;
    extractionStatus: 'complete' | 'partial' | 'failed';
  },
): Promise<{ jobId: number }> {
  const result = await repositories.jobs.recordNewJob({
    job: {
      sourceJobId: args.sourceJobId,
      extractionStatus: args.extractionStatus,
      firstDiscoveryTimestamp: '2026-08-20T10:00:00.000Z',
      lastRediscoveryTimestamp: '2026-08-20T10:00:00.000Z',
      createdTimestamp: '2026-08-20T10:00:00.000Z',
      updatedTimestamp: '2026-08-20T10:00:00.000Z',
    },
    discoveryEvent: {
      jobId: 0,
      pipelineRunId: args.pipelineRunId,
      searchExecutionId: args.searchExecutionId,
      timestamp: '2026-08-20T10:00:00.000Z',
      isNew: true,
      currentExtractionState: args.extractionStatus,
      extractionAttempted: false,
      skipReason: null,
    },
  });
  return { jobId: result.jobId };
}

const NO_SIGNAL = new AbortController().signal;

describe('LinkedInExtractionService (Wave D integration)', () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await setupTestRig();
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('extractOne happy path: panel-complete → kind: complete + DB rows updated', async () => {
    // Route the search URL to panel-complete; the dedicated URL is
    // unused on the happy path.
    const searchUrl = PANEL_COMPLETE_URL;
    rig.session = new FixtureRoutingSession(
      new Map([[searchUrl, 'panel-complete']]),
      new Map([['https://www.linkedin.com/jobs/view/1234567890/', 'dedicated-complete']]),
      false,
    );
    void rig.session.launch();
    const service = new LinkedInExtractionService({
      repositories: rig.repositories,
      browserSession: rig.session,
      diagnosticManager: rig.dm as never,
      logger: rig.logger,
      config: {
        navigationMs: 30_000,
        detailPanelMs: 10_000,
        dedicatedPageMs: 20_000,
        overlayDismissalMs: 1_000,
      },
    });

    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    const { jobId } = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'failed',
    });

    const outcome = await service.extractOne({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      job: { id: jobId, sourceJobId: '1234567890', extractionStatus: 'failed' },
      searchPage: asPage(makeFixturePage(loadFixture('panel-complete'), searchUrl)),
      signal: NO_SIGNAL,
    });

    expect(outcome.kind).toBe('complete');
    expect(outcome.jobId).toBe(jobId);
    expect(outcome.attemptedMethods).toEqual(['search_detail_panel']);
    expect(outcome.errorCode).toBeNull();
    expect(outcome.fields.title).toBe('Senior Software Engineer');
    expect(outcome.fields.company).toBe('Acme Corp');

    // jobs row promoted to 'complete'.
    const job = await rig.repositories.jobs.findById(jobId);
    expect(job?.extractionStatus).toBe('complete');
    expect(job?.successfulMethod).toBe('search_detail_panel');
    expect(job?.title).toBe('Senior Software Engineer');

    // extractionAttempts row inserted.
    const attempts = await rig.repositories.jobs.listExtractionAttemptsByJob(jobId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.method).toBe('search_detail_panel');
    expect(attempts[0]?.success).toBe(true);
    expect(attempts[0]?.errorCode).toBeNull();

    // discoveryEvents row patched.
    const events = await rig.repositories.jobs.listDiscoveryEventsByJob(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]?.currentExtractionState).toBe('complete');
    expect(events[0]?.extractionAttempted).toBe(true);

    // No fallback page opened.
    expect(rig.session.activeFallbackCount).toBe(0);

    // Logger emitted the lifecycle events.
    const methods = rig.logger.calls.map((c) => c.method);
    expect(methods).toContain('extractionStart');
    expect(methods).toContain('extractionComplete');
  });

  it('extractOne skips complete jobs (no panel, no fallback, no DB writes)', async () => {
    const searchUrl = PANEL_COMPLETE_URL;
    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    const { jobId } = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'complete',
    });
    // Pre-existing title — must NOT change.
    await rig.repositories.jobs.updateExtraction(jobId, { title: 'Original Title' });

    const outcome = await rig.service.extractOne({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      job: { id: jobId, sourceJobId: '1234567890', extractionStatus: 'complete' },
      searchPage: asPage(makeFixturePage('<html><body></body></html>', searchUrl)),
      signal: NO_SIGNAL,
    });

    expect(outcome.kind).toBe('skipped');
    expect(outcome.attemptedMethods).toEqual([]);
    expect(outcome.errorCode).toBeNull();

    // jobs.title unchanged.
    const job = await rig.repositories.jobs.findById(jobId);
    expect(job?.title).toBe('Original Title');
    expect(job?.extractionStatus).toBe('complete');

    // Zero extractionAttempts rows inserted.
    const attempts = await rig.repositories.jobs.listExtractionAttemptsByJob(jobId);
    expect(attempts).toHaveLength(0);

    // discoveryEvents row unchanged (extractionAttempted still false).
    const events = await rig.repositories.jobs.listDiscoveryEventsByJob(jobId);
    expect(events[0]?.extractionAttempted).toBe(false);
    expect(events[0]?.skipReason).toBeNull();

    // No fallback page opened.
    expect(rig.session.activeFallbackCount).toBe(0);

    // Logger emitted skip.
    const methods = rig.logger.calls.map((c) => c.method);
    expect(methods).toContain('extractionSkip');
  });

  it('extractOne skips partial jobs (no DB writes)', async () => {
    const searchUrl = PANEL_PARTIAL_URL;
    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    const { jobId } = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'partial',
    });

    const outcome = await rig.service.extractOne({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      job: { id: jobId, sourceJobId: '1234567890', extractionStatus: 'partial' },
      searchPage: asPage(makeFixturePage('<html><body></body></html>', searchUrl)),
      signal: NO_SIGNAL,
    });

    expect(outcome.kind).toBe('skipped');

    const job = await rig.repositories.jobs.findById(jobId);
    expect(job?.extractionStatus).toBe('partial');
    const attempts = await rig.repositories.jobs.listExtractionAttemptsByJob(jobId);
    expect(attempts).toHaveLength(0);
    const events = await rig.repositories.jobs.listDiscoveryEventsByJob(jobId);
    expect(events[0]?.extractionAttempted).toBe(false);
    expect(events[0]?.skipReason).toBeNull();
    expect(rig.session.activeFallbackCount).toBe(0);
  });

  it('extractOne fallback path: panel-mismatch → dedicated-complete → kind: complete', async () => {
    const searchUrl = PANEL_COMPLETE_URL;
    const dedicatedUrl = 'https://www.linkedin.com/jobs/view/1234567890/';
    rig.session = new FixtureRoutingSession(
      new Map([[searchUrl, 'panel-mismatch']]),
      new Map([[dedicatedUrl, 'dedicated-complete']]),
      false,
    );
    void rig.session.launch();
    const service = new LinkedInExtractionService({
      repositories: rig.repositories,
      browserSession: rig.session,
      diagnosticManager: rig.dm as never,
      logger: rig.logger,
      config: {
        navigationMs: 30_000,
        detailPanelMs: 10_000,
        dedicatedPageMs: 20_000,
        overlayDismissalMs: 1_000,
      },
    });

    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    const { jobId } = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'failed',
    });

    const outcome = await service.extractOne({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      job: { id: jobId, sourceJobId: '1234567890', extractionStatus: 'failed' },
      searchPage: asPage(makeFixturePage(loadFixture('panel-mismatch'), searchUrl)),
      signal: NO_SIGNAL,
    });

    expect(outcome.kind).toBe('complete');
    expect(outcome.attemptedMethods).toEqual(['search_detail_panel', 'dedicated_job_page']);
    expect(outcome.fields.title).toBe('Director of Engineering');
    expect(outcome.fields.company).toContain('Gamma Co');

    const job = await rig.repositories.jobs.findById(jobId);
    expect(job?.extractionStatus).toBe('complete');
    expect(job?.successfulMethod).toBe('dedicated_job_page');

    // 2 extraction attempts (panel + dedicated).
    const attempts = await rig.repositories.jobs.listExtractionAttemptsByJob(jobId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.method).toBe('search_detail_panel');
    expect(attempts[0]?.success).toBe(false);
    expect(attempts[0]?.attemptNumber).toBe(1);
    expect(attempts[1]?.method).toBe('dedicated_job_page');
    expect(attempts[1]?.success).toBe(true);
    expect(attempts[1]?.attemptNumber).toBe(2);

    // Logger captured the mismatch + fallback events.
    const methods = rig.logger.calls.map((c) => c.method);
    expect(methods).toContain('panelMismatch');
    expect(methods).toContain('fallbackStart');
    expect(methods).toContain('fallbackClose');
    expect(methods).toContain('extractionComplete');

    // Fallback page closed.
    expect(rig.session.activeFallbackCount).toBe(0);
  });

  it('extractOne both panel and dedicated fail → kind: failed + 2 attempts', async () => {
    const searchUrl = PANEL_COMPLETE_URL;
    const dedicatedUrl = 'https://www.linkedin.com/jobs/view/1234567890/';
    // Route panel to panel-parse-failure (description missing →
    // PanelExtractionError); force the dedicated page's navigation
    // to fail (goto throws TimeoutError → navigateWithTimeout
    // returns ok:false → service records a DedicatedPageError).
    rig.session = new FixtureRoutingSession(
      new Map([[searchUrl, 'panel-parse-failure']]),
      new Map([[dedicatedUrl, 'panel-parse-failure']]),
      false,
      true, // dedicatedNavigationFails
    );
    void rig.session.launch();
    const service = new LinkedInExtractionService({
      repositories: rig.repositories,
      browserSession: rig.session,
      diagnosticManager: rig.dm as never,
      logger: rig.logger,
      config: {
        navigationMs: 30_000,
        detailPanelMs: 10_000,
        dedicatedPageMs: 20_000,
        overlayDismissalMs: 1_000,
      },
    });

    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    const { jobId } = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'failed',
    });

    const outcome = await service.extractOne({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      job: { id: jobId, sourceJobId: '1234567890', extractionStatus: 'failed' },
      searchPage: asPage(makeFixturePage(loadFixture('panel-parse-failure'), searchUrl)),
      signal: NO_SIGNAL,
    });

    expect(outcome.kind).toBe('failed');
    expect(outcome.attemptedMethods).toEqual(['search_detail_panel', 'dedicated_job_page']);
    expect(outcome.errorCode).toBe('panel_and_dedicated_failed');

    const job = await rig.repositories.jobs.findById(jobId);
    expect(job?.extractionStatus).toBe('failed');

    const attempts = await rig.repositories.jobs.listExtractionAttemptsByJob(jobId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.success).toBe(false);
    expect(attempts[0]?.errorCode).toBe('panel_and_dedicated_failed');
    expect(attempts[1]?.success).toBe(false);
    expect(attempts[1]?.errorCode).toBe('panel_and_dedicated_failed');

    // discoveryEvents row patched.
    const events = await rig.repositories.jobs.listDiscoveryEventsByJob(jobId);
    expect(events[0]?.currentExtractionState).toBe('failed');
    expect(events[0]?.extractionAttempted).toBe(true);

    // Fallback page closed.
    expect(rig.session.activeFallbackCount).toBe(0);

    const methods = rig.logger.calls.map((c) => c.method);
    expect(methods).toContain('extractionFail');
  });

  it('extractBatch processes 3 jobs sequentially + aggregates totals', async () => {
    const searchUrl = PANEL_COMPLETE_URL;
    const dedicatedUrl = 'https://www.linkedin.com/jobs/view/';
    rig.session = new FixtureRoutingSession(
      new Map([
        [searchUrl, 'panel-complete'],
        [PANEL_PARTIAL_URL, 'panel-partial'],
        ['https://www.linkedin.com/jobs/search/?keywords=minimal', 'panel-complete'],
      ]),
      new Map([
        [`${dedicatedUrl}1234567890/`, 'dedicated-complete'],
        [`${dedicatedUrl}1234567891/`, 'dedicated-complete'],
        [`${dedicatedUrl}1234567892/`, 'dedicated-complete'],
      ]),
      false,
    );
    void rig.session.launch();
    const service = new LinkedInExtractionService({
      repositories: rig.repositories,
      browserSession: rig.session,
      diagnosticManager: rig.dm as never,
      logger: rig.logger,
      config: {
        navigationMs: 30_000,
        detailPanelMs: 10_000,
        dedicatedPageMs: 20_000,
        overlayDismissalMs: 1_000,
      },
    });

    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    // 3 failed jobs → orchestrator promotes them via updateExtraction.
    const j1 = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'failed',
    });
    const j2 = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567891',
      extractionStatus: 'failed',
    });
    const j3 = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567892',
      extractionStatus: 'complete', // pre-existing complete → skipped
    });

    const searchPage = asPage(makeFixturePage(loadFixture('panel-complete'), searchUrl));
    const batch = await service.extractBatch({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      jobs: [
        { id: j1.jobId, sourceJobId: '1234567890', extractionStatus: 'failed' },
        { id: j2.jobId, sourceJobId: '1234567891', extractionStatus: 'failed' },
        { id: j3.jobId, sourceJobId: '1234567892', extractionStatus: 'complete' },
      ],
      searchPage,
      signal: NO_SIGNAL,
    });

    expect(batch.perJob).toHaveLength(3);
    // j3 was pre-existing complete → skipped; j1 + j2 → complete.
    expect(batch.totals).toEqual({
      complete: 2,
      partial: 0,
      failed: 0,
      skipped: 1,
      cancelled: 0,
    });
    expect(batch.perJob[0]?.kind).toBe('complete');
    expect(batch.perJob[1]?.kind).toBe('complete');
    expect(batch.perJob[2]?.kind).toBe('skipped');

    // Fallback pages closed.
    expect(rig.session.activeFallbackCount).toBe(0);
  });

  it('extractBatch cancellation between iterations → remaining jobs are cancelled', async () => {
    const searchUrl = PANEL_COMPLETE_URL;
    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    const j1 = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'failed',
    });
    const j2 = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567891',
      extractionStatus: 'failed',
    });
    const j3 = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567892',
      extractionStatus: 'failed',
    });

    // Rebuild the service so the dedicated navigation fails — the
    // first iteration must produce `kind: 'failed'` so we can prove
    // the cancellation check fires at iteration 2.
    rig.session = new FixtureRoutingSession(
      new Map(),
      new Map(),
      false,
      true, // dedicatedNavigationFails
    );
    void rig.session.launch();
    const service = new LinkedInExtractionService({
      repositories: rig.repositories,
      browserSession: rig.session,
      diagnosticManager: rig.dm as never,
      logger: rig.logger,
      config: {
        navigationMs: 30_000,
        detailPanelMs: 10_000,
        dedicatedPageMs: 20_000,
        overlayDismissalMs: 1_000,
      },
    });

    const controller = new AbortController();
    // Abort AFTER the first job — the for-of loop's signal check
    // fires at iteration 2.
    const originalExtractOne = service.extractOne.bind(service);
    let count = 0;
    service.extractOne = async (
      input: Parameters<typeof originalExtractOne>[0],
    ): ReturnType<typeof originalExtractOne> => {
      count += 1;
      if (count === 1) {
        const result = await originalExtractOne(input);
        controller.abort();
        return result;
      }
      return originalExtractOne(input);
    };

    const batch = await service.extractBatch({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      jobs: [
        { id: j1.jobId, sourceJobId: '1234567890', extractionStatus: 'failed' },
        { id: j2.jobId, sourceJobId: '1234567891', extractionStatus: 'failed' },
        { id: j3.jobId, sourceJobId: '1234567892', extractionStatus: 'failed' },
      ],
      searchPage: asPage(makeFixturePage('<html><body></body></html>', searchUrl)),
      signal: controller.signal,
    });

    expect(batch.perJob).toHaveLength(3);
    expect(batch.perJob[0]?.kind).toBe('failed'); // first iteration: panel + dedicated both fail
    expect(batch.perJob[1]?.kind).toBe('cancelled');
    expect(batch.perJob[2]?.kind).toBe('cancelled');
    expect(batch.totals.cancelled).toBe(2);
    void j2;
    void j3;
  });

  it('extractOne updates lastExtractionAttemptTimestamp + updatedTimestamp atomically', async () => {
    const searchUrl = PANEL_COMPLETE_URL;
    const { runId, searchExecutionId } = await seedRunAndSearch(rig.repositories, searchUrl);
    const { jobId } = await seedJob(rig.repositories, {
      pipelineRunId: runId,
      searchExecutionId,
      sourceJobId: '1234567890',
      extractionStatus: 'failed',
    });

    await rig.service.extractOne({
      run: { id: runId },
      searchExecution: makeSearchExecution(searchExecutionId, searchUrl),
      job: { id: jobId, sourceJobId: '1234567890', extractionStatus: 'failed' },
      searchPage: asPage(makeFixturePage(loadFixture('panel-complete'), searchUrl)),
      signal: NO_SIGNAL,
    });

    const job = await rig.repositories.jobs.findById(jobId);
    expect(job?.lastExtractionAttemptTimestamp).not.toBeNull();
    expect(job?.lastExtractionAttemptTimestamp).toBe(job?.updatedTimestamp);
  });
});
