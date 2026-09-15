import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ErrorBoundary } from '@/components/shared/ui/error-boundary';
// import { SidecarBanner } from '@/components/shared/ui/sidecar-banner';
// import { useSidecarReachability } from '@/lib/sidecar-reachability';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toast';
import { AppSidebar } from '@/components/shared/layout/app-sidebar';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  // const reachability = useSidecarReachability();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          {/* <SidecarBanner state={reachability} /> */}
          <ErrorBoundary>
            <main className="flex-1 overflow-auto p-4">
              <Outlet />
            </main>
          </ErrorBoundary>
        </SidebarInset>

        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
