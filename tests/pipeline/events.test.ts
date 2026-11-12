import { describe, expect, it } from 'vitest';

import { buildRunHarness, type RunHarness } from '../helpers/run-harness.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { insertActiveFilter, insertApprovedProfile } from './helpers/fixtures.js';
import { StubExtractionService } from './helpers/stub-extraction-service.js';
import { fakePageWithCard } from './helpers/fake-page-with-card.js';
import { makeValidResponse } from '../scoring/fixtures/fake-scoring-pipeline.js';
import { loadScoringFixture } from '../scoring/fixtures/loadFixture.js';
import type { PipelineProgressEvent } from '../../src/pipeline/events.js';

/**
 * Progress-event coverage for the orchestrator's `onEvent` sink: the
 * deterministic emission points (run_start, initial stats, per-search
 * search_start + stats, terminal run_summary). scoring_plan /
 * scoring_confirmed / scoring_declined ride the scoring-confirmation
 * branch (needs accepted jobs); their SSE forwarding is covered by the
 * sidecar's `pipeline-progress` tests with an injected orchestrator.
 */
describe('PipelineOrchestrator progress events', () => {
  function harnessWithEvents(
    config: typeof DEFAULT_OPERATIONAL_CONFIG = DEFAULT_OPERATIONAL_CONFIG,
  ): { harness: RunHarness; events: PipelineProgressEvent[] } {
    const events: PipelineProgressEvent[] = [];
    const harness = buildRunHarness({
      config,
      prompts: new ScriptedPipelinePrompts([]),
      onEvent: (event) => {
        events.push(event);
      },
    });
    return { harness, events };
  }

  it('emits run_start, an initial stats snapshot, and run_summary for an empty matrix', async () => {
    const { harness, events } = harnessWithEvents({
      ...DEFAULT_OPERATIONAL_CONFIG,
      search: { ...DEFAULT_OPERATIONAL_CONFIG.search, searchQueries: [], locations: [] },
    });
    try {
      await insertApprovedProfile(harness.repositories);
      await insertActiveFilter(harness.repositories);
      await harness.orchestrator.run({});
      expect(events.map((e) => e.type)).toEqual(['run_start', 'stats', 'run_summary']);
      expect(events[0]).toMatchObject({ type: 'run_start', searchesPlanned: 0 });
      expect(events[1]).toMatchObject({ type: 'stats', counters: { searchesAttempted: 0 } });
      expect(events[2]).toMatchObject({
        type: 'run_summary',
        summary: { status: 'completed', searchesPlanned: 0 },
      });
    } finally {
      harness.cleanup();
    }
  });

  it('emits search_start per search with query and location, then refreshed stats', async () => {
    const { harness, events } = harnessWithEvents({
      ...DEFAULT_OPERATIONAL_CONFIG,
      search: {
        ...DEFAULT_OPERATIONAL_CONFIG.search,
        searchQueries: ['q1'],
        locations: [{ name: 'L1', geoId: '1' }],
      },
    });
    try {
      await insertApprovedProfile(harness.repositories);
      await insertActiveFilter(harness.repositories);
      await harness.orchestrator.run({});
      expect(events.map((e) => e.type)).toEqual([
        'run_start',
        'stats',
        'search_start',
        'search_phase',
        'search_phase',
        'search_phase',
        'stats',
        'run_summary',
      ]);
      expect(events[2]).toMatchObject({
        type: 'search_start',
        index: 0,
        total: 1,
        query: 'q1',
        locationName: 'L1',
      });
      expect(events[3]).toMatchObject({ type: 'search_phase', index: 0, phase: 'discovery' });
      expect(events[4]).toMatchObject({ type: 'search_phase', index: 0, phase: 'extraction' });
      expect(events[5]).toMatchObject({ type: 'search_phase', index: 0, phase: 'filter' });
    } finally {
      harness.cleanup();
    }
  });

  it('emits stats per scored job so the stage counters climb live (#335)', async () => {
    const events: PipelineProgressEvent[] = [];
    const harness = buildRunHarness({
      config: {
        ...DEFAULT_OPERATIONAL_CONFIG,
        search: {
          ...DEFAULT_OPERATIONAL_CONFIG.search,
          searchQueries: ['q1'],
          locations: [{ name: 'L1', geoId: '1' }],
        },
      },
      prompts: new ScriptedPipelinePrompts([]),
      confirmScoring: true,
      createPage: fakePageWithCard(['4242', '4243']),
      extractionServiceOverride: new StubExtractionService() as never,
      fakeScripts: [
        {
          responses: [
            makeValidResponse(loadScoringFixture('scoring-output-valid')),
            makeValidResponse(loadScoringFixture('scoring-output-valid')),
          ],
        },
      ],
      onEvent: (event) => {
        events.push(event);
      },
    });
    try {
      await insertApprovedProfile(harness.repositories);
      await insertActiveFilter(harness.repositories);
      await harness.orchestrator.run({});

      const scoringStats = events.filter(
        (e): e is Extract<PipelineProgressEvent, { type: 'stats' }> =>
          e.type === 'stats' && e.counters.jobsScored > 0,
      );
      // One stats event per finished job, with the counter climbing:
      // 1 after the first score, 2 after the second.
      expect(scoringStats.map((e) => e.counters.jobsScored)).toEqual([1, 2]);
      const tokens = scoringStats[1]?.counters;
      expect((tokens?.promptTokens ?? 0) + (tokens?.completionTokens ?? 0)).toBeGreaterThan(0);
    } finally {
      harness.cleanup();
    }
  });
});
