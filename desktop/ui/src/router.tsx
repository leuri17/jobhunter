import { createRouter } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root';
import { Route as indexRoute } from './routes/index';
import { Route as jobsRoute } from './routes/jobs';
import { Route as pipelineRoute } from './routes/pipeline';
import { Route as runsRoute } from './routes/runs';
import { Route as profileRoute } from './routes/profile';
import { Route as settingsRoute } from './routes/settings';

// Code-based composition: each route file exports its `Route`, we wire the
// tree here. This sidesteps the TanStack Router Vite codegen plugin (added
// friction in a worktree-only scaffold) while keeping the file-based
// directory structure for future codegen adoption.
const routeTree = rootRoute.addChildren([
  indexRoute,
  jobsRoute,
  pipelineRoute,
  runsRoute,
  profileRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
