import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  ProfileImportService, ProfileExtractionService,
  ProfileReviewService, ProfileApprovalService,
  ProfileRejectionService,
  type OpenAIClient,
} from '@jobhunter/core/profile';
import { openDbHandle, createRepositories } from './db-helper.js';
import { resolveOpenAiClientOrNull } from './openai-resolve.js';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';

export interface ProfileRouteOptions {
  readonly openaiClient?: OpenAIClient;
}

export async function registerProfileRoutes(
  app: FastifyInstance,
  opts: ProfileRouteOptions = {},
): Promise<void> {
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.get<{ Querystring: { status?: string } }>('/api/profile', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new ProfileReviewService(repos);
      const status = req.query.status as 'draft' | 'approved' | 'rejected' | 'superseded' | undefined;
      const entries = await service.list(status === undefined ? undefined : { status });
      return { schemaVersion: 1, profiles: entries };
    } finally { handle.close(); }
  });

  app.get<{ Params: { id: string } }>('/api/profile/:id', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new ProfileReviewService(repos);
      return await service.show(req.params.id);
    } finally { handle.close(); }
  });

  app.post('/api/profile/import', async (req, reply) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
      const service = new ProfileImportService({ paths, repositories: repos });
      const parts = req.parts();
      const filePaths: string[] = [];
      for await (const part of parts) {
        if (part.type === 'file' && typeof part.filename === 'string') {
          // v1 limitation: this endpoint accepts the filename only, not the file
          // body. The desktop UI (Phase D) currently passes absolute paths that
          // already exist on disk. Real browser uploads (multipart with file
          // bodies) are deferred; when added, this handler must consume
          // part.file via pipeline() or toBuffer() to avoid silent data loss.
          // Tracked in .slim/deepwork/progress.md.
          filePaths.push(part.filename);
        }
      }
      const result = await service.importSources(filePaths);
      reply.send({ schemaVersion: 1, ...result });
    } finally { handle.close(); }
  });

  app.post('/api/profile/extract', async (_req, reply) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const sources = await repos.profileSources.list();
      const usable = sources.filter((s) => s.textExtractionStatus === 'success').map((s) => s.id);
      const client = opts.openaiClient ?? resolveOpenAiClientOrNull();
      if (client === null) {
        reply.status(503);
        return { schemaVersion: 1, error: { code: 'openai_unavailable', message: 'OPENAI_API_KEY not set' } };
      }
      const service = new ProfileExtractionService({
        repositories: repos,
        openaiClient: client,
        config: { model: process.env['OPENAI_MODEL'] ?? 'gpt-5', reasoningEffort: 'medium' },
      });
      const status = await service.extract(usable);
      return { schemaVersion: 1, status };
    } finally { handle.close(); }
  });

  app.post<{ Params: { id: string } }>('/api/profile/:id/approve', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new ProfileApprovalService({
        repositories: repos,
        prompts: { confirmApprovalWithWarnings: async () => true },
      });
      return await service.approve(req.params.id);
    } finally { handle.close(); }
  });

  app.post<{ Params: { id: string } }>('/api/profile/:id/reject', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new ProfileRejectionService({
        repositories: repos,
        prompts: { confirmRejection: async () => true },
      });
      return await service.reject(req.params.id);
    } finally { handle.close(); }
  });

  app.post<{ Params: { id: string }; Body: { profileJson?: unknown } }>(
    '/api/profile/:id/edit',
    async (req, reply) => {
      // v1 limitation: the interactive ProfileEditingService prompts over stdin
      // (Inquirer), which is incompatible with an HTTP sidecar. Calling it would
      // hang or throw TtyError. Surface this clearly to the desktop UI,
      // acknowledge the body, and signal the follow-up. The full programmatic
      // edit (apply profileJson as a new draft version via the repo) is tracked
      // as a known limitation in .slim/deepwork/progress.md.
      reply.status(501);
      return {
        schemaVersion: 1,
        error: {
          code: 'edit_via_http_not_supported',
          message:
            'Profile editing is not yet supported over HTTP in v1. The desktop UI should display the profile JSON, edit it locally, and POST the new draft via a follow-up endpoint. Tracked in .slim/deepwork/progress.md.',
        },
        receivedProfileJson: req.body?.profileJson,
        receivedSourceId: req.params.id,
      };
    },
  );
}
