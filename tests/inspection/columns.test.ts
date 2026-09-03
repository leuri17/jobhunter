import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TERMINAL_WIDTH,
  HEADERS_BY_STATE,
  PRIORITY_BY_STATE,
  selectColumns,
} from '../../src/inspection/columns.js';
import { InspectionValidationError } from '../../src/inspection/errors.js';
import { JOB_LIST_STATES, type JobListState } from '../../src/inspection/state.js';

describe('selectColumns + per-state headers + priorities', () => {
  describe('DEFAULT_TERMINAL_WIDTH', () => {
    it('is 120 (matches src/pipeline/format.ts:60)', () => {
      expect(DEFAULT_TERMINAL_WIDTH).toBe(120);
    });
  });

  describe('HEADERS_BY_STATE', () => {
    it('matches the documented per-state column counts', () => {
      expect(HEADERS_BY_STATE.scored.length).toBe(6);
      expect(HEADERS_BY_STATE.accepted.length).toBe(6);
      expect(HEADERS_BY_STATE.rejected.length).toBe(7);
      expect(HEADERS_BY_STATE.unscored.length).toBe(6);
      expect(HEADERS_BY_STATE.partial.length).toBe(6);
      expect(HEADERS_BY_STATE.failed.length).toBe(6);
      expect(HEADERS_BY_STATE['filter-errors'].length).toBe(5);
      expect(HEADERS_BY_STATE['scoring-errors'].length).toBe(6);
      expect(HEADERS_BY_STATE.all.length).toBe(9);
    });

    it('contains the documented "scored" header order', () => {
      expect(HEADERS_BY_STATE.scored).toEqual([
        'ID',
        'Score',
        'Title',
        'Company',
        'Location',
        'First discovered',
      ]);
    });

    it('contains the documented "all" header order', () => {
      expect(HEADERS_BY_STATE.all).toEqual([
        'ID',
        'Extraction',
        'Filter',
        'Score status',
        'Score',
        'Title',
        'Company',
        'Location',
        'First discovered',
      ]);
    });
  });

  describe('PRIORITY_BY_STATE', () => {
    it('matches the per-state header count (every state has one priority per header)', () => {
      for (const state of JOB_LIST_STATES) {
        expect(PRIORITY_BY_STATE[state].length).toBe(HEADERS_BY_STATE[state].length);
      }
    });

    it('scored: ID is priority 0, Score is 1, Title is 2, Company is 3, Location is 4, First discovered is 5', () => {
      expect(PRIORITY_BY_STATE.scored).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('ID column is always priority 0 across every state', () => {
      for (const state of JOB_LIST_STATES) {
        expect(PRIORITY_BY_STATE[state][0]).toBe(0);
      }
    });
  });

  describe('selectColumns(state, 120)', () => {
    it('returns all 6 columns for the scored view at the default width', () => {
      const specs = selectColumns('scored', 120);
      expect(specs.map((s) => s.header)).toEqual(HEADERS_BY_STATE.scored);
      expect(specs).toHaveLength(6);
    });

    it('returns all 9 columns for the allJobs view at the default width', () => {
      const specs = selectColumns('all', 120);
      expect(specs.map((s) => s.header)).toEqual(HEADERS_BY_STATE.all);
      expect(specs).toHaveLength(9);
    });

    it('every ColumnSpec has minWidth === header.length (priority 0 + 1 invariant)', () => {
      for (const state of JOB_LIST_STATES) {
        const specs = selectColumns(state, 120);
        for (const spec of specs) {
          expect(spec.minWidth).toBe(spec.header.length);
        }
      }
    });
  });

  describe('priority drop', () => {
    it('scored at width 60 fits all 6 documented columns (sum of minWidths = 43)', () => {
      const specs = selectColumns('scored', 60);
      expect(specs.map((s) => s.header)).toEqual(HEADERS_BY_STATE.scored);
      expect(specs).toHaveLength(6);
    });

    it('scored at width 40 drops the lowest-priority column ("First discovered")', () => {
      const specs = selectColumns('scored', 40);
      const headers = specs.map((s) => s.header);
      // First discovered (priority 5, width 16) is the first column dropped;
      // Location + Title + Company still fit.
      expect(headers).toContain('ID');
      expect(headers).toContain('Score');
      expect(headers).toContain('Title');
      expect(headers).toContain('Company');
      expect(headers).toContain('Location');
      expect(headers).not.toContain('First discovered');
    });

    it('scored at width 25 drops "First discovered" + "Location" (priority 4 + 5)', () => {
      const specs = selectColumns('scored', 25);
      const headers = specs.map((s) => s.header);
      // At width 25, the cumulative minWidth for the lowest-priority
      // columns pushes them over the budget. Location (8) is dropped
      // along with First discovered (16).
      expect(headers).toContain('ID');
      expect(headers).toContain('Score');
      expect(headers).toContain('Title');
      expect(headers).toContain('Company');
      expect(headers).not.toContain('Location');
      expect(headers).not.toContain('First discovered');
    });

    it('scored at width 18 keeps only ID + Score + Title (drops Company, Location, First discovered)', () => {
      const specs = selectColumns('scored', 18);
      const headers = specs.map((s) => s.header);
      expect(headers).toEqual(['ID', 'Score', 'Title']);
    });

    it('scored at width 7 keeps only ID + Score', () => {
      const specs = selectColumns('scored', 7);
      const headers = specs.map((s) => s.header);
      expect(headers).toEqual(['ID', 'Score']);
    });
  });

  describe('terminal_width_too_small', () => {
    it('scored at width 1 (cannot fit ID) throws InspectionValidationError', () => {
      expect(() => selectColumns('scored', 1)).toThrow(InspectionValidationError);
    });

    it('error.code is "terminal_width_too_small"', () => {
      try {
        selectColumns('scored', 1);
        throw new Error('expected selectColumns to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InspectionValidationError);
        expect((error as InspectionValidationError).code).toBe('terminal_width_too_small');
      }
    });
  });

  describe('input validation', () => {
    it('throws for non-integer terminalWidth', () => {
      expect(() => selectColumns('scored', 120.5)).toThrow(InspectionValidationError);
    });

    it('throws for negative terminalWidth', () => {
      expect(() => selectColumns('scored', -1)).toThrow(InspectionValidationError);
    });

    it('returns the documented first column for every JobListState', () => {
      const allStates: readonly JobListState[] = JOB_LIST_STATES;
      for (const state of allStates) {
        const specs = selectColumns(state, 120);
        // The kept columns are always a non-empty subset that preserves
        // the documented per-state column order.
        expect(specs.length).toBeGreaterThanOrEqual(1);
        expect(specs[0]?.header).toBe(HEADERS_BY_STATE[state][0]);
      }
    });
  });
});
