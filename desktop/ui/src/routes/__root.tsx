import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ErrorBoundary } from '@/components/shared/ui/error-boundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toast';
import { AppSidebar } from '@/components/shared/layout/app-sidebar';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
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
