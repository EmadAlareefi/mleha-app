'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { AppSidebar } from '@/components/dashboard/app-sidebar';
import {
  getRoleLabel,
  getVisibleDashboardServices,
  type DashboardRole,
} from '@/components/dashboard/dashboard-data';
import { SiteHeader } from '@/components/dashboard/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { sanitizeServiceKeys, type ServiceKey } from '@/app/lib/service-definitions';

type DashboardSessionUser = {
  name?: string | null;
  email?: string | null;
  role?: DashboardRole | null;
  roles?: DashboardRole[];
  serviceKeys?: ServiceKey[];
  affiliateName?: string | null;
};

type AppPageShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  contentClassName?: string;
};

export function AppPageShell({ title, subtitle, children, contentClassName }: AppPageShellProps) {
  const { data: session, status } = useSession();
  const user = session?.user as DashboardSessionUser | undefined;
  const userRole = user?.role;
  const userRoles = user?.roles || (userRole ? [userRole] : []);
  const serviceKeys = sanitizeServiceKeys(user?.serviceKeys);
  const isAuthenticated = status === 'authenticated';
  const isAdmin = userRole === 'admin' || userRoles.includes('admin');
  const roleLabel = getRoleLabel(userRole || userRoles[0]);

  const lastUpdated = useMemo(
    () =>
      new Intl.DateTimeFormat('ar-SA', {
        hour: 'numeric',
        minute: 'numeric',
      }).format(new Date()),
    []
  );

  const services = useMemo(
    () =>
      getVisibleDashboardServices({
        isAuthenticated,
        isAdmin,
        serviceKeys,
        affiliateName: user?.affiliateName,
      }),
    [isAuthenticated, isAdmin, serviceKeys, user?.affiliateName]
  );

  return (
    <SidebarProvider
      className="bg-background"
      style={
        {
          '--sidebar-width': '18rem',
          '--header-height': '4rem',
        } as CSSProperties
      }
    >
      <AppSidebar
        services={services}
        isAuthenticated={isAuthenticated}
        isAdmin={isAdmin}
        userName={user?.name}
        userEmail={user?.email}
        roleLabel={roleLabel}
      />
      <SidebarInset className="min-h-svh overflow-hidden">
        <SiteHeader
          isAuthenticated={isAuthenticated}
          userName={user?.name}
          title={title}
          subtitle={subtitle}
          lastUpdated={lastUpdated}
        />
        <main className={contentClassName || 'flex flex-1 flex-col gap-6 p-4 md:p-6'}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
