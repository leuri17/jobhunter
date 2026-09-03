import type { FastifyInstance } from 'fastify';
import {
  RunsListService,
  RunsShowService,
  type RunListRow,
  type RunShowPayload,
} from '@jobhunter/core/inspection';
import { openDbHandle, createRepositories } from './db-helper.js';

export async function registerRunsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>('/api/runs', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new RunsListService(repos);
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;
      const rows: readonly RunListRow[] = await service.list({ limit });
      return { schemaVersion: 1, limit, returned: rows.length, runs: rows };
    } finally {
      handle.close();
    }
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new RunsShowService(repos);
      const payload: RunShowPayload = await service.show(req.params.id);
      return { schemaVersion: 1, ...payload };
    } finally {
      handle.close();
    }
  });
}
