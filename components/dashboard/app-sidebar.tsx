'use client';

import Link from 'next/link';
import { Home, IdCard, Printer, Settings, Users } from 'lucide-react';
import type { DashboardService } from '@/components/dashboard/dashboard-data';
import { dashboardCategories } from '@/components/dashboard/dashboard-data';
import { NavUser } from '@/components/dashboard/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';

type AppSidebarProps = {
  services: DashboardService[];
  isAuthenticated: boolean;
  isAdmin: boolean;
  userName?: string | null;
  userEmail?: string | null;
  roleLabel: string;
};

const adminLinks = [
  {
    title: 'إدارة المستخدمين',
    href: '/order-users-management',
    Icon: Users,
  },
  {
    title: 'إعدادات الطابعات',
    href: '/printer-settings',
    Icon: Printer,
  },
  {
    title: 'الإعدادات',
    href: '/settings',
    Icon: Settings,
  },
];

export function AppSidebar({
  services,
  isAuthenticated,
  isAdmin,
  userName,
  userEmail,
  roleLabel,
}: AppSidebarProps) {
  const groupedServices = dashboardCategories
    .map((category) => ({
      ...category,
      services: services.filter((service) => service.category === category.id),
    }))
    .filter((category) => category.services.length > 0);

  return (
    <Sidebar side="right" variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={{ children: 'الرئيسية', side: 'left' }}>
              <Link href="/" prefetch={false}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Home className="size-4" />
                </div>
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-semibold">مليحة</span>
                  <span className="truncate text-xs">لوحة التحكم</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>روابط سريعة</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive tooltip={{ children: 'الرئيسية', side: 'left' }}>
                  <Link href="/" prefetch={false}>
                    <Home className="size-4" />
                    <span>الرئيسية</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isAuthenticated && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={{ children: 'ملفي الشخصي', side: 'left' }}>
                    <Link href="/my-profile" prefetch={false}>
                      <IdCard className="size-4" />
                      <span>ملفي الشخصي</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {groupedServices.map((category) => (
          <SidebarGroup key={category.id}>
            <SidebarGroupLabel>{category.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {category.services.map((service) => {
                  const Icon = service.Icon;

                  return (
                    <SidebarMenuItem key={service.key}>
                      <SidebarMenuButton
                        asChild
                        tooltip={{ children: service.title, side: 'left' }}
                        className="text-start"
                      >
                        <Link href={service.href} prefetch={false}>
                          <Icon className="size-4" />
                          <span>{service.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {isAdmin && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>إدارة النظام</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminLinks.map((link) => {
                    const Icon = link.Icon;

                    return (
                      <SidebarMenuItem key={link.href}>
                        <SidebarMenuButton
                          asChild
                          tooltip={{ children: link.title, side: 'left' }}
                          className="text-start"
                        >
                          <Link href={link.href} prefetch={false}>
                            <Icon className="size-4" />
                            <span>{link.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      {isAuthenticated && (
        <SidebarFooter>
          <NavUser name={userName} email={userEmail} roleLabel={roleLabel} />
        </SidebarFooter>
      )}
      <SidebarRail />
    </Sidebar>
  );
}
