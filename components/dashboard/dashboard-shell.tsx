'use client';

import { useMemo, type CSSProperties } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { LogIn, ShieldCheck } from 'lucide-react';
import { AppSidebar } from '@/components/dashboard/app-sidebar';
import {
  getDashboardServiceCount,
  getRoleLabel,
  getVisibleDashboardServices,
  type DashboardRole,
} from '@/components/dashboard/dashboard-data';
import { SectionCards } from '@/components/dashboard/section-cards';
import { ServiceCardGrid } from '@/components/dashboard/service-card-grid';
import { ServicesDataTable } from '@/components/dashboard/services-data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { SiteHeader } from '@/components/dashboard/site-header';
import { sanitizeServiceKeys, type ServiceKey } from '@/app/lib/service-definitions';

type DashboardSessionUser = {
  name?: string | null;
  email?: string | null;
  role?: DashboardRole | null;
  roles?: DashboardRole[];
  serviceKeys?: ServiceKey[];
  affiliateName?: string | null;
};

export function DashboardShell() {
  const { data: session, status } = useSession();
  const user = session?.user as DashboardSessionUser | undefined;
  const userRole = user?.role;
  const userRoles = user?.roles || (userRole ? [userRole] : []);
  const serviceKeys = sanitizeServiceKeys(user?.serviceKeys);
  const isAuthenticated = status === 'authenticated';
  const isAdmin = userRole === 'admin' || userRoles.includes('admin');
  const roleLabel = getRoleLabel(userRole || userRoles[0]);
  const totalServices = getDashboardServiceCount();

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

  const sessionLabel =
    status === 'loading' ? 'جاري التحقق' : isAuthenticated ? 'نشطة الآن' : 'غير مسجلة';

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
          lastUpdated={lastUpdated}
        />
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
            {status === 'loading' ? (
              <DashboardLoadingState />
            ) : isAuthenticated ? (
              <>
                <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <Badge variant="outline" className="rounded-md">
                      {roleLabel}
                    </Badge>
                    <h1 className="mt-3 text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
                      لوحة التحكم
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                      روابط تشغيلية مرتبة حسب صلاحياتك للوصول السريع إلى الطلبات،
                      المستودع، المالية، وخدمات المتجر.
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link href="/order-invoice-search" prefetch={false}>
                      بحث الطلبات
                    </Link>
                  </Button>
                </section>

                <SectionCards
                  availableServices={services.length}
                  totalServices={totalServices}
                  sessionLabel={sessionLabel}
                  roleLabel={roleLabel}
                  lastUpdated={lastUpdated}
                />

                {services.length > 0 ? (
                  <>
                    <section className="space-y-3">
                      <div>
                        <h2 className="text-lg font-semibold tracking-normal">الأكثر استخداماً</h2>
                        <p className="text-sm text-muted-foreground">
                          اختصارات لأهم الخدمات المتاحة لهذا الحساب.
                        </p>
                      </div>
                      <ServiceCardGrid services={services} />
                    </section>

                    <section className="space-y-3">
                      <div>
                        <h2 className="text-lg font-semibold tracking-normal">كل الخدمات</h2>
                        <p className="text-sm text-muted-foreground">
                          جدول shadcn مبني من نفس تعريفات الخدمات الحالية.
                        </p>
                      </div>
                      <ServicesDataTable services={services} />
                    </section>
                  </>
                ) : (
                  <NoServicesState />
                )}
              </>
            ) : (
              <UnauthenticatedState totalServices={totalServices} />
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function DashboardLoadingState() {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="rounded-lg">
            <CardHeader>
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-36" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="rounded-lg">
            <CardHeader>
              <Skeleton className="h-9 w-9 rounded-md" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NoServicesState() {
  return (
    <Card className="rounded-lg border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <ShieldCheck className="size-10 text-muted-foreground" />
        <CardTitle className="mt-4 text-xl">لا توجد خدمات متاحة لهذا الحساب</CardTitle>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          يظهر هذا التنبيه عندما لا يحتوي الحساب على مفاتيح خدمات مفعلة. يمكن للمسؤول
          تحديث الصلاحيات من إدارة المستخدمين.
        </p>
      </CardContent>
    </Card>
  );
}

function UnauthenticatedState({ totalServices }: { totalServices: number }) {
  return (
    <Card className="rounded-lg">
      <CardContent className="grid gap-6 p-6 md:grid-cols-[1.5fr_1fr] md:p-8">
        <div>
          <Badge variant="secondary" className="rounded-md">
            {totalServices} خدمة تشغيلية
          </Badge>
          <h1 className="mt-4 text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
            سجّل الدخول للوصول إلى لوحة التحكم
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            بعد تسجيل الدخول ستظهر خدمات الحساب حسب الصلاحيات الحالية، مع شريط جانبي
            للتنقل السريع بين الطلبات، المستودع، المرتجعات، والمالية.
          </p>
          <Button asChild className="mt-6">
            <Link href="/login" prefetch={false}>
              <LogIn className="size-4" />
              تسجيل الدخول
            </Link>
          </Button>
        </div>
        <div className="rounded-lg border bg-muted/50 p-4">
          <h2 className="text-sm font-medium">ما الذي سيتغير؟</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            <li>شريط جانبي قابل للطي مبني على shadcn sidebar.</li>
            <li>بطاقات إحصائية shadcn لحالة الحساب والخدمات.</li>
            <li>جدول خدمات مرتب حسب التصنيف والصلاحيات.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
