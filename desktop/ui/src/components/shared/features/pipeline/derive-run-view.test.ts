import { describe, expect, it } from 'vitest';
import type { PipelineProgressEvent } from '@/lib/types';
import { deriveRunView } from './derive-run-view';

function events(...list: PipelineProgressEvent[]): readonly PipelineProgressEvent[] {
  return list;
}

const runStart: PipelineProgressEvent = { type: 'run_start', runId: 1, searchesPlanned: 2 };

const searchStart0: PipelineProgressEvent = {
  type: 'search_start',
  runId: 1,
  index: 0,
  total: 2,
  query: 'q1',
  locationName: 'L1',
};

const searchStart1: PipelineProgressEvent = {
  type: 'search_start',
  runId: 1,
  index: 1,
  total: 2,
  query: 'q2',
  locationName: 'L1',
};

function phase(index: number, p: 'discovery' | 'extraction' | 'filter'): PipelineProgressEvent {
  return { type: 'search_phase', runId: 1, index, phase: p };
}

describe('deriveRunView current search', () => {
  it('is null before any search starts', () => {
    const view = deriveRunView(events(runStart), 'running', false);
    expect(view.currentSearch).toBeNull();
  });

  it('exposes the current search from the latest search_start', () => {
    const view = deriveRunView(events(runStart, searchStart0), 'running', false);
    expect(view.currentSearch).toEqual({
      query: 'q1',
      locationName: 'L1',
      index: 0,
      total: 2,
    });
  });

  it('moves to the next search when its search_start arrives', () => {
    const view = deriveRunView(events(runStart, searchStart0, searchStart1), 'running', false);
    expect(view.currentSearch).toMatchObject({ query: 'q2', locationName: 'L1', index: 1 });
  });
});

describe('deriveRunView search-loop stage phases', () => {
  it('keeps the legacy shared-active fold for streams without search_phase events', () => {
    const view = deriveRunView(events(runStart, searchStart0), 'running', false);
    expect(view.stages.discovery).toBe('active');
    expect(view.stages.extraction).toBe('active');
    expect(view.stages.filter).toBe('active');
  });

  it('lights only discovery while its phase event is last', () => {
    const view = deriveRunView(
      events(runStart, searchStart0, phase(0, 'discovery')),
      'running',
      false,
    );
    expect(view.stages.discovery).toBe('active');
    expect(view.stages.extraction).toBe('pending');
    expect(view.stages.filter).toBe('pending');
  });

  it('marks discovery done and lights only extraction in the extraction phase', () => {
    const view = deriveRunView(
      events(runStart, searchStart0, phase(0, 'discovery'), phase(0, 'extraction')),
      'running',
      false,
    );
    expect(view.stages.discovery).toBe('done');
    expect(view.stages.extraction).toBe('active');
    expect(view.stages.filter).toBe('pending');
  });

  it('marks discovery and extraction done while the filter phase runs', () => {
    const view = deriveRunView(
      events(
        runStart,
        searchStart0,
        phase(0, 'discovery'),
        phase(0, 'extraction'),
        phase(0, 'filter'),
      ),
      'running',
      false,
    );
    expect(view.stages.discovery).toBe('done');
    expect(view.stages.extraction).toBe('done');
    expect(view.stages.filter).toBe('active');
  });

  it('re-activates discovery when the next search begins', () => {
    const view = deriveRunView(
      events(
        runStart,
        searchStart0,
        phase(0, 'discovery'),
        phase(0, 'extraction'),
        phase(0, 'filter'),
        searchStart1,
        phase(1, 'discovery'),
      ),
      'running',
      false,
    );
    expect(view.stages.discovery).toBe('active');
    expect(view.stages.extraction).toBe('pending');
    expect(view.stages.filter).toBe('pending');
  });

  it('holds the current phases when the SSE stream drops (status error)', () => {
    const view = deriveRunView(
      events(runStart, searchStart0, phase(0, 'discovery'), phase(0, 'extraction')),
      'error',
      false,
    );
    expect(view.stages.discovery).toBe('done');
    expect(view.stages.extraction).toBe('active');
    expect(view.stages.filter).toBe('pending');
  });

  it('folds all three stages to done on a terminal status', () => {
    const view = deriveRunView(
      events(runStart, searchStart0, phase(0, 'discovery')),
      'cancelled',
      false,
    );
    expect(view.stages.discovery).toBe('done');
    expect(view.stages.extraction).toBe('done');
    expect(view.stages.filter).toBe('done');
  });

  it('folds all three stages to done on run_summary', () => {
    const view = deriveRunView(
      events(
        runStart,
        searchStart0,
        phase(0, 'discovery'),
        phase(0, 'extraction'),
        phase(0, 'filter'),
        {
          type: 'scoring_plan',
          runId: 1,
          jobsDiscovered: 0,
          newOpenAIRequests: 0,
        },
      ),
      'running',
      false,
    );
    expect(view.stages.discovery).toBe('done');
    expect(view.stages.extraction).toBe('done');
    expect(view.stages.filter).toBe('done');
  });
});
