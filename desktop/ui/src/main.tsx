import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { routeTree } from './routeTree.gen';
import { Spinner } from './components/ui/spinner';

const router = createRouter({
  routeTree,
  defaultPendingComponent: () => (
    <div className="flex min-h-full items-center justify-center">
      <Spinner className="size-8" />
    </div>
  ),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root === null) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
