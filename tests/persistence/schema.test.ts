import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/persistence/schema.js';

const EXPECTED_TABLES = [
  'application_metadata',
  'profile_sources',
  'profile_versions',
  'profile_revisions',
  'profile_conflicts',
  'profile_warnings',
  'derived_overrides',
  'filter_configuration_versions',
  'pipeline_runs',
  'search_executions',
  'jobs',
  'discovery_events',
  'discovery_errors',
  'extraction_attempts',
  'filter_results',
  'score_results',
  'openai_request_metadata',
  'diagnostic_artifacts',
] as const;

function table(name: (typeof EXPECTED_TABLES)[number]): SQLiteTable {
  for (const value of Object.values(schema)) {
    if (value !== null && typeof value === 'object' && 'getSQL' in value) {
      const exported = value as SQLiteTable;
      if (getTableConfig(exported).name === name) {
        return exported;
      }
    }
  }
  throw new Error(`Schema export "${name}" is missing or not a table.`);
}

describe('persistence schema', () => {
  it('exports a table for every required MVP entity', () => {
    const exportedNames = new Set<string>(
      Object.values(schema).map((value) => {
        if (value === null || typeof value !== 'object' || !('getSQL' in value)) return '';
        return getTableConfig(value as SQLiteTable).name;
      }),
    );
    for (const expected of EXPECTED_TABLES) {
      expect(exportedNames.has(expected), `missing table ${expected}`).toBe(true);
    }
  });

  it('gives every table an integer primary key named "id" except application_metadata', () => {
    for (const name of EXPECTED_TABLES) {
      // application_metadata uses a text `key` column as its primary key.
      if (name === 'application_metadata') continue;
      const config = getTableConfig(table(name));
      const idColumn = config.columns.find((c) => c.name === 'id');
      expect(idColumn, `${name} missing id column`).toBeDefined();
      expect(idColumn?.dataType, `${name}.id must be integer`).toBe('number');
      expect(idColumn?.primary, `${name}.id must be primary`).toBe(true);
      const idAutoIncrement = (idColumn as { autoIncrement?: boolean }).autoIncrement;
      expect(idAutoIncrement, `${name}.id must be autoincrement`).toBe(true);
    }
  });

  it('enforces one active approved profile version via a partial unique index', () => {
    const config = getTableConfig(table('profile_versions'));
    const partial = config.indexes.find(
      (idx) => idx.config.name === 'profile_versions_active_approved_idx',
    );
    expect(partial, 'partial unique index must exist').toBeDefined();
    expect(partial?.config.unique, 'profile_versions_active_approved_idx must be unique').toBe(
      true,
    );
    const whereString = JSON.stringify(partial?.config.where);
    expect(whereString).toContain('approved');
    expect(whereString).toContain('active');
  });

  it('enforces job deduplication by source_job_id', () => {
    const config = getTableConfig(table('jobs'));
    const unique = config.indexes.find((idx) => idx.config.name === 'jobs_source_job_id_idx');
    expect(unique, 'unique index on jobs.source_job_id must exist').toBeDefined();
    expect(unique?.config.unique, 'jobs_source_job_id_idx must be unique').toBe(true);
  });

  it('declares foreign-key relationships from extraction_attempts to job/run/search', () => {
    const config = getTableConfig(table('extraction_attempts'));
    const fkTargets = config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        columns: ref.columns.map((c) => c.name),
        referenceColumns: ref.foreignColumns.map((c) => c.name),
        referenceTable: getTableConfig(ref.foreignTable).name,
      };
    });
    expect(fkTargets).toContainEqual({
      columns: ['job_id'],
      referenceColumns: ['id'],
      referenceTable: 'jobs',
    });
    expect(fkTargets).toContainEqual({
      columns: ['pipeline_run_id'],
      referenceColumns: ['id'],
      referenceTable: 'pipeline_runs',
    });
    expect(fkTargets).toContainEqual({
      columns: ['search_execution_id'],
      referenceColumns: ['id'],
      referenceTable: 'search_executions',
    });
  });
});
