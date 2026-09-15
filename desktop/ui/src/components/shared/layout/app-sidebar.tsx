import { Briefcase, Folder, Gauge, ListChecks, Settings, User } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { StatusPill } from '../ui/status-pill';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/pipeline', label: 'Pipeline', icon: ListChecks },
  { to: '/runs', label: 'Runs', icon: Folder },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function AppSidebar() {
  return (
    <Sidebar variant="inset" className="px-4">
      <SidebarHeader>
        <div className="">
          <h1 className="text-lg font-semibold">JobHunter</h1>
          <p className="text-xs text-muted-foreground">v0.1.0</p>
        </div>
      </SidebarHeader>

      <Separator className="my-2" />

      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            {NAV.map(({ to, icon: Icon, label }) => {
              return (
                <SidebarMenuButton
                  key={to}
                  size="lg"
                  render={
                    <Link to={to}>
                      <Icon /> {label}
                    </Link>
                  }
                />
              );
            })}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <StatusPill />
      </SidebarFooter>
    </Sidebar>
  );
}
