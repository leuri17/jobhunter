import { Suspense } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ErrorBoundary } from '@/components/shared/ui/error-boundary';
import { SidecarBanner } from '@/components/shared/ui/sidecar-banner';
import { Spinner } from '@/components/ui/spinner';
import { useSidecarReachability } from '@/lib/sidecar-reachability';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toast';
import { AppSidebar } from '@/components/shared/layout/app-sidebar';

export const Route = createRootRoute({
  component: RootLayout,
});

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-full items-center justify-center p-12"
    >
      <Spinner className="size-8" />
    </div>
  );
}

function RootLayout() {
  const reachability = useSidecarReachability();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SidecarBanner state={reachability} />
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <main className="flex-1 overflow-auto p-4">
                <Outlet />
              </main>
            </Suspense>
          </ErrorBoundary>
        </SidebarInset>

        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
